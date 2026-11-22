import { describe, expect, it } from 'vitest'

import metric from './coefficient-of-variation.metric'
import { daily, REFERENCE } from './testData'

describe('coefficient of variation metric', () => {
  it('hand-calculated: sample SD sqrt(32/7) ÷ mean 5 ≈ 0.42762', () => {
    const result = metric.compute(daily(REFERENCE), { subject: 'number' })

    expect(result.status).toBe('ok')
    if (result.status === 'ok' && result.value.kind === 'number') {
      expect(result.value.value).toBeCloseTo(Math.sqrt(32 / 7) / 5, 12)
    }
  })

  it('is not calculated when the mean is zero or values are negative', () => {
    expect(metric.compute(daily([0, 0, 0, 0, 0]), { subject: 'number' })).toEqual({
      status: 'not-applicable', reason: 'Not meaningful when the mean is zero.',
    })
    expect(metric.compute(daily([-1, 2, 3, 4, 5]), { subject: 'number' })).toEqual({
      status: 'not-applicable', reason: 'Not meaningful when some values are negative.',
    })
  })

  it('does not apply to clock times such as bedtime', () => {
    expect(metric.applicableTypes).not.toContain('bedtime')
    expect(metric.applicableTypes).not.toContain('wakeTime')
  })

  it('excludes missing values; empty and single inputs are insufficient', () => {
    expect(metric.compute(daily([...REFERENCE, null]), { subject: 'number' })).toMatchObject({ n: 8, missing: 1 })
    expect(metric.compute([], { subject: 'number' }).status).toBe('insufficient')
    expect(metric.compute(daily([3]), { subject: 'number', minN: 1 }).status).toBe('insufficient')
  })
})
