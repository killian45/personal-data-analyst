import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { validateSettingRecord } from '../backup/restore/validateRecords'
import { db } from '../database/db'

import { baselineShare, cleanProfile, EMPTY_PROFILE, GoalFieldError, goalProgress, parseGoals, parseProfile, rulesFor, validateGoal } from './goals'
import type { Goal } from './goals'
import { deleteGoal, loadGoals, loadProfile, saveGoal, saveProfile } from './goalsStore'

const goal = (changes: Partial<Goal> = {}): Goal => ({
  id: 'g1', title: 'Sleep 7 h 30 on average', kind: 'outcome', progressMeasure: 'sleep:duration',
  success: { measure: 'sleep:duration', rule: 'mean-at-least', target: 7.5, share: null },
  ambition: 6, realism: 7, startUtc: '2026-11-01T07:00:00.000Z', endUtc: '2026-11-10T21:00:00.000Z', timezone: 'Europe/Paris',
  createdAt: '2026-10-31T10:00:00.000Z', updatedAt: '2026-10-31T10:00:00.000Z', ...changes,
})
const period = { start: '2026-11-01', end: '2026-11-10' }
const days = (values: (number | null)[], start = 1) =>
  values.flatMap((value, index) => (value === null ? [] : [{ date: `2026-11-${String(start + index).padStart(2, '0')}`, value }]))

describe('validateGoal (every field required)', () => {
  it('accepts a complete goal', () => {
    expect(() => validateGoal(goal())).not.toThrow()
  })

  it('names the missing or wrong field', () => {
    expect(() => validateGoal(goal({ title: '  ' }))).toThrow('Describe the goal')
    expect(() => validateGoal(goal({ progressMeasure: '' }))).toThrow('measure for progress')
    expect(() => validateGoal(goal({ success: { measure: 'sleep:duration', rule: 'days-at-least', target: 7, share: null } }))).toThrow('share of days')
    expect(() => validateGoal(goal({ ambition: 11 }))).toThrow('ambition from 1 to 10')
    expect(() => validateGoal(goal({ realism: 0 }))).toThrow('realism from 1 to 10')
    expect(() => validateGoal(goal({ endUtc: '2026-11-01T07:00:00.000Z' }))).toThrow('finish must be after the start')
  })

  it('tags the target and date errors so the form never depends on their wording', () => {
    const fieldOf = (changes: Partial<Goal>) => {
      try {
        validateGoal(goal(changes))
      } catch (caught) {
        return caught instanceof GoalFieldError ? caught.field : 'untagged'
      }
      return 'no error'
    }
    expect(fieldOf({ success: { measure: 'sleep:duration', rule: 'mean-at-least', target: Number.NaN, share: null } })).toBe('target')
    expect(fieldOf({ startUtc: '' })).toBe('dates')
    expect(fieldOf({ title: '' })).toBe('untagged')
  })

  it('reads a stored list and refuses broken ones (also in backups and sync)', () => {
    expect(parseGoals(JSON.stringify([goal()]))).toEqual([goal()])
    expect(parseGoals(JSON.stringify([goal(), goal()]))).toBeNull() // same id twice
    expect(parseGoals(JSON.stringify([goal({ kind: 'dream' as never })]))).toBeNull()
    const base = { key: 'goals.list', updatedAt: '2026-11-12T10:00:00.000Z', syncStatus: 'pending', revision: 1, syncedRevision: null, deletedAt: null }
    expect(() => validateSettingRecord({ ...base, value: '[{"id":"x"}]' })).toThrow('invalid list of goals')
  })
})

describe('profile (every field optional)', () => {
  it('trims texts and drops empty epochs; too long is refused', () => {
    const cleaned = cleanProfile({ ...EMPTY_PROFILE, virtues: '  patient ', epochs: [{ title: 'University', text: ' Lyon ' }, { title: ' ', text: '' }] })
    expect(cleaned).toEqual({ ...EMPTY_PROFILE, virtues: 'patient', epochs: [{ title: 'University', text: 'Lyon' }] })
    expect(parseProfile(JSON.stringify(cleaned))).toEqual(cleaned)
    expect(parseProfile(JSON.stringify({ ...EMPTY_PROFILE, faults: 'x'.repeat(5001) }))).toBeNull()
  })
})

describe('goalProgress (hand-calculated)', () => {
  it('mean at least: average of the days WITH data (missing days are not 0)', () => {
    // 7, missing, 8, 6.5 → mean 7.17 < 7.5
    const progress = goalProgress(goal(), period, days([7, null, 8, 6.5]), '2026-11-04')
    expect(progress).toMatchObject({ status: 'in-progress', daysTotal: 10, daysElapsed: 4, daysWithData: 3, met: false })
    expect(progress.value).toBeCloseTo(7.1667, 3)
  })

  it('total at least: met when the pace reaches the target by the finish', () => {
    const steps = goal({ success: { measure: 'health:steps', rule: 'total-at-least', target: 80000, share: null } })
    // 5 days, 9,000 a day → 45,000 so far, 90,000 at this pace over 10 days.
    const progress = goalProgress(steps, period, days([9000, 9000, 9000, 9000, 9000]), '2026-11-05')
    expect(progress).toMatchObject({ value: 45000, projected: 90000, met: true })
    // Finished: only the real total counts.
    expect(goalProgress(steps, period, days([9000, 9000]), '2026-11-20')).toMatchObject({ status: 'finished', value: 18000, met: false })
  })

  it('days at least: share of the days with data reaching the level', () => {
    const habit = goal({ success: { measure: 'habit:x', rule: 'days-at-least', target: 1, share: 80 } })
    // 4 of 5 days done = 80 %
    expect(goalProgress(habit, period, days([1, 1, 0, 1, 1]), '2026-11-05')).toMatchObject({ value: 80, met: true })
    // at most: screen time ≤ 2 h on 50 % of days → 1 of 3 = 33 %
    const screen = goal({ success: { measure: 'screenTime', rule: 'days-at-most', target: 2, share: 50 } })
    expect(goalProgress(screen, period, days([1.5, 3, 2.5]), '2026-11-03').met).toBe(false)
  })

  it('before the start, and without data', () => {
    expect(goalProgress(goal(), period, days([7]), '2026-10-30')).toMatchObject({ status: 'not-started', daysElapsed: 0, value: null, met: null })
  })

  it('rules offered per kind of measure', () => {
    expect(rulesFor('clock')).not.toContain('total-at-least')
    expect(rulesFor('binary')).toEqual(['days-at-least'])
  })
})

describe('baselineShare (the data figure)', () => {
  it('share of the days before the start reaching the daily level', () => {
    const daily = [{ date: '2026-10-29', value: 8 }, { date: '2026-10-30', value: 7 }, { date: '2026-10-31', value: 7.5 }, { date: '2026-11-01', value: 9 }]
    expect(baselineShare(goal(), period, daily)).toEqual({ share: 67, n: 3, level: 7.5, mean: 7.5, first: '2026-10-29' }) // 8 and 7.5 of 3 days; 1 Nov is in the goal; mean (8 + 7 + 7.5) / 3
  })

  it('for totals, the daily level is the pace the total needs', () => {
    const steps = goal({ success: { measure: 'health:steps', rule: 'total-at-least', target: 80000, share: null } })
    expect(baselineShare(steps, period, [{ date: '2026-10-30', value: 9000 }, { date: '2026-10-31', value: 7000 }])).toEqual({ share: 50, n: 2, level: 8000, mean: 8000, first: '2026-10-30' })
  })

  it('covers 90 days by default, or all data before the start with days = null', () => {
    const daily = [{ date: '2025-12-05', value: 8 }, { date: '2026-10-31', value: 7 }]
    expect(baselineShare(goal(), period, daily)).toMatchObject({ share: 0, n: 1, first: '2026-10-31' })
    expect(baselineShare(goal(), period, daily, null)).toEqual({ share: 50, n: 2, level: 7.5, mean: 7.5, first: '2025-12-05' })
  })
})

describe('storage', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('saves the profile and goals as settings (synced, in backups)', async () => {
    expect(await loadProfile()).toEqual(EMPTY_PROFILE)
    await saveProfile({ ...EMPTY_PROFILE, aiStyle: ' direct ' })
    expect((await loadProfile()).aiStyle).toBe('direct')
    await saveGoal(goal())
    await saveGoal(goal({ id: 'g2', title: 'Second' }))
    await saveGoal(goal({ title: 'Edited' }))
    expect((await loadGoals()).map((g) => g.title)).toEqual(['Edited', 'Second'])
    await deleteGoal('g1')
    expect((await loadGoals()).map((g) => g.id)).toEqual(['g2'])
    await expect(saveGoal(goal({ id: 'g3', ambition: 0 }))).rejects.toThrow('ambition')
    expect(await db.settings.get('goals.list')).toMatchObject({ syncStatus: 'pending' })
  })
})
