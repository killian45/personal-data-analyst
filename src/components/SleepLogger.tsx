import { commentTemplate } from '../logging/commentTemplate'
import { messages } from '../i18n'
import { useId, useState } from 'react'

import type { FormEvent } from 'react'

import type { ManualSleepInput } from '../database/sleepSessions'
import { formatDateDMY } from '../logging/dateTimeInput'
import { buildSleepInput, LONG_SLEEP_MS } from '../sleep/buildSleepInput'
import type { SleepForm } from '../sleep/buildSleepInput'
import { formatDuration } from '../stopwatch/duration'
import { formatInTimezone, getDeviceTimezone, utcToLocalDateTime } from '../time/time'

import { DateTime24Field } from './DateTime24Field'
import { TimezoneField } from './TimezoneField'

interface SleepLoggerProps {
  /** Saves the session. Rejects with an Error whose message is shown. */
  onCreateSleep: (input: ManualSleepInput) => Promise<unknown>
}

/** Yesterday 23:00 → today 07:00 in the device timezone. */
function lastNightDefaults(): Pick<SleepForm, 'startDate' | 'startTime' | 'endDate' | 'endTime'> {
  const zone = getDeviceTimezone()
  const today = utcToLocalDateTime(new Date().toISOString(), zone).slice(0, 10)
  const [year, month, day] = today.split('-').map(Number)
  const yesterday = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)

  return {
    startDate: formatDateDMY(yesterday),
    startTime: '23:00',
    endDate: formatDateDMY(today),
    endTime: '07:00',
  }
}

/**
 * "Log sleep": enter a bedtime and a wake time by hand, until automatic
 * imports are available. Saved as a manual sleep session.
 */
export function SleepLogger({ onCreateSleep }: SleepLoggerProps) {
  const t = messages()
  const id = useId()

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<SleepForm>({
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

  function update(changes: Partial<SleepForm>) {
    setForm((current) => ({ ...current, ...changes }))
  }

  function openForm() {
    update(lastNightDefaults())
    setError('')
    setConfirmation('')
    setOpen(true)
  }

  let previewMs: number | null = null

  try {
    previewMs = buildSleepInput(form).durationMs
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
      built = buildSleepInput(form)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t.sleepLogger.readFailed)
      return
    }

    setSaving(true)

    try {
      await onCreateSleep(built.input)

      const zone = built.input.timezone ?? form.timezone
      const bedtime = formatInTimezone(built.input.startUtc, zone, 'd MMM, HH:mm')
      const wake = formatInTimezone(built.input.endUtc, zone, 'd MMM, HH:mm')

      setConfirmation(
        t.sleepLogger.saved(bedtime, wake, formatDuration(built.durationMs)) +
          (built.ambiguousTime ? ` ${t.common.clocksWentBack}` : ''),
      )
      setOpen(false)
      update({ comment: commentTemplate() })
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t.sleepLogger.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mb-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t.sleepLogger.title}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {t.sleepLogger.intro}
          </p>
        </div>

        {!open && (
          <button
            type="button"
            onClick={openForm}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {t.sleepLogger.logSleep}
          </button>
        )}
      </div>

      {confirmation && (
        <p role="status" className="mt-4 text-sm text-green-700">
          {confirmation}
        </p>
      )}

      {open && (
        <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <DateTime24Field
              id={`${id}-bed`}
              label={t.sleepLogger.bedtime}
              date={form.startDate}
              time={form.startTime}
              onDateChange={(startDate) => update({ startDate })}
              onTimeChange={(startTime) => update({ startTime })}
            />

            <DateTime24Field
              id={`${id}-wake`}
              label={t.sleepLogger.wakeTime}
              date={form.endDate}
              time={form.endTime}
              onDateChange={(endDate) => update({ endDate })}
              onTimeChange={(endTime) => update({ endTime })}
            />

            <TimezoneField
              id={`${id}-timezone`}
              value={form.timezone}
              onChange={(timezone) => update({ timezone })}
              help={t.sleepLogger.whereSlept}
            />

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
          </div>

          <p className="text-sm text-slate-700" aria-live="polite">
            {previewMs === null ? t.sleepLogger.timeInBedNone : t.sleepLogger.timeInBed(formatDuration(previewMs))}
          </p>

          {previewMs !== null && previewMs > LONG_SLEEP_MS && (
            <p className="text-xs text-amber-700">
              {t.sleepLogger.tooLong}
            </p>
          )}

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
              {saving ? t.common.saving : t.sleepLogger.save}
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
      )}
    </section>
  )
}
