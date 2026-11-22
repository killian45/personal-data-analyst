import { commentTemplate } from '../logging/commentTemplate'
import { messages } from '../i18n'
import { useId, useState } from 'react'

import type { FormEvent } from 'react'

import type { CreateEntryInput } from '../database/entries'
import type { Habit } from '../database/types'
import {
  buildStopwatchSessionInput,
  LONG_SESSION_MS,
} from '../logging/buildStopwatchSessionInput'
import type { StopwatchSessionForm } from '../logging/buildStopwatchSessionInput'
import { splitLocalDateTime } from '../logging/dateTimeInput'
import { formatDuration } from '../stopwatch/duration'
import {
  formatInTimezone,
  getDeviceTimezone,
  isValidTimezone,
  utcToLocalDateTime,
} from '../time/time'

import { DateTime24Field } from './DateTime24Field'
import { TimezoneField } from './TimezoneField'

interface StopwatchSessionLoggerProps {
  habit: Habit

  /** Saves the entry. Rejects with an Error whose message is shown. */
  onCreateEntry: (input: CreateEntryInput) => Promise<unknown>
}

const DEFAULT_SESSION_MS = 60 * 60 * 1000

/**
 * "Log a past session" for stopwatch habits: enter a start and an end
 * instead of using the live stopwatch. Saves a single active period.
 */
export function StopwatchSessionLogger({
  habit,
  onCreateEntry,
}: StopwatchSessionLoggerProps) {
  const t = messages()
  const id = useId()

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<StopwatchSessionForm>({
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    timezone: getDeviceTimezone(),
    comment: commentTemplate(),
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState('')

  function update(changes: Partial<StopwatchSessionForm>) {
    setForm((current) => ({ ...current, ...changes }))
  }

  /** Pre-fills the last hour, ending now, in the chosen timezone. */
  function openForm() {
    const zone = isValidTimezone(form.timezone.trim())
      ? form.timezone.trim()
      : getDeviceTimezone()

    const nowMs = Date.now()
    const start = splitLocalDateTime(
      utcToLocalDateTime(new Date(nowMs - DEFAULT_SESSION_MS).toISOString(), zone),
    )
    const end = splitLocalDateTime(
      utcToLocalDateTime(new Date(nowMs).toISOString(), zone),
    )

    update({
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time,
    })
    setError('')
    setConfirmation('')
    setOpen(true)
  }

  // Live preview of the duration, or nothing while the form is incomplete.
  let previewMs: number | null = null

  try {
    previewMs = buildStopwatchSessionInput(habit, form).durationMs
  } catch {
    previewMs = null
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (saving) {
      return
    }

    setError('')
    setConfirmation('')

    let built

    try {
      built = buildStopwatchSessionInput(habit, form)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : t.stopwatchLogger.readFailed,
      )
      return
    }

    setSaving(true)

    try {
      await onCreateEntry(built.input)

      const when = formatInTimezone(
        built.input.occurredStart ?? '',
        built.input.timezone ?? form.timezone,
        'd MMM, HH:mm',
      )

      setConfirmation(
        t.stopwatchLogger.saved(formatDuration(built.durationMs), when) +
          (built.ambiguousTime ? ` ${t.common.clocksWentBack}` : ''),
      )
      update({ comment: commentTemplate() })
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : t.stopwatchLogger.saveFailed,
      )
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={openForm}
          className="text-xs font-medium text-blue-700 hover:underline"
        >
          {t.stopwatchLogger.logPast}
        </button>

        {confirmation && (
          <p role="status" className="mt-2 text-xs text-green-700">
            {confirmation}
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="mt-4 space-y-3 border-t border-slate-200 pt-4"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {t.stopwatchLogger.logPast}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <DateTime24Field
          id={`${id}-start`}
          label={t.stopwatchLogger.start}
          date={form.startDate}
          time={form.startTime}
          onDateChange={(startDate) => update({ startDate })}
          onTimeChange={(startTime) => update({ startTime })}
        />

        <DateTime24Field
          id={`${id}-end`}
          label={t.stopwatchLogger.end}
          date={form.endDate}
          time={form.endTime}
          onDateChange={(endDate) => update({ endDate })}
          onTimeChange={(endTime) => update({ endTime })}
        />
      </div>

      <TimezoneField
        id={`${id}-timezone`}
        value={form.timezone}
        onChange={(timezone) => update({ timezone })}
      />

      <div>
        <label
          htmlFor={`${id}-comment`}
          className="mb-1 block text-xs font-medium text-slate-600"
        >
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

      <p className="text-sm text-slate-700" aria-live="polite">
        {previewMs === null
          ? t.stopwatchLogger.durationNone
          : t.stopwatchLogger.duration(formatDuration(previewMs))}
      </p>

      {previewMs !== null && previewMs > LONG_SESSION_MS && (
        <p className="text-xs text-amber-700">
          {t.stopwatchLogger.tooLong}
        </p>
      )}

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

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? t.common.saving : t.stopwatchLogger.save}
        </button>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-100"
        >
          {t.common.close}
        </button>
      </div>
    </form>
  )
}
