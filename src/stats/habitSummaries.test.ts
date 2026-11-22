import { describe, expect, it } from 'vitest'

import { checkboxSummary, countSummary, hoursToMinutes, stopwatchSummary } from './habitSummaries'

const WEEK = { start: '2026-11-01', end: '2026-11-07' }

describe('checkboxSummary', () => {
  it('uses observed days as the denominator; missing days are neither done nor failed', () => {
    const summary = checkboxSummary(
      [
        { date: '2026-11-01', done: true },
        { date: '2026-11-02', done: false },
        { date: '2026-11-04', done: true },
        { date: '2026-11-05', done: true },
      ],
      WEEK,
    )

    expect(summary).toMatchObject({
      observedDays: 4,
      doneDays: 3,
      notDoneDays: 1,
      missingDays: 3,
      completionRate: 0.75,
    })
  })

  it('counts a day as done if it has at least one Done entry', () => {
    const summary = checkboxSummary(
      [
        { date: '2026-11-01', done: false },
        { date: '2026-11-01', done: true },
      ],
      WEEK,
    )

    expect(summary).toMatchObject({ doneDays: 1, notDoneDays: 0 })
  })

  it('streaks: a missing day neither breaks nor extends, a not-done day breaks', () => {
    const summary = checkboxSummary(
      [
        { date: '2026-11-01', done: true },
        // 2 Nov missing: does not break
        { date: '2026-11-03', done: true },
        { date: '2026-11-04', done: false },
        { date: '2026-11-05', done: true },
        { date: '2026-11-06', done: true },
      ],
      WEEK,
    )

    expect(summary.longestStreak).toBe(2)
    expect(summary.currentStreak).toBe(2)
  })

  it('ignores entries outside the range and handles no entries', () => {
    expect(checkboxSummary([{ date: '2026-12-01', done: true }], WEEK)).toEqual({
      observedDays: 0,
      doneDays: 0,
      notDoneDays: 0,
      missingDays: 7,
      completionRate: null,
      longestStreak: 0,
      currentStreak: 0,
    })
  })
})

describe('stopwatchSummary', () => {
  it('gives the total and the mean per day with a session', () => {
    const hour = 3_600_000

    expect(
      stopwatchSummary([
        { date: '2026-11-01', durationMs: hour },
        { date: '2026-11-01', durationMs: hour },
        { date: '2026-11-03', durationMs: hour },
        { date: '2026-11-04', durationMs: -5 },
        { date: '2026-11-04', durationMs: Number.NaN },
      ]),
    ).toEqual({ totalMs: 3 * hour, validDays: 2, meanPerValidDayMs: 1.5 * hour, sessions: 3 })
  })

  it('handles no sessions', () => {
    expect(stopwatchSummary([])).toEqual({ totalMs: 0, validDays: 0, meanPerValidDayMs: null, sessions: 0 })
  })
})

describe('countSummary', () => {
  it('counts values, includes unused label options, most frequent first', () => {
    expect(countSummary(['Good', 'Bad', 'Good'], ['Good', 'Neutral', 'Bad'])).toEqual({
      total: 3,
      byValue: [
        { value: 'Good', count: 2 },
        { value: 'Bad', count: 1 },
        { value: 'Neutral', count: 0 },
      ],
    })
  })
})

describe('hoursToMinutes', () => {
  it('converts axis deviations to minutes', () => {
    expect(hoursToMinutes(0.25)).toBe(15)
  })
})
