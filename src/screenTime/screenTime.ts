import { messages } from '../i18n'
import type { DataSource, ExternalSample } from '../database/types'
import { localDateTimeToUtc } from '../time/time'

/**
 * Daily screen time stored as an imported sample (docs/PHASE5_PLAN.md §3).
 * Pure functions, independent of React and of the database.
 *
 * Conventions:
 * - One record per local day and source: measurementType
 *   "screen_time_daily", value = total foreground time of all apps that
 *   day in whole seconds (unit "s"), as reported by the source.
 * - startUtc / endUtc are the real start and end of that local day in the
 *   record's timezone, so a daylight-saving day lasts 23 or 25 hours.
 * - metadata.apps keeps the per-app breakdown exactly as reported.
 * - A missing day is simply absent: it is never stored as 0 seconds.
 */

export const SCREEN_TIME_DAILY = 'screen_time_daily'
export const SCREEN_TIME_FORMAT = 1

/** Shortest and longest possible local day (daylight-saving changes). */
const MIN_DAY_MS = 22 * 3_600_000
const MAX_DAY_MS = 26 * 3_600_000
const MAX_APPS = 2000
const MAX_APP_NAME = 200

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export interface ScreenTimeApp {
  /** App name as shown by the source app. */
  name: string
  seconds: number
  /** Number of times the app was opened, if reported. */
  opens: number | null
  /** Android package name, when read on the phone. */
  package?: string
}

export interface ScreenTimeMetadata {
  format: typeof SCREEN_TIME_FORMAT
  /** The local day, "YYYY-MM-DD". */
  localDate: string
  /** Per-app breakdown, or null when the source only gives a total. */
  apps: ScreenTimeApp[] | null
  [key: string]: unknown
}

/** True for a real calendar date written "YYYY-MM-DD". */
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = LOCAL_DATE.exec(value)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number)
  const check = new Date(Date.UTC(year, month - 1, day))
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
}

/** The calendar day after a "YYYY-MM-DD" date. */
export function nextLocalDate(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

/**
 * The first instant of a local day: midnight, or — in the few timezones
 * whose clocks jump forward at midnight — the moment the day really
 * starts (01:00 local).
 */
function dayStartUtc(localDate: string, timezone: string): string {
  try {
    return localDateTimeToUtc(`${localDate}T00:00`, timezone).utc
  } catch (error) {
    if (error instanceof Error && error.message.includes('does not exist')) {
      return localDateTimeToUtc(`${localDate}T01:00`, timezone).utc
    }
    throw error
  }
}

/** Real start and end (UTC) of a local day in a timezone. */
export function localDayBoundsUtc(localDate: string, timezone: string): { startUtc: string; endUtc: string } {
  if (!isLocalDate(localDate)) {
    throw new Error(messages().importText.invalidDate)
  }
  return { startUtc: dayStartUtc(localDate, timezone), endUtc: dayStartUtc(nextLocalDate(localDate), timezone) }
}

/** Deterministic duplicate-detection key: one record per source and day. */
export function buildScreenTimeDedupeKey(source: DataSource, localDate: string): string {
  return `screen_time:${source}:${localDate}`
}

function requireWholeSeconds(value: unknown, maxSeconds: number, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > maxSeconds) {
    throw new Error(`invalid ${field}`)
  }
  return value
}

/**
 * Checks the screen-time part of an imported sample (used when importing,
 * restoring a backup and receiving synchronised records). Throws an Error
 * explaining the first problem found.
 *
 * Deliberately does not recompute the day boundaries from the timezone
 * rules: those rules can differ slightly between browser versions, and a
 * valid record must not be rejected on another device because of that.
 */
export function validateScreenTimeSample(
  sample: Pick<ExternalSample, 'source' | 'dedupeKey' | 'measurementType' | 'value' | 'unit' | 'startUtc' | 'endUtc' | 'timezone' | 'metadata'>,
): ScreenTimeMetadata {
  if (sample.measurementType !== SCREEN_TIME_DAILY) {
    throw new Error('unknown kind of imported sample')
  }
  if (sample.source !== 'import' && sample.source !== 'android_usage') {
    throw new Error('invalid source for screen time')
  }
  if (sample.unit !== 's') {
    throw new Error('screen time must be stored in seconds')
  }
  if (sample.timezone === null) {
    throw new Error('screen time needs a timezone')
  }
  if (sample.endUtc === null) {
    throw new Error('screen time needs the end of its day')
  }

  const dayMs = Date.parse(sample.endUtc) - Date.parse(sample.startUtc)
  if (!(dayMs >= MIN_DAY_MS && dayMs <= MAX_DAY_MS)) {
    throw new Error('the start and end of the day are not about 24 hours apart')
  }
  const daySeconds = dayMs / 1000

  requireWholeSeconds(sample.value, daySeconds, 'screen time (more than the length of the day, or not whole seconds)')

  const metadata = sample.metadata
  if (!metadata || metadata.format !== SCREEN_TIME_FORMAT) {
    throw new Error('unknown screen-time format')
  }
  if (!isLocalDate(metadata.localDate)) {
    throw new Error('invalid screen-time day')
  }
  if (sample.dedupeKey !== buildScreenTimeDedupeKey(sample.source, metadata.localDate)) {
    throw new Error('its duplicate-detection key does not match its data')
  }

  const apps = metadata.apps
  if (apps !== null) {
    if (!Array.isArray(apps) || apps.length > MAX_APPS) {
      throw new Error('invalid list of apps')
    }
    for (const app of apps as unknown[]) {
      const { name, seconds, opens } = (app ?? {}) as Record<string, unknown>
      if (typeof name !== 'string' || name.length === 0 || name.length > MAX_APP_NAME) {
        throw new Error('invalid app name')
      }
      requireWholeSeconds(seconds, daySeconds, `time for app "${name}"`)
      if (opens !== null) requireWholeSeconds(opens, 1_000_000, `number of opens for app "${name}"`)
    }
  }

  return metadata as ScreenTimeMetadata
}
