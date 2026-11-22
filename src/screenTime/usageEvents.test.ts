import { describe, expect, it } from 'vitest'

import {
  USAGE_EVENT as E,
  dailyForeground,
  foregroundIntervals,
  localDatesUpTo,
  mergeRanges,
  mergeUsageEvents,
  percentDifference,
} from './usageEvents'
import type { UsageEventsData } from './usageEvents'

const t = (iso: string) => Date.parse(iso)
const PKGS = ['com.chat', 'com.maps', 'android']

function data(events: [string, number, number][]): UsageEventsData {
  return { packages: PKGS, events: events.map(([iso, type, index]) => [t(iso), type, index]) }
}

describe('foregroundIntervals', () => {
  it('pairs resumed and paused/stopped events per app', () => {
    const result = foregroundIntervals(
      data([
        ['2026-11-09T08:00:00Z', E.ACTIVITY_RESUMED, 0],
        ['2026-11-09T08:10:00Z', E.ACTIVITY_PAUSED, 0],
        ['2026-11-09T08:10:01Z', E.ACTIVITY_RESUMED, 1],
        ['2026-11-09T08:30:01Z', E.ACTIVITY_STOPPED, 1],
      ]),
      t('2026-11-10T00:00:00Z'),
    )
    expect(result.intervals).toEqual([
      { pkg: 'com.chat', startMs: t('2026-11-09T08:00:00Z'), endMs: t('2026-11-09T08:10:00Z') },
      { pkg: 'com.maps', startMs: t('2026-11-09T08:10:01Z'), endMs: t('2026-11-09T08:30:01Z') },
    ])
    expect(result.malformedEvents).toBe(0)
  })

  it('ignores a second "resumed" (another screen of the same app) and an end without a start', () => {
    const result = foregroundIntervals(
      data([
        ['2026-11-09T07:00:00Z', E.ACTIVITY_PAUSED, 0],
        ['2026-11-09T08:00:00Z', E.ACTIVITY_RESUMED, 0],
        ['2026-11-09T08:05:00Z', E.ACTIVITY_RESUMED, 0],
        ['2026-11-09T08:10:00Z', E.ACTIVITY_PAUSED, 0],
      ]),
      t('2026-11-10T00:00:00Z'),
    )
    expect(result.intervals).toEqual([{ pkg: 'com.chat', startMs: t('2026-11-09T08:00:00Z'), endMs: t('2026-11-09T08:10:00Z') }])
  })

  it('keeps an app on screen while it moves between its own screens (stopped logged after resumed)', () => {
    // Real Android order: list paused → video resumed → list stopped.
    const result = foregroundIntervals(
      {
        packages: PKGS,
        classes: ['ListScreen', 'VideoScreen'],
        events: [
          [t('2026-11-09T20:00:00Z'), E.ACTIVITY_RESUMED, 0, 0],
          [t('2026-11-09T20:05:00Z'), E.ACTIVITY_PAUSED, 0, 0],
          [t('2026-11-09T20:05:00.200Z'), E.ACTIVITY_RESUMED, 0, 1],
          [t('2026-11-09T20:05:00.900Z'), E.ACTIVITY_STOPPED, 0, 0],
          [t('2026-11-09T21:05:00Z'), E.ACTIVITY_PAUSED, 0, 1],
          [t('2026-11-09T21:05:01Z'), E.ACTIVITY_STOPPED, 0, 1],
        ],
      },
      t('2026-11-10T00:00:00Z'),
    )
    // 20:00–20:05, then 20:05:00.2–21:05 (the late "stopped" of the list does not end it).
    expect(result.intervals.map((i) => [i.pkg, i.endMs - i.startMs])).toEqual([
      ['com.chat', 5 * 60_000],
      ['com.chat', 60 * 60_000 - 200],
    ])
  })

  it('counts an app once while two of its screens are resumed together, and rejects unknown screens', () => {
    const result = foregroundIntervals(
      {
        packages: PKGS,
        classes: ['A', 'B'],
        events: [
          [t('2026-11-09T08:00:00Z'), E.ACTIVITY_RESUMED, 0, 0],
          [t('2026-11-09T08:01:00Z'), E.ACTIVITY_RESUMED, 0, 1],
          [t('2026-11-09T08:02:00Z'), E.ACTIVITY_PAUSED, 0, 0],
          [t('2026-11-09T08:03:00Z'), E.ACTIVITY_PAUSED, 0, 1],
          [t('2026-11-09T08:04:00Z'), E.ACTIVITY_RESUMED, 0, 7],
          [t('2026-11-09T08:05:00Z'), E.SCREEN_NON_INTERACTIVE, 2, -1],
        ],
      },
      t('2026-11-10T00:00:00Z'),
    )
    expect(result.intervals.map((i) => (i.endMs - i.startMs) / 60_000)).toEqual([3])
    expect(result.malformedEvents).toBe(1)
  })

  it('ends every open period when the screen turns off, locks or the phone shuts down', () => {
    for (const type of [E.SCREEN_NON_INTERACTIVE, E.KEYGUARD_SHOWN, E.DEVICE_SHUTDOWN]) {
      const result = foregroundIntervals(
        data([
          ['2026-11-09T08:00:00Z', E.ACTIVITY_RESUMED, 0],
          ['2026-11-09T08:01:00Z', E.ACTIVITY_RESUMED, 1],
          ['2026-11-09T08:20:00Z', type, 2],
          ['2026-11-09T09:00:00Z', E.ACTIVITY_PAUSED, 0],
        ]),
        t('2026-11-10T00:00:00Z'),
      )
      expect(result.intervals.map((i) => [i.pkg, (i.endMs - i.startMs) / 60_000])).toEqual([
        ['com.chat', 20],
        ['com.maps', 19],
      ])
    }
  })

  it('drops open periods when the phone restarts without a shutdown event', () => {
    const result = foregroundIntervals(
      data([
        ['2026-11-09T08:00:00Z', E.ACTIVITY_RESUMED, 0],
        ['2026-11-09T12:00:00Z', E.DEVICE_STARTUP, 2],
        ['2026-11-09T12:05:00Z', E.ACTIVITY_RESUMED, 1],
        ['2026-11-09T12:06:00Z', E.ACTIVITY_PAUSED, 1],
      ]),
      t('2026-11-10T00:00:00Z'),
    )
    expect(result.droppedAtRestart).toBe(1)
    expect(result.intervals.map((i) => i.pkg)).toEqual(['com.maps'])
  })

  it('ends a period still open at "now", sorts by time and counts malformed events', () => {
    const result = foregroundIntervals(
      {
        packages: PKGS,
        events: [
          [t('2026-11-09T08:30:00Z'), E.ACTIVITY_RESUMED, 1],
          [t('2026-11-09T08:00:00Z'), E.ACTIVITY_RESUMED, 0],
          [t('2026-11-09T08:10:00Z'), E.ACTIVITY_PAUSED, 0],
          [t('2026-11-09T08:11:00Z'), E.ACTIVITY_RESUMED, 9],
          [Number.NaN, E.ACTIVITY_PAUSED, 0],
        ],
      },
      t('2026-11-09T08:45:00Z'),
    )
    expect(result.intervals.map((i) => [i.pkg, (i.endMs - i.startMs) / 60_000])).toEqual([
      ['com.chat', 10],
      ['com.maps', 15],
    ])
    expect(result.malformedEvents).toBe(2)
  })
})

describe('dailyForeground', () => {
  const now = t('2026-11-11T09:00:00Z')

  it('splits periods at local midnight (Paris, UTC+1) and sums per app (hand-calculated)', () => {
    const { intervals } = foregroundIntervals(
      data([
        // 23:30–00:15 Paris → 30 min on the 9th, 15 min on the 10th.
        ['2026-11-09T22:30:00Z', E.ACTIVITY_RESUMED, 0],
        ['2026-11-09T23:15:00Z', E.ACTIVITY_PAUSED, 0],
        // 10 min + 20.4 s of maps on the 9th.
        ['2026-11-09T10:00:00Z', E.ACTIVITY_RESUMED, 1],
        ['2026-11-09T10:10:20.400Z', E.ACTIVITY_PAUSED, 1],
      ]),
      now,
    )
    const days = dailyForeground(intervals, {
      localDates: ['2026-11-09', '2026-11-10'],
      timezone: 'Europe/Paris',
      covered: [{ startMs: t('2026-11-01T00:00:00Z'), endMs: now }],
      nowMs: now,
    })
    expect(days).toEqual([
      {
        localDate: '2026-11-09',
        startUtc: '2026-11-08T23:00:00.000Z',
        endUtc: '2026-11-09T23:00:00.000Z',
        coverage: 'full',
        seconds: 1800 + 620, // 30 min + 10 min 20.4 s (rounded)
        appCount: 2,
        apps: [{ pkg: 'com.chat', seconds: 1800 }, { pkg: 'com.maps', seconds: 620 }],
      },
      {
        localDate: '2026-11-10',
        startUtc: '2026-11-09T23:00:00.000Z',
        endUtc: '2026-11-10T23:00:00.000Z',
        coverage: 'full',
        seconds: 900,
        appCount: 1,
        apps: [{ pkg: 'com.chat', seconds: 900 }],
      },
    ])
  })

  it('handles the 25-hour autumn day (Paris, 25 Oct 2026)', () => {
    // On screen from 00:00 Paris (UTC+2) to 23:59:59 Paris (UTC+1): 25 h − 1 s.
    const { intervals } = foregroundIntervals(
      data([
        ['2026-10-24T22:00:00Z', E.ACTIVITY_RESUMED, 0],
        ['2026-10-25T22:59:59Z', E.ACTIVITY_PAUSED, 0],
      ]),
      now,
    )
    const [day] = dailyForeground(intervals, { localDates: ['2026-10-25'], timezone: 'Europe/Paris', covered: [{ startMs: 0, endMs: now }], nowMs: now })
    expect(day.seconds).toBe(25 * 3600 - 1)
  })

  it('can leave out packages (e.g. the home screen)', () => {
    const { intervals } = foregroundIntervals(
      data([
        ['2026-11-09T08:00:00Z', E.ACTIVITY_RESUMED, 2],
        ['2026-11-09T08:05:00Z', E.ACTIVITY_PAUSED, 2],
        ['2026-11-09T08:05:00Z', E.ACTIVITY_RESUMED, 0],
        ['2026-11-09T08:06:00Z', E.ACTIVITY_PAUSED, 0],
      ]),
      now,
    )
    const options = { localDates: ['2026-11-09'], timezone: 'Europe/Paris', covered: [{ startMs: 0, endMs: now }], nowMs: now }
    expect(dailyForeground(intervals, options)[0].seconds).toBe(360)
    expect(dailyForeground(intervals, { ...options, excludePackages: new Set(['android']) })[0]).toMatchObject({ seconds: 60, appCount: 1 })
  })

  it('marks coverage: no data (null, not 0), partial, full and unfinished days', () => {
    const days = dailyForeground([], {
      localDates: ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-11'],
      timezone: 'Europe/Paris',
      covered: [{ startMs: t('2026-11-08T06:00:00Z'), endMs: now }], // from during the 8th
      nowMs: now,
    })
    expect(days.map((day) => [day.localDate, day.coverage, day.seconds])).toEqual([
      ['2026-11-07', 'none', null],
      ['2026-11-08', 'partial', 0],
      ['2026-11-09', 'full', 0],
      ['2026-11-11', 'unfinished', 0],
    ])
    expect(dailyForeground([], { localDates: ['2026-11-09'], timezone: 'Europe/Paris', covered: [], nowMs: now })[0].seconds).toBeNull()
  })
})

describe('combining live and saved history', () => {
  it('merges spans that overlap or touch, ignoring empty ones', () => {
    expect(mergeRanges([
      { startMs: 50, endMs: 60 },
      { startMs: 0, endMs: 10 },
      { startMs: 10, endMs: 20 },
      { startMs: 15, endMs: 30 },
      { startMs: 40, endMs: 40 },
    ])).toEqual([{ startMs: 0, endMs: 30 }, { startMs: 50, endMs: 60 }])
  })

  it('marks a day full only when one continuous span covers it (a gap makes it partial)', () => {
    const now = t('2026-11-11T09:00:00Z')
    const days = dailyForeground([], {
      localDates: ['2026-11-08', '2026-11-09'],
      timezone: 'Europe/Paris',
      // Saved copy covers the 8th; a gap of 2 h on the 9th.
      covered: [
        { startMs: t('2026-11-07T20:00:00Z'), endMs: t('2026-11-09T08:00:00Z') },
        { startMs: t('2026-11-09T10:00:00Z'), endMs: now },
      ],
      nowMs: now,
    })
    expect(days.map((day) => day.coverage)).toEqual(['full', 'partial'])
  })

  it('combines events from both sources without duplicates (an uninstalled app survives in the saved copy)', () => {
    const live: UsageEventsData = {
      packages: ['com.chat'],
      classes: ['Main'],
      events: [
        [t('2026-11-09T08:00:00Z'), E.ACTIVITY_RESUMED, 0, 0],
        [t('2026-11-09T09:00:00Z'), E.ACTIVITY_PAUSED, 0, 0],
      ],
    }
    const saved: UsageEventsData = {
      packages: ['com.game', 'com.chat'],
      classes: ['Main', 'Play'],
      events: [
        [t('2026-11-09T08:00:00Z'), E.ACTIVITY_RESUMED, 1, 0], // duplicate of live
        [t('2026-11-09T10:00:00Z'), E.ACTIVITY_RESUMED, 0, 1], // app since uninstalled
        [t('2026-11-09T10:30:00Z'), E.ACTIVITY_PAUSED, 0, 1],
        [t('2026-11-09T11:00:00Z'), E.ACTIVITY_RESUMED, 5, 0], // malformed
      ],
    }
    const merged = mergeUsageEvents(live, saved)
    expect(merged.events).toHaveLength(5)
    const { intervals, malformedEvents } = foregroundIntervals(merged, t('2026-11-10T00:00:00Z'))
    expect(intervals.map((i) => [i.pkg, (i.endMs - i.startMs) / 60_000])).toEqual([
      ['com.chat', 60],
      ['com.game', 30],
    ])
    expect(malformedEvents).toBe(1)
  })
})

describe('helpers', () => {
  it('lists the last days up to a date, across month ends', () => {
    expect(localDatesUpTo('2026-11-02', 4)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })

  it('computes the percentage difference against a reference', () => {
    expect(percentDifference(3300, 3000)).toBeCloseTo(10)
    expect(percentDifference(2700, 3000)).toBeCloseTo(-10)
    expect(percentDifference(null, 3000)).toBeNull()
    expect(percentDifference(100, null)).toBeNull()
    expect(percentDifference(100, 0)).toBeNull()
  })
})
