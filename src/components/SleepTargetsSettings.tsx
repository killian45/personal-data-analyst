import { useEffect, useId, useState } from 'react'

import type { FormEvent } from 'react'

import {
  formatDurationHM,
  loadSleepTargets,
  saveSleepTargets,
} from '../settings/sleepTargets'
import type { SleepTargetTexts } from '../settings/sleepTargets'
import { messages } from '../i18n'

const fieldClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums'

/**
 * Optional sleep targets, used by the dashboard to show how far values
 * are from them (RMSD split into bias and spread).
 */
export function SleepTargetsSettings() {
  const t = messages().settings
  const s = t.sleepTargets
  const id = useId()
  const [texts, setTexts] = useState<SleepTargetTexts | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState('')

  useEffect(() => {
    let cancelled = false

    loadSleepTargets()
      .then((targets) => {
        if (!cancelled) {
          setTexts({
            sleepDuration:
              targets.sleepDurationMinutes === null ? '' : formatDurationHM(targets.sleepDurationMinutes),
            bedtime: targets.bedtime ?? '',
            wakeTime: targets.wakeTime ?? '',
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(messages().settings.sleepTargets.loadFailed)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!texts) {
      return
    }

    setError('')
    setConfirmation('')
    setSaving(true)

    try {
      await saveSleepTargets(texts)
      setConfirmation(s.saved)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : s.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const fields: { key: keyof SleepTargetTexts; label: string; placeholder: string }[] = (
    ['sleepDuration', 'bedtime', 'wakeTime'] as const
  ).map((key) => ({ key, ...s.fields[key] }))

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{s.title}</h3>

      <p className="mt-1 text-sm text-slate-500">
        {s.intro}
      </p>

      {texts && (
        <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {fields.map((field) => (
              <div key={field.key}>
                <label htmlFor={`${id}-${field.key}`} className="mb-1 block text-xs font-medium text-slate-600">
                  {field.label}
                </label>
                <input
                  id={`${id}-${field.key}`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={5}
                  placeholder={field.placeholder}
                  value={texts[field.key]}
                  onChange={(event) => setTexts({ ...texts, [field.key]: event.target.value })}
                  className={fieldClass}
                />
              </div>
            ))}
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-700">
              {error}
            </p>
          )}

          {confirmation && (
            <p role="status" className="text-xs text-green-700">
              {confirmation}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t.saving : s.save}
          </button>
        </form>
      )}
    </section>
  )
}
