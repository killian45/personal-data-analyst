import { addDays, daysBetween } from './subjects'
import type { Observation } from './subjects'

/**
 * Time-series transformations (§9). Missing days are never interpolated.
 */

export interface SeriesPoint {
  date: string
  /** null when the window does not have enough observations. */
  value: number | null
  /** Observations used for this point. */
  n: number
}

export interface MovingAverageOptions {
  /** Window length in calendar days (default 7). */
  windowDays?: number
  /** Minimum observed days in the window (default 4 for 7 days). */
  minObservations?: number
}

/**
 * Trailing moving average over calendar days: the point for day D is the
 * mean of the observations from D − (window − 1) to D. Days without an
 * observation are skipped (not counted as zero). If fewer than
 * `minObservations` observed values fall in the window, the point is null.
 *
 * Several observations on the same date each count (aggregate first if a
 * single value per day is wanted). Output: one point per calendar day from
 * the first to the last observed date.
 */
export function movingAverage(
  observations: readonly Observation[],
  options: MovingAverageOptions = {},
): SeriesPoint[] {
  const windowDays = options.windowDays ?? 7
  const minObservations = options.minObservations ?? Math.ceil(windowDays / 2)

  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new Error('The window must be a whole number of days, at least 1.')
  }

  const valid = observations.filter(
    (observation) => typeof observation.value === 'number' && Number.isFinite(observation.value),
  ) as { date: string; value: number }[]

  if (valid.length === 0) {
    return []
  }

  const dates = valid.map((observation) => observation.date).sort()
  const first = dates[0]
  const last = dates[dates.length - 1]
  const points: SeriesPoint[] = []

  for (let offset = 0; offset <= daysBetween(first, last); offset += 1) {
    const day = addDays(first, offset)
    const windowStart = addDays(day, -(windowDays - 1))
    const inWindow = valid.filter((o) => o.date >= windowStart && o.date <= day)

    points.push({
      date: day,
      n: inWindow.length,
      value:
        inWindow.length >= minObservations && inWindow.length > 0
          ? inWindow.reduce((sum, o) => sum + o.value, 0) / inWindow.length
          : null,
    })
  }

  return points
}
