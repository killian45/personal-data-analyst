import { describe, expect, it } from 'vitest'

import metric from './moving-average-7d.metric'
import { daily } from './testData'

describe('7-day moving average metric', () => {
  it('hand-calculated trailing averages over calendar days', () => {
    const result = metric.compute(daily([1, 2, 3, 4, 5, 6, 7, 8]), { subject: 'number' })

    expect(result.status).toBe('ok')
    if (result.status === 'ok' && result.value.kind === 'series') {
      // Day 4: (1+2+3+4)/4 = 2.5; day 7: 28/7 = 4; day 8: (2..8)/7 = 5
      expect(result.value.points.map((p) => p.value)).toEqual([null, null, null, 2.5, 3, 3.5, 4, 5])
    }
  })

  it('skips missing days and leaves windows with fewer than 4 days empty', () => {
    const result = metric.compute(daily([2, null, 4, null, 6, null, 8]), { subject: 'number' })

    expect(result).toMatchObject({ status: 'ok', n: 4, missing: 3 })
    if (result.status === 'ok' && result.value.kind === 'series') {
      // Only the last window (all 7 days) has 4 observed days: (2+4+6+8)/4 = 5
      expect(result.value.points.map((p) => p.value)).toEqual([null, null, null, null, null, null, 5])
    }
  })

  it('empty, single or too-sparse inputs are insufficient', () => {
    expect(metric.compute([], { subject: 'number' }).status).toBe('insufficient')
    expect(metric.compute(daily([5]), { subject: 'number' }).status).toBe('insufficient')
    expect(metric.compute(daily([1, null, null, null, 2, null, null, 3]), { subject: 'number' }).status).toBe('insufficient')
  })
})
