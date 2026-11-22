import { describe, expect, it } from 'vitest'

import type { Measure } from '../analysis/measures'
import { addDays } from '../stats/subjects'

import { buildChatContext, chosenGoals, estimateTokens, fitConversation, MAX_CURRENT_GOALS, PROFILE_BUDGET, shortenToBudget } from './chatContext'
import { EMPTY_PROFILE } from './goals'
import type { Goal } from './goals'

const TODAY = '2026-11-10'

function goal(id: string, start: string, end: string, extra: Partial<Goal> = {}): Goal {
  return {
    id, title: `Goal ${id}`, kind: 'process', progressMeasure: 'habit:water',
    success: { measure: 'habit:water', rule: 'mean-at-least', target: 2000, share: null },
    ambition: 7, realism: 5,
    startUtc: `${start}T11:00:00.000Z`, endUtc: `${end}T11:00:00.000Z`, timezone: 'Europe/Paris',
    createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z',
    ...extra,
  }
}

// Water: before the goal 2100 and 1000 ml (1 of 2 days ≥ 2000 → 50 %); during it 2500 and 1500 (mean 2000 → on track).
const water: Measure = {
  id: 'habit:water', label: 'Water', group: 'Habits', kind: 'number', unit: 'ml', per: 'day',
  daily: [['2026-10-30', 2100], ['2026-10-31', 1000], ['2026-11-08', 2500], ['2026-11-09', 1500]].map(([date, value]) => ({ date: date as string, value: value as number })),
}
// Sleep: 6 nights of 7 h in the last 30 days → one summary sentence.
const sleep: Measure = {
  id: 'sleep:duration', label: 'Sleep duration', group: 'Sleep', kind: 'duration', unit: null, per: 'night',
  daily: Array.from({ length: 6 }, (_, i) => ({ date: addDays('2026-11-01', i), value: 7 })),
}

describe('shortenToBudget', () => {
  it('keeps short texts whole and shares the rest equally (hand-calculated)', () => {
    // Lengths 10, 100, 100 with 110 characters: 10 kept, then 50 and 50.
    const result = shortenToBudget(['a'.repeat(10), 'b'.repeat(100), 'c'.repeat(100)], 110)
    expect(result.map((text) => text.length)).toEqual([10, 50, 50])
    expect(result[1].endsWith('…')).toBe(true)
    expect(result[0]).toBe('a'.repeat(10))
  })

  it('changes nothing when everything fits, and cuts at a word when one is near', () => {
    expect(shortenToBudget(['one', 'two'], 100)).toEqual(['one', 'two'])
    // 30 characters allowed: "word word word word word word" (29) is cut before the last space.
    const [cut] = shortenToBudget(['word word word word word word word word'], 30)
    expect(cut).toBe('word word word word word word…')
    expect(shortenToBudget([], 100)).toEqual([])
  })
})

describe('chosenGoals', () => {
  it('lists goals in progress first, then not started (by finish), then the 3 most recently finished', () => {
    const goals = [
      goal('later', '2026-12-01', '2026-12-31'),
      goal('now-long', '2026-11-01', '2026-12-15'),
      goal('now-short', '2026-11-01', '2026-11-20'),
      goal('done-1', '2026-09-01', '2026-09-30'),
      goal('done-2', '2026-10-01', '2026-10-31'),
      goal('done-3', '2026-08-01', '2026-08-31'),
      goal('done-4', '2026-07-01', '2026-07-31'),
    ]
    const { current, finished } = chosenGoals(goals, TODAY)
    expect(current.map((g) => g.id)).toEqual(['now-short', 'now-long', 'later'])
    expect(finished.map((g) => g.id)).toEqual(['done-2', 'done-1', 'done-3'])
    const many = Array.from({ length: 12 }, (_, i) => goal(`g${i}`, '2026-11-01', addDays('2026-11-20', i)))
    expect(chosenGoals(many, TODAY).current).toHaveLength(MAX_CURRENT_GOALS)
  })
})

describe('buildChatContext', () => {
  it('describes the profile, each goal with the app’s figures, and the 30-day statistics', () => {
    const context = buildChatContext({
      profile: { ...EMPTY_PROFILE, epochs: [{ title: 'University', text: 'Studied in Lyon.' }], virtues: 'Patient.', aiStyle: 'Direct', aiFormat: '' },
      goals: [goal('a', '2026-11-01', '2026-11-30', { title: 'Drink 2 litres a day' })],
      measures: [water, sleep],
      today: TODAY,
    })
    expect(context.shortened).toBe(false)
    expect(context.sections.map((s) => s.title)).toEqual([
      'Instructions', 'About you (your own texts)', 'Your goals (progress calculated by the app)', 'Your statistics, last 30 days (calculated by the app)',
    ])
    expect(context.sections[0].lines[0]).toContain('Style: Direct. Answer format: short: about 100 words')
    expect(context.sections[0].lines[0]).toContain('say you do not have it. (2) Measures that change together do not prove a cause. (3) Address')
    expect(context.system).not.toMatch(/professional|medical/)
    expect(context.sections[0].lines[1]).toBe('Today is 10/11/2026.')
    expect(context.sections[1].lines).toEqual(['Past — University: Studied in Lyon.', 'Strengths: Patient.'])
    const [line] = context.sections[2].lines
    expect(line).toContain('"Drink 2 litres a day" (process goal, 01/11/2026 to 30/11/2026; in progress, day 10 of 30).')
    expect(line).toContain('So far: 2,000 ml, on track (2 days with data).')
    expect(line).toContain('on 50 % of days (2 days with data).')
    expect(line).toContain('Own ratings: ambition 7/10, realism 5/10.')
    expect(context.sections[3].lines).toEqual([
      'Period: 12/10/2026 to 10/11/2026 (30 days).',
      'Sleep duration: on average 7 h 00 min per night (6 nights); no comparison with the previous period (too few days).',
    ])
    // The system message carries the same lines.
    expect(context.system).toContain('About you (your own texts):\n- Past — University: Studied in Lyon.')
    expect(context.system).toContain('- Sleep duration: on average 7 h 00 min')
  })

  it('adds a line over all data before the start when some data is older than 90 days (hand-calculated)', () => {
    // Before the start (01/11/2026): 05/12/2025 2200, 30/10 2100, 31/10 1000 → 2 of 3 days ≥ 2000 = 67 %;
    // average (2200 + 2100 + 1000) / 3 = 1,766.67 ml (the app's number format). The 90-day figure still counts 2 days (50 %).
    const withOld: Measure = { ...water, daily: [{ date: '2025-12-05', value: 2200 }, ...water.daily] }
    const [line] = buildChatContext({ profile: EMPTY_PROFILE, goals: [goal('a', '2026-11-01', '2026-11-30')], measures: [withOld], today: TODAY }).sections[2].lines
    expect(line).toContain('on 50 % of days (2 days with data).')
    expect(line).toContain('All your data before the start (since 05/12/2025): water was at least 2,000 ml on 67 % of days (3 days with data); average 1,766.67 ml per day.')
    // Without older data, no extra line.
    const [plain] = buildChatContext({ profile: EMPTY_PROFILE, goals: [goal('a', '2026-11-01', '2026-11-30')], measures: [water], today: TODAY }).sections[2].lines
    expect(plain).not.toContain('All your data')
  })

  it('says when there is nothing, uses default style and shortens long texts to the budget', () => {
    const empty = buildChatContext({ profile: EMPTY_PROFILE, goals: [], measures: [], today: TODAY })
    expect(empty.sections[1].lines).toEqual(['The person has not written anything about themselves.'])
    expect(empty.sections[2].lines).toEqual(['No goals yet.'])
    expect(empty.sections[3].lines[1]).toBe('Not enough data for statistics.')
    expect(empty.sections[0].lines[0]).toContain('Style: warm, honest and practical.')

    const long = buildChatContext({ profile: { ...EMPTY_PROFILE, virtues: 'x '.repeat(2500), faults: 'y '.repeat(2500), futurePlan: 'Short plan.' }, goals: [], measures: [], today: TODAY })
    expect(long.shortened).toBe(true)
    const texts = long.sections[1].lines.map((l) => l.slice(l.indexOf(': ') + 2))
    expect(texts.reduce((total, t) => total + t.length, 0)).toBeLessThanOrEqual(PROFILE_BUDGET)
    expect(texts[2]).toBe('Short plan.')
  })
})

describe('fitConversation', () => {
  it('keeps the most recent messages that fit, starting with a message from the person', () => {
    const system = 's'.repeat(3500) // 1,000 tokens → 4096 − 1000 − 700 = 2,396 tokens for messages
    const long = 'm'.repeat(3500) // 1,000 tokens (+4) each
    const messages = [
      { role: 'user' as const, content: long },
      { role: 'assistant' as const, content: long },
      { role: 'user' as const, content: long },
      { role: 'assistant' as const, content: 'ok' },
      { role: 'user' as const, content: 'Next?' },
    ]
    // From the newest: 'Next?' (6) + 'ok' (5) + long (1,004) + long (1,004) = 2,019 fit; a third long does not.
    // The kept part would then start with the assistant's long message → it starts at the person's instead.
    const { kept, dropped } = fitConversation(messages, system)
    expect(dropped).toBe(2)
    expect(kept[0]).toBe(messages[2])
    expect(estimateTokens(system)).toBe(1000)
    // Always at least the newest message, even when it alone is too long.
    expect(fitConversation([{ role: 'user', content: 'z'.repeat(50_000) }], system).kept).toHaveLength(1)
  })
})
