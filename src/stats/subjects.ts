import type { HabitType } from '../database/types'

/**
 * What a metric can be computed for ("applicable types", §9): habit
 * types plus the sleep measures produced by the sleep engine.
 */
export type SubjectType =
  | HabitType
  | 'sleepDuration'
  | 'timeInBed'
  | 'bedtime'
  | 'wakeTime'

/**
 * Measurement scale of a subject:
 * - "ratio":    amounts with a true zero (number values, durations).
 *               Percent changes and coefficient of variation are allowed
 *               when the data allow it.
 * - "clock":    times on the continuous after-midnight axis (bedtime,
 *               wake time). Only absolute changes; no coefficient of
 *               variation; deviations shown in minutes.
 * - "binary":   checkbox (done / not done).
 * - "category": label and text (counts only).
 *
 * Number habits are treated as "ratio" but percent changes and the CV are
 * still refused when values are negative or the mean is not positive.
 */
export type SubjectScale = 'ratio' | 'clock' | 'binary' | 'category'

export const SUBJECT_SCALES: Record<SubjectType, SubjectScale> = {
  number: 'ratio',
  stopwatch: 'ratio',
  sleepDuration: 'ratio',
  timeInBed: 'ratio',
  bedtime: 'clock',
  wakeTime: 'clock',
  checkbox: 'binary',
  label: 'category',
  text: 'category',
}

/** Subjects with numeric values (all descriptive statistics apply). */
export const NUMERIC_SUBJECTS: SubjectType[] = [
  'number',
  'stopwatch',
  'sleepDuration',
  'timeInBed',
  'bedtime',
  'wakeTime',
]

/** Numeric subjects measured on a ratio scale. */
export const RATIO_SUBJECTS: SubjectType[] = NUMERIC_SUBJECTS.filter(
  (subject) => SUBJECT_SCALES[subject] === 'ratio',
)

/** One observation in a time series: a local date and a value or null. */
export interface Observation {
  /** Local calendar date "YYYY-MM-DD" (the period it belongs to). */
  date: string
  /** null = missing (never treated as zero). */
  value: number | null
}

/** Whole days from date a to date b ("YYYY-MM-DD"). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** Date plus a number of days ("YYYY-MM-DD"). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}
