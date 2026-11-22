import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { Aggregation } from '../../dashboard/periods'
import { messages } from '../../i18n'

import { useChartTheme } from './chartTheme'
import { fullPeriodLabel, shortPeriodLabel } from './periodLabels'

export interface ChartPoint {
  period: string
  value: number | null
  n: number
  /** Optional 7-day moving average at this point. */
  average?: number | null
}

interface TimeSeriesChartProps {
  points: ChartPoint[]
  kind: 'bar' | 'line'
  aggregation: Aggregation
  /** Name of the series, e.g. "Sleep duration". */
  seriesName: string
  formatValue: (value: number) => string
  formatTick: (value: number) => string
  /** Fixed y range; otherwise from 0 for bars, around the data for lines. */
  yDomain?: [number, number]
  target?: number | null
  /** Draw the moving average (orange line) when points carry one. */
  showAverage?: boolean
}

interface TooltipRow {
  dataKey?: string | number
  value?: number | null
  payload?: ChartPoint
}

/**
 * One chart per measure (one y-axis). Bars grow from zero; lines are used
 * for clock times. Missing periods are gaps: lines are never joined across
 * them (no interpolation). Hover shows the value and the number of days
 * behind it; the same values are in the data table below the chart.
 */
export function TimeSeriesChart({
  points,
  kind,
  aggregation,
  seriesName,
  formatValue,
  formatTick,
  yDomain,
  target = null,
  showAverage = false,
}: TimeSeriesChartProps) {
  const theme = useChartTheme()

  const values = points
    .flatMap((point) => [point.value, showAverage ? point.average ?? null : null])
    .filter((value): value is number => value !== null)
  if (target !== null) {
    values.push(target)
  }

  const domain: [number, number] = yDomain ??
    (kind === 'bar'
      ? [0, values.length > 0 ? Math.max(...values) * 1.1 || 1 : 1]
      : values.length > 0
        ? [Math.floor(Math.min(...values) * 2 - 1) / 2, Math.ceil(Math.max(...values) * 2 + 1) / 2]
        : [0, 1])

  const renderTooltip = ({ active, payload }: { active?: boolean; payload?: TooltipRow[] }) => {
    const point = payload?.[0]?.payload

    if (!active || !point) {
      return null
    }

    return (
      <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
        <p className="font-semibold text-slate-900">
          {point.value === null ? messages().dashboard.noData : formatValue(point.value)}
        </p>
        <p className="text-slate-600">
          {messages().dashboard.periodDays(fullPeriodLabel(point.period, aggregation), point.n)}
        </p>
        {showAverage && point.average !== undefined && point.average !== null && (
          <p className="text-slate-600">{messages().dashboard.sevenDayAverage(formatValue(point.average))}</p>
        )}
      </div>
    )
  }

  return (
    <div className="h-56 w-full" role="img" aria-label={messages().dashboard.chartAlt(seriesName)}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 224 }}>
        <ComposedChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
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
            domain={domain}
            tickFormatter={formatTick}
            tick={{ fill: theme.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip
            content={(props) =>
              renderTooltip(props as unknown as { active?: boolean; payload?: TooltipRow[] })
            }
            cursor={kind === 'bar' ? { fill: theme.grid, opacity: 0.5 } : { stroke: theme.axis, strokeWidth: 1 }}
          />
          {target !== null && (
            <ReferenceLine
              y={target}
              stroke={theme.target}
              strokeWidth={1}
              label={{ value: messages().dashboard.target, position: 'insideTopRight', fill: theme.axis, fontSize: 11 }}
            />
          )}
          {kind === 'bar' ? (
            <Bar
              dataKey="value"
              name={seriesName}
              fill={theme.series}
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          ) : (
            <Line
              dataKey="value"
              name={seriesName}
              type="linear"
              stroke={theme.series}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              connectNulls={false}
              dot={{ r: 4, fill: theme.series, stroke: theme.surface, strokeWidth: 2 }}
              activeDot={{ r: 6, fill: theme.series, stroke: theme.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          )}
          {showAverage && (
            <Line
              dataKey="average"
              name="7-day average"
              type="linear"
              stroke={theme.average}
              strokeWidth={2}
              connectNulls={false}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
