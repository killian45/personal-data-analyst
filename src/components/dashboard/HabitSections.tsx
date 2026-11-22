import { useId } from 'react'

import type { Aggregation } from '../../dashboard/periods'
import { aggregate, inRange } from '../../dashboard/periods'
import { deltaVersusPrevious, previousPeriod } from '../../stats/delta'
import type { DateRange } from '../../stats/delta'
import { checkboxSummary, countSummary } from '../../stats/habitSummaries'
import type { Observation } from '../../stats/subjects'
import { daysBetween } from '../../stats/subjects'
import { messages } from '../../i18n'

import { CountsChart } from './CountsChart'
import { DataTable } from './DataTable'
import { fullPeriodLabel } from './periodLabels'
import { StatTiles } from './StatTiles'
import { SectionOrderControls, type SectionOrder } from './SectionOrderControls'
import { TimeSeriesChart } from './TimeSeriesChart'

const percent = (value: number) => `${Math.round(value * 100)} %`

function SectionFrame({ title, description, order, children }: {
  title: string
  description: string
  order?: SectionOrder
  children: React.ReactNode
}) {
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={headingId} className="text-lg font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        {order && <SectionOrderControls title={title} order={order} />}
      </div>
      {children}
    </section>
  )
}

interface CheckboxSectionProps {
  title: string
  /** Daily 1 (done) / 0 (not done) observations, any dates. */
  daily: readonly Observation[]
  range: DateRange
  aggregation: Aggregation
  entryCount: number
  order?: SectionOrder
}

/**
 * Checkbox habit: completion rate (done days ÷ days with an entry),
 * streaks, and the completion rate per period. Days without an entry are
 * neither done nor failed.
 */
export function CheckboxSection({ title, daily, range, aggregation, entryCount, order }: CheckboxSectionProps) {
  const current = inRange(daily, range)
  const previous = inRange(daily, previousPeriod(range))
  const summary = checkboxSummary(current.map((o) => ({ date: o.date, done: o.value === 1 })), range)
  const delta = deltaVersusPrevious('checkbox', current.map((o) => o.value), previous.map((o) => o.value))
  const series = aggregate(current, range, aggregation)
  const rangeDays = daysBetween(range.start, range.end) + 1
  const t = messages().dashboard
  const h = t.habits

  return (
    <SectionFrame title={title} description={h.checkboxDescription} order={order}>
      {summary.observedDays === 0 ? (
        <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">{h.empty}</p>
      ) : (
        <>
          <StatTiles
            tiles={[
              {
                label: h.completionRate,
                value: summary.completionRate === null ? '—' : percent(summary.completionRate),
                note: h.doneOf(summary.doneDays, summary.observedDays),
              },
              { label: h.daysWithEntry, value: String(summary.observedDays), note: h.notDone(summary.notDoneDays) },
              { label: h.daysWithoutEntry, value: String(summary.missingDays), note: h.notCounted },
              { label: h.longestStreak, value: h.days(summary.longestStreak), note: h.longestStreakNote },
              { label: h.currentStreak, value: h.days(summary.currentStreak) },
              delta.insufficient
                ? { label: t.tiles.changeVsPrevious(rangeDays), value: t.tiles.insufficient, note: t.tiles.nowBefore(delta.currentN, delta.previousN) }
                : {
                    label: t.tiles.changeVsPrevious(rangeDays),
                    value: h.points((delta.absolute ?? 0) >= 0 ? '+' : '−', Math.round(Math.abs(delta.absolute ?? 0) * 100)),
                    note: h.versus(percent(delta.currentMean ?? 0), percent(delta.previousMean ?? 0)),
                  },
            ]}
          />

          <TimeSeriesChart
            points={series}
            kind="bar"
            aggregation={aggregation}
            seriesName={h.completionRateOf(title)}
            formatValue={percent}
            formatTick={percent}
            yDomain={[0, 1]}
          />

          <DataTable
            caption={h.completionRateOf(title)}
            detailHeader={h.daysWithEntry}
            rows={series.map((point) => ({
              label: fullPeriodLabel(point.period, aggregation),
              value: point.value === null ? t.noData : percent(point.value),
              detail: String(point.n),
            }))}
          />
        </>
      )}

      <p className="text-xs text-slate-500">
        {h.checkboxTrace(entryCount)}
      </p>
    </SectionFrame>
  )
}

interface CountsSectionProps {
  title: string
  kind: 'label' | 'text'
  /** Entry values with their local dates, any dates. */
  values: readonly { date: string; value: string }[]
  options: readonly string[]
  range: DateRange
  order?: SectionOrder
}

/** Label and text habits: counts only, no numerical statistics (§8.3). */
export function CountsSection({ title, kind, values, options, range, order }: CountsSectionProps) {
  const current = inRange(values, range)
  const previous = inRange(values, previousPeriod(range))
  const counts = countSummary(current.map((item) => item.value), kind === 'label' ? options : [])
  const rangeDays = daysBetween(range.start, range.end) + 1
  const h = messages().dashboard.habits

  return (
    <SectionFrame
      title={title}
      description={kind === 'label' ? h.labelDescription : h.textDescription}
      order={order}
    >
      {current.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">{h.empty}</p>
      ) : (
        <>
          <StatTiles
            tiles={[
              { label: h.entries, value: String(counts.total) },
              { label: h.previousDays(rangeDays), value: String(previous.length), note: h.entries },
              ...(kind === 'label' && counts.byValue[0]
                ? [{ label: h.mostFrequent, value: counts.byValue[0].value, note: h.times(counts.byValue[0].count) }]
                : []),
            ]}
          />

          {kind === 'label' && (
            <>
              <CountsChart counts={counts.byValue} seriesName={title} />
              <DataTable
                caption={h.countsCaption(title)}
                firstHeader={h.option}
                rows={counts.byValue.map((item) => ({ label: item.value, value: String(item.count) }))}
              />
            </>
          )}
        </>
      )}
    </SectionFrame>
  )
}
