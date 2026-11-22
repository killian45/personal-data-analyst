import { useId, useState } from 'react'

import type { GoalsProfile } from '../../goals/goals'
import { messages } from '../../i18n'

interface ProfileFormProps {
  profile: GoalsProfile
  onSave: (profile: GoalsProfile) => Promise<void>
  onClose: () => void
}

const input = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'
const label = 'mb-1 block text-xs font-medium text-slate-600'
const primary = 'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
const secondary = 'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50'

/** Texts: messages().goals.profile.fields. */
const FIELDS: readonly Exclude<keyof GoalsProfile, 'epochs'>[] = ['virtues', 'faults', 'futurePlan', 'aiStyle', 'aiFormat']

/** "Set up AI": context for the local AI, every field optional (docs/GOALS_PLAN.md). */
export function ProfileForm({ profile, onSave, onClose }: ProfileFormProps) {
  const t = messages()
  const p = t.goals.profile
  const id = useId()
  const [draft, setDraft] = useState<GoalsProfile>(profile)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setError('')
    setSaving(true)
    try {
      await onSave(draft)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : p.saveFailed)
      setSaving(false)
    }
  }

  const setEpoch = (index: number, field: 'title' | 'text', value: string) =>
    setDraft({ ...draft, epochs: draft.epochs.map((epoch, i) => (i === index ? { ...epoch, [field]: value } : epoch)) })

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h3 id={`${id}-title`} className="text-lg font-semibold">{p.title}</h3>
        <p className="mt-1 text-sm text-slate-500">
          {p.intro}
        </p>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{p.past}</legend>
        <p className="text-xs text-slate-500">{p.pastHint}</p>
        {draft.epochs.map((epoch, index) => (
          <div key={index} className="space-y-2 rounded-lg border border-slate-200 p-3">
            <label htmlFor={`${id}-epoch-${index}`} className={label}>{p.epochName(index + 1)}</label>
            <input id={`${id}-epoch-${index}`} type="text" value={epoch.title} onChange={(event) => setEpoch(index, 'title', event.target.value)} className={input} />
            <label htmlFor={`${id}-epoch-text-${index}`} className={label}>{p.epochText}</label>
            <textarea id={`${id}-epoch-text-${index}`} rows={3} value={epoch.text} onChange={(event) => setEpoch(index, 'text', event.target.value)} className={input} />
            <button type="button" onClick={() => setDraft({ ...draft, epochs: draft.epochs.filter((_, i) => i !== index) })} className={secondary}>
              {p.removeEpoch}
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setDraft({ ...draft, epochs: [...draft.epochs, { title: '', text: '' }] })} className={secondary}>
          {p.addEpoch}
        </button>
      </fieldset>

      {FIELDS.map((field) => (
        <div key={field}>
          <label htmlFor={`${id}-${field}`} className={label}>{p.fields[field].title}</label>
          <p className="mb-1 text-xs text-slate-500">{p.fields[field].hint}</p>
          <textarea id={`${id}-${field}`} rows={3} value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} className={input} />
        </div>
      ))}

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={saving} onClick={() => void save()} className={primary}>{saving ? t.goals.saving : p.save}</button>
        <button type="button" disabled={saving} onClick={onClose} className={secondary}>{t.common.close}</button>
      </div>
    </section>
  )
}
