import { describe, expect, it } from 'vitest'

import metric from './percentiles.metric'
import { daily, REFERENCE } from './testData'

describe('percentiles metric', () => {
  it('hand-calculated default percentiles (type 7)', () => {
    const result = metric.compute(daily(REFERENCE), { subject: 'number' })

    expect(result.status).toBe('ok')

    if (result.status === 'ok' && result.value.kind === 'percentiles') {
      // p10: h = 0.7 → 2 + 0.7·(4 − 2) = 3.4; p90: h = 6.3 → 7 + 0.3·2 = 7.6
      const values = result.value.values.map(({ p, value }) => [p, Number(value.toFixed(10))])
      expect(values).toEqual([[0.1, 3.4], [0.25, 4], [0.5, 4.5], [0.75, 5.5], [0.9, 7.6]])
    }
  })

  it('accepts custom percentiles, returned in ascending order', () => {
    const result = metric.compute(daily(REFERENCE), { subject: 'number', percentiles: [1, 0] })

    expect(result).toMatchObject({ value: { values: [{ p: 0, value: 2 }, { p: 1, value: 9 }] } })
  })

  it('refuses invalid percentiles', () => {
    expect(metric.compute(daily(REFERENCE), { subject: 'number', percentiles: [1.5] })).toEqual({
      status: 'not-applicable', reason: 'Percentiles must be between 0 and 1.',
    })
    expect(metric.compute(daily(REFERENCE), { subject: 'number', percentiles: [] }).status).toBe('not-applicable')
  })

  it('excludes missing values; empty and single inputs are insufficient', () => {
    expect(metric.compute(daily([...REFERENCE, null]), { subject: 'number' })).toMatchObject({ n: 8, missing: 1 })
    expect(metric.compute([], { subject: 'number' }).status).toBe('insufficient')
    expect(metric.compute(daily([4]), { subject: 'number' }).status).toBe('insufficient')
  })
})
