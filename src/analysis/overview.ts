import { benjaminiHochberg, correlate } from '../stats/correlation'
import type { CorrelationResult } from '../stats/correlation'
import type { DateRange } from '../stats/delta'
import { messages } from '../i18n'
import { addDays } from '../stats/subjects'
import type { Observation } from '../stats/subjects'

import type { Measure } from './measures'

/**
 * Overview of many pairs (Phase 6 step 3, docs/PHASE6_PLAN.md §3.6).
 * Pure functions.
 *
 * - Every pair of the chosen measures, same day (delay 0); a measure is
 *   never paired with itself.
 * - Multiple comparisons: Benjamini–Hochberg over the pairs that have a
 *   p-value (status "ok"); the count of comparisons is reported.
 * - Order: pairs with a result by strength |r| (largest first); then pairs
 *   too dependent to judge, then those without variation, then those with
 *   too few shared days. Ties by measure order, so the list is stable.
 */

export const MAX_OVERVIEW_MEASURES = 20

/** X's days in the range; Y's days in the range moved by the delay. "All data" = no range. */
export function measureWindow(measure: Measure, range: DateRange | null, lag: number): Observation[] {
  if (!range) return measure.daily
  const start = addDays(range.start, lag)
  const end = addDays(range.end, lag)
  return measure.daily.filter((o) => o.date >= start && o.date <= end)
}

export interface OverviewRow {
  x: Measure
  y: Measure
  result: CorrelationResult
  /** Benjamini–Hochberg adjusted p-value (null when the pair has no p-value). */
  adjustedP: number | null
}

export interface Overview {
  rows: OverviewRow[]
  /** Pairs with a p-value, i.e. the number of comparisons adjusted for. */
  comparisons: number
  pairs: number
}

const STATUS_ORDER: Record<CorrelationResult['status'], number> = { ok: 0, 'too-dependent': 1, 'no-variation': 2, 'too-few-days': 3 }

export function buildOverview(measures: readonly Measure[], range: DateRange | null): Overview {
  if (measures.length > MAX_OVERVIEW_MEASURES) throw new Error(messages().correlationText.tooManyMeasures(MAX_OVERVIEW_MEASURES))
  const raw: { x: Measure; y: Measure; result: CorrelationResult; order: number }[] = []
  let order = 0
  for (let i = 0; i < measures.length; i += 1) {
    for (let j = i + 1; j < measures.length; j += 1) {
      const x = measures[i]
      const y = measures[j]
      raw.push({ x, y, result: correlate(measureWindow(x, range, 0), measureWindow(y, range, 0), 0), order: order++ })
    }
  }

  const adjusted = benjaminiHochberg(raw.map((item) => (item.result.status === 'ok' ? item.result.pearson!.p : null)))
  const rows = raw
    .map((item, index) => ({ ...item, adjustedP: adjusted[index] }))
    .sort((a, b) =>
      STATUS_ORDER[a.result.status] - STATUS_ORDER[b.result.status] ||
      Math.abs(b.result.pearson?.value ?? 0) - Math.abs(a.result.pearson?.value ?? 0) ||
      a.order - b.order,
    )
    .map(({ x, y, result, adjustedP }) => ({ x, y, result, adjustedP }))

  return { rows, comparisons: adjusted.filter((p) => p !== null).length, pairs: raw.length }
}
