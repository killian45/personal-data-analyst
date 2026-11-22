import { studentTTwoSidedP } from './distributions'
import { addDays } from './subjects'
import type { Observation } from './subjects'

/**
 * Correlation between two daily series (Phase 6, docs/PHASE6_PLAN.md §3).
 * Pure functions, independent of React, the database and units.
 *
 * Conventions (user-approved 2026-11-11):
 * - Pairs: X on day d with Y on day d + lag (lag ≥ 0 days). Only days where
 *   both have a value are used (pairwise); missing is never filled or 0.
 * - Pearson r and Spearman ρ (ranks, ties get their average rank) are both
 *   computed.
 * - Day-to-day dependence: each series' lag-1 autocorrelation (r1, from
 *   consecutive calendar days among the paired days) gives an effective
 *   number of days, Bartlett's n_eff = n (1 − r1x·r1y) / (1 + r1x·r1y),
 *   never above n. r1 is taken as 0 when fewer than 3 consecutive pairs
 *   exist (it cannot be estimated). Intervals and p-values use n_eff.
 * - 95% interval: Fisher z; standard error 1/√(n_eff − 3) for r and
 *   Bonett–Wright √((1 + ρ²/2) / (n_eff − 3)) for ρ.
 * - Two-sided p-value: t = r √((n_eff − 2)/(1 − r²)), df = n_eff − 2
 *   (fractional df allowed); the same approximation for ρ.
 * - No result below 10 paired days, or when either series is constant
 *   (correlation undefined). When n_eff ≤ 4 the coefficients are given
 *   without interval or p-value (status "too-dependent").
 * - Strength in words from |r|: < 0.1 negligible, < 0.3 weak, < 0.5
 *   moderate, otherwise strong (Cohen's conventional thresholds).
 */

export const MIN_PAIRED_DAYS = 10
export const SMALL_SAMPLE_DAYS = 30
export const MAX_LAG_DAYS = 7
const Z_95 = 1.959963984540054

export interface PairedDay {
  /** Date of X (Y is from date + lag). */
  date: string
  x: number
  y: number
}

/** Pairs X on day d with Y on day d + lag; days missing either value are left out. */
export function pairObservations(x: readonly Observation[], y: readonly Observation[], lag = 0): PairedDay[] {
  if (!Number.isInteger(lag) || lag < 0 || lag > MAX_LAG_DAYS) throw new Error(`The delay must be a whole number of days from 0 to ${MAX_LAG_DAYS}.`)
  const yByDate = new Map<string, number>()
  for (const o of y) if (typeof o.value === 'number' && Number.isFinite(o.value)) yByDate.set(o.date, o.value)
  const pairs: PairedDay[] = []
  for (const o of x) {
    if (typeof o.value !== 'number' || !Number.isFinite(o.value)) continue
    const yValue = yByDate.get(addDays(o.date, lag))
    if (yValue !== undefined) pairs.push({ date: o.date, x: o.value, y: yValue })
  }
  return pairs.sort((a, b) => a.date.localeCompare(b.date))
}

/** Pearson's r, or null when n < 2 or a series has no variation. */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length
  if (n !== ys.length) throw new Error('Both series need the same number of values.')
  if (n < 2) return null
  const meanX = xs.reduce((s, v) => s + v, 0) / n
  const meanY = ys.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return null
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)))
}

/** Ranks from 1; tied values share the average of their ranks. */
export function ranks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const result = new Array<number>(values.length)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j += 1
    const average = (i + j) / 2 + 1
    for (let k = i; k <= j; k += 1) result[order[k].index] = average
    i = j + 1
  }
  return result
}

/** Spearman's ρ (Pearson's r of the ranks), or null when undefined. */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  return pearson(ranks(xs), ranks(ys))
}

/**
 * Lag-1 autocorrelation from consecutive calendar days, or null when fewer
 * than 3 consecutive pairs exist or there is no variation.
 */
export function lag1Autocorrelation(series: readonly { date: string; value: number }[]): number | null {
  const byDate = new Map(series.map((item) => [item.date, item.value]))
  const a: number[] = []
  const b: number[] = []
  for (const item of series) {
    const next = byDate.get(addDays(item.date, 1))
    if (next !== undefined) {
      a.push(item.value)
      b.push(next)
    }
  }
  return a.length < 3 ? null : pearson(a, b)
}

/** Bartlett's effective number of days, never above n. */
export function effectiveSampleSize(n: number, r1x: number | null, r1y: number | null): number {
  const product = (r1x ?? 0) * (r1y ?? 0)
  if (product >= 1) return 0
  return Math.min(n, (n * (1 - product)) / (1 + product))
}

export interface CoefficientResult {
  value: number
  /** 95% interval (null when n_eff ≤ 3). */
  low: number | null
  high: number | null
  p: number | null
}

function withUncertainty(value: number, nEffective: number, spearmanSe: boolean): CoefficientResult {
  if (nEffective <= 4) return { value, low: null, high: null, p: null }
  const z = Math.atanh(Math.max(-0.999999999999, Math.min(0.999999999999, value)))
  const se = (spearmanSe ? Math.sqrt(1 + (value * value) / 2) : 1) / Math.sqrt(nEffective - 3)
  const df = nEffective - 2
  const t = Math.abs(value) >= 1 ? Infinity : value * Math.sqrt(df / (1 - value * value))
  return {
    value,
    low: Math.tanh(z - Z_95 * se),
    high: Math.tanh(z + Z_95 * se),
    p: studentTTwoSidedP(t, df),
  }
}

export type CorrelationStatus = 'ok' | 'too-few-days' | 'no-variation' | 'too-dependent'

export interface CorrelationResult {
  status: CorrelationStatus
  lag: number
  /** Paired days, and the effective number of days after the dependence correction. */
  n: number
  nEffective: number | null
  autocorrelation: { x: number | null; y: number | null }
  pearson: CoefficientResult | null
  spearman: CoefficientResult | null
  pairs: PairedDay[]
}

/** Correlates two daily series at a given delay (see conventions above). */
export function correlate(x: readonly Observation[], y: readonly Observation[], lag = 0): CorrelationResult {
  const pairs = pairObservations(x, y, lag)
  const n = pairs.length
  const base = { lag, n, pairs }
  const empty = { nEffective: null, autocorrelation: { x: null, y: null }, pearson: null, spearman: null }
  if (n < MIN_PAIRED_DAYS) return { status: 'too-few-days', ...base, ...empty }

  const xs = pairs.map((pair) => pair.x)
  const ys = pairs.map((pair) => pair.y)
  const r = pearson(xs, ys)
  const rho = spearman(xs, ys)
  if (r === null || rho === null) return { status: 'no-variation', ...base, ...empty }

  // Each series' own day-to-day dependence, on its own dates among the pairs.
  const r1x = lag1Autocorrelation(pairs.map((pair) => ({ date: pair.date, value: pair.x })))
  const r1y = lag1Autocorrelation(pairs.map((pair) => ({ date: addDays(pair.date, lag), value: pair.y })))
  const nEffective = effectiveSampleSize(n, r1x, r1y)
  const autocorrelation = { x: r1x, y: r1y }
  // Too few independent days: the coefficients are shown, without interval or p-value.
  if (nEffective <= 4) {
    return {
      status: 'too-dependent',
      ...base,
      nEffective,
      autocorrelation,
      pearson: withUncertainty(r, nEffective, false),
      spearman: withUncertainty(rho, nEffective, true),
    }
  }

  return {
    status: 'ok',
    ...base,
    nEffective,
    autocorrelation,
    pearson: withUncertainty(r, nEffective, false),
    spearman: withUncertainty(rho, nEffective, true),
  }
}

export type Strength = 'negligible' | 'weak' | 'moderate' | 'strong'

export function describeStrength(coefficient: number): Strength {
  const size = Math.abs(coefficient)
  if (size < 0.1) return 'negligible'
  if (size < 0.3) return 'weak'
  if (size < 0.5) return 'moderate'
  return 'strong'
}

/**
 * Benjamini–Hochberg adjusted p-values (false discovery rate), in the
 * original order; nulls are passed through and not counted.
 */
export function benjaminiHochberg(pValues: readonly (number | null)[]): (number | null)[] {
  const present = pValues
    .map((p, index) => ({ p, index }))
    .filter((item): item is { p: number; index: number } => item.p !== null)
    .sort((a, b) => a.p - b.p)
  const m = present.length
  const adjusted = new Array<number | null>(pValues.length).fill(null)
  let running = 1
  for (let rank = m; rank >= 1; rank -= 1) {
    const item = present[rank - 1]
    running = Math.min(running, (item.p * m) / rank)
    adjusted[item.index] = running
  }
  return adjusted
}
