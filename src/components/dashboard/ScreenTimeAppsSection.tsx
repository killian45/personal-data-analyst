import { useId, type ReactNode } from 'react'

import type { ExternalSample } from '../../database/types'
import { aggregateMany, inRange } from '../../dashboard/periods'
import type { Aggregation } from '../../dashboard/periods'
import { appDailyObservations } from '../../screenTime/dailyScreenTime'
import type { ChosenAppSlots } from '../../settings/dashboardScreenTimeApps'
import type { DateRange } from '../../stats/delta'
import { formatDuration } from '../../stopwatch/duration'
import { messages } from '../../i18n'

import { useSeriesColor } from './chartTheme'
import { MultiSeriesChart, MultiSeriesTable } from './MultiSeriesChart'
import type { ChartSeries } from './MultiSeriesChart'
import { MetricChooser } from './MetricChooser'
import { SectionOrderControls } from './SectionOrderControls'
import type { SectionOrder } from './SectionOrderControls'
import { sectionTiles } from './sectionTiles'
import { StatTiles } from './StatTiles'

interface ScreenTimeAppsSectionProps {
  slots: ChosenAppSlots
  samples: readonly ExternalSample[]
  range: DateRange
  aggregation: Aggregation
  order?: SectionOrder
  controls: ReactNode
  trace: string
  /** The screen-time statistics choice (shared with the total panel). */
  metricIds: readonly string[]
  onMetricsChange: (metricIds: string[]) => void
}

const hours = (value: number) => formatDuration(value * 3_600_000)

/**
 * Time of several chosen apps in ONE chart (a line and a colour per app,
 * colour = the app's slot, so removing an app never repaints the others),
 * with a summary per app and the data table.
 */
export function ScreenTimeAppsSection({ slots, samples, range, aggregation, order, controls, trace, metricIds, onMetricsChange }: ScreenTimeAppsSectionProps) {
  const headingId = useId()
  const colorOf = useSeriesColor()
  const series: ChartSeries[] = slots.flatMap((name, slot) => (name === null ? [] : [{ key: name, label: name, colorSlot: slot }]))
  const daily = series.map((item) => ({ key: item.key, daily: appDailyObservations(samples, item.key) }))
  const rows = aggregateMany(daily, range, aggregation)
  const recordedDays = inRange(daily[0]?.daily ?? [], range).length
  const t = messages().dashboard
  const title = t.screenTime.byAppTitle

  return (
    <section aria-labelledby={headingId} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={headingId} className="text-lg font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">
            {t.screenTime.byAppDescription(aggregation === 'day')}
          </p>
          <div className="mt-2">{controls}</div>
        </div>
        {order && <SectionOrderControls title={t.screenTime.title} order={order} />}
      </div>

      {recordedDays === 0 ? (
        <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">{t.screenTime.empty}</p>
      ) : (
        <>

          <MultiSeriesChart
            rows={rows}
            series={series}
            kind="line"
            aggregation={aggregation}
            title={title}
            formatValue={hours}
            formatTick={hours}
            durationAxis
          />

          <div className="space-y-4">
            {series.map((item, index) => {
              const inDates = inRange(daily[index].daily, range).map((observation) => observation.value ?? 0)
              const total = inDates.reduce((sum, value) => sum + value, 0)
              const { tiles } = sectionTiles({
                subject: 'stopwatch', daily: daily[index].daily, range, aggregation, target: null, metricIds, unitOfObservation: 'day',
              })
              return (
                <div key={item.key} role="group" aria-label={t.screenTime.appStatistics(item.label)} className="space-y-2">
                  <h4 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                    <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorOf(item.colorSlot) }} />
                    <span className="break-words">{item.label}</span>
                    <span className="text-xs font-normal text-slate-500">
                      {t.screenTime.appTotal(hours(total), inDates.filter((value) => value > 0).length, inDates.length)}
                    </span>
                  </h4>
                  <StatTiles tiles={tiles} />
                </div>
              )
            })}
          </div>

          <MultiSeriesTable rows={rows} series={series} aggregation={aggregation} caption={t.valuesCaption(title)} formatValue={hours} />
        </>
      )}

      <p className="text-xs text-slate-500">{trace}</p>

      <MetricChooser
        subject="stopwatch"
        builtIns={sectionTiles({ subject: 'stopwatch', daily: [], range, aggregation, target: null, metricIds, unitOfObservation: 'day' }).builtIns}
        selected={metricIds}
        onChange={onMetricsChange}
      />
    </section>
  )
}
