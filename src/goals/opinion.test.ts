import { afterEach, describe, expect, it } from 'vitest'

import type { Measure } from '../analysis/measures'

import { EMPTY_PROFILE } from './goals'
import type { Goal } from './goals'
import { buildOpinionFacts, clearOpinions, GOAL_OPINIONS_KEY, loadOpinions, opinionInstructions, parseOpinion, parseOpinions, saveOpinion } from './opinion'

const AT = '2026-11-13T10:00:00.000Z'

// Water: before the goal 2100 and 1000 ml (50 % of days ≥ 2000); during it 2500 and 1500 (mean 2000).
const water: Measure = {
  id: 'habit:water', label: 'Water', group: 'Habits', kind: 'number', unit: 'ml', per: 'day',
  daily: [['2026-10-30', 2100], ['2026-10-31', 1000], ['2026-11-08', 2500], ['2026-11-09', 1500]].map(([date, value]) => ({ date: date as string, value: value as number })),
}
const goal: Goal = {
  id: 'g1', title: 'Drink 2 litres a day', kind: 'process', progressMeasure: 'habit:water',
  success: { measure: 'habit:water', rule: 'mean-at-least', target: 2000, share: null }, ambition: 7, realism: 5,
  startUtc: '2026-11-01T11:00:00.000Z', endUtc: '2026-11-30T11:00:00.000Z', timezone: 'Europe/Paris',
  createdAt: AT, updatedAt: AT,
}

afterEach(() => localStorage.clear())

describe('buildOpinionFacts', () => {
  it('gives today, the goal with the app’s figures and the person’s strengths and weaknesses (shortened)', () => {
    const facts = buildOpinionFacts({ goal, measures: [water], profile: { ...EMPTY_PROFILE, virtues: 'Patient.', faults: 'w '.repeat(1000), futurePlan: 'Not sent.' }, today: '2026-11-10' })
    expect(facts[0]).toBe('Today is 10/11/2026.')
    expect(facts[1]).toContain('Goal: "Drink 2 litres a day" (process goal, 01/11/2026 to 30/11/2026; in progress, day 10 of 30).')
    expect(facts[1]).toContain('So far: 2,000 ml, on track (2 days with data).')
    expect(facts[1]).toContain('on 50 % of days (2 days with data).')
    // Only 2 values in the last 30 days → no statistics sentence (at least 5 needed).
    expect(facts.some((fact) => fact.startsWith('Statistics'))).toBe(false)
    expect(facts[2]).toBe('Strengths (their own words): Patient.')
    expect(facts[3].length).toBeLessThan(650)
    expect(facts.join(' ')).not.toContain('Not sent.')
  })

  it('adds the 30-day statistics of the goal’s measures when there are enough days', () => {
    const steady: Measure = { ...water, daily: Array.from({ length: 6 }, (_, i) => ({ date: `2026-11-0${i + 1}`, value: 1800 })) }
    const facts = buildOpinionFacts({ goal, measures: [steady], profile: EMPTY_PROFILE, today: '2026-11-10' })
    expect(facts[2]).toBe('Statistics, last 30 days: Water: on average 1,800 ml per day (6 days); no comparison with the previous period (too few days).')
    expect(facts).toHaveLength(3)
  })
})

describe('opinion instructions and reply', () => {
  it('asks for a fixed first line and adds the style', () => {
    expect(opinionInstructions(EMPTY_PROFILE)).toContain('"Likelihood: high", "Likelihood: medium" or "Likelihood: low"')
    expect(opinionInstructions({ ...EMPTY_PROFILE, aiStyle: 'Blunt' })).toMatch(/Style: Blunt\.$/)
  })

  it('reads the likelihood from the first line, also with formatting, and keeps the rest', () => {
    expect(parseOpinion('Likelihood: medium\nYou are on track.')).toEqual({ likelihood: 'medium', text: 'You are on track.' })
    expect(parseOpinion('**Likelihood: High**\n\nKeep going.')).toEqual({ likelihood: 'high', text: 'Keep going.' })
    expect(parseOpinion('likelihood low. Hard so far.')).toEqual({ likelihood: 'low', text: '' })
    expect(parseOpinion('I think you can do it.')).toEqual({ likelihood: null, text: 'I think you can do it.' })
  })
})

describe('opinion storage (this computer only)', () => {
  it('saves, removes and clears opinions per goal; ignores invalid content', () => {
    const opinion = { likelihood: 'high' as const, text: 'Yes.', facts: ['a'], model: 'llama3.2:3b', at: AT }
    saveOpinion('g1', opinion)
    saveOpinion('g2', { ...opinion, likelihood: null })
    expect(Object.keys(loadOpinions())).toEqual(['g1', 'g2'])
    saveOpinion('g2', null)
    expect(loadOpinions()).toEqual({ g1: opinion })
    clearOpinions()
    expect(localStorage.getItem(GOAL_OPINIONS_KEY)).toBeNull()
    expect(parseOpinions('nope')).toEqual({})
    expect(parseOpinions(JSON.stringify({ version: 1, opinions: { ok: opinion, bad: { ...opinion, likelihood: 'certain' } } }))).toEqual({ ok: opinion })
  })
})
