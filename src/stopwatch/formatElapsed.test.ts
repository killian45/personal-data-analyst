import { describe, expect, it } from 'vitest'

import { formatElapsedTime } from './formatElapsed'

describe('formatElapsedTime', () => {
  it('shows hours, minutes and seconds with two digits', () => {
    expect(formatElapsedTime(0)).toBe('00:00:00')
    expect(formatElapsedTime(3_723_000)).toBe('01:02:03')
  })

  it('rounds partial seconds down', () => {
    expect(formatElapsedTime(59_999)).toBe('00:00:59')
  })

  it('adds days from 24 hours on', () => {
    expect(formatElapsedTime(86_399_000)).toBe('23:59:59')
    expect(formatElapsedTime(86_400_000)).toBe('1d 00:00:00')
    expect(formatElapsedTime(2 * 86_400_000 + 5_000)).toBe('2d 00:00:05')
  })
})
