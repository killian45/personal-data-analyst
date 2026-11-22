import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { messages } from '../../i18n'

import { useChartTheme } from './chartTheme'

interface CountsChartProps {
  counts: { value: string; count: number }[]
  seriesName: string
}

/**
 * Horizontal bars of counts per label option: one series, one colour
 * (bars are compared by length, not coloured by size).
 */
export function CountsChart({ counts, seriesName }: CountsChartProps) {
  const theme = useChartTheme()
  const height = Math.max(96, counts.length * 32 + 32)

  return (
    <div style={{ height }} className="w-full" role="img" aria-label={messages().dashboard.countsChartAlt(seriesName)}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
        <BarChart data={counts} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 0 }}>
          <CartesianGrid horizontal={false} stroke={theme.grid} strokeWidth={1} />
          <XAxis type="number" allowDecimals={false} tick={{ fill: theme.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            type="category"
            dataKey="value"
            width={96}
            tick={{ fill: theme.axis, fontSize: 11 }}
            axisLine={{ stroke: theme.grid }}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: theme.grid, opacity: 0.5 }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as { value: string; count: number } | undefined
              return active && row ? (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                  <p className="font-semibold text-slate-900">{row.count}</p>
                  <p className="text-slate-600">{row.value}</p>
                </div>
              ) : null
            }}
          />
          <Bar dataKey="count" name={seriesName} fill={theme.series} maxBarSize={24} radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
