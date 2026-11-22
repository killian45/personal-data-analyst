import { dateLocale, messages } from '../i18n'
import { tz, tzOffset } from '@date-fns/tz'
import { format } from 'date-fns'

/**
 * Timezone-aware date and time utilities.
 *
 * Conventions (see PROJECT_SPEC.md §5):
 * - Event instants are stored as UTC ISO strings ("...Z").
 * - Each event also stores the IANA timezone in which it happened.
 * - "Local date-time" means a wall-clock reading in a given timezone,
 *   written "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss" (the format used
 *   by HTML datetime-local inputs). It has no meaning without a timezone.
 * - Elapsed durations are always the difference between two UTC instants,
 *   never a difference between wall-clock readings.
 * - Nothing here relies on the browser's own timezone, except
 *   getDeviceTimezone(), which reads it on purpose.
 */

/** Used when the device timezone cannot be determined. */
export const FALLBACK_TIMEZONE = 'Europe/Paris'

const LOCAL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/**
 * Returns true for a timezone name the browser recognises,
 * e.g. "Europe/Paris" or "UTC".
 */
export function isValidTimezone(timezone: unknown): timezone is string {
  if (typeof timezone !== 'string' || timezone.trim().length === 0) {
    return false
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/** The timezone the device reports, or null when it gives none (or an invalid one). */
function reportedTimezone(): string | null {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

    if (timezone !== 'Etc/Unknown' && isValidTimezone(timezone)) {
      return timezone
    }
  } catch {
    // No timezone reported.
  }
  return null
}

/** Whether the device reports its timezone (sharing plan S4: otherwise the welcome screen asks). */
export function deviceReportsTimezone(): boolean {
  return reportedTimezone() !== null
}

/**
 * Timezone chosen on the welcome screen, used only when the device reports
 * none (this device's localStorage, not synced).
 */
export const CHOSEN_FALLBACK_TIMEZONE_KEY = 'pda.fallbackTimezone'

function chosenFallbackTimezone(): string | null {
  try {
    const value = globalThis.localStorage?.getItem(CHOSEN_FALLBACK_TIMEZONE_KEY) ?? null
    return value !== null && isValidTimezone(value) ? value : null
  } catch {
    return null
  }
}

export function saveFallbackTimezone(timezone: string): void {
  if (!isValidTimezone(timezone)) return
  globalThis.localStorage?.setItem(CHOSEN_FALLBACK_TIMEZONE_KEY, timezone)
}

/**
 * Returns the device's current IANA timezone. When the device gives none:
 * the timezone chosen on the welcome screen, else Europe/Paris.
 */
export function getDeviceTimezone(): string {
  return reportedTimezone() ?? chosenFallbackTimezone() ?? FALLBACK_TIMEZONE
}

function assertTimezone(timezone: string): void {
  if (!isValidTimezone(timezone)) {
    throw new Error(messages().validation.timezone)
  }
}

function parseUtc(utc: string): number {
  const instant = typeof utc === 'string' ? Date.parse(utc) : Number.NaN

  if (!Number.isFinite(instant)) {
    throw new Error(messages().inputText.invalidUtc)
  }

  return instant
}

/**
 * Offset of the timezone from UTC at a given instant, in minutes
 * (e.g. +60 for Paris in winter, +120 in summer).
 */
export function getUtcOffsetMinutes(utc: string, timezone: string): number {
  assertTimezone(timezone)

  return tzOffset(timezone, new Date(parseUtc(utc)))
}

export interface LocalToUtcResult {
  /** The UTC instant as an ISO string. */
  utc: string

  /**
   * True when this wall-clock time occurs twice in the timezone
   * (clocks going back). The earlier occurrence is returned.
   */
  ambiguous: boolean
}

/**
 * Converts a wall-clock time in a timezone to a UTC instant.
 *
 * Daylight-saving rules:
 * - A time that does not exist (clocks jump forward, e.g. 02:30 in Paris
 *   on the last Sunday of March) is rejected with an error. It is never
 *   silently moved.
 * - A time that exists twice (clocks go back, e.g. 02:30 in Paris on the
 *   last Sunday of October) resolves to the earlier occurrence and is
 *   flagged as ambiguous.
 */
export function localDateTimeToUtc(
  localDateTime: string,
  timezone: string,
): LocalToUtcResult {
  assertTimezone(timezone)

  const match =
    typeof localDateTime === 'string'
      ? LOCAL_DATE_TIME.exec(localDateTime)
      : null

  if (!match) {
    throw new Error(
      messages().inputText.localFormat,
    )
  }

  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map((part) => (part === undefined ? 0 : Number(part)))

  // The wall-clock reading expressed as if it were UTC.
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const check = new Date(wallAsUtc)

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    throw new Error(messages().inputText.invalidDateOrTime)
  }

  // Every offset the timezone uses within a day either side.
  // A daylight-saving change can only make these differ.
  const candidateOffsets = new Set(
    [-DAY_MS, 0, DAY_MS].map((shift) =>
      tzOffset(timezone, new Date(wallAsUtc + shift)),
    ),
  )

  // Keep each instant whose local reading really is the requested time.
  const matches = [...candidateOffsets]
    .map((offset) => wallAsUtc - offset * MINUTE_MS)
    .filter(
      (instant) =>
        instant + tzOffset(timezone, new Date(instant)) * MINUTE_MS ===
        wallAsUtc,
    )
    .sort((a, b) => a - b)

  if (matches.length === 0) {
    throw new Error(
      messages().inputText.nonexistentTime(timezone),
    )
  }

  return {
    utc: new Date(matches[0]).toISOString(),
    ambiguous: new Set(matches).size > 1,
  }
}

/**
 * Converts a UTC instant to a wall-clock reading in a timezone,
 * in the format used by datetime-local inputs.
 */
export function utcToLocalDateTime(
  utc: string,
  timezone: string,
  options: { includeSeconds?: boolean } = {},
): string {
  return formatInTimezone(
    utc,
    timezone,
    options.includeSeconds
      ? "yyyy-MM-dd'T'HH:mm:ss"
      : "yyyy-MM-dd'T'HH:mm",
  )
}

/**
 * Formats a UTC instant as seen in a timezone, using a date-fns pattern.
 * Default pattern: "2026-11-09 14:30".
 */
export function formatInTimezone(
  utc: string,
  timezone: string,
  pattern = 'yyyy-MM-dd HH:mm',
): string {
  assertTimezone(timezone)

  // Month and weekday names follow the app's language (patterns stay fixed).
  return format(new Date(parseUtc(utc)), pattern, { in: tz(timezone), locale: dateLocale() })
}

/**
 * Actual elapsed time between two UTC instants, in milliseconds.
 * Correct across daylight-saving changes and timezone travel.
 */
export function elapsedMilliseconds(startUtc: string, endUtc: string): number {
  return parseUtc(endUtc) - parseUtc(startUtc)
}

/**
 * Writes a UTC offset in minutes as "+01:00" / "−05:30" style text that
 * the date library accepts as a timezone (for data that only has an
 * offset, such as Health Connect records).
 */
export function offsetToZoneName(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+'
  const absolute = Math.abs(offsetMinutes)
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0')
  const minutes = String(absolute % 60).padStart(2, '0')

  return `${sign}${hours}:${minutes}`
}
