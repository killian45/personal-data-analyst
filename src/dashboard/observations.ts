import type { Entry, Habit } from '../database/types'
import { resolveDisplayZone } from '../settings/displayTimezone'
import type { DisplayTimezone } from '../settings/displayTimezone'
import type { Night } from '../sleep/engine/processSleep'
import { activeDurationMs } from '../stopwatch/duration'
import type { Observation } from '../stats/subjects'
import { formatInTimezone } from '../time/time'

/**
 * Turns records into one value per day for the dashboard. Pure functions.
 *
 * Days are local dates in the display timezone setting (the same dates as
 * in the Personal Data Log). Days without records are simply absent: they
 * are missing, never zero.
 */

const HOUR_MS = 3_600_000

export interface SleepObservations {
  /** Sleep duration per night, in hours. */
  sleepDuration: Observation[]
  /** Time in bed per night, in hours. */
  timeInBed: Observation[]
  /** Bedtime per night on the continuous axis (hours). */
  bedtime: Observation[]
  /** Wake time per night on the continuous axis (hours). */
  wakeTime: Observation[]
}

/** One observation per night, dated by the night date (§7.2). */
export function sleepObservations(nights: readonly Night[]): SleepObservations {
  return {
    sleepDuration: nights.map((night) => ({ date: night.nightDate, value: night.sleepMs / HOUR_MS })),
    timeInBed: nights.map((night) => ({ date: night.nightDate, value: night.timeInBedMs / HOUR_MS })),
    bedtime: nights.map((night) => ({ date: night.nightDate, value: night.bedtimeHours })),
    wakeTime: nights.map((night) => ({ date: night.nightDate, value: night.wakeHours })),
  }
}

/** Local date of an entry in the display timezone. */
export function entryDate(entry: Entry, displayTimezone: DisplayTimezone, deviceTimezone?: string): string {
  return formatInTimezone(
    entry.occurredStart,
    resolveDisplayZone(displayTimezone, entry.timezone, deviceTimezone),
    'yyyy-MM-dd',
  )
}

/**
 * Daily values of a numeric habit:
 * - number: total or average of the day's values (habit setting);
 * - stopwatch: total active time of the sessions started that day, in hours;
 * - checkbox: 1 if at least one Done entry, else 0.
 * Label and text habits have no numeric daily value (counts only).
 *
 * Deleted entries and entries of other habits are ignored.
 */
export function habitDailyObservations(
  habit: Habit,
  entries: readonly Entry[],
  displayTimezone: DisplayTimezone,
  deviceTimezone?: string,
): Observation[] {
  if (habit.type === 'label' || habit.type === 'text') {
    return []
  }

  const byDay = new Map<string, number[]>()

  for (const entry of entries) {
    if (entry.habitId !== habit.id || entry.deletedAt !== null) {
      continue
    }

    let value: number

    if (entry.habitType === 'number') {
      value = entry.value
    } else if (entry.habitType === 'stopwatch') {
      value = activeDurationMs(entry.value.segments) / HOUR_MS
    } else if (entry.habitType === 'checkbox') {
      value = entry.value ? 1 : 0
    } else {
      continue
    }

    const date = entryDate(entry, displayTimezone, deviceTimezone)
    byDay.set(date, [...(byDay.get(date) ?? []), value])
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => {
      let value: number

      if (habit.type === 'checkbox') {
        value = values.some((item) => item === 1) ? 1 : 0
      } else if (habit.type === 'number' && habit.dailyAggregation === 'mean') {
        value = values.reduce((sum, item) => sum + item, 0) / values.length
      } else {
        value = values.reduce((sum, item) => sum + item, 0)
      }

      return { date, value }
    })
}

/** Values (as text) of a label or text habit's entries, with their dates. */
export function habitTextValues(
  habit: Habit,
  entries: readonly Entry[],
  displayTimezone: DisplayTimezone,
  deviceTimezone?: string,
): { date: string; value: string }[] {
  return entries
    .filter((entry) => entry.habitId === habit.id && entry.deletedAt === null)
    .filter((entry) => entry.habitType === 'label' || entry.habitType === 'text')
    .map((entry) => ({ date: entryDate(entry, displayTimezone, deviceTimezone), value: String(entry.value) }))
}
