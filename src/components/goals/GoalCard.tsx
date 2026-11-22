import { useState } from 'react'

import type { Measure } from '../../analysis/measures'
import { aggregate } from '../../dashboard/periods'
import { baselineText, describeSuccess, formatMeasureValue, formatProgressValue, progressStatusText } from '../../goals/goalFormat'
import { baselineShare, goalProgress } from '../../goals/goals'
import type { Goal, GoalsProfile } from '../../goals/goals'
import { formatInTimezone } from '../../time/time'
import { messages } from '../../i18n'
import { TimeSeriesChart } from '../dashboard/TimeSeriesChart'

import { GoalOpinion } from './GoalOpinion'

interface GoalCardProps {
  goal: Goal
  measures: readonly Measure[]
  today: string
  onEdit: () => void
  onDelete: () => Promise<void>
  /** With both: the AI's opinion (computer with Ollama only). */
  profile?: GoalsProfile
  aiModel?: string | null
}

const secondary = 'rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100'
const danger = 'rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50'

/** One goal: what success means, progress so far, the data figure and a chart. */
export function GoalCard({ goal, measures, today, onEdit, onDelete, profile, aiModel }: GoalCardProps) {
  const t = messages()
  const c = t.goals.card
  const [confirm, setConfirm] = useState(false)
  const success = measures.find((measure) => measure.id === goal.success.measure)
  const progressMeasure = measures.find((measure) => measure.id === goal.progressMeasure)
  const period = {
    start: formatInTimezone(goal.startUtc, goal.timezone, 'yyyy-MM-dd'),
    end: formatInTimezone(goal.endUtc, goal.timezone, 'yyyy-MM-dd'),
  }
  const when = (utc: string) => formatInTimezone(utc, goal.timezone, 'dd/MM/yyyy HH:mm')
  const progress = success ? goalProgress(goal, period, success.daily, today) : null
  const baseline = success ? baselineShare(goal, period, success.daily) : null

  const statusText = progressStatusText(progress)

  return (
    <article aria-label={goal.title} className="space-y-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-lg font-semibold">{goal.title}</h3>
          <p className="text-xs text-slate-500">
            {c.kinds[goal.kind]} · {when(goal.startUtc)} → {when(goal.endUtc)} ({goal.timezone})
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onEdit} className={secondary}>{t.common.edit}</button>
          {confirm ? (
            <>
              <button type="button" onClick={() => void onDelete()} className={danger}>{c.confirmDelete}</button>
              <button type="button" onClick={() => setConfirm(false)} className={secondary}>{c.keep}</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirm(true)} className={danger}>{t.common.delete}</button>
          )}
        </div>
      </div>

      {!success ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{c.measureGone}</p>
      ) : (
        <>
          <p className="text-sm"><span className="font-medium">{c.success}</span> {describeSuccess(goal, success)}</p>
          {progress && (
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">{c.soFar}</dt>
                <dd className="font-semibold">{progress.value === null ? '—' : formatProgressValue(goal, success, progress.value)}</dd>
                <dd className="text-xs text-slate-600">{statusText}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">{c.days}</dt>
                <dd className="font-semibold">{c.daysOf(progress.daysElapsed, progress.daysTotal)}</dd>
                <dd className="text-xs text-slate-600">{c.withData(progress.daysWithData)}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">{c.ratings}</dt>
                <dd className="font-semibold">{c.ratingsValue(goal.ambition, goal.realism)}</dd>
                {progress.projected !== null && <dd className="text-xs text-slate-600">{c.atThisPace(formatMeasureValue(success, progress.projected))}</dd>}
              </div>
            </dl>
          )}
          <p className="text-xs text-slate-600">
            {baselineText(goal, success, baseline)}
          </p>
          {aiModel && profile && progress?.status !== 'finished' && (
            <GoalOpinion goal={goal} measures={measures} profile={profile} today={today} model={aiModel} />
          )}
        </>
      )}

      {progressMeasure && (
        <TimeSeriesChart
          points={aggregate(progressMeasure.daily, period, 'day')}
          kind={progressMeasure.kind === 'clock' ? 'line' : 'bar'}
          aggregation="day"
          seriesName={progressMeasure.label}
          formatValue={(value) => formatMeasureValue(progressMeasure, value)}
          formatTick={(value) => formatMeasureValue(progressMeasure, value)}
          target={progressMeasure.id === goal.success.measure && !goal.success.rule.startsWith('total-') && progressMeasure.kind !== 'binary' ? goal.success.target : null}
        />
      )}
      <p className="text-xs text-slate-500">{c.progress(progressMeasure ? progressMeasure.label : null)}</p>
    </article>
  )
}
