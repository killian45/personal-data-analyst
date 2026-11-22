import { MIN_OBSERVATIONS } from './descriptive'
import { daysBetween } from './subjects'
import type { Observation } from './subjects'

/**
 * Linear trend (§8.4, §9): ordinary least squares of value on time, using
 * the ACTUAL calendar spacing between observations (x = days since the
 * first observed date), expressed in units per week. Missing observations
 * are excluded, never interpolated.
 */

export interface TrendResult {
  insufficient: boolean
  n: number
  /** Change per week (slope per day × 7). */
  slopePerWeek: number | null
  /** Fitted value at the first observed date. */
  intercept: number | null
  /** Date x = 0 refers to. */
  originDate: string | null
}

export function linearTrend(
  observations: readonly Observation[],
  minN: number = MIN_OBSERVATIONS,
): TrendResult {
  const valid = observations.filter(
    (o) => typeof o.value === 'number' && Number.isFinite(o.value),
  ) as { date: string; value: number }[]

  const empty = { n: valid.length, slopePerWeek: null, intercept: null }

  if (valid.length < minN || valid.length < 2) {
    return { insufficient: true, ...empty, originDate: null }
  }

  const origin = valid.map((o) => o.date).sort()[0]
  const xs = valid.map((o) => daysBetween(origin, o.date))
  const ys = valid.map((o) => o.value)
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length

  let sxx = 0
  let sxy = 0

  for (let index = 0; index < xs.length; index += 1) {
    sxx += (xs[index] - xMean) ** 2
    sxy += (xs[index] - xMean) * (ys[index] - yMean)
  }

  // All observations on the same date: no trend can be estimated.
  if (sxx === 0) {
    return { insufficient: true, ...empty, originDate: origin }
  }

  const slopePerDay = sxy / sxx

  return {
    insufficient: false,
    n: valid.length,
    slopePerWeek: slopePerDay * 7,
    intercept: yMean - slopePerDay * xMean,
    originDate: origin,
  }
}
