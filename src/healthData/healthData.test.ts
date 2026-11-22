import { describe, expect, it } from 'vitest'

import { validateExternalSampleRecord } from '../backup/restore/validateRecords'
import type { ExternalSample } from '../database/types'

import {
  buildDailySamples,
  buildExerciseSamples,
  fromPlugin,
  planHealthImport,
  validateHealthSample,
} from './healthData'
import type { ExerciseRecord, IntervalRecord, PointRecord, SeriesRecord } from './healthData'

let counter = 0
const options = { zone: 'Europe/Paris', today: '2026-11-12', importedAt: '2026-11-12T08:00:00.000Z', newId: () => `id-${++counter}` }
const meta = (id: string, origin = 'com.sec.android.app.shealth') => ({ id, dataOrigin: origin, lastModifiedTime: '2026-11-11T20:00:00Z' })

describe('fromPlugin (records from the phone are checked)', () => {
  it('reads steps and converts distances to metres', () => {
    expect(fromPlugin('steps', { metadata: meta('s1'), startTime: '2026-11-10T07:00:00Z', endTime: '2026-11-10T07:10:00Z', startZoneOffset: '+01:00', count: 820 }))
      .toEqual({ id: 's1', origin: 'com.sec.android.app.shealth', lastModifiedMs: Date.parse('2026-11-11T20:00:00Z'), startMs: Date.parse('2026-11-10T07:00:00Z'), endMs: Date.parse('2026-11-10T07:10:00Z'), offsetSeconds: 3600, amount: 820 })
    const km = fromPlugin('distance', { metadata: meta('d1'), startTime: '2026-11-10T07:00:00Z', endTime: '2026-11-10T07:30:00Z', distance: { unit: 'kilometer', value: 2.5 } }) as IntervalRecord
    expect(km.amount).toBe(2500)
    const miles = fromPlugin('distance', { metadata: meta('d2'), startTime: '2026-11-10T07:00:00Z', endTime: '2026-11-10T07:30:00Z', distance: { unit: 'mile', value: 1 } }) as IntervalRecord
    expect(miles.amount).toBeCloseTo(1609.344, 6)
  })

  it('refuses malformed records with a reason', () => {
    expect(() => fromPlugin('steps', { metadata: {}, startTime: '2026-11-10T07:00:00Z', endTime: '2026-11-10T07:10:00Z', count: 1 })).toThrow('no Health Connect id')
    expect(() => fromPlugin('steps', { metadata: meta('x'), startTime: '2026-11-10T08:00:00Z', endTime: '2026-11-10T07:00:00Z', count: 1 })).toThrow('ends before it starts')
    expect(() => fromPlugin('steps', { metadata: meta('x'), startTime: '2026-11-10T07:00:00Z', endTime: '2026-11-10T07:10:00Z', count: -5 })).toThrow('invalid step count')
    expect(() => fromPlugin('distance', { metadata: meta('x'), startTime: '2026-11-10T07:00:00Z', endTime: '2026-11-10T07:10:00Z', distance: { unit: 'parsec', value: 1 } })).toThrow('unknown distance unit')
    expect(() => fromPlugin('restingHeartRate', { metadata: meta('x'), time: '2026-11-10T07:00:00Z', beatsPerMinute: 0 })).toThrow('out of range')
  })
})

describe('buildDailySamples', () => {
  const step = (id: string, start: string, amount: number, origin?: string, offsetSeconds: number | null = 3600): IntervalRecord =>
    ({ id, origin: origin ?? 'phone', lastModifiedMs: null, startMs: Date.parse(start), endMs: Date.parse(start) + 600_000, offsetSeconds, amount })

  it('sums steps per local day and source app; today and later are not imported', () => {
    const { samples, notImported } = buildDailySamples('steps', [
      step('a', '2026-11-10T07:00:00Z', 1000),
      step('b', '2026-11-10T22:30:00Z', 500), // 23:30 in Paris: still 10 Nov
      step('c', '2026-11-10T23:30:00Z', 200), // 00:30 on 11 Nov in Paris
      step('w', '2026-11-10T09:00:00Z', 900, 'watch'),
      step('t', '2026-11-12T08:00:00Z', 300), // today
    ], options)
    expect(notImported).toEqual([])
    expect(samples.map((s) => [s.dedupeKey, s.value, s.startUtc, s.endUtc, s.startOffsetMinutes])).toEqual([
      ['health_connect:steps:phone:2026-11-10', 1500, '2026-11-09T23:00:00.000Z', '2026-11-10T23:00:00.000Z', 60],
      ['health_connect:steps:watch:2026-11-10', 900, '2026-11-09T23:00:00.000Z', '2026-11-10T23:00:00.000Z', 60],
      ['health_connect:steps:phone:2026-11-11', 200, '2026-11-10T23:00:00.000Z', '2026-11-11T23:00:00.000Z', 60],
    ])
    expect(samples[0]).toMatchObject({ source: 'health_connect', measurementType: 'hc_steps_daily', unit: 'steps', sourceApp: 'phone', syncStatus: 'pending', revision: 1 })
    expect((samples[0].metadata as { records: unknown[] }).records).toHaveLength(2) // originals kept
  })

  it('uses the device timezone when a record has no offset (summer time in Paris: UTC+2)', () => {
    const { samples } = buildDailySamples('steps', [step('a', '2026-07-01T22:30:00Z', 100, 'phone', null)], options)
    expect(samples.map((s) => [s.dedupeKey, s.startOffsetMinutes])).toEqual([['health_connect:steps:phone:2026-07-02', 120]])
  })

  it('heart rate: a series crossing midnight is split by sample; mean, min, max, n', () => {
    const series: SeriesRecord = {
      id: 'h1', origin: 'watch', lastModifiedMs: null, offsetSeconds: 3600,
      samples: [[Date.parse('2026-11-10T22:58:00Z'), 60], [Date.parse('2026-11-10T22:59:00Z'), 70], [Date.parse('2026-11-10T23:00:00Z'), 80]],
    }
    const { samples } = buildDailySamples('heartRate', [series], options)
    expect(samples.map((s) => [s.dedupeKey, s.value, (s.metadata as { summary: unknown }).summary])).toEqual([
      ['health_connect:heartRate:watch:2026-11-10', 65, { min: 60, max: 70, n: 2 }],
      ['health_connect:heartRate:watch:2026-11-11', 80, { min: 80, max: 80, n: 1 }],
    ])
  })

  it('resting heart rate: mean of the day, one decimal', () => {
    const point = (id: string, bpm: number): PointRecord => ({ id, origin: 'watch', lastModifiedMs: null, timeMs: Date.parse('2026-11-10T06:00:00Z'), offsetSeconds: 3600, bpm })
    const { samples } = buildDailySamples('restingHeartRate', [point('r1', 52), point('r2', 55), point('r3', 54)], options)
    expect(samples[0]).toMatchObject({ value: 53.7, unit: 'bpm', measurementType: 'hc_resting_heart_rate_daily' })
  })

  it('the same records in another order give the same sample content', () => {
    const records = [step('a', '2026-11-10T07:00:00Z', 1000), step('b', '2026-11-10T08:00:00Z', 500)]
    const one = buildDailySamples('steps', records, options).samples[0]
    const two = buildDailySamples('steps', [...records].reverse(), options).samples[0]
    expect(two.metadata).toEqual(one.metadata)
  })
})

describe('buildExerciseSamples', () => {
  it('one sample per finished session, named, with its duration in seconds', () => {
    const ride: ExerciseRecord = { id: 'e1', origin: 'watch', lastModifiedMs: null, startMs: Date.parse('2026-11-10T16:00:00Z'), endMs: Date.parse('2026-11-10T16:45:30Z'), startOffsetSeconds: 3600, exerciseType: 8, title: null }
    const today: ExerciseRecord = { ...ride, id: 'e2', startMs: Date.parse('2026-11-12T08:00:00Z'), endMs: Date.parse('2026-11-12T08:30:00Z') }
    const { samples } = buildExerciseSamples([ride, today], options)
    expect(samples).toHaveLength(1)
    expect(samples[0]).toMatchObject({
      dedupeKey: 'health_connect:exercise:e1', externalId: 'e1', value: 2730, unit: 's', measurementType: 'hc_exercise',
      metadata: { localDate: '2026-11-10', exerciseName: 'Cycling', exerciseType: 8 },
    })
  })
})

describe('planHealthImport', () => {
  const day = (amount: number) => buildDailySamples('steps', [
    { id: 'a', origin: 'phone', lastModifiedMs: null, startMs: Date.parse('2026-11-10T07:00:00Z'), endMs: Date.parse('2026-11-10T07:10:00Z'), offsetSeconds: 3600, amount },
  ], options).samples[0]

  it('adds new days, updates changed ones (same id, new revision), keeps the rest', () => {
    const stored = { ...day(1000), syncStatus: 'synced' as const, syncedRevision: 1 }
    expect(planHealthImport([day(1000)], [stored], '2026-11-13T08:00:00.000Z')).toMatchObject({ toAdd: [], toUpdate: [], unchanged: 1 })

    const later = planHealthImport([day(1400)], [stored], '2026-11-13T08:00:00.000Z')
    expect(later.toUpdate).toEqual([{ ...stored, value: 1400, metadata: day(1400).metadata, importedAt: '2026-11-13T08:00:00.000Z', updatedAt: '2026-11-13T08:00:00.000Z', revision: 2, syncStatus: 'pending' }])

    expect(planHealthImport([day(1000)], [], options.importedAt).toAdd).toHaveLength(1)
  })

  it('never brings back a day deleted in PDA', () => {
    const deleted = { ...day(1000), deletedAt: '2026-11-12T09:00:00.000Z' }
    expect(planHealthImport([day(1400)], [deleted], options.importedAt)).toMatchObject({ toAdd: [], toUpdate: [], deletedInPda: 1 })
  })
})

describe('checks for stored Health Connect records (restore and sync)', () => {
  const sample = (): ExternalSample => buildDailySamples('steps', [
    { id: 'a', origin: 'phone', lastModifiedMs: null, startMs: Date.parse('2026-11-10T07:00:00Z'), endMs: Date.parse('2026-11-10T07:10:00Z'), offsetSeconds: 3600, amount: 10 },
  ], options).samples[0]

  it('accepts what the import builds, through the general record check', () => {
    const built = sample()
    expect(() => validateHealthSample(built)).not.toThrow()
    expect(validateExternalSampleRecord(built as unknown as Record<string, unknown>)).toEqual(built)
  })

  it('refuses broken records', () => {
    expect(() => validateHealthSample({ ...sample(), unit: 'km' })).toThrow('invalid unit')
    expect(() => validateHealthSample({ ...sample(), dedupeKey: 'other' })).toThrow('invalid duplicate-detection key')
    expect(() => validateHealthSample({ ...sample(), metadata: { ...sample().metadata, records: [] } })).toThrow('missing original values')
    expect(() => validateHealthSample({ ...sample(), source: 'import' })).toThrow('source')
    expect(() => validateHealthSample({ ...sample(), measurementType: 'hc_unknown' })).toThrow('unknown kind')
  })
})
