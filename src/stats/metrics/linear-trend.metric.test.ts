import { describe, expect, it } from 'vitest'

import metric from './linear-trend.metric'
import { daily } from './testData'

describe('linear trend metric', () => {
  it('hand-calculated: 0.5 per day = 3.5 per week', () => {
    expect(metric.compute(daily([1, 1.5, 2, 2.5, 3]), { subject: 'number' })).toEqual({
      status: 'ok',
      n: 5,
      missing: 0,
      value: { kind: 'trend', slopePerWeek: 3.5, intercept: 1, originDate: '2026-11-01' },
    })
  })

  it('uses calendar spacing, not position: missing days are skipped, not interpolated', () => {
    // y = day at days 0, 2, 4, 6, 8 → 1 per day = 7 per week
    const result = metric.compute(daily([0, null, 2, null, 4, null, 6, null, 8]), { subject: 'number' })

    expect(result).toMatchObject({ status: 'ok', n: 5, missing: 4, value: { slopePerWeek: 7 } })
  })

  it('a flat series has a zero trend', () => {
    expect(metric.compute(daily([4, 4, 4, 4, 4]), { subject: 'number' })).toMatchObject({ value: { slopePerWeek: 0 } })
  })

  it('empty, single and same-date inputs are insufficient', () => {
    expect(metric.compute([], { subject: 'number' }).status).toBe('insufficient')
    expect(metric.compute(daily([3]), { subject: 'number' }).status).toBe('insufficient')
    expect(
      metric.compute([1, 2, 3, 4, 5].map((value) => ({ date: '2026-11-01', value })), { subject: 'number' }),
    ).toMatchObject({ status: 'insufficient', reason: 'Insufficient data: all observations are on the same date.' })
  })
})
