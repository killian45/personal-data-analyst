import { deltaVersusPrevious, previousPeriod } from '../stats/delta'
import type { DateRange, DeltaResult } from '../stats/delta'
import { describe } from '../stats/descriptive'
import type { DescriptiveSummary } from '../stats/descriptive'
import type { Metric, MetricResult } from '../stats/metric'
import { computeMetric, getMetric } from '../stats/registry'
import type { Observation, SubjectType } from '../stats/subjects'

import { aggregate, inRange } from './periods'
import type { Aggregation, PeriodPoint } from './periods'

/**
 * Statistics of one dashboard section (a sleep measure or a numeric
 * habit). Pure function.
 *
 * Statistics always use ONE VALUE PER DAY (per night for sleep) inside the
 * selected range; the aggregation (day/week/month) only changes the chart
 * series. The delta compares with the previous range of equal length.
 */

export interface SectionInput {
  subject: SubjectType
  /** Daily observations (any dates; filtered here). */
  daily: readonly Observation[]
  range: DateRange
  aggregation: Aggregation
  /** Target in the subject's unit (hours for durations and clock times). */
  target: number | null
  /** Selected metric ids (unknown or inapplicable ones are ignored). */
  metricIds: readonly string[]
}

export interface SectionStats {
  /** Daily values in the range: what every number below is based on. */
  dailyInRange: Observation[]
  summary: DescriptiveSummary
  previousRange: DateRange
  delta: DeltaResult
  series: PeriodPoint[]
  metrics: { metric: Metric; result: MetricResult }[]
}

export function buildSectionStats(input: SectionInput): SectionStats {
  const dailyInRange = inRange(input.daily, input.range)
  const previousRange = previousPeriod(input.range)
  const previousDaily = inRange(input.daily, previousRange)

  const metrics = input.metricIds
    .map((id) => getMetric(id))
    .filter((metric): metric is Metric => metric !== undefined)
    .filter((metric) => metric.applicableTypes.includes(input.subject))
    .map((metric) => ({ metric, result: computeMetric(metric, dailyInRange, { subject: input.subject }) }))

  return {
    dailyInRange,
    summary: describe(
      dailyInRange.map((observation) => observation.value),
      { target: input.target },
    ),
    previousRange,
    delta: deltaVersusPrevious(
      input.subject,
      dailyInRange.map((observation) => observation.value),
      previousDaily.map((observation) => observation.value),
    ),
    series: aggregate(dailyInRange, input.range, input.aggregation),
    metrics,
  }
}
