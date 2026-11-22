import { db } from '../database/db'
import { getSettingValue, putSetting } from '../database/settings'

/**
 * What each dashboard section shows (PROJECT_SPEC.md §8–§9.2; user
 * decision 2026-11-11: only a few statistics by default, the rest on
 * request). Stored as JSON in the setting "dashboard.metrics":
 *   { "<sectionId>": ["choice:v2", "stat:mean", "linear-trend", ...], ... }
 * Section ids: "sleepDuration", "bedtime", "wakeTime", "habit:<habitId>".
 *
 * Ids:
 * - "stat:<name>": standard statistics (always calculated; shown if chosen);
 * - "extra:<name>": section-specific tiles (time in bed, naps, stopwatch);
 * - other ids: registry metrics (§9).
 * n ("nights/days with data") is always shown and is not a choice.
 *
 * Lists saved before 2026-11-11 have no "choice:v2" marker and held only
 * registry metrics: the default statistics are added to them.
 */

export const DASHBOARD_METRICS_KEY = 'dashboard.metrics'
export const SELECTION_V2_MARKER = 'choice:v2'

/** Standard statistics, in display order. */
export const STATISTIC_IDS = [
  'stat:mean',
  'stat:median',
  'stat:sd',
  'stat:min',
  'stat:max',
  'stat:iqr',
  'stat:rmsd',
  'stat:change',
] as const

/**
 * Registry metrics that compute the same value as a standard statistic.
 * They are not offered separately; an old choice of them means the
 * standard statistic.
 */
export const REGISTRY_DUPLICATES: Readonly<Record<string, string>> = {
  median: 'stat:median',
  iqr: 'stat:iqr',
}

/** Shown when nothing was chosen: a few relevant values. */
export const DEFAULT_SECTION_METRICS = [
  'stat:mean',
  'stat:change',
  'extra:stopwatch-total',
  'extra:location-modes',
  'extra:location-active-distance',
]

export type MetricSelection = Record<string, string[]>

/** Parses a stored selection; null if the text is not a valid selection. */
export function parseMetricSelection(text: string): MetricSelection | null {
  try {
    const value: unknown = JSON.parse(text)

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null
    }

    for (const ids of Object.values(value)) {
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
        return null
      }
    }

    return value as MetricSelection
  } catch {
    return null
  }
}

export function metricsForSection(selection: MetricSelection, sectionId: string): string[] {
  const saved = selection[sectionId]
  if (!saved) return [...DEFAULT_SECTION_METRICS]
  if (saved.includes(SELECTION_V2_MARKER)) return saved.filter((id) => id !== SELECTION_V2_MARKER)
  const legacy = saved.map((id) => REGISTRY_DUPLICATES[id] ?? id)
  return [...new Set([...DEFAULT_SECTION_METRICS, ...legacy])]
}

export async function loadMetricSelection(): Promise<MetricSelection> {
  const value = await getSettingValue(DASHBOARD_METRICS_KEY)
  return (value !== null && parseMetricSelection(value)) || {}
}

export async function saveSectionMetrics(sectionId: string, metricIds: string[]): Promise<MetricSelection> {
  return db.transaction('rw', db.settings, async () => {
    const value = await getSettingValue(DASHBOARD_METRICS_KEY)
    const chosen = [SELECTION_V2_MARKER, ...metricIds.filter((id) => id !== SELECTION_V2_MARKER)]
    const selection = { ...((value !== null && parseMetricSelection(value)) || {}), [sectionId]: chosen }

    await putSetting(DASHBOARD_METRICS_KEY, JSON.stringify(selection))

    return selection
  })
}
