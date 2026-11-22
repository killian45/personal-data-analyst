import { formatChange, formatSpread, formatValue } from '../../dashboard/format'
import type { Aggregation } from '../../dashboard/periods'
import { buildSectionStats } from '../../dashboard/sectionStats'
import type { DateRange } from '../../stats/delta'
import type { MetricResult } from '../../stats/metric'
import type { Observation, SubjectType } from '../../stats/subjects'
import { daysBetween } from '../../stats/subjects'
import { messages } from '../../i18n'

import type { Choice } from './MetricChooser'
import type { Tile } from './StatTiles'

/**
 * The statistics tiles of a Dashboard section (and the choices offered
 * by the statistics chooser), shared by single-series panels and the
 * per-app statistics of "Screen time by app".
 */

export interface SectionTilesInput {
  subject: SubjectType
  unit?: string | null
  daily: readonly Observation[]
  range: DateRange
  aggregation: Aggregation
  target: number | null
  metricIds: readonly string[]
  unitOfObservation: 'night' | 'day'
  extraTiles?: (Tile & { id: string; description: string })[]
}

export function metricTile(
  id: string,
  name: string,
  result: MetricResult,
  subject: SubjectType,
  unit: string | null | undefined,
): Tile {
  const t = messages().dashboard.tiles
  if (result.status === 'insufficient') {
    return { label: name, value: t.insufficient, note: result.reason }
  }

  if (result.status === 'not-applicable') {
    return { label: name, value: t.notApplicable, note: result.reason }
  }

  const value = result.value

  switch (value.kind) {
    case 'number':
      if (id === 'coefficient-of-variation') {
        return { label: name, value: `${Math.round(value.value * 100)} %`, note: `n = ${result.n}` }
      }
      return {
        label: name,
        value: id === 'iqr' ? formatSpread(subject, value.value, unit) : formatValue(subject, value.value, unit),
        note: `n = ${result.n}`,
      }

    case 'trend':
      return {
        label: name,
        value: t.perWeek(formatChange(subject, value.slopePerWeek, unit)),
        note: t.trendNote(result.n),
      }

    case 'percentiles':
      return {
        label: name,
        value: value.values.length > 0
          ? `${formatValue(subject, value.values[0].value, unit)} – ${formatValue(subject, value.values[value.values.length - 1].value, unit)}`
          : '—',
        note: value.values.map((item) => `P${Math.round(item.p * 100)} ${formatValue(subject, item.value, unit)}`).join(' · '),
      }

    case 'series': {
      // The metric is computed on the range's values only: take the last point with a value.
      const latest = value.points.filter((point) => point.value !== null).at(-1)
      return {
        label: name,
        value: latest && latest.value !== null ? formatValue(subject, latest.value, unit) : '—',
        note: t.latestNote,
      }
    }
  }
}

export function sectionTiles(input: SectionTilesInput): { stats: ReturnType<typeof buildSectionStats>; tiles: Tile[]; builtIns: Choice[] } {
  const { subject, unit, daily, range, aggregation, target, metricIds, unitOfObservation, extraTiles = [] } = input
  const stats = buildSectionStats({ subject, daily, range, aggregation, target, metricIds })
  const { summary, delta } = stats
  const rangeDays = daysBetween(range.start, range.end) + 1
  const fmt = (value: number) => formatValue(subject, value, unit)
  const chosen = new Set(metricIds)
  const t = messages().dashboard.tiles
  const c = t.choices

  const builtIns: Choice[] = [
    { id: 'stat:mean', ...c.mean },
    { id: 'stat:median', ...c.median },
    { id: 'stat:sd', ...c.sd },
    { id: 'stat:min', ...c.min },
    { id: 'stat:max', ...c.max },
    { id: 'stat:iqr', ...c.iqr },
    { id: 'stat:rmsd', name: c.rmsdName, description: target !== null ? c.rmsdTarget : c.rmsdMean },
    { id: 'stat:change', ...c.change },
    ...extraTiles.map((tile) => ({ id: tile.id, name: tile.label, description: tile.description })),
  ]

  // n is always shown (PROJECT_SPEC.md §8.1).
  const tiles: Tile[] = [
    {
      label: unitOfObservation === 'night' ? t.nightsWithData : t.daysWithData,
      value: String(summary.n),
      note: t.ofDaysInRange(rangeDays),
    },
  ]

  const descriptive = ['stat:mean', 'stat:median', 'stat:sd', 'stat:min', 'stat:max', 'stat:iqr', 'stat:rmsd']
  if (summary.insufficient) {
    if (descriptive.some((id) => chosen.has(id))) {
      tiles.push({ label: t.statistics, value: t.insufficient, note: t.atLeastFive })
    }
  } else {
    const standard: [string, Tile][] = [
      ['stat:mean', { label: c.mean.name, value: fmt(summary.mean ?? 0) }],
      ['stat:median', { label: c.median.name, value: fmt(summary.median ?? 0) }],
      ['stat:sd', { label: c.sd.name, value: summary.sampleSd === null ? '—' : formatSpread(subject, summary.sampleSd, unit), note: t.sampleSd }],
      ['stat:min', { label: c.min.name, value: fmt(summary.min ?? 0) }],
      ['stat:max', { label: c.max.name, value: fmt(summary.max ?? 0) }],
      ['stat:iqr', { label: c.iqr.name, value: formatSpread(subject, summary.iqr ?? 0, unit), note: t.iqrNote }],
    ]
    tiles.push(...standard.filter(([id]) => chosen.has(id)).map(([, tile]) => tile))

    // With a target, bias and spread are always shown with RMSD (§8.2).
    if (summary.rmsd && chosen.has('stat:rmsd')) {
      tiles.push({
        label: c.rmsdName,
        value: formatSpread(subject, summary.rmsd.rmsd, unit),
        note: summary.rmsd.reference === 'target' ? t.aroundTarget(fmt(target ?? 0)) : t.aroundMean,
      })

      if (summary.rmsd.reference === 'target' && summary.rmsd.bias !== null && summary.rmsd.spread !== null) {
        tiles.push(
          { label: t.bias, value: formatChange(subject, summary.rmsd.bias, unit), note: t.biasNote },
          { label: t.spread, value: formatSpread(subject, summary.rmsd.spread, unit), note: t.populationSd },
        )
      }
    }
  }

  if (chosen.has('stat:change')) tiles.push(
    delta.insufficient
      ? {
          label: t.changeVsPrevious(rangeDays),
          value: t.insufficient,
          note: t.nowBefore(delta.currentN, delta.previousN),
        }
      : {
          label: t.changeVsPrevious(rangeDays),
          value:
            formatChange(subject, delta.absolute ?? 0, unit) +
            (delta.percent !== null ? ` (${delta.percent >= 0 ? '+' : '−'}${Math.abs(Math.round(delta.percent))} %)` : ''),
          note: t.meanVs(fmt(delta.currentMean ?? 0), fmt(delta.previousMean ?? 0)),
        },
  )
  tiles.push(
    ...extraTiles.filter((tile) => chosen.has(tile.id)),
    ...stats.metrics.map(({ metric, result }) => metricTile(metric.id, metric.name, result, subject, unit)),
  )


  return { stats, tiles, builtIns }
}
