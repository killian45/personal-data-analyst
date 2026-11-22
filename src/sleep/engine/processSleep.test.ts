import { describe, expect, it } from 'vitest'

import type { SleepSession, SleepStage } from '../../database/types'
import { localDateTimeToUtc } from '../../time/time'

import { formatAxisHours } from './localTime'
import { processSleep } from './processSleep'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Builds a session from local wall-clock times ("YYYY-MM-DDTHH:mm"). */
function session(
  id: string,
  startLocal: string,
  endLocal: string,
  overrides: Partial<SleepSession> = {},
  zone = 'Europe/Paris',
): SleepSession {
  return {
    id,
    source: 'manual',
    externalId: null,
    sourceApp: null,
    dedupeKey: `manual:${id}`,
    startUtc: localDateTimeToUtc(startLocal, zone).utc,
    endUtc: localDateTimeToUtc(endLocal, zone).utc,
    timezone: zone,
    startOffsetMinutes: null,
    endOffsetMinutes: null,
    stages: [],
    reportedSleepMs: null,
    comment: null,
    importedAt: null,
    metadata: null,
    syncStatus: 'pending',
    revision: 1,
    syncedRevision: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

/** A stage from local Paris times. */
function stage(startLocal: string, endLocal: string, type: SleepStage['stage']): SleepStage {
  return {
    start: localDateTimeToUtc(startLocal, 'Europe/Paris').utc,
    end: localDateTimeToUtc(endLocal, 'Europe/Paris').utc,
    stage: type,
  }
}

describe('sleep engine — required cases (PROJECT_SPEC.md §7.8)', () => {
  it('23:30–07:00: night of the evening date, bedtime 23.5, wake 31.0', () => {
    const { nights, naps } = processSleep([session('a', '2026-11-08T23:30', '2026-11-09T07:00')])

    expect(naps).toEqual([])
    expect(nights).toHaveLength(1)
    expect(nights[0]).toMatchObject({
      nightDate: '2026-11-08',
      bedtimeHours: 23.5,
      wakeHours: 31,
      timeInBedMs: 7.5 * HOUR,
      sleepMs: 7.5 * HOUR,
      methods: ['elapsed'],
    })
    expect(formatAxisHours(nights[0].bedtimeHours)).toBe('23:30')
    expect(formatAxisHours(nights[0].wakeHours)).toBe('07:00')
  })

  it('01:00–09:00: started before noon, so it belongs to the previous date (bedtime 25.0)', () => {
    const { nights, naps } = processSleep([session('a', '2026-11-09T01:00', '2026-11-09T09:00')])

    expect(naps).toEqual([])
    expect(nights[0]).toMatchObject({ nightDate: '2026-11-08', bedtimeHours: 25, wakeHours: 33 })
    expect(formatAxisHours(25)).toBe('01:00')
  })

  it('13:00 nap: classified as a nap and excluded from the night', () => {
    const { nights, naps } = processSleep([
      session('night', '2026-11-08T23:00', '2026-11-09T07:00'),
      session('nap', '2026-11-09T13:00', '2026-11-09T14:00'),
    ])

    expect(naps.map((nap) => nap.sessionIds)).toEqual([['nap']])
    expect(nights).toHaveLength(1)
    expect(nights[0].sessionIds).toEqual(['night'])
    expect(nights[0].wakeHours).toBe(31)
  })

  it('split night: two sessions 90 minutes apart form one night', () => {
    const { nights } = processSleep([
      session('first', '2026-11-08T23:00', '2026-11-09T02:00'),
      session('second', '2026-11-09T03:30', '2026-11-09T07:00'),
    ])

    expect(nights).toHaveLength(1)
    expect(nights[0].sessions).toHaveLength(2)
    expect(nights[0]).toMatchObject({
      nightDate: '2026-11-08',
      bedtimeHours: 23,
      wakeHours: 31,
      // 3 h + 3.5 h; the 90-minute gap is not time in bed
      timeInBedMs: 6.5 * HOUR,
      sleepMs: 6.5 * HOUR,
    })
  })

  it('overlapping sessions merge and their overlap is counted once', () => {
    const { nights } = processSleep([
      session('a', '2026-11-08T23:00', '2026-11-09T03:00'),
      session('b', '2026-11-09T02:00', '2026-11-09T07:00'),
    ])

    expect(nights[0].sessions).toHaveLength(1)
    expect(nights[0].sessionIds).toEqual(['a', 'b'])
    expect(nights[0].timeInBedMs).toBe(8 * HOUR)
    expect(nights[0].sleepMs).toBe(8 * HOUR)
  })

  describe('merging threshold (default 60 minutes)', () => {
    function gapOf(minutes: number) {
      const end = new Date(Date.UTC(2026, 10, 9, 1, 0) + minutes * MINUTE).toISOString()
      const second = session('b', '2026-11-09T02:00', '2026-11-09T07:00')
      second.startUtc = end

      return processSleep([
        session('a', '2026-11-08T23:00', '2026-11-09T02:00'),
        second,
      ]).nights[0].sessions.length
    }

    it('does NOT merge sessions exactly 60 minutes apart', () => {
      expect(gapOf(60)).toBe(2)
    })

    it('merges sessions 59 minutes apart', () => {
      expect(gapOf(59)).toBe(1)
    })

    it('does not merge sessions 61 minutes apart', () => {
      expect(gapOf(61)).toBe(2)
    })

    it('respects a configured threshold', () => {
      const sessions = [
        session('a', '2026-11-08T23:00', '2026-11-09T02:00'),
        session('b', '2026-11-09T03:00', '2026-11-09T07:00'),
      ]

      expect(processSleep(sessions, { mergeGapMs: 90 * MINUTE }).nights[0].sessions).toHaveLength(1)
      expect(processSleep(sessions, { mergeGapMs: 30 * MINUTE }).nights[0].sessions).toHaveLength(2)
    })

    it('keeps the original sessions unchanged', () => {
      const a = session('a', '2026-11-08T23:00', '2026-11-09T02:00')
      const copy = structuredClone(a)

      processSleep([a, session('b', '2026-11-09T02:30', '2026-11-09T07:00')])

      expect(a).toEqual(copy)
    })
  })

  describe('daylight-saving transitions (Europe/Paris)', () => {
    it('counts 9 hours for 23:00–07:00 when the clocks go back, with wake still at 07:00', () => {
      const { nights } = processSleep([session('a', '2026-10-24T23:00', '2026-10-25T07:00')])

      expect(nights[0]).toMatchObject({
        timeInBedMs: 9 * HOUR,
        sleepMs: 9 * HOUR,
        bedtimeHours: 23,
        wakeHours: 31,
      })
    })

    it('counts 7 hours for 23:00–07:00 when the clocks move forward', () => {
      const { nights } = processSleep([session('a', '2026-03-28T23:00', '2026-03-29T07:00')])

      expect(nights[0]).toMatchObject({ timeInBedMs: 7 * HOUR, wakeHours: 31 })
    })
  })

  describe('travel across timezones', () => {
    it('reads bedtime where you went to bed and wake time where you woke up', () => {
      // Health Connect style: offsets only. Bed 23:00 at UTC+1 (22:00 UTC),
      // woke 15:00 at UTC+9 the next day (06:00 UTC): 8 hours elapsed.
      const flight = session('flight', '2026-11-08T23:00', '2026-11-09T07:00', {
        source: 'health_connect',
        externalId: 'hc-1',
        dedupeKey: 'health_connect:id:hc-1',
        timezone: null,
        startOffsetMinutes: 60,
        endOffsetMinutes: 540,
      })
      flight.startUtc = '2026-11-08T22:00:00.000Z'
      flight.endUtc = '2026-11-09T06:00:00.000Z'

      const { nights } = processSleep([flight])

      expect(nights[0]).toMatchObject({
        nightDate: '2026-11-08',
        bedtimeHours: 23,
        // 15:00 on the next local date
        wakeHours: 39,
        timeInBedMs: 8 * HOUR,
      })
      expect(nights[0].sessions[0]).toMatchObject({ startZone: '+01:00', endZone: '+09:00' })
    })

    it('uses each session’s own timezone for its night date', () => {
      const { nights } = processSleep([
        session('paris', '2026-11-08T23:00', '2026-11-09T07:00'),
        session('tokyo', '2026-11-10T23:30', '2026-11-11T06:30', {}, 'Asia/Tokyo'),
      ])

      expect(nights.map((night) => [night.nightDate, night.bedtimeHours])).toEqual([
        ['2026-11-08', 23],
        ['2026-11-10', 23.5],
      ])
    })
  })

  describe('sleep duration priority', () => {
    it('missing stages: falls back to the reported total, then to elapsed time', () => {
      const reported = processSleep([
        session('a', '2026-11-08T23:00', '2026-11-09T07:00', { reportedSleepMs: 7 * HOUR }),
      ]).nights[0]
      const elapsed = processSleep([session('a', '2026-11-08T23:00', '2026-11-09T07:00')]).nights[0]

      expect(reported).toMatchObject({ sleepMs: 7 * HOUR, timeInBedMs: 8 * HOUR, methods: ['reported'] })
      expect(elapsed).toMatchObject({ sleepMs: 8 * HOUR, methods: ['elapsed'] })
    })

    it('uses valid stages before a reported total, subtracting awake time', () => {
      const night = processSleep([
        session('a', '2026-11-08T23:00', '2026-11-09T07:00', {
          reportedSleepMs: 5 * HOUR,
          stages: [
            stage('2026-11-08T23:00', '2026-11-08T23:20', 'awake'),
            stage('2026-11-08T23:20', '2026-11-09T03:00', 'light'),
            stage('2026-11-09T03:00', '2026-11-09T04:00', 'deep'),
            stage('2026-11-09T04:00', '2026-11-09T06:30', 'rem'),
            stage('2026-11-09T06:30', '2026-11-09T07:00', 'out_of_bed'),
          ],
        }),
      ]).nights[0]

      // 3 h 40 + 1 h + 2 h 30 = 7 h 10
      expect(night).toMatchObject({ sleepMs: 7 * HOUR + 10 * MINUTE, timeInBedMs: 8 * HOUR, methods: ['stages'] })
    })

    it('invalid stage intervals are excluded and reported', () => {
      const night = processSleep([
        session('a', '2026-11-08T23:00', '2026-11-09T07:00', {
          stages: [
            stage('2026-11-08T23:00', '2026-11-09T05:00', 'sleeping'),
            // End before start: invalid.
            stage('2026-11-09T06:00', '2026-11-09T05:30', 'deep'),
            // Entirely outside the session: invalid.
            stage('2026-11-09T09:00', '2026-11-09T10:00', 'rem'),
            // Partly outside: clipped to 07:00 → counts 1 hour.
            stage('2026-11-09T06:00', '2026-11-09T08:00', 'light'),
          ],
        }),
      ]).nights[0]

      expect(night.sleepMs).toBe(7 * HOUR)
      expect(night.methods).toEqual(['stages'])
      expect(night.warnings).toEqual(['2 invalid sleep stage interval(s) excluded.'])
    })

    it('falls back when every stage interval is invalid', () => {
      const night = processSleep([
        session('a', '2026-11-08T23:00', '2026-11-09T07:00', {
          stages: [stage('2026-11-09T05:00', '2026-11-09T04:00', 'deep')],
        }),
      ]).nights[0]

      expect(night).toMatchObject({ sleepMs: 8 * HOUR, methods: ['elapsed'] })
    })

    it('overlapping stage intervals are not counted twice; awake wins over sleep', () => {
      const night = processSleep([
        session('a', '2026-11-08T23:00', '2026-11-09T07:00', {
          stages: [
            stage('2026-11-08T23:00', '2026-11-09T03:00', 'light'),
            // Overlaps light by 1 hour: counted once.
            stage('2026-11-09T02:00', '2026-11-09T05:00', 'deep'),
            // Awake inside deep: 30 minutes removed.
            stage('2026-11-09T04:00', '2026-11-09T04:30', 'awake'),
          ],
        }),
      ]).nights[0]

      // Sleep union 23:00–05:00 = 6 h, minus 30 min awake = 5 h 30
      expect(night.sleepMs).toBe(5.5 * HOUR)
    })

    it('"unknown" stages count as neither sleep nor awake', () => {
      const night = processSleep([
        session('a', '2026-11-08T23:00', '2026-11-09T07:00', {
          stages: [
            stage('2026-11-08T23:00', '2026-11-09T05:00', 'deep'),
            stage('2026-11-09T05:00', '2026-11-09T07:00', 'unknown'),
          ],
        }),
      ]).nights[0]

      expect(night.sleepMs).toBe(6 * HOUR)

      const onlyUnknown = processSleep([
        session('b', '2026-11-08T23:00', '2026-11-09T07:00', {
          stages: [stage('2026-11-08T23:00', '2026-11-09T07:00', 'unknown')],
        }),
      ]).nights[0]

      expect(onlyUnknown.methods).toEqual(['elapsed'])
    })

    it('invalid reported durations are ignored and reported', () => {
      for (const reportedSleepMs of [-1, 0, 9 * HOUR, Number.NaN]) {
        const night = processSleep([
          session('a', '2026-11-08T23:00', '2026-11-09T07:00', { reportedSleepMs }),
        ]).nights[0]

        expect(night).toMatchObject({ sleepMs: 8 * HOUR, methods: ['elapsed'] })
        expect(night.warnings).toEqual(['1 invalid reported sleep duration(s) ignored.'])
      }
    })

    it('accepts a reported total equal to the elapsed time', () => {
      const night = processSleep([
        session('a', '2026-11-08T23:00', '2026-11-09T07:00', { reportedSleepMs: 8 * HOUR }),
      ]).nights[0]

      expect(night.methods).toEqual(['reported'])
    })

    it('uses the staged session when overlapping sessions are merged', () => {
      const night = processSleep([
        session('manual', '2026-11-08T22:45', '2026-11-09T07:15'),
        session('watch', '2026-11-08T23:00', '2026-11-09T07:00', {
          source: 'health_connect',
          externalId: 'w',
          dedupeKey: 'health_connect:id:w',
          stages: [stage('2026-11-08T23:10', '2026-11-09T06:40', 'sleeping')],
        }),
      ]).nights[0]

      expect(night).toMatchObject({ sleepMs: 7.5 * HOUR, timeInBedMs: 8.5 * HOUR, methods: ['stages'] })
      expect(night.warnings).toEqual(['1 session(s) without sleep stages ignored for the sleep duration.'])
    })

    it('does not add reported totals of overlapping sessions', () => {
      const night = processSleep([
        session('a', '2026-11-08T23:00', '2026-11-09T05:00', { reportedSleepMs: 5 * HOUR }),
        session('b', '2026-11-09T04:00', '2026-11-09T07:00', { reportedSleepMs: 2 * HOUR }),
      ]).nights[0]

      expect(night).toMatchObject({ sleepMs: 8 * HOUR, methods: ['elapsed'] })
    })
  })
})

describe('sleep engine — boundaries and safeguards', () => {
  it('night date: a start at exactly 12:00 keeps its date; 11:59 belongs to the previous date', () => {
    const atNoon = processSleep([session('a', '2026-11-09T12:00', '2026-11-09T20:00')]).nights[0]
    const beforeNoon = processSleep([session('b', '2026-11-09T11:59', '2026-11-09T20:00')]).nights[0]

    expect(atNoon.nightDate).toBe('2026-11-09')
    expect(beforeNoon.nightDate).toBe('2026-11-08')
    expect(beforeNoon.bedtimeHours).toBeCloseTo(35 + 59 / 60)
  })

  it('nap: 2 h 59 is a nap, 3 h 00 is not', () => {
    const short = processSleep([session('a', '2026-11-09T13:00', '2026-11-09T15:59')])
    const long = processSleep([session('b', '2026-11-09T13:00', '2026-11-09T16:00')])

    expect(short.naps).toHaveLength(1)
    expect(long.naps).toHaveLength(0)
    expect(long.nights).toHaveLength(1)
  })

  it('nap window: a start at 09:00 counts, at 19:00 does not, at 08:59 does not', () => {
    const at9 = processSleep([session('a', '2026-11-09T09:00', '2026-11-09T10:00')])
    const at19 = processSleep([session('b', '2026-11-09T19:00', '2026-11-09T20:00')])
    const at859 = processSleep([session('c', '2026-11-09T08:59', '2026-11-09T09:30')])

    expect(at9.naps).toHaveLength(1)
    expect(at19.naps).toHaveLength(0)
    expect(at859.naps).toHaveLength(0)
  })

  it('gives the same result whatever the input order', () => {
    const sessions = [
      session('c', '2026-11-10T23:00', '2026-11-11T07:00'),
      session('a', '2026-11-08T23:00', '2026-11-09T02:00'),
      session('nap', '2026-11-09T14:00', '2026-11-09T15:00'),
      session('b', '2026-11-09T02:30', '2026-11-09T07:00'),
    ]

    expect(processSleep([...sessions].reverse())).toEqual(processSleep(sessions))
  })

  it('ignores deleted sessions and reports invalid ones', () => {
    const deleted = session('deleted', '2026-11-08T23:00', '2026-11-09T07:00', {
      deletedAt: '2026-11-09T08:00:00.000Z',
    })
    const broken = session('broken', '2026-11-09T23:00', '2026-11-09T22:00')

    const result = processSleep([deleted, broken])

    expect(result.nights).toEqual([])
    expect(result.excluded).toEqual([
      { sessionId: 'broken', reason: 'the session does not end after it starts' },
    ])
  })

  it('returns nothing for no sessions', () => {
    expect(processSleep([])).toEqual({ nights: [], naps: [], excluded: [] })
  })
})

describe('formatAxisHours', () => {
  it('shows axis hours as a clock time, rounding to the nearest minute', () => {
    expect(formatAxisHours(23.5)).toBe('23:30')
    expect(formatAxisHours(24.5)).toBe('00:30')
    expect(formatAxisHours(31)).toBe('07:00')
    expect(formatAxisHours(23.999)).toBe('00:00')
    expect(formatAxisHours(22 + 29.6 / 60)).toBe('22:30')
  })
})
