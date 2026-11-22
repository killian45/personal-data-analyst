import type { ExternalSample } from '../database/types'
import type { Observation } from '../stats/subjects'

import { SCREEN_TIME_DAILY } from './screenTime'

/**
 * One screen-time value per day for the Dashboard. Pure function.
 *
 * - Every source's record is kept in the database; this only chooses
 *   which one is shown and counted.
 * - When a day exists from both sources, the phone's figure wins (user
 *   decision, 2026-11-11); App Usage files fill the other days (e.g. days
 *   older than the phone's ~10-day history).
 * - A day is its own calendar day as lived (metadata.localDate), whatever
 *   the display timezone: a day total has no time of day to convert.
 * - Values are in hours (like stopwatch habits). Days without a record
 *   are absent (missing, never 0). Deleted records are ignored.
 */

export interface ScreenTimeSeries {
  daily: Observation[]
  /** Days taken from each source, and days where both existed. */
  phoneDays: number
  fileDays: number
  bothDays: number
}

const PRIORITY: Record<string, number> = { android_usage: 2, import: 1 }

/** Valid, non-deleted screen-time records grouped by day, with the chosen one first. */
function recordsByDay(samples: readonly ExternalSample[]): Map<string, ExternalSample[]> {
  const byDay = new Map<string, ExternalSample[]>()

  for (const sample of samples) {
    const date = sample.metadata?.localDate
    if (sample.deletedAt !== null || sample.measurementType !== SCREEN_TIME_DAILY || typeof date !== 'string') continue
    byDay.set(date, [...(byDay.get(date) ?? []), sample])
  }

  for (const records of byDay.values()) {
    records.sort((a, b) => (PRIORITY[b.source] ?? 0) - (PRIORITY[a.source] ?? 0) || a.id.localeCompare(b.id))
  }
  return byDay
}

/** Ids of the records the Dashboard uses (one per day). */
export function chosenScreenTimeIds(samples: readonly ExternalSample[]): string[] {
  return [...recordsByDay(samples).values()].map((records) => records[0].id)
}

export function screenTimeObservations(samples: readonly ExternalSample[]): ScreenTimeSeries {
  const byDay = recordsByDay(samples)

  let phoneDays = 0
  let fileDays = 0
  let bothDays = 0
  const daily: Observation[] = []

  for (const date of [...byDay.keys()].sort()) {
    const records = byDay.get(date) as ExternalSample[]
    const chosen = records[0]
    const sources = new Set(records.map((record) => record.source))

    if (chosen.source === 'android_usage') phoneDays += 1
    else fileDays += 1
    if (sources.has('android_usage') && sources.has('import')) bothDays += 1

    daily.push({ date, value: chosen.value / 3600 })
  }

  return { daily, phoneDays, fileDays, bothDays }
}

// ---------------------------------------------------------------------------
// Time per app (2026-11-12)
//
// Conventions (documented choice):
// - The same day record is used as for the total (the phone's when both a
//   phone record and an App Usage file exist).
// - Apps are identified by their displayed name, so the phone and App
//   Usage files (which give names only) count as the same app.
// - A day WITH a screen-time record that does not list an app counts as
//   0 for that app: the day was fully recorded and the app was not used.
//   A day WITHOUT a record is missing (never 0), like the total.

export interface AppUsageTotal {
  name: string
  /** Seconds in the given days. */
  seconds: number
  /** Days on which the app was used. */
  daysUsed: number
}

function appSecondsOf(sample: ExternalSample): Map<string, number> {
  const seconds = new Map<string, number>()
  const apps = (sample.metadata as { apps?: { name?: unknown; seconds?: unknown }[] | null } | null)?.apps ?? []
  for (const app of apps) {
    if (typeof app.name !== 'string' || typeof app.seconds !== 'number' || !Number.isFinite(app.seconds)) continue
    const name = app.name.trim()
    if (name === '') continue
    seconds.set(name, (seconds.get(name) ?? 0) + app.seconds)
  }
  return seconds
}

/** Apps used in the chosen days (between start and end, inclusive), most used first. */
export function appUsageTotals(samples: readonly ExternalSample[], range?: { start: string; end: string }): AppUsageTotal[] {
  const totals = new Map<string, AppUsageTotal>()
  for (const [date, records] of recordsByDay(samples)) {
    if (range && (date < range.start || date > range.end)) continue
    for (const [name, seconds] of appSecondsOf(records[0])) {
      const total = totals.get(name) ?? { name, seconds: 0, daysUsed: 0 }
      total.seconds += seconds
      if (seconds > 0) total.daysUsed += 1
      totals.set(name, total)
    }
  }
  return [...totals.values()].sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))
}

/** Daily time of one app in hours, for every day with a screen-time record (0 when not used). */
export function appDailyObservations(samples: readonly ExternalSample[], appName: string): Observation[] {
  const byDay = recordsByDay(samples)
  const daily: Observation[] = []
  for (const date of [...byDay.keys()].sort()) {
    const records = byDay.get(date) as ExternalSample[]
    daily.push({ date, value: (appSecondsOf(records[0]).get(appName) ?? 0) / 3600 })
  }
  return daily
}
