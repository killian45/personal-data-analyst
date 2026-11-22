import { useId, useState } from 'react'

import type { Measure } from '../../analysis/measures'
import { parseTarget, RULE_LABELS, targetHint, targetText } from '../../goals/goalFormat'
import { GOAL_KINDS, GoalFieldError, rulesFor, validateGoal } from '../../goals/goals'
import type { Goal, GoalKind, SuccessRule } from '../../goals/goals'
import { fieldsFromInstant, interactionTimeFromFields } from '../../crm/contactForm'
import { getDeviceTimezone } from '../../time/time'
import { messages } from '../../i18n'
import { DateTime24Field } from '../DateTime24Field'

interface GoalFormProps {
  measures: readonly Measure[]
  /** The goal being edited, or null for a new one. */
  goal: Goal | null
  onSave: (goal: Goal) => Promise<void>
  onCancel: () => void
}

const input = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'
const label = 'mb-1 block text-xs font-medium text-slate-600'
const primary = 'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
const secondary = 'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50'
/** The current time (read when saving, never while drawing). */
function nowIso(): string {
  return new Date().toISOString()
}

function MeasureSelect({ id, value, onChange, measures, text }: { id: string; value: string; onChange: (id: string) => void; measures: readonly Measure[]; text: string }) {
  const groups = [...new Set(measures.map((measure) => measure.group))]
  return (
    <div>
      <label htmlFor={id} className={label}>{text}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={input}>
        <option value="">{messages().goals.form.choose}</option>
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {measures.filter((measure) => measure.group === group).map((measure) => <option key={measure.id} value={measure.id}>{measure.label}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

function RatingSelect({ id, value, onChange, text, hint }: { id: string; value: string; onChange: (value: string) => void; text: string; hint: string }) {
  return (
    <div>
      <label htmlFor={id} className={label}>{text}</label>
      <p className="mb-1 text-xs text-slate-500">{hint}</p>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={input}>
        <option value="">{messages().goals.form.choose}</option>
        {Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={String(index + 1)}>{index + 1}</option>)}
      </select>
    </div>
  )
}

/** "Add a goal" / edit a goal: every field required (docs/GOALS_PLAN.md). */
export function GoalForm({ measures, goal, onSave, onCancel }: GoalFormProps) {
  const t = messages()
  const f = t.goals.form
  const id = useId()
  const zone = goal?.timezone ?? getDeviceTimezone()
  const successMeasureOf = (measureId: string) => measures.find((measure) => measure.id === measureId)
  const [title, setTitle] = useState(goal?.title ?? '')
  const [kind, setKind] = useState<GoalKind | ''>(goal?.kind ?? '')
  const [progressMeasure, setProgressMeasure] = useState(goal?.progressMeasure ?? '')
  const [successMeasure, setSuccessMeasure] = useState(goal?.success.measure ?? '')
  const [rule, setRule] = useState<SuccessRule | ''>(goal?.success.rule ?? '')
  const initialMeasure = goal ? successMeasureOf(goal.success.measure) : undefined
  const [target, setTarget] = useState(goal && initialMeasure ? targetText(initialMeasure, goal.success.target) : '')
  const [share, setShare] = useState(goal?.success.share === null || goal === null ? '' : String(goal.success.share))
  const [ambition, setAmbition] = useState(goal ? String(goal.ambition) : '')
  const [realism, setRealism] = useState(goal ? String(goal.realism) : '')
  const [start, setStart] = useState(() => fieldsFromInstant(goal?.startUtc ?? new Date().toISOString(), zone))
  const [end, setEnd] = useState(() => (goal ? fieldsFromInstant(goal.endUtc, zone) : { date: '', time: '' }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const measure = successMeasureOf(successMeasure)
  const rules = measure ? rulesFor(measure.kind) : []
  const needsShare = rule !== '' && rule.startsWith('days-')

  async function save() {
    setError('')
    // Messages follow the form from top to bottom (validateGoal's order);
    // the target and dates keep their precise messages.
    const parsedTarget = measure ? parseTarget(measure, target) : null
    const startTime = interactionTimeFromFields(start.date, start.time, zone)
    const endTime = interactionTimeFromFields(end.date, end.time, zone)
    const now = nowIso()
    const built: Goal = {
      id: goal?.id ?? crypto.randomUUID(),
      title: title.trim(),
      kind: kind as GoalKind,
      progressMeasure,
      success: { measure: successMeasure, rule: rule as SuccessRule, target: parsedTarget ?? Number.NaN, share: needsShare ? Number(share) : null },
      ambition: Number(ambition),
      realism: Number(realism),
      startUtc: startTime.ok ? startTime.occurredStart : '',
      endUtc: endTime.ok ? endTime.occurredStart : '',
      timezone: zone,
      createdAt: goal?.createdAt ?? now,
      updatedAt: now,
    }
    try {
      validateGoal(built)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : f.somethingMissing
      const field = caught instanceof GoalFieldError ? caught.field : null
      if (field === 'target' && measure) return setError(f.enterTarget(targetHint(measure)))
      if (field === 'dates') {
        if (!startTime.ok) return setError(f.startError(startTime.message))
        if (!endTime.ok) return setError(f.finishError(endTime.message))
      }
      return setError(message)
    }
    setSaving(true)
    try {
      await onSave(built)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : f.saveFailed)
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 id={`${id}-title`} className="text-lg font-semibold">{goal ? f.editTitle : f.addTitle}</h3>
      <p className="text-sm text-slate-500">{f.allRequired}</p>

      <div>
        <label htmlFor={`${id}-goal`} className={label}>{f.what}</label>
        <textarea id={`${id}-goal`} rows={2} value={title} onChange={(event) => setTitle(event.target.value)} className={input} />
      </div>

      <fieldset>
        <legend className={label}>{f.kind}</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {GOAL_KINDS.map((item) => (
            <label key={item} className="flex items-center gap-2">
              <input type="radio" name={`${id}-kind`} checked={kind === item} onChange={() => setKind(item)} />
              {f.kinds[item]}
            </label>
          ))}
        </div>
      </fieldset>

      <MeasureSelect id={`${id}-progress`} value={progressMeasure} onChange={setProgressMeasure} measures={measures} text={f.progressMeasure} />

      <div className="space-y-3 rounded-lg border border-slate-200 p-3">
        <MeasureSelect
          id={`${id}-success`}
          value={successMeasure}
          onChange={(value) => {
            setSuccessMeasure(value)
            setRule('')
            setTarget('')
          }}
          measures={measures}
          text={f.successMeasure}
        />
        {measure && (
          <>
            <div>
              <label htmlFor={`${id}-rule`} className={label}>{f.successMeans}</label>
              <select id={`${id}-rule`} value={rule} onChange={(event) => setRule(event.target.value as SuccessRule)} className={input}>
                <option value="">{f.choose}</option>
                {rules.map((item) => <option key={item} value={item}>{measure.kind === 'binary' ? f.doneShare : RULE_LABELS[item]}</option>)}
              </select>
            </div>
            {measure.kind !== 'binary' && (
              <div>
                <label htmlFor={`${id}-target`} className={label}>{f.target}</label>
                <input id={`${id}-target`} type="text" inputMode="decimal" placeholder={targetHint(measure)} value={target} onChange={(event) => setTarget(event.target.value)} className={input} />
              </div>
            )}
            {needsShare && (
              <div>
                <label htmlFor={`${id}-share`} className={label}>{f.share}</label>
                <input id={`${id}-share`} type="number" min={1} max={100} value={share} onChange={(event) => setShare(event.target.value)} className={input} />
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <RatingSelect id={`${id}-ambition`} value={ambition} onChange={setAmbition} text={f.ambition} hint={f.ambitionHint} />
        <RatingSelect id={`${id}-realism`} value={realism} onChange={setRealism} text={f.realism} hint={f.realismHint} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <DateTime24Field id={`${id}-start`} label={f.start} date={start.date} time={start.time} onDateChange={(date) => setStart({ ...start, date })} onTimeChange={(time) => setStart({ ...start, time })} />
        <DateTime24Field id={`${id}-end`} label={f.finish} date={end.date} time={end.time} onDateChange={(date) => setEnd({ ...end, date })} onTimeChange={(time) => setEnd({ ...end, time })} />
      </div>
      <p className="text-xs text-slate-500">{f.timesIn(zone)}</p>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={saving} onClick={() => void save()} className={primary}>{saving ? t.goals.saving : goal ? f.save : f.add}</button>
        <button type="button" disabled={saving} onClick={onCancel} className={secondary}>{t.common.cancel}</button>
      </div>
    </section>
  )
}
