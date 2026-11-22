import { useId, type ReactNode } from 'react'

import { formatValue } from '../../dashboard/format'
import type { Aggregation } from '../../dashboard/periods'
import type { DateRange } from '../../stats/delta'
import { movingAverage } from '../../stats/timeseries'
import type { Observation, SubjectType } from '../../stats/subjects'
import { messages } from '../../i18n'

import { useChartTheme } from './chartTheme'
import { DataTable } from './DataTable'
import { MetricChooser } from './MetricChooser'
import { SectionOrderControls, type SectionOrder } from './SectionOrderControls'
import { sectionTiles } from './sectionTiles'
import { fullPeriodLabel } from './periodLabels'
import { StatTiles } from './StatTiles'
import type { Tile } from './StatTiles'
import { TimeSeriesChart } from './TimeSeriesChart'

export interface NumericSectionProps {
  title: string
  description: string
  subject: SubjectType
  unit?: string | null
  daily: readonly Observation[]
  range: DateRange
  aggregation: Aggregation
  target: number | null
  metricIds: readonly string[]
  onMetricsChange: (metricIds: string[]) => void
  chartKind: 'bar' | 'line'
  yDomain?: [number, number]
  /** What one value is: "night" or "day". */
  unitOfObservation: 'night' | 'day'
  /**
   * Section-specific tiles, shown after the standard ones when chosen.
   * Each needs an id "extra:…" and a description for the chooser.
   */
  extraTiles?: (Tile & { id: string; description: string })[]
  /** Plain-language trace of what the numbers are based on. */
  trace: string
  /** Notes about ignored or excluded data. */
  warnings?: string[]
  emptyMessage: string
  /** Up / down controls (habit sections only). */
  order?: SectionOrder
  /** Extra controls under the description (e.g. a view selector). */
  controls?: ReactNode
  /** Replaces the single-series chart (e.g. spending stacked by category). */
  chart?: ReactNode
  /** Shown after the data table (e.g. the table behind a custom chart). */
  afterTable?: ReactNode
}

/**
 * One dashboard section for a numeric measure: statistics (one value per
 * night/day in the range), change versus the previous period, selected
 * metrics, a chart, the data table and a trace of the records used.
 */
export function NumericSection(props: NumericSectionProps) {
  const {
    title, description, subject, unit, daily, range, aggregation, target,
    metricIds, onMetricsChange, chartKind, yDomain, unitOfObservation, extraTiles = [], trace, warnings = [], emptyMessage,
    order, controls, chart, afterTable,
  } = props

  const headingId = useId()
  const theme = useChartTheme()
  const { stats, tiles, builtIns } = sectionTiles({ subject, unit, daily, range, aggregation, target, metricIds, unitOfObservation, extraTiles })
  const hasData = stats.summary.n > 0

  const showAverage = metricIds.includes('moving-average-7d') && aggregation === 'day'
  const averages = showAverage
    ? new Map(movingAverage(daily, { windowDays: 7, minObservations: 4 }).map((point) => [point.date, point.value]))
    : null

  const points = stats.series.map((point) => ({
    ...point,
    average: averages ? averages.get(point.period) ?? null : undefined,
  }))

  const fmt = (value: number) => formatValue(subject, value, unit)

  return (
    <section aria-labelledby={headingId} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={headingId} className="text-lg font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
          {controls && <div className="mt-2">{controls}</div>}
        </div>
        {order && <SectionOrderControls title={title} order={order} />}
      </div>

      {!hasData ? (
        <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <>
          <StatTiles tiles={tiles} />

          {chart ?? (
            <TimeSeriesChart
              points={points}
              kind={chartKind}
              aggregation={aggregation}
              seriesName={title}
              formatValue={fmt}
              formatTick={fmt}
              yDomain={yDomain}
              target={target}
              showAverage={showAverage}
            />
          )}

          {showAverage && (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ background: theme.average }} />
              {messages().dashboard.sevenDayAverageNote}
            </p>
          )}

          <DataTable
            caption={messages().dashboard.valuesCaption(title)}
            detailHeader={unitOfObservation === 'night' ? messages().dashboard.nightsHeader : messages().dashboard.daysHeader}
            rows={points.map((point) => ({
              label: fullPeriodLabel(point.period, aggregation),
              value: point.value === null ? messages().dashboard.noData : fmt(point.value),
              detail: String(point.n),
            }))}
          />
          {afterTable}
        </>
      )}

      <p className="text-xs text-slate-500">{trace}</p>

      {warnings.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">{messages().dashboard.notesAboutData(warnings.length)}</summary>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </details>
      )}

      <MetricChooser subject={subject} builtIns={builtIns} selected={metricIds} onChange={onMetricsChange} />
    </section>
  )
}
