import { useId, useState } from 'react'

import type { FormEvent } from 'react'

import type { SleepSessionChanges } from '../database/sleepSessions'
import type { SleepSession } from '../database/types'
import { messages } from '../i18n'
import { buildSleepUpdate, initialSleepEditForm } from '../sleep/buildSleepUpdate'
import type { SleepEditForm } from '../sleep/buildSleepUpdate'

import { DateTime24Field } from './DateTime24Field'
import { TimezoneField } from './TimezoneField'

interface SleepEditorProps {
  session: SleepSession
  /** Saves the changed fields. Not called when nothing changed. */
  onSave: (changes: SleepSessionChanges, ambiguousTime: boolean) => Promise<unknown>
  onCancel: () => void
}

/**
 * Edit form for a sleep session, shown inside the Personal Data Log.
 * Imported sessions keep their original times: only the comment can be
 * edited.
 */
export function SleepEditor({ session, onSave, onCancel }: SleepEditorProps) {
  const t = messages()
  const id = useId()
  const [form, setForm] = useState<SleepEditForm>(() => initialSleepEditForm(session))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const manual = session.source === 'manual'

  function update(changes: Partial<SleepEditForm>) {
    setForm((current) => ({ ...current, ...changes }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (saving) {
      return
    }

    setError('')

    let built

    try {
      built = buildSleepUpdate(session, form)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t.editors.readFailed)
      return
    }

    if (Object.keys(built.changes).length === 0) {
      onCancel()
      return
    }

    setSaving(true)

    try {
      await onSave(built.changes, built.ambiguousTime)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t.editors.saveFailed)
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      aria-label={t.editors.editSleep}
      className="space-y-3 rounded-lg bg-slate-50 p-4"
    >
      {manual ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <DateTime24Field
            id={`${id}-bed`}
            label={t.editors.bedtime}
            date={form.startDate}
            time={form.startTime}
            onDateChange={(startDate) => update({ startDate })}
            onTimeChange={(startTime) => update({ startTime })}
          />

          <DateTime24Field
            id={`${id}-wake`}
            label={t.editors.wakeTime}
            date={form.endDate}
            time={form.endTime}
            onDateChange={(endDate) => update({ endDate })}
            onTimeChange={(endTime) => update({ endTime })}
          />

          <TimezoneField
            id={`${id}-timezone`}
            value={form.timezone}
            onChange={(timezone) => update({ timezone })}
            help={t.editors.whereSlept}
          />
        </div>
      ) : (
        <p className="text-xs text-slate-600">
          {t.editors.importedSleepNote}
        </p>
      )}

      <div>
        <label htmlFor={`${id}-comment`} className="mb-1 block text-xs font-medium text-slate-600">
          {t.common.commentOptional}
        </label>
        <textarea
          id={`${id}-comment`}
          rows={4}
          maxLength={2000}
          value={form.comment}
          onChange={(event) => update({ comment: event.target.value })}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? t.common.saving : t.editors.saveChanges}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
        >
          {t.common.cancel}
        </button>
      </div>
    </form>
  )
}
