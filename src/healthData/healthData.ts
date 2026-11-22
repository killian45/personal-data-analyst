import { initialSyncFields, nextSyncFields } from '../database/sync'
import { stableStringify } from '../database/stableStringify'
import type { ExternalSample } from '../database/types'
import { messages } from '../i18n'
import { parseZoneOffsetSeconds } from '../import/healthConnectDevice'
import { getUtcOffsetMinutes } from '../time/time'

/**
 * Health Connect activity and heart data (docs/HEALTH_DATA_PLAN.md).
 * Pure functions: plugin records → checked neutral records → imported
 * samples (one per local day and source app, or one per exercise session)
 * → a plan of what to add and update. No plugin, no database.
 */

export type HealthKind = 'steps' | 'distance' | 'restingHeartRate' | 'heartRate'

export const HEALTH_MEASUREMENTS: Record<HealthKind, string> = {
  steps: 'hc_steps_daily',
  distance: 'hc_distance_daily',
  restingHeartRate: 'hc_resting_heart_rate_daily',
  heartRate: 'hc_heart_rate_daily',
}
export const EXERCISE_MEASUREMENT = 'hc_exercise'
export const HEALTH_DAILY_KINDS: readonly HealthKind[] = ['steps', 'distance', 'restingHeartRate', 'heartRate']
export const HEALTH_MEASUREMENT_TYPES: readonly string[] = [...Object.values(HEALTH_MEASUREMENTS), EXERCISE_MEASUREMENT]

export const HEALTH_UNITS: Record<HealthKind | 'exercise', string> = {
  steps: 'steps',
  distance: 'm',
  restingHeartRate: 'bpm',
  heartRate: 'bpm',
  exercise: 's',
}

/* Getters: the text of the current language is read when used (sharing plan S2i). */
export const HEALTH_LABELS: Record<HealthKind | 'exercise', string> = {
  get steps() { return messages().labels.health.steps },
  get distance() { return messages().labels.health.distance },
  get restingHeartRate() { return messages().labels.health.restingHeartRate },
  get heartRate() { return messages().labels.health.heartRate },
  get exercise() { return messages().labels.health.exercise },
}

/** Exercise types (androidx.health.connect ExerciseSessionRecord constants); others show their number. */
/** Names: messages().labels.exercises. */
export const EXERCISE_TYPES = [0, 8, 9, 25, 36, 37, 48, 53, 54, 56, 57, 70, 71, 73, 74, 79, 83] as const

export function exerciseName(type: number): string {
  return messages().labels.exercises[type] ?? messages().labels.exerciseType(type)
}

const DAY_MS = 86_400_000
const MAX_SAMPLE_JSON = 900_000

// ---------------------------------------------------------------------------
// Neutral records (checked at the data boundary)

interface Base {
  id: string
  origin: string
  lastModifiedMs: number | null
}
export interface IntervalRecord extends Base { startMs: number; endMs: number; offsetSeconds: number | null; amount: number }
export interface PointRecord extends Base { timeMs: number; offsetSeconds: number | null; bpm: number }
export interface SeriesRecord extends Base { offsetSeconds: number | null; samples: [number, number][] }
export interface ExerciseRecord extends Base {
  startMs: number
  endMs: number
  startOffsetSeconds: number | null
  exerciseType: number
  title: string | null
}

export type NeutralRecords = {
  steps: IntervalRecord[]
  distance: IntervalRecord[]
  restingHeartRate: PointRecord[]
  heartRate: SeriesRecord[]
  exercise: ExerciseRecord[]
}

type Raw = Record<string, unknown>

function timeMs(value: unknown, label: string): number {
  const ms = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(ms)) throw new Error(`invalid ${label}`)
  return ms
}

function base(raw: Raw): Base {
  const meta = (raw.metadata ?? {}) as Raw
  if (typeof meta.id !== 'string' || meta.id === '') throw new Error('the record has no Health Connect id')
  return {
    id: meta.id,
    origin: typeof meta.dataOrigin === 'string' && meta.dataOrigin !== '' ? meta.dataOrigin : 'unknown',
    lastModifiedMs: meta.lastModifiedTime === undefined ? null : timeMs(meta.lastModifiedTime, 'last modified time'),
  }
}

function nonNegative(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`invalid ${label}`)
  return value
}

const METRES: Record<string, number> = { meter: 1, kilometer: 1000, mile: 1609.344, inch: 0.0254, feet: 0.3048 }

function bpm(value: unknown): number {
  const n = nonNegative(value, 'heart rate')
  if (n < 1 || n > 300) throw new Error('heart rate out of range (1–300 bpm)')
  return n
}

/** Plugin record → neutral record of the given kind. Throws (with a reason) on malformed input. */
export function fromPlugin(kind: HealthKind | 'exercise', raw: Raw): IntervalRecord | PointRecord | SeriesRecord | ExerciseRecord {
  const common = base(raw)
  switch (kind) {
    case 'steps':
    case 'distance': {
      const startMs = timeMs(raw.startTime, 'start time')
      const endMs = timeMs(raw.endTime, 'end time')
      if (endMs < startMs) throw new Error('ends before it starts')
      let amount: number
      if (kind === 'steps') {
        amount = nonNegative(raw.count, 'step count')
      } else {
        const length = (raw.distance ?? {}) as Raw
        const factor = typeof length.unit === 'string' ? METRES[length.unit] : undefined
        if (factor === undefined) throw new Error('unknown distance unit')
        amount = nonNegative(length.value, 'distance') * factor
      }
      return { ...common, startMs, endMs, offsetSeconds: parseZoneOffsetSeconds(raw.startZoneOffset), amount }
    }
    case 'restingHeartRate':
      return { ...common, timeMs: timeMs(raw.time, 'time'), offsetSeconds: parseZoneOffsetSeconds(raw.zoneOffset), bpm: bpm(raw.beatsPerMinute) }
    case 'heartRate': {
      if (!Array.isArray(raw.samples)) throw new Error('no heart-rate samples')
      const samples = (raw.samples as Raw[]).map((sample): [number, number] => [timeMs(sample.time, 'sample time'), bpm(sample.beatsPerMinute)])
      return { ...common, offsetSeconds: parseZoneOffsetSeconds(raw.startZoneOffset), samples }
    }
    case 'exercise': {
      const startMs = timeMs(raw.startTime, 'start time')
      const endMs = timeMs(raw.endTime, 'end time')
      if (endMs < startMs) throw new Error('ends before it starts')
      const type = typeof raw.exerciseType === 'number' && Number.isInteger(raw.exerciseType) ? raw.exerciseType : 0
      return {
        ...common, startMs, endMs, startOffsetSeconds: parseZoneOffsetSeconds(raw.startZoneOffset), exerciseType: type,
        title: typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title.trim().slice(0, 200) : null,
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Days

/** UTC offset in seconds: the record's own, else the device timezone's at that instant. */
function offsetAt(ms: number, offsetSeconds: number | null, zone: string): number {
  return offsetSeconds ?? getUtcOffsetMinutes(new Date(ms).toISOString(), zone) * 60
}

export function localDateOf(ms: number, offsetSeconds: number): string {
  return new Date(ms + offsetSeconds * 1000).toISOString().slice(0, 10)
}

function dayBounds(date: string, offsetSeconds: number): { startUtc: string; endUtc: string } {
  const start = Date.parse(`${date}T00:00:00Z`) - offsetSeconds * 1000
  return { startUtc: new Date(start).toISOString(), endUtc: new Date(start + DAY_MS).toISOString() }
}

// ---------------------------------------------------------------------------
// Imported samples

export interface BuildOptions {
  /** Device timezone (used only when a record has no UTC offset). */
  zone: string
  /** Today's local date: only days before it are imported (finished days). */
  today: string
  importedAt: string
  newId: () => string
}

export interface HealthDayMetadata {
  format: 1
  kind: HealthKind
  localDate: string
  origin: string
  /** Every original value of that day (compact arrays, see docs/HEALTH_DATA_PLAN.md). */
  records: unknown[]
  /** Heart rate: lowest, highest and number of samples. */
  summary?: { min: number; max: number; n: number }
}

interface DayBucket {
  date: string
  origin: string
  offsetSeconds: number
  records: unknown[]
  values: number[]
}

function newSample(fields: Pick<ExternalSample, 'dedupeKey' | 'measurementType' | 'value' | 'unit' | 'startUtc' | 'endUtc' | 'startOffsetMinutes' | 'sourceApp' | 'externalId' | 'metadata'>, options: BuildOptions): ExternalSample {
  return {
    id: options.newId(),
    source: 'health_connect',
    timezone: null,
    importedAt: options.importedAt,
    ...fields,
    ...initialSyncFields(),
    createdAt: options.importedAt,
    updatedAt: options.importedAt,
    deletedAt: null,
  }
}

export interface BuildResult {
  samples: ExternalSample[]
  /** Parts not imported, with the reason (never silently dropped). */
  notImported: { label: string; reason: string }[]
}

/** One imported sample per finished local day and source app for a daily kind. */
export function buildDailySamples(kind: HealthKind, records: readonly (IntervalRecord | PointRecord | SeriesRecord)[], options: BuildOptions): BuildResult {
  const buckets = new Map<string, DayBucket>()
  const bucket = (date: string, origin: string, offsetSeconds: number) => {
    const key = `${origin}\n${date}`
    let found = buckets.get(key)
    if (!found) {
      found = { date, origin, offsetSeconds, records: [], values: [] }
      buckets.set(key, found)
    }
    return found
  }

  for (const record of records) {
    if (kind === 'heartRate') {
      const series = record as SeriesRecord
      const perDay = new Map<string, { offset: number; samples: [number, number][] }>()
      for (const [t, value] of series.samples) {
        const offset = offsetAt(t, series.offsetSeconds, options.zone)
        const date = localDateOf(t, offset)
        const day = perDay.get(date) ?? { offset, samples: [] }
        day.samples.push([t, value])
        perDay.set(date, day)
      }
      for (const [date, day] of perDay) {
        const target = bucket(date, series.origin, day.offset)
        target.records.push([series.id, series.lastModifiedMs, day.samples])
        target.values.push(...day.samples.map(([, value]) => value))
      }
    } else if (kind === 'restingHeartRate') {
      const point = record as PointRecord
      const offset = offsetAt(point.timeMs, point.offsetSeconds, options.zone)
      const target = bucket(localDateOf(point.timeMs, offset), point.origin, offset)
      target.records.push([point.id, point.timeMs, point.bpm, point.lastModifiedMs])
      target.values.push(point.bpm)
    } else {
      const interval = record as IntervalRecord
      const offset = offsetAt(interval.startMs, interval.offsetSeconds, options.zone)
      const target = bucket(localDateOf(interval.startMs, offset), interval.origin, offset)
      target.records.push([interval.id, interval.startMs, interval.endMs, interval.amount, interval.lastModifiedMs])
      target.values.push(interval.amount)
    }
  }

  const result: BuildResult = { samples: [], notImported: [] }
  for (const day of [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date) || a.origin.localeCompare(b.origin))) {
    if (day.date >= options.today || day.values.length === 0) continue
    // Same order whatever order Health Connect returned the records in.
    day.records.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)))
    const sum = day.values.reduce((total, value) => total + value, 0)
    const isMean = kind === 'restingHeartRate' || kind === 'heartRate'
    const value = isMean ? Math.round((sum / day.values.length) * 10) / 10 : kind === 'steps' ? Math.round(sum) : Math.round(sum * 10) / 10
    const metadata: HealthDayMetadata = { format: 1, kind, localDate: day.date, origin: day.origin, records: day.records }
    if (kind === 'heartRate') metadata.summary = { min: Math.min(...day.values), max: Math.max(...day.values), n: day.values.length }

    const label = `${HEALTH_LABELS[kind]} ${day.date} (${day.origin})`
    if (JSON.stringify(metadata).length > MAX_SAMPLE_JSON) {
      result.notImported.push({ label, reason: 'too many values in one day to store and sync' })
      continue
    }
    result.samples.push(newSample({
      dedupeKey: `health_connect:${kind}:${day.origin}:${day.date}`,
      measurementType: HEALTH_MEASUREMENTS[kind],
      value,
      unit: HEALTH_UNITS[kind],
      ...dayBounds(day.date, day.offsetSeconds),
      startOffsetMinutes: Math.round(day.offsetSeconds / 60),
      sourceApp: day.origin,
      externalId: null,
      metadata: metadata as unknown as Record<string, unknown>,
    }, options))
  }
  return result
}

/** One imported sample per finished exercise session that started before today. */
export function buildExerciseSamples(records: readonly ExerciseRecord[], options: BuildOptions): BuildResult {
  const result: BuildResult = { samples: [], notImported: [] }
  for (const session of records) {
    const offset = offsetAt(session.startMs, session.startOffsetSeconds, options.zone)
    const date = localDateOf(session.startMs, offset)
    if (date >= options.today) continue
    result.samples.push(newSample({
      dedupeKey: `health_connect:exercise:${session.id}`,
      measurementType: EXERCISE_MEASUREMENT,
      value: Math.round((session.endMs - session.startMs) / 1000),
      unit: 's',
      startUtc: new Date(session.startMs).toISOString(),
      endUtc: new Date(session.endMs).toISOString(),
      startOffsetMinutes: Math.round(offset / 60),
      sourceApp: session.origin,
      externalId: session.id,
      metadata: {
        format: 1, kind: 'exercise', localDate: date, origin: session.origin,
        exerciseType: session.exerciseType, exerciseName: exerciseName(session.exerciseType),
        title: session.title, lastModifiedMs: session.lastModifiedMs,
      },
    }, options))
  }
  return result
}

// ---------------------------------------------------------------------------
// Plan

export interface HealthImportPlan {
  toAdd: ExternalSample[]
  /** Stored days/sessions whose Health Connect records changed: new version (same id). */
  toUpdate: ExternalSample[]
  unchanged: number
  /** Deleted in PDA by the user: left deleted. */
  deletedInPda: number
  notImported: { label: string; reason: string }[]
}

const CONTENT = (sample: ExternalSample) =>
  stableStringify([sample.value, sample.unit, sample.startUtc, sample.endUtc, sample.startOffsetMinutes, sample.sourceApp, sample.metadata])

/**
 * Compares freshly built samples with the stored ones (same duplicate
 * keys). New → add; changed in Health Connect → update (a new revision of
 * the stored record, keeping its id); same → nothing; deleted in PDA →
 * left as it is.
 */
export function planHealthImport(built: readonly ExternalSample[], existing: readonly ExternalSample[], importedAt: string, notImported: HealthImportPlan['notImported'] = []): HealthImportPlan {
  const byKey = new Map(existing.map((sample) => [sample.dedupeKey, sample]))
  const plan: HealthImportPlan = { toAdd: [], toUpdate: [], unchanged: 0, deletedInPda: 0, notImported: [...notImported] }
  for (const sample of built) {
    const stored = byKey.get(sample.dedupeKey)
    if (!stored) {
      plan.toAdd.push(sample)
    } else if (stored.deletedAt !== null) {
      plan.deletedInPda += 1
    } else if (CONTENT(stored) === CONTENT(sample)) {
      plan.unchanged += 1
    } else {
      plan.toUpdate.push({
        ...stored,
        value: sample.value,
        unit: sample.unit,
        startUtc: sample.startUtc,
        endUtc: sample.endUtc,
        startOffsetMinutes: sample.startOffsetMinutes,
        sourceApp: sample.sourceApp,
        metadata: sample.metadata,
        importedAt,
        ...nextSyncFields(stored),
        updatedAt: importedAt,
      })
    }
  }
  return plan
}

// ---------------------------------------------------------------------------
// Checks for stored records (backup restore and sync)

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Throws if an imported Health Connect sample breaks the rules. */
export function validateHealthSample(sample: ExternalSample): void {
  if (sample.source !== 'health_connect') throw new Error('Health Connect data must have the source "health_connect"')
  const metadata = (sample.metadata ?? {}) as Record<string, unknown>
  if (typeof metadata.localDate !== 'string' || !LOCAL_DATE.test(metadata.localDate)) throw new Error('missing or invalid day')
  if (typeof metadata.origin !== 'string' || metadata.origin === '') throw new Error('missing source app')
  if (!(sample.value >= 0)) throw new Error('negative value')

  if (sample.measurementType === EXERCISE_MEASUREMENT) {
    if (sample.unit !== 's' || sample.endUtc === null || typeof sample.externalId !== 'string') throw new Error('invalid exercise session')
    if (typeof metadata.exerciseType !== 'number') throw new Error('invalid exercise type')
    if (sample.dedupeKey !== `health_connect:exercise:${sample.externalId}`) throw new Error('invalid duplicate-detection key')
    return
  }

  const kind = HEALTH_DAILY_KINDS.find((item) => HEALTH_MEASUREMENTS[item] === sample.measurementType)
  if (!kind) throw new Error(`unknown kind of Health Connect data "${sample.measurementType}"`)
  if (sample.unit !== HEALTH_UNITS[kind]) throw new Error('invalid unit')
  if (metadata.kind !== kind || !Array.isArray(metadata.records) || metadata.records.length === 0) throw new Error('missing original values')
  if (sample.dedupeKey !== `health_connect:${kind}:${metadata.origin}:${metadata.localDate}`) throw new Error('invalid duplicate-detection key')
}

export function isHealthMeasurement(type: string): boolean {
  return HEALTH_MEASUREMENT_TYPES.includes(type)
}
