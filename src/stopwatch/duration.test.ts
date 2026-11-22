import { describe, expect, it } from 'vitest'

import { activeDurationMs, formatDuration, timerElapsedMs } from './duration'

const MINUTE = 60_000

describe('activeDurationMs', () => {
  it('is zero for no periods', () => {
    expect(activeDurationMs([])).toBe(0)
  })

  it('adds up periods and leaves pauses out', () => {
    // 10:00–10:10 (10 min), pause 5 min, 10:15–10:35 (20 min) = 30 min
    expect(
      activeDurationMs([
        { start: '2026-11-01T10:00:00.000Z', end: '2026-11-01T10:10:00.000Z' },
        { start: '2026-11-01T10:15:00.000Z', end: '2026-11-01T10:35:00.000Z' },
      ]),
    ).toBe(30 * MINUTE)
  })

  it('counts actual time across a daylight-saving change', () => {
    // 00:30–03:30 Paris on 2026-10-25 (clocks go back at 03:00):
    // 22:30 UTC → 02:30 UTC = 4 hours, although the clock shows 3 hours.
    expect(
      activeDurationMs([
        { start: '2026-10-24T22:30:00.000Z', end: '2026-10-25T02:30:00.000Z' },
      ]),
    ).toBe(240 * MINUTE)
  })
})

describe('timerElapsedMs', () => {
  const completed = [
    { start: '2026-11-01T10:00:00.000Z', end: '2026-11-01T10:10:00.000Z' },
  ]

  it('counts only completed periods while paused', () => {
    const now = Date.parse('2026-11-01T12:00:00.000Z')

    expect(timerElapsedMs({ completedSegments: completed, runningSince: null }, now)).toBe(
      10 * MINUTE,
    )
  })

  it('adds the current period while running', () => {
    const now = Date.parse('2026-11-01T10:20:00.000Z')

    expect(
      timerElapsedMs(
        { completedSegments: completed, runningSince: '2026-11-01T10:15:00.000Z' },
        now,
      ),
    ).toBe(15 * MINUTE)
  })

  it('never counts a running period as negative time', () => {
    const now = Date.parse('2026-11-01T10:00:00.000Z')

    expect(
      timerElapsedMs({ completedSegments: [], runningSince: '2026-11-01T10:05:00.000Z' }, now),
    ).toBe(0)
  })
})

describe('formatDuration', () => {
  it('formats durations rounded down to whole minutes', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(1)).toBe('less than 1 min')
    expect(formatDuration(59_999)).toBe('less than 1 min')
    expect(formatDuration(45 * MINUTE)).toBe('45 min')
    expect(formatDuration(65 * MINUTE + 59_000)).toBe('1 h 05 min')
    expect(formatDuration(26 * 60 * MINUTE + 10 * MINUTE)).toBe('26 h 10 min')
  })

  it('treats negative durations as zero', () => {
    expect(formatDuration(-5 * MINUTE)).toBe('0 min')
  })
})
