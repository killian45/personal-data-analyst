import { addDays, daysBetween } from '../stats/subjects'
import type { Observation } from '../stats/subjects'
import type { DateRange } from '../stats/delta'

/**
 * Date ranges and period aggregation for the dashboard. Pure functions.
 *
 * - Ranges are inclusive local dates "YYYY-MM-DD".
 * - Presets end today: "7d" is today and the 6 days before.
 * - Weeks start on Monday (ISO 8601). Months are calendar months.
 * - A period's value is the MEAN of the daily values observed in it;
 *   days without a value are skipped (never zero, never interpolated).
 *   For checkbox habits (daily 1 = done, 0 = not done) this mean is the
 *   completion rate of the period.
 */

export type RangePreset = '7d' | '30d' | '90d' | 'custom'
export type Aggregation = 'day' | 'week' | 'month'

const PRESET_DAYS: Record<Exclude<RangePreset, 'custom'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

export function presetRange(preset: Exclude<RangePreset, 'custom'>, today: string): DateRange {
  return { start: addDays(today, -(PRESET_DAYS[preset] - 1)), end: today }
}

/** Every date of the range, in order. */
export function enumerateDates(range: DateRange): string[] {
  const length = daysBetween(range.start, range.end) + 1
  return Array.from({ length: Math.max(0, length) }, (_, index) => addDays(range.start, index))
}

/** First day of the period containing `date`. */
export function periodStart(date: string, aggregation: Aggregation): string {
  if (aggregation === 'day') {
    return date
  }

  if (aggregation === 'month') {
    return `${date.slice(0, 7)}-01`
  }

  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7))
}

export interface PeriodPoint {
  /** First day of the period. */
  period: string
  /** Mean of the daily values in the period within the range, or null. */
  value: number | null
  /** Number of days with a value. */
  n: number
}

/**
 * Aggregates daily observations into periods covering the whole range.
 * Periods at the edges only use the days inside the range. Periods
 * without any value are kept with value null, so charts show gaps.
 */
export function aggregate(
  daily: readonly Observation[],
  range: DateRange,
  aggregation: Aggregation,
): PeriodPoint[] {
  const sums = new Map<string, { sum: number; n: number }>()

  for (const date of enumerateDates(range)) {
    sums.set(periodStart(date, aggregation), sums.get(periodStart(date, aggregation)) ?? { sum: 0, n: 0 })
  }

  for (const { date, value } of daily) {
    if (date < range.start || date > range.end || typeof value !== 'number' || !Number.isFinite(value)) {
      continue
    }

    const bucket = sums.get(periodStart(date, aggregation))

    if (bucket) {
      bucket.sum += value
      bucket.n += 1
    }
  }

  return [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, { sum, n }]) => ({ period, value: n > 0 ? sum / n : null, n }))
}

/** Keeps the observations whose date is inside the range. */
/**
 * Several daily series aggregated on the same periods (one row per
 * period, one value per series key; null = no data for that series).
 */
export function aggregateMany(
  series: readonly { key: string; daily: readonly Observation[] }[],
  range: DateRange,
  aggregation: Aggregation,
): { period: string; values: Record<string, number | null>; n: Record<string, number> }[] {
  const perSeries = series.map(({ key, daily }) => ({ key, points: aggregate(daily, range, aggregation) }))
  const periods = perSeries[0]?.points.map((point) => point.period) ?? aggregate([], range, aggregation).map((point) => point.period)
  return periods.map((period, index) => ({
    period,
    values: Object.fromEntries(perSeries.map(({ key, points }) => [key, points[index].value])),
    n: Object.fromEntries(perSeries.map(({ key, points }) => [key, points[index].n])),
  }))
}

// ---------------------------------------------------------------------------
// Moving through periods (arrows and swipes, 2026-11-12)

/** Number of days in a range (inclusive). */
export function rangeLength(range: DateRange): number {
  return daysBetween(range.start, range.end) + 1
}

/** A small step: about a seventh of the range (7 days → 1, 30 → 5, 90 → 13). */
export function smallStep(range: DateRange): number {
  return Math.max(1, Math.ceil(rangeLength(range) / 7))
}

/** The range moved by `days` (negative = earlier), never ending after today. */
export function shiftRange(range: DateRange, days: number, today: string): DateRange {
  const moved = { start: addDays(range.start, days), end: addDays(range.end, days) }
  if (moved.end <= today) return moved
  const back = daysBetween(today, moved.end)
  return { start: addDays(moved.start, -back), end: today }
}

export type SwipeMove = { size: 'small' | 'full'; direction: -1 | 1 } | null

/**
 * A horizontal swipe on the Dashboard: finger moving right = earlier
 * dates (like turning back a page). At least 50 px, mostly horizontal
 * (twice as wide as tall, so scrolling is not mistaken for a swipe);
 * 35 % of the screen width or more (at least 120 px) = a whole period.
 */
export function swipeMove(dx: number, dy: number, width: number): SwipeMove {
  if (Math.abs(dx) < 50 || Math.abs(dx) < 2 * Math.abs(dy)) return null
  return { size: Math.abs(dx) >= Math.max(120, width * 0.35) ? 'full' : 'small', direction: dx > 0 ? -1 : 1 }
}

export function inRange<T extends { date: string }>(items: readonly T[], range: DateRange): T[] {
  return items.filter((item) => item.date >= range.start && item.date <= range.end)
}
