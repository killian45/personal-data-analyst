import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { Aggregation } from '../../dashboard/periods'
import { messages } from '../../i18n'

import { durationTicks, useChartTheme, useSeriesColor } from './chartTheme'
import { fullPeriodLabel, shortPeriodLabel } from './periodLabels'

export interface ChartSeries {
  key: string
  label: string
  /** Index in the theme's categorical palette, or 'other' for the neutral grey. */
  colorSlot: number | 'other'
}

export interface MultiSeriesRow {
  period: string
  values: Record<string, number | null>
}

interface MultiSeriesChartProps {
  rows: readonly MultiSeriesRow[]
  series: readonly ChartSeries[]
  /** Lines to compare series (apps); stacked bars for parts of a total (categories). */
  kind: 'line' | 'stacked'
  aggregation: Aggregation
  title: string
  formatValue: (value: number) => string
  formatTick: (value: number) => string
  /** Values are hours: axis steps of 15 min, 30 min, 1 h, 2 h… */
  durationAxis?: boolean
}

/** Legend with names (colour is never the only way to tell series apart). */
export function SeriesLegend({ series, kind }: { series: readonly ChartSeries[]; kind: 'line' | 'stacked' }) {
  const colorOf = useSeriesColor()
  return (
    <ul aria-label={messages().dashboard.legend} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {series.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={kind === 'line' ? 'inline-block h-0.5 w-4 rounded' : 'inline-block h-2.5 w-2.5 rounded-sm'}
            style={{ background: colorOf(item.colorSlot) }}
          />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  )
}

interface TooltipProps {
  active?: boolean
  payload?: { payload?: Record<string, unknown> }[]
}

/**
 * Several series in ONE chart with one y-axis: lines (e.g. apps) or
 * stacked bars (e.g. spending categories). Colours come from the
 * validated categorical palette in fixed slots. Hover shows every
 * series for that period; the values are also in the data table.
 */
export function MultiSeriesChart({ rows, series, kind, aggregation, title, formatValue, formatTick, durationAxis = false }: MultiSeriesChartProps) {
  const theme = useChartTheme()
  const colorOf = useSeriesColor()
  // Safe data keys: app and category names may contain dots or spaces.
  const keyOf = (index: number) => `s${index}`
  const data = rows.map((row) => ({
    period: row.period,
    ...Object.fromEntries(series.map((item, index) => [keyOf(index), row.values[item.key] ?? null])),
  }))

  const totals = rows.map((row) => series.reduce((sum, item) => sum + (row.values[item.key] ?? 0), 0))
  const peaks = kind === 'stacked' ? totals : rows.flatMap((row) => series.map((item) => row.values[item.key] ?? 0))
  const max = Math.max(0, ...peaks)

  const renderTooltip = ({ active, payload }: TooltipProps) => {
    const point = payload?.[0]?.payload
    if (!active || !point) return null
    const period = String(point.period)
    const values = series.map((item, index) => ({ item, value: point[keyOf(index)] as number | null }))
    const total = values.reduce((sum, { value }) => sum + (value ?? 0), 0)
    return (
      <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
        <p className="font-semibold text-slate-900">{fullPeriodLabel(period, aggregation)}</p>
        <ul className="mt-1 space-y-0.5">
          {values.map(({ item, value }) => (
            <li key={item.key} className="flex items-center gap-1.5 text-slate-600">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-sm" style={{ background: colorOf(item.colorSlot) }} />
              <span>{item.label}:</span>
              <span className="font-medium text-slate-900">{value === null ? messages().dashboard.noData : formatValue(value)}</span>
            </li>
          ))}
        </ul>
        {kind === 'stacked' && <p className="mt-1 text-slate-600">{messages().dashboard.total} <span className="font-medium text-slate-900">{formatValue(total)}</span></p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <SeriesLegend series={series} kind={kind} />
      <div className="h-56 w-full" role="img" aria-label={messages().dashboard.chartAlt(title)}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 224 }}>
          <ComposedChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={theme.grid} strokeWidth={1} />
            <XAxis
              dataKey="period"
              tickFormatter={(period: string) => shortPeriodLabel(period, aggregation)}
              tick={{ fill: theme.axis, fontSize: 11 }}
              axisLine={{ stroke: theme.grid }}
              tickLine={false}
              minTickGap={16}
            />
            <YAxis
              domain={durationAxis ? [0, durationTicks(max).at(-1) ?? 1] : [0, max > 0 ? 'auto' : 1]}
              ticks={durationAxis ? durationTicks(max) : undefined}
              tickFormatter={formatTick}
              tick={{ fill: theme.axis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip
              content={(props) => renderTooltip(props as unknown as TooltipProps)}
              cursor={kind === 'stacked' ? { fill: theme.grid, opacity: 0.5 } : { stroke: theme.axis, strokeWidth: 1 }}
            />
            {series.map((item, index) =>
              kind === 'stacked' ? (
                <Bar
                  key={item.key}
                  dataKey={keyOf(index)}
                  name={item.label}
                  stackId="total"
                  fill={colorOf(item.colorSlot)}
                  stroke={theme.surface}
                  strokeWidth={2}
                  maxBarSize={24}
                  radius={index === series.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={item.key}
                  dataKey={keyOf(index)}
                  name={item.label}
                  type="linear"
                  stroke={colorOf(item.colorSlot)}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  connectNulls={false}
                  dot={{ r: 4, fill: colorOf(item.colorSlot), stroke: theme.surface, strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: colorOf(item.colorSlot), stroke: theme.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/** The values behind a multi-series chart: one row per period, one column per series. */
export function MultiSeriesTable({ rows, series, aggregation, caption, formatValue, label }: {
  /** Text of the expander, e.g. "Show data by category" when a panel has two tables. */
  label?: string
  rows: readonly MultiSeriesRow[]
  series: readonly ChartSeries[]
  aggregation: Aggregation
  caption: string
  formatValue: (value: number) => string
}) {
  const t = messages()
  return (
    <details className="rounded-lg border border-slate-200 text-sm">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600">
        {t.dashboard.withRows(label ?? t.dashboard.showData, rows.length)}
      </summary>
      <div className="max-h-72 overflow-auto border-t border-slate-200">
        <table className="min-w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">{t.dashboard.period}</th>
              {series.map((item) => <th key={item.key} scope="col" className="px-3 py-2 font-medium">{item.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.period} className="border-t border-slate-200">
                <th scope="row" className="px-3 py-1.5 font-normal">{fullPeriodLabel(row.period, aggregation)}</th>
                {series.map((item) => {
                  const value = row.values[item.key]
                  return <td key={item.key} className="px-3 py-1.5 tabular-nums">{value === null || value === undefined ? t.dashboard.noData : formatValue(value)}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
