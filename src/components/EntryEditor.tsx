import { useId, useState } from 'react'

import type { FormEvent } from 'react'

import type { UpdateEntryInput } from '../database/entries'
import type { Entry, Habit } from '../database/types'
import { messages } from '../i18n'
import {
  buildEntryUpdate,
  hasPauses,
  initialEditForm,
} from '../log/buildEntryUpdate'
import type { EntryEditForm } from '../log/buildEntryUpdate'

import { DateTime24Field } from './DateTime24Field'
import { TimezoneField } from './TimezoneField'

interface EntryEditorProps {
  entry: Entry
  habit: Habit

  /**
   * Saves the changed fields. Rejects with an Error whose message is
   * shown. Not called when nothing changed.
   */
  onSave: (changes: UpdateEntryInput, ambiguousTime: boolean) => Promise<unknown>
  onCancel: () => void
}

const fieldClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'

/**
 * Edit form for one entry, shown inside the Personal Data Log.
 */
export function EntryEditor({ entry, habit, onSave, onCancel }: EntryEditorProps) {
  const t = messages()
  const id = useId()
  const [form, setForm] = useState<EntryEditForm>(() => initialEditForm(entry))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function update(changes: Partial<EntryEditForm>) {
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
      built = buildEntryUpdate(entry, habit, form)
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

  const paused = hasPauses(entry)

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      aria-label={t.editors.editEntry(habit.name)}
      className="space-y-3 rounded-lg bg-slate-50 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {habit.type === 'number' && (
          <div>
            <label htmlFor={`${id}-value`} className="mb-1 block text-xs font-medium text-slate-600">
              {t.editors.valueWithUnit(habit.unit)}
            </label>
            <input
              id={`${id}-value`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={String(form.rawValue)}
              onChange={(event) => update({ rawValue: event.target.value })}
              className={fieldClass}
            />
          </div>
        )}

        {habit.type === 'checkbox' && (
          <div>
            <label htmlFor={`${id}-value`} className="mb-1 block text-xs font-medium text-slate-600">
              {t.editors.value}
            </label>
            <select
              id={`${id}-value`}
              value={form.rawValue ? 'done' : 'not-done'}
              onChange={(event) => update({ rawValue: event.target.value === 'done' })}
              className={fieldClass}
            >
              <option value="done">{t.editors.done}</option>
              <option value="not-done">{t.editors.notDone}</option>
            </select>
          </div>
        )}

        {habit.type === 'label' && (
          <div>
            <label htmlFor={`${id}-value`} className="mb-1 block text-xs font-medium text-slate-600">
              {t.editors.value}
            </label>
            <select
              id={`${id}-value`}
              value={String(form.rawValue)}
              onChange={(event) => update({ rawValue: event.target.value })}
              className={fieldClass}
            >
              {habit.labelOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        )}

        {habit.type === 'text' && (
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-value`} className="mb-1 block text-xs font-medium text-slate-600">
              {t.editors.text}
            </label>
            <textarea
              id={`${id}-value`}
              rows={3}
              value={String(form.rawValue)}
              onChange={(event) => update({ rawValue: event.target.value })}
              className={fieldClass}
            />
          </div>
        )}

        <DateTime24Field
          id={`${id}-start`}
          label={habit.type === 'stopwatch' ? t.editors.start : t.editors.dateAndTime}
          date={form.date}
          time={form.time}
          onDateChange={(date) => update({ date })}
          onTimeChange={(time) => update({ time })}
        />

        {habit.type === 'stopwatch' && (
          <DateTime24Field
            id={`${id}-end`}
            label={t.editors.end}
            date={form.endDate}
            time={form.endTime}
            onDateChange={(endDate) => update({ endDate })}
            onTimeChange={(endTime) => update({ endTime })}
          />
        )}

        {paused && (
          <p className="text-xs text-slate-600 sm:col-span-2">
            {t.editors.pausesNote}
          </p>
        )}

        <TimezoneField
          id={`${id}-timezone`}
          value={form.timezone}
          onChange={(timezone) => update({ timezone })}
        />

        <div className="sm:col-span-2">
          <label htmlFor={`${id}-comment`} className="mb-1 block text-xs font-medium text-slate-600">
            {t.common.commentOptional}
          </label>
          <textarea
            id={`${id}-comment`}
            rows={4}
            maxLength={2000}
            value={form.comment}
            onChange={(event) => update({ comment: event.target.value })}
            className={fieldClass}
          />
        </div>
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
