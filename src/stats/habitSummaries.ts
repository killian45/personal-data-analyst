import { daysBetween } from './subjects'

/**
 * Habit-specific summaries (PROJECT_SPEC.md §8.3). Pure functions.
 * Inputs are already limited to the selected date range and assigned to
 * local dates by the caller.
 */

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------

export interface CheckboxObservation {
  date: string
  done: boolean
}

export interface CheckboxSummary {
  /** Days with at least one entry (the denominator). */
  observedDays: number
  doneDays: number
  notDoneDays: number
  /** Calendar days in the range without any entry (neither done nor failed). */
  missingDays: number
  /** doneDays / observedDays, or null without observed days. */
  completionRate: number | null
  /** Longest run of consecutive observed days that were done. */
  longestStreak: number
  /** Run of done observed days ending at the latest observed day. */
  currentStreak: number
}

/**
 * Checkbox conventions:
 * - A day is "done" if it has at least one Done entry, "not done" if it
 *   has only Not done entries, and "missing" if it has no entry.
 * - Completion rate = done days ÷ observed days. Missing days are in
 *   neither the numerator nor the denominator.
 * - Streaks count consecutive OBSERVED days marked done: a missing day
 *   neither breaks nor extends a streak; a "not done" day breaks it.
 *
 * `range` (inclusive local dates) is used to count missing days.
 */
export function checkboxSummary(
  observations: readonly CheckboxObservation[],
  range: { start: string; end: string },
): CheckboxSummary {
  const byDay = new Map<string, boolean>()

  for (const { date, done } of observations) {
    if (date < range.start || date > range.end) {
      continue
    }

    byDay.set(date, (byDay.get(date) ?? false) || done)
  }

  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))
  const doneDays = days.filter(([, done]) => done).length
  const totalDays = daysBetween(range.start, range.end) + 1

  let longestStreak = 0
  let run = 0

  for (const [, done] of days) {
    run = done ? run + 1 : 0
    longestStreak = Math.max(longestStreak, run)
  }

  return {
    observedDays: days.length,
    doneDays,
    notDoneDays: days.length - doneDays,
    missingDays: Math.max(0, totalDays - days.length),
    completionRate: days.length > 0 ? doneDays / days.length : null,
    longestStreak,
    currentStreak: run,
  }
}

// ---------------------------------------------------------------------------
// Stopwatch
// ---------------------------------------------------------------------------

export interface DurationObservation {
  date: string
  durationMs: number
}

export interface StopwatchSummary {
  totalMs: number
  /** Days with at least one session (the "valid days"). */
  validDays: number
  /** totalMs ÷ validDays, or null without sessions. */
  meanPerValidDayMs: number | null
  sessions: number
}

/**
 * Stopwatch conventions: total duration of all sessions in the range, and
 * mean per valid day = total ÷ days with at least one session. Days
 * without a session are excluded (not counted as zero). Invalid durations
 * (negative or not finite) are ignored.
 */
export function stopwatchSummary(observations: readonly DurationObservation[]): StopwatchSummary {
  const valid = observations.filter(
    (o) => Number.isFinite(o.durationMs) && o.durationMs >= 0,
  )
  const totalMs = valid.reduce((sum, o) => sum + o.durationMs, 0)
  const validDays = new Set(valid.map((o) => o.date)).size

  return {
    totalMs,
    validDays,
    meanPerValidDayMs: validDays > 0 ? totalMs / validDays : null,
    sessions: valid.length,
  }
}

// ---------------------------------------------------------------------------
// Label and text: counts only
// ---------------------------------------------------------------------------

export interface CountSummary {
  total: number
  /** Count per value, most frequent first, then alphabetical. */
  byValue: { value: string; count: number }[]
}

/**
 * Label and text habits: counts only, no numerical statistics.
 * For labels, pass the configured options so options never chosen appear
 * with a count of 0.
 */
export function countSummary(values: readonly string[], options: readonly string[] = []): CountSummary {
  const counts = new Map<string, number>(options.map((option) => [option, 0]))

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  return {
    total: values.length,
    byValue: [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
  }
}

// ---------------------------------------------------------------------------
// Bedtime and wake time (continuous axis)
// ---------------------------------------------------------------------------

/**
 * Bedtime and wake time statistics are calculated on the continuous axis
 * in hours (see src/sleep/engine/localTime.ts) and displayed as hh:mm;
 * deviations (SD, IQR, RMSD, bias, changes) are displayed in minutes.
 */
export function hoursToMinutes(hours: number): number {
  return hours * 60
}
