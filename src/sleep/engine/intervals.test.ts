import { describe, expect, it } from 'vitest'

import { clipInterval, subtractIntervals, totalLength, unionIntervals } from './intervals'

const i = (start: number, end: number) => ({ start, end })

describe('interval helpers', () => {
  it('unions overlapping and touching intervals, dropping empty ones', () => {
    expect(unionIntervals([i(5, 8), i(0, 2), i(1, 3), i(3, 4), i(9, 9)])).toEqual([i(0, 4), i(5, 8)])
  })

  it('counts overlaps once', () => {
    expect(totalLength([i(0, 10), i(5, 15), i(20, 25)])).toBe(20)
  })

  it('subtracts removals inside, across and outside intervals', () => {
    expect(subtractIntervals([i(0, 10)], [i(2, 3), i(8, 12), i(20, 30)])).toEqual([i(0, 2), i(3, 8)])
    expect(subtractIntervals([i(0, 10)], [i(-5, 15)])).toEqual([])
    expect(subtractIntervals([i(0, 10)], [])).toEqual([i(0, 10)])
  })

  it('clips to bounds and returns null when nothing remains', () => {
    expect(clipInterval(i(-5, 5), 0, 10)).toEqual(i(0, 5))
    expect(clipInterval(i(12, 15), 0, 10)).toBeNull()
  })
})
