/**
 * Descriptive statistics (PROJECT_SPEC.md §8.1, §8.2, §8.4).
 * Pure functions, independent of React, the database and units.
 *
 * Conventions:
 * - Missing observations (null, undefined, NaN, ±Infinity) are EXCLUDED
 *   and counted; they are never treated as zero and never interpolated.
 * - Displayed standard deviation: SAMPLE SD (divides by n − 1).
 * - RMSD decomposition: POPULATION SD (divides by n).
 * - Quantiles: Hyndman–Fan type 7 (linear interpolation between order
 *   statistics; the default of R and NumPy).
 * - Fewer than 5 observations: "insufficient data" (statistics are not
 *   presented, n always is).
 */

export const MIN_OBSERVATIONS = 5

export interface CleanValues {
  /** Valid values, in their original order. */
  values: number[]
  /** Number of missing or invalid observations that were excluded. */
  missing: number
}

export function cleanValues(values: ReadonlyArray<number | null | undefined>): CleanValues {
  const valid: number[] = []
  let missing = 0

  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      valid.push(value)
    } else {
      missing += 1
    }
  }

  return { values: valid, missing }
}

function requireValues(values: readonly number[]): void {
  if (values.length === 0) {
    throw new Error('At least one value is required.')
  }
}

export function mean(values: readonly number[]): number {
  requireValues(values)
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Quantile with Hyndman–Fan type 7: h = (n − 1)·p (0-based), then linear
 * interpolation between the sorted values at floor(h) and ceil(h).
 */
export function quantile(values: readonly number[], p: number): number {
  requireValues(values)

  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new Error('The probability must be between 0 and 1.')
  }

  const sorted = [...values].sort((a, b) => a - b)
  const h = (sorted.length - 1) * p
  const lower = Math.floor(h)
  const upper = Math.ceil(h)

  return sorted[lower] + (h - lower) * (sorted[upper] - sorted[lower])
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5)
}

/** Interquartile range: Q3 − Q1 (type 7). */
export function iqr(values: readonly number[]): number {
  return quantile(values, 0.75) - quantile(values, 0.25)
}

/** Sample standard deviation (n − 1). Needs at least 2 values. */
export function sampleSd(values: readonly number[]): number {
  if (values.length < 2) {
    throw new Error('The sample standard deviation needs at least 2 values.')
  }

  const m = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1))
}

/** Population standard deviation (n). */
export function populationSd(values: readonly number[]): number {
  const m = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length)
}

export interface RmsdResult {
  rmsd: number
  /**
   * "target": RMSD around the user's target.
   * "mean": no target, so the reference is the mean and the RMSD equals
   * the population SD ("RMSD around mean (= population SD)").
   */
  reference: 'target' | 'mean'
  /** Bias = mean − target (only with a target). */
  bias: number | null
  /** Spread = population SD (only with a target). */
  spread: number | null
}

/**
 * RMSD = sqrt(mean((x − target)²)). With a target, RMSD² = bias² + spread².
 */
export function rmsd(values: readonly number[], target?: number | null): RmsdResult {
  requireValues(values)

  if (target === undefined || target === null) {
    return { rmsd: populationSd(values), reference: 'mean', bias: null, spread: null }
  }

  if (!Number.isFinite(target)) {
    throw new Error('The target must be a finite number.')
  }

  const value = Math.sqrt(values.reduce((sum, x) => sum + (x - target) ** 2, 0) / values.length)

  return {
    rmsd: value,
    reference: 'target',
    bias: mean(values) - target,
    spread: populationSd(values),
  }
}

export interface DescriptiveSummary {
  n: number
  missing: number
  /** True when n is below the minimum: the statistics below are null. */
  insufficient: boolean
  mean: number | null
  median: number | null
  sampleSd: number | null
  min: number | null
  max: number | null
  iqr: number | null
  rmsd: RmsdResult | null
}

export interface DescribeOptions {
  /** Minimum number of observations (default 5). */
  minN?: number
  /** Optional target for the RMSD. */
  target?: number | null
}

/**
 * All descriptive statistics of §8.1 (the delta versus the previous
 * period is calculated separately, see delta.ts).
 */
export function describe(
  raw: ReadonlyArray<number | null | undefined>,
  options: DescribeOptions = {},
): DescriptiveSummary {
  const { values, missing } = cleanValues(raw)
  const minN = options.minN ?? MIN_OBSERVATIONS
  const n = values.length

  if (n < minN || n === 0) {
    return {
      n,
      missing,
      insufficient: true,
      mean: null,
      median: null,
      sampleSd: null,
      min: null,
      max: null,
      iqr: null,
      rmsd: null,
    }
  }

  return {
    n,
    missing,
    insufficient: false,
    mean: mean(values),
    median: median(values),
    sampleSd: n >= 2 ? sampleSd(values) : null,
    // reduce instead of Math.min(...values): safe for very long lists.
    min: values.reduce((a, b) => Math.min(a, b)),
    max: values.reduce((a, b) => Math.max(a, b)),
    iqr: iqr(values),
    rmsd: rmsd(values, options.target),
  }
}
