import { describe, expect, it } from 'vitest'

import metric from './iqr.metric'
import { daily, REFERENCE } from './testData'

describe('IQR metric', () => {
  it('hand-calculated (type 7): Q3 5.5 − Q1 4 = 1.5', () => {
    expect(metric.compute(daily(REFERENCE), { subject: 'number' })).toMatchObject({ status: 'ok', value: { value: 1.5 } })
  })

  it('is 0 when all values are equal', () => {
    expect(metric.compute(daily([7, 7, 7, 7, 7]), { subject: 'sleepDuration' })).toMatchObject({ value: { value: 0 } })
  })

  it('excludes missing values', () => {
    expect(metric.compute(daily([null, ...REFERENCE]), { subject: 'number' })).toMatchObject({ n: 8, missing: 1 })
  })

  it('empty and single observations are insufficient', () => {
    expect(metric.compute([], { subject: 'number' }).status).toBe('insufficient')
    expect(metric.compute(daily([1]), { subject: 'number' }).status).toBe('insufficient')
  })

  it('works on the bedtime axis (hours past midnight)', () => {
    // 23.0 23.5 24.0 24.5 25.0: Q1 23.5, Q3 24.5 → 1 hour
    expect(metric.compute(daily([24, 23, 25, 23.5, 24.5]), { subject: 'bedtime' })).toMatchObject({ value: { value: 1 } })
  })
})
