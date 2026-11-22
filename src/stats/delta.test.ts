import { describe, expect, it } from 'vitest'

import { deltaVersusPrevious, previousPeriod } from './delta'

describe('previousPeriod', () => {
  it('returns the equal-length period immediately before', () => {
    expect(previousPeriod({ start: '2026-11-03', end: '2026-11-09' })).toEqual({
      start: '2026-10-27',
      end: '2026-11-02',
    })
    expect(previousPeriod({ start: '2026-03-01', end: '2026-03-01' })).toEqual({
      start: '2026-02-28',
      end: '2026-02-28',
    })
  })

  it('refuses a range that ends before it starts', () => {
    expect(() => previousPeriod({ start: '2026-11-09', end: '2026-11-01' })).toThrow()
  })
})

describe('deltaVersusPrevious', () => {
  const previous = [6, 7, 8, 7, 7] // mean 7
  const current = [8, 7, 9, 8, 8] // mean 8

  it('gives the absolute and percent change for ratio-scale data', () => {
    expect(deltaVersusPrevious('sleepDuration', current, previous)).toMatchObject({
      insufficient: false,
      currentMean: 8,
      previousMean: 7,
      absolute: 1,
    })
    expect(deltaVersusPrevious('sleepDuration', current, previous).percent).toBeCloseTo(100 / 7, 10)
  })

  it('never gives a percent change for clock times such as bedtime', () => {
    const result = deltaVersusPrevious('bedtime', [23.5, 23.5, 24, 23, 23.5], [23, 23, 23, 23, 23])

    expect(result.absolute).toBeCloseTo(0.5, 12)
    expect(result.percent).toBeNull()
  })

  it('gives no percent change when values are negative or the previous mean is zero', () => {
    expect(deltaVersusPrevious('number', [1, 1, 1, 1, 1], [0, 0, 0, 0, 0]).percent).toBeNull()
    expect(deltaVersusPrevious('number', [1, 1, 1, 1, 1], [-1, 3, 1, 1, 1]).percent).toBeNull()
  })

  it('reports insufficient data when either period has fewer than 5 observations', () => {
    expect(deltaVersusPrevious('number', [1, 2, 3, 4, null], previous)).toMatchObject({
      insufficient: true,
      currentN: 4,
      previousN: 5,
      absolute: null,
    })
  })
})
