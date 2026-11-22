import { formatNumber as formatLocaleNumber } from '../i18n'
import { formatAxisHours } from '../sleep/engine/localTime'
import { formatDuration } from '../stopwatch/duration'
import { SUBJECT_SCALES } from '../stats/subjects'
import type { SubjectType } from '../stats/subjects'

/**
 * Display formatting for dashboard values. Units:
 * - sleepDuration, timeInBed, stopwatch: hours → "7 h 30 min";
 * - bedtime, wakeTime: continuous-axis hours → "23:30";
 * - checkbox: fraction → "75 %";
 * - number: the habit's own unit.
 * Deviations (SD, IQR, RMSD, bias, changes) of clock times are shown in
 * minutes (§8.3); of durations as hours and minutes.
 */

/** A number with the current language's separators, at most 2 decimals. */
export function formatNumber(value: number): string {
  return formatLocaleNumber(value)
}

function isDuration(subject: SubjectType): boolean {
  return subject === 'sleepDuration' || subject === 'timeInBed' || subject === 'stopwatch'
}

function withUnit(text: string, unit?: string | null): string {
  return unit ? `${text} ${unit}` : text
}

/** A value itself (mean, median, minimum, a chart point...). */
export function formatValue(subject: SubjectType, value: number, unit?: string | null): string {
  if (isDuration(subject)) {
    // Negative durations only come from custom formulas (e.g. sleep − screen time).
    return value < 0 ? `−${formatDuration(-value * 3_600_000)}` : formatDuration(value * 3_600_000)
  }

  if (SUBJECT_SCALES[subject] === 'clock') {
    return formatAxisHours(value)
  }

  if (subject === 'checkbox') {
    return `${Math.round(value * 100)} %`
  }

  return withUnit(formatNumber(value), unit)
}

/** A spread or difference (always ≥ 0 shown without sign). */
export function formatSpread(subject: SubjectType, value: number, unit?: string | null): string {
  if (SUBJECT_SCALES[subject] === 'clock') {
    return `${Math.round(value * 60)} min`
  }

  if (isDuration(subject)) {
    const minutes = Math.round(value * 60)
    return minutes < 60 ? `${minutes} min` : formatDuration(minutes * 60_000)
  }

  if (subject === 'checkbox') {
    return `${Math.round(value * 100)} points`
  }

  return withUnit(formatNumber(value), unit)
}

/** A signed change, e.g. "+15 min" or "−0.5 kg". */
export function formatChange(subject: SubjectType, value: number, unit?: string | null): string {
  const rounded = SUBJECT_SCALES[subject] === 'clock' || isDuration(subject)
    ? Math.round(value * 60) / 60
    : value

  if (rounded === 0) {
    return `±${formatSpread(subject, 0, unit)}`
  }

  return `${rounded > 0 ? '+' : '−'}${formatSpread(subject, Math.abs(value), unit)}`
}
