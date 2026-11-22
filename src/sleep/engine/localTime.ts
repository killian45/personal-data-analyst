import { formatInTimezone } from '../../time/time'

/**
 * Local clock readings for the sleep engine.
 *
 * Night date (PROJECT_SPEC.md §7.2): from the local start time of a
 * merged session in its event timezone:
 * - at or after 12:00 → that local calendar date;
 * - before 12:00     → the preceding local calendar date.
 *
 * Continuous time axis (§7.7): a local clock reading expressed as hours
 * after 00:00 on the night date, so times after midnight continue past 24:
 * 23:30 → 23.5, 00:30 the next day → 24.5, 07:00 the next day → 31.0.
 * The axis uses WALL-CLOCK readings (what the clock showed), not elapsed
 * time, so a daylight-saving night still has its 07:00 wake time at 31.0.
 */

export interface LocalReading {
  /** Local calendar date "YYYY-MM-DD". */
  date: string
  /** Minutes since local midnight, 0–1439 (seconds included as a fraction). */
  minutesOfDay: number
}

export function localReading(utc: string, zone: string): LocalReading {
  const [date, time] = formatInTimezone(utc, zone, "yyyy-MM-dd'|'HH:mm:ss").split('|')
  const [hours, minutes, seconds] = time.split(':').map(Number)

  return { date, minutesOfDay: hours * 60 + minutes + seconds / 60 }
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

/** Night date of a session starting at `startUtc` in `zone`. */
export function nightDateFor(startUtc: string, zone: string): string {
  const { date, minutesOfDay } = localReading(startUtc, zone)
  return minutesOfDay >= 12 * 60 ? date : addDays(date, -1)
}

/** Hours after 00:00 of the night date, on the continuous axis. */
export function axisHours(utc: string, zone: string, nightDate: string): number {
  const { date, minutesOfDay } = localReading(utc, zone)
  return daysBetween(nightDate, date) * 24 + minutesOfDay / 60
}

/**
 * Formats an axis value as a clock time "hh:mm" (24.5 → "00:30").
 * Rounded to the nearest minute.
 */
export function formatAxisHours(hours: number): string {
  const totalMinutes = Math.round(hours * 60)
  const minutesOfDay = ((totalMinutes % 1440) + 1440) % 1440
  const hh = String(Math.floor(minutesOfDay / 60)).padStart(2, '0')
  const mm = String(minutesOfDay % 60).padStart(2, '0')

  return `${hh}:${mm}`
}
