import { describe, expect, it } from 'vitest'

import { durationTicks } from './chartTheme'

describe('durationTicks', () => {
  it('steps of 15 min, 30 min, 1 h… with at most 5 intervals, up to a round top', () => {
    expect(durationTicks(1)).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(durationTicks(2.2)).toEqual([0, 0.5, 1, 1.5, 2, 2.5])
    expect(durationTicks(4.5)).toEqual([0, 1, 2, 3, 4, 5])
    expect(durationTicks(0)).toEqual([0, 0.25])
  })
})
