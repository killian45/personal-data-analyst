import type { SeriesPoint } from './timeseries'
import { messages } from '../i18n'
import type { Observation, SubjectType } from './subjects'

/**
 * Standard interface of a metric (PROJECT_SPEC.md §9).
 *
 * Each metric lives in its own file "src/stats/metrics/<id>.metric.ts"
 * whose default export is a Metric. The registry discovers these files
 * automatically: adding a metric requires no other change.
 *
 * compute() is a pure function. It receives observations (missing values
 * as null) and must never treat missing values as zero.
 */

export type MetricCategory = 'descriptive' | 'timeseries' | 'habit' | 'trend'

export interface MetricOptions {
  /** What the values measure (decides applicability and scale). */
  subject: SubjectType
  /** Minimum number of observations (default 5). */
  minN?: number
  /** Probabilities for percentile metrics, between 0 and 1. */
  percentiles?: number[]
}

export type MetricValue =
  | { kind: 'number'; value: number }
  | { kind: 'percentiles'; values: { p: number; value: number }[] }
  | { kind: 'series'; points: SeriesPoint[] }
  | { kind: 'trend'; slopePerWeek: number; intercept: number; originDate: string }

export type MetricResult =
  | { status: 'ok'; n: number; missing: number; value: MetricValue }
  | { status: 'insufficient'; n: number; missing: number; reason: string }
  | { status: 'not-applicable'; reason: string }

export interface Metric {
  /** Unique, stable identifier (also the file name). */
  id: string
  name: string
  description: string
  category: MetricCategory
  /** Subjects this metric can be computed for (spec: "applicableTypes"). */
  applicableTypes: readonly SubjectType[]
  compute(values: readonly Observation[], options: MetricOptions): MetricResult
}

/** Typing helper for metric files. */
export function defineMetric(metric: Metric): Metric {
  return metric
}

/** Shared "insufficient data" result. */
export function insufficient(n: number, missing: number, minN: number): MetricResult {
  return {
    status: 'insufficient',
    n,
    missing,
    reason: messages().metrics.insufficient(n, minN),
  }
}
