import { describe, expect, it } from 'vitest'

import metric from './median.metric'
import { daily, REFERENCE } from './testData'

describe('median metric', () => {
  it('hand-calculated: median of 2 4 4 4 5 5 7 9 is 4.5', () => {
    expect(metric.compute(daily(REFERENCE), { subject: 'number' })).toEqual({
      status: 'ok', n: 8, missing: 0, value: { kind: 'number', value: 4.5 },
    })
  })

  it('odd count: the middle value', () => {
    expect(metric.compute(daily([3, 1, 2, 5, 4]), { subject: 'number' })).toMatchObject({ value: { value: 3 } })
  })

  it('excludes missing values (not zero)', () => {
    expect(metric.compute(daily([...REFERENCE, null, null]), { subject: 'number' })).toMatchObject({
      n: 8, missing: 2, value: { value: 4.5 },
    })
  })

  it('empty and single observations are insufficient', () => {
    expect(metric.compute([], { subject: 'number' })).toMatchObject({ status: 'insufficient', n: 0 })
    expect(metric.compute(daily([3]), { subject: 'number' })).toMatchObject({ status: 'insufficient', n: 1 })
  })

  it('a lower minimum can be configured', () => {
    expect(metric.compute(daily([3]), { subject: 'number', minN: 1 })).toMatchObject({ status: 'ok', value: { value: 3 } })
  })
})
