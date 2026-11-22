import { describe, expect, it } from 'vitest'

import { movingAverage } from './timeseries'
import { linearTrend } from './trend'

describe('movingAverage', () => {
  it('averages the last 7 calendar days and skips missing days', () => {
    const points = movingAverage(
      [
        { date: '2026-11-01', value: 1 },
        { date: '2026-11-02', value: 2 },
        { date: '2026-11-03', value: null },
        { date: '2026-11-04', value: 3 },
        { date: '2026-11-05', value: 4 },
        { date: '2026-11-09', value: 10 },
      ],
      { windowDays: 7, minObservations: 4 },
    )

    expect(points.map((p) => [p.date, p.value, p.n])).toEqual([
      ['2026-11-01', null, 1],
      ['2026-11-02', null, 2],
      ['2026-11-03', null, 2],
      ['2026-11-04', null, 3],
      // 1 + 2 + 3 + 4 = 10 / 4
      ['2026-11-05', 2.5, 4],
      ['2026-11-06', 2.5, 4],
      ['2026-11-07', 2.5, 4],
      // Window 2 Nov – 8 Nov: 2, 3, 4 → only 3 days
      ['2026-11-08', null, 3],
      // Window 3 Nov – 9 Nov: 3, 4, 10 → only 3 days
      ['2026-11-09', null, 3],
    ])
  })

  it('returns nothing without valid observations and refuses a bad window', () => {
    expect(movingAverage([{ date: '2026-11-01', value: null }])).toEqual([])
    expect(() => movingAverage([], { windowDays: 0 })).toThrow()
  })
})

describe('linearTrend', () => {
  it('uses actual calendar spacing and reports the slope per week', () => {
    // y = 2 + day at irregular days 0, 1, 4, 8, 9 → 1 per day = 7 per week
    const result = linearTrend([
      { date: '2026-11-01', value: 2 },
      { date: '2026-11-02', value: 3 },
      { date: '2026-11-05', value: 6 },
      { date: '2026-11-09', value: 10 },
      { date: '2026-11-10', value: 11 },
    ])

    expect(result.slopePerWeek).toBeCloseTo(7, 12)
    expect(result.intercept).toBeCloseTo(2, 12)
  })

  it('matches a hand-calculated least-squares fit', () => {
    // x = 0 2 4 6 8, y = 1 3 2 5 4: x̄ = 4, ȳ = 3, Sxy = 16, Sxx = 40
    // slope = 0.4 per day = 2.8 per week, intercept = 3 − 0.4·4 = 1.4
    const result = linearTrend(
      [1, 3, 2, 5, 4].map((value, index) => ({
        date: `2026-11-${String(1 + index * 2).padStart(2, '0')}`,
        value,
      })),
    )

    expect(result.slopePerWeek).toBeCloseTo(2.8, 12)
    expect(result.intercept).toBeCloseTo(1.4, 12)
    expect(result.originDate).toBe('2026-11-01')
  })

  it('excludes missing values and needs 5 observations on different dates', () => {
    expect(linearTrend([1, 2, 3, null, 4].map((value, i) => ({ date: `2026-11-0${i + 1}`, value }))).insufficient).toBe(true)
    expect(linearTrend([1, 2, 3, 4, 5].map((value) => ({ date: '2026-11-01', value }))).insufficient).toBe(true)
  })
})
