import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'

import { correlationWarnings, delayLabel, delayWords, readCorrelation } from '../../analysis/describe'
import { formatMeasureValue } from '../../analysis/format'
import { buildMeasures } from '../../analysis/measures'
import { buildOverview, MAX_OVERVIEW_MEASURES, measureWindow } from '../../analysis/overview'
import type { Measure } from '../../analysis/measures'
import { loadDashboardData } from '../../dashboard/loadDashboardData'
import type { DashboardData } from '../../dashboard/loadDashboardData'
import { parseDateDMY } from '../../logging/dateTimeInput'
import { benjaminiHochberg, correlate, describeStrength, MAX_LAG_DAYS } from '../../stats/correlation'
import type { CoefficientResult, CorrelationResult } from '../../stats/correlation'
import { addDays } from '../../stats/subjects'
import type { DateRange } from '../../stats/delta'
import { getDeviceTimezone, utcToLocalDateTime } from '../../time/time'
import { messages } from '../../i18n'
import { useChartTheme } from '../dashboard/chartTheme'
import { DateDMYField } from '../DateDMYField'
import { FormulaManager } from './FormulaManager'

/**
 * Analysis page (Phase 6 step 2, docs/PHASE6_PLAN.md): correlation
 * between two daily measures, with a delay, a scatter plot, a delay
 * profile and always-visible warnings. Calculations in src/stats/
 * correlation.ts; wording in src/analysis/describe.ts.
 */

type RangeChoice = 'all' | '90d' | '30d' | 'custom'

const RANGES: readonly RangeChoice[] = ['all', '90d', '30d', 'custom']

const selectClass = 'w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm'

function signed(value: number): string {
  return value.toFixed(2).replace('-', '−')
}

function pText(p: number | null): string {
  if (p === null) return '—'
  return p < 0.001 ? '< 0.001' : p.toFixed(3)
}

function rangeText(coefficient: CoefficientResult | null): string {
  if (!coefficient || coefficient.low === null || coefficient.high === null) return '—'
  return messages().analysis.rangeBetween(signed(coefficient.low), signed(coefficient.high))
}

function MeasureSelect({ id, label, value, measures, onChange }: { id: string; label: string; value: string; measures: Measure[]; onChange: (id: string) => void }) {
  const groups = [...new Set(measures.map((measure) => measure.group))]
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}>
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {measures.filter((measure) => measure.group === group).map((measure) => (
              <option key={measure.id} value={measure.id}>{measure.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

function ScatterPlot({ result, x, y }: { result: CorrelationResult; x: Measure; y: Measure }) {
  const theme = useChartTheme()
  const points = result.pairs.map((pair) => ({ date: pair.date, x: pair.x, y: pair.y }))
  return (
    <figure className="h-72" aria-label={messages().analysis.scatterAlt(x.label, y.label)}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 288 }}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
          <CartesianGrid stroke={theme.grid} strokeWidth={1} />
          <XAxis
            type="number"
            dataKey="x"
            name={x.label}
            domain={['auto', 'auto']}
            tickFormatter={(value: number) => formatMeasureValue(x, value)}
            stroke={theme.axis}
            tick={{ fill: theme.axis, fontSize: 12 }}
            label={{ value: x.label, position: 'insideBottom', offset: -16, fill: theme.axis, fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={y.label}
            domain={['auto', 'auto']}
            width={72}
            tickFormatter={(value: number) => formatMeasureValue(y, value)}
            stroke={theme.axis}
            tick={{ fill: theme.axis, fontSize: 12 }}
          />
          <Tooltip
            cursor={{ stroke: theme.grid }}
            content={({ active, payload }) => {
              const point = active ? (payload?.[0]?.payload as { date: string; x: number; y: number } | undefined) : undefined
              if (!point) return null
              const [year, month, day] = point.date.split('-')
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                  <p className="font-medium">{`${day}/${month}/${year}`}</p>
                  <p>{x.label}: {formatMeasureValue(x, point.x)}</p>
                  <p>{y.label}{result.lag > 0 ? ` (${delayLabel(result.lag).toLowerCase()})` : ''}: {formatMeasureValue(y, point.y)}</p>
                </div>
              )
            }}
          />
          <Scatter
            data={points}
            isAnimationActive={false}
            shape={(props: { cx?: number; cy?: number }) => (
              <g>
                {/* 24 px hover target, 8 px dot with a 2 px surface ring. */}
                <circle cx={props.cx} cy={props.cy} r={12} fill="transparent" />
                <circle cx={props.cx} cy={props.cy} r={4} fill={theme.series} stroke={theme.surface} strokeWidth={2} />
              </g>
            )}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </figure>
  )
}

export default function AnalysisPage() {
  const t = messages().analysis
  const id = useId()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [xId, setXId] = useState('')
  const [yId, setYId] = useState('')
  const [lag, setLag] = useState(0)
  const [rangeChoice, setRangeChoice] = useState<RangeChoice>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [overviewIds, setOverviewIds] = useState<string[]>([])
  const resultRef = useRef<HTMLDivElement>(null)
  // "Today" for the 30/90-day ranges, read once when the page opens.
  const [today] = useState(() => utcToLocalDateTime(new Date().toISOString(), getDeviceTimezone()).slice(0, 10))

  useEffect(() => {
    let cancelled = false
    loadDashboardData()
      .then((loaded) => {
        if (!cancelled) setData(loaded)
      })
      .catch((error: unknown) => {
        console.error('Failed to load the analysis data:', error)
        if (!cancelled) setLoadError(messages().analysis.loadFailed)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const measures = useMemo(() => (data ? buildMeasures(data) : []), [data])
  const baseMeasures = useMemo(() => (data ? buildMeasures({ ...data, formulas: [] }) : []), [data])
  const usable = measures.filter((measure) => measure.daily.length > 0)
  const x = usable.find((measure) => measure.id === xId) ?? usable[0]
  const y = usable.find((measure) => measure.id === yId) ?? usable.find((measure) => measure.id !== x?.id)

  let range: DateRange | null = null
  let rangeError = ''
  if (rangeChoice === 'custom') {
    const from = parseDateDMY(customFrom)
    const to = parseDateDMY(customTo)
    if (from === null || to === null) rangeError = t.customRangeMissing
    else if (to < from) rangeError = t.customRangeOrder
    else range = { start: from, end: to }
  } else if (rangeChoice !== 'all') {
    range = { start: addDays(today, rangeChoice === '90d' ? -89 : -29), end: today }
  }

  if (loadError) return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{loadError}</p>
  if (!data) return <p className="py-8 text-center text-sm text-slate-500">{messages().app.loading.analysis}</p>
  if (!x || !y) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
        {t.needTwoMeasures}
      </p>
    )
  }

  const sameMeasure = x.id === y.id && lag === 0
  const canCompute = !rangeError && !sameMeasure
  const result = canCompute ? correlate(measureWindow(x, range, 0), measureWindow(y, range, lag), lag) : null
  const profile = canCompute
    ? Array.from({ length: MAX_LAG_DAYS + 1 }, (_, k) => (x.id === y.id && k === 0 ? null : correlate(measureWindow(x, range, 0), measureWindow(y, range, k), k)))
    : []
  const adjusted = benjaminiHochberg(profile.map((item) => (item?.status === 'ok' ? item.pearson!.p : null)))
  const comparisons = adjusted.filter((p) => p !== null).length

  const chosen = usable.filter((measure) => overviewIds.includes(measure.id))
  const overview = chosen.length >= 2 && !rangeError ? buildOverview(chosen, range) : null
  const groups = [...new Set(usable.map((measure) => measure.group))]

  function toggleOverview(measureId: string) {
    setOverviewIds((current) =>
      current.includes(measureId)
        ? current.filter((item) => item !== measureId)
        : current.length >= MAX_OVERVIEW_MEASURES ? current : [...current, measureId],
    )
  }

  function openPair(xMeasure: string, yMeasure: string) {
    setXId(xMeasure)
    setYId(yMeasure)
    setLag(0)
    resultRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="space-y-6" ref={resultRef}>
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <MeasureSelect id={`${id}-x`} label={t.measureX} value={x.id} measures={usable} onChange={setXId} />
        <MeasureSelect id={`${id}-y`} label={t.measureY} value={y.id} measures={usable} onChange={setYId} />
        <div>
          <label htmlFor={`${id}-lag`} className="mb-1 block text-xs font-medium text-slate-600">{t.yMeasured}</label>
          <select id={`${id}-lag`} value={lag} onChange={(event) => setLag(Number(event.target.value))} className={selectClass}>
            {Array.from({ length: MAX_LAG_DAYS + 1 }, (_, k) => (
              <option key={k} value={k}>{delayLabel(k)} ({delayWords(x, y, k)})</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-range`} className="mb-1 block text-xs font-medium text-slate-600">{t.daysOfX}</label>
          <select id={`${id}-range`} value={rangeChoice} onChange={(event) => setRangeChoice(event.target.value as RangeChoice)} className={selectClass}>
            {RANGES.map((item) => <option key={item} value={item}>{t.ranges[item]}</option>)}
          </select>
        </div>
        {rangeChoice === 'custom' && (
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <DateDMYField id={`${id}-from`} label={t.from} showLabel value={customFrom} onChange={setCustomFrom} className="w-36" />
            <DateDMYField id={`${id}-to`} label={t.to} showLabel value={customTo} onChange={setCustomTo} className="w-36" />
          </div>
        )}
      </div>

      {rangeError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{rangeError}</p>}
      {sameMeasure && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{t.sameMeasure}</p>
      )}

      {result && (
        <section aria-labelledby={`${id}-result`} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 id={`${id}-result`} className="text-lg font-semibold">{t.pairTitle(x.label, y.label)}</h3>
          <p className="text-sm">{readCorrelation(result, x, y)}</p>

          {result.pearson && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">{t.measureOfRelation}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t.value}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t.range95}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t.pValue}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-200">
                    <th scope="row" className="px-3 py-2 font-normal">{t.pearsonRow}</th>
                    <td className="px-3 py-2 tabular-nums">{signed(result.pearson.value)}</td>
                    <td className="px-3 py-2 tabular-nums">{rangeText(result.pearson)}</td>
                    <td className="px-3 py-2 tabular-nums">{pText(result.pearson.p)}</td>
                  </tr>
                  <tr className="border-t border-slate-200">
                    <th scope="row" className="px-3 py-2 font-normal">{t.spearmanRow}</th>
                    <td className="px-3 py-2 tabular-nums">{signed(result.spearman!.value)}</td>
                    <td className="px-3 py-2 tabular-nums">{rangeText(result.spearman)}</td>
                    <td className="px-3 py-2 tabular-nums">{pText(result.spearman!.p)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-slate-500">
            {t.basedOn(result.n, result.nEffective === null ? null : Math.round(result.nEffective))}
          </p>

          {result.pairs.length > 0 && <ScatterPlot result={result} x={x} y={y} />}

          <details className="rounded-lg border border-slate-200 text-sm">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600">{t.showData(result.pairs.length)}</summary>
            <div className="max-h-64 overflow-y-auto">
              <table className="min-w-full text-left text-xs">
                <caption className="sr-only">{t.pairedDays}</caption>
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th scope="col" className="px-3 py-1.5 font-medium">{t.day}</th>
                    <th scope="col" className="px-3 py-1.5 font-medium">{x.label}</th>
                    <th scope="col" className="px-3 py-1.5 font-medium">{y.label}{lag > 0 ? ` (${delayLabel(lag).toLowerCase()})` : ''}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.pairs.map((pair) => (
                    <tr key={pair.date} className="border-t border-slate-200">
                      <td className="px-3 py-1 tabular-nums">{pair.date.slice(8, 10)}/{pair.date.slice(5, 7)}/{pair.date.slice(0, 4)}</td>
                      <td className="px-3 py-1 tabular-nums">{formatMeasureValue(x, pair.x)}</td>
                      <td className="px-3 py-1 tabular-nums">{formatMeasureValue(y, pair.y)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            <p className="font-medium">{t.readWithCare}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {correlationWarnings(result, x, y).map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        </section>
      )}

      {profile.length > 0 && (
        <section aria-labelledby={`${id}-profile`} className="space-y-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 id={`${id}-profile`} className="text-lg font-semibold">{t.delayProfile}</h3>
          <p className="text-sm text-slate-600">
            {t.delayProfileIntro(MAX_LAG_DAYS, comparisons)}
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">{t.yMeasured}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t.days}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t.pearsonR}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t.range95}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t.pValue}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t.adjustedP}</th>
                </tr>
              </thead>
              <tbody>
                {profile.map((item, k) => (
                  <tr key={k} className={`border-t border-slate-200 ${k === lag ? 'bg-slate-50 font-medium' : ''}`}>
                    <th scope="row" className="px-3 py-2 font-normal">{delayLabel(k)}{k === lag ? t.shownAbove : ''}</th>
                    <td className="px-3 py-2 tabular-nums">{item ? item.n : '—'}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {item?.pearson ? signed(item.pearson.value) : item?.status === 'too-few-days' ? t.tooFewDays : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{rangeText(item?.pearson ?? null)}</td>
                    <td className="px-3 py-2 tabular-nums">{pText(item?.pearson?.p ?? null)}</td>
                    <td className="px-3 py-2 tabular-nums">{pText(adjusted[k])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby={`${id}-overview`} className="space-y-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 id={`${id}-overview`} className="text-lg font-semibold">{t.overviewTitle}</h3>
        <p className="text-sm text-slate-600">
          {t.overviewIntro(MAX_OVERVIEW_MEASURES)}
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {groups.map((group) => (
            <fieldset key={group} className="text-sm">
              <legend className="mb-1 text-xs font-medium text-slate-600">{group}</legend>
              {usable.filter((measure) => measure.group === group).map((measure) => (
                <label key={measure.id} className="flex items-center gap-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={overviewIds.includes(measure.id)}
                    disabled={!overviewIds.includes(measure.id) && overviewIds.length >= MAX_OVERVIEW_MEASURES}
                    onChange={() => toggleOverview(measure.id)}
                  />
                  {measure.label}
                </label>
              ))}
            </fieldset>
          ))}
        </div>

        {!overview ? (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{t.tickTwo}</p>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              {t.overviewSummary(chosen.length, overview.pairs, overview.comparisons)}
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">{t.pair}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t.days}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t.pearsonR}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t.strength}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t.adjustedP}</th>
                    <th scope="col" className="px-3 py-2"><span className="sr-only">{t.open}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {overview.rows.map((row) => {
                    const r = row.result.pearson?.value ?? null
                    const status = row.result.status
                    return (
                      <tr key={`${row.x.id}|${row.y.id}`} className="border-t border-slate-200">
                        <th scope="row" className="px-3 py-2 font-normal">{row.x.label} — {row.y.label}</th>
                        <td className="px-3 py-2 tabular-nums">{row.result.n}</td>
                        <td className="px-3 py-2 tabular-nums">{r === null ? '—' : signed(r)}</td>
                        <td className="px-3 py-2">
                          {status === 'ok' && r !== null
                            ? messages().correlationText.strengths[describeStrength(r)]
                            : status === 'too-dependent' ? t.tooLittleToTell
                            : status === 'no-variation' ? t.noVariation
                            : t.tooFewDays}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{pText(row.adjustedP)}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => openPair(row.x.id, row.y.id)}
                            aria-label={t.openPair(row.x.label, row.y.label)}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100"
                          >
                            {t.open}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <FormulaManager
        measures={baseMeasures}
        formulas={data.formulas}
        onChange={(formulas) => setData((current) => (current ? { ...current, formulas } : current))}
      />
    </div>
  )
}
