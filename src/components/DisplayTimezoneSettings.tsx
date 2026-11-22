import { useId, useState } from 'react'

import type { FormEvent } from 'react'

import type { DisplayTimezone } from '../settings/displayTimezone'
import { messages } from '../i18n'
import { getDeviceTimezone } from '../time/time'

import { TimezoneField } from './TimezoneField'

interface DisplayTimezoneSettingsProps {
  value: DisplayTimezone

  /** Saves the new setting. Rejects with an Error whose message is shown. */
  onSave: (value: DisplayTimezone) => Promise<unknown>
}

type Mode = 'event' | 'device' | 'fixed'

function modeOf(value: DisplayTimezone): Mode {
  return value === 'event' || value === 'device' ? value : 'fixed'
}

/**
 * Lets the user choose in which timezone dates and times are displayed.
 * Stored entries keep their own event timezone whatever is chosen here.
 */
export function DisplayTimezoneSettings({ value, onSave }: DisplayTimezoneSettingsProps) {
  const t = messages().settings
  const d = t.displayTimezone
  const id = useId()
  const deviceTimezone = getDeviceTimezone()

  const [mode, setMode] = useState<Mode>(modeOf(value))
  const [fixedZone, setFixedZone] = useState(
    modeOf(value) === 'fixed' ? value : deviceTimezone,
  )
  // Follow the saved setting when it changes (e.g. once it has loaded),
  // without resetting messages.
  const [syncedValue, setSyncedValue] = useState(value)

  if (value !== syncedValue) {
    setSyncedValue(value)
    setMode(modeOf(value))

    if (modeOf(value) === 'fixed') {
      setFixedZone(value)
    }
  }

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setConfirmation('')
    setSaving(true)

    try {
      await onSave(mode === 'fixed' ? fixedZone.trim() : mode)
      setConfirmation(d.saved)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : d.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const options: { mode: Mode; label: string; help: string }[] = [
    {
      mode: 'event',
      label: d.event.label,
      help: d.event.help,
    },
    {
      mode: 'device',
      label: d.device.label(deviceTimezone),
      help: d.device.help,
    },
    {
      mode: 'fixed',
      label: d.fixed.label,
      help: d.fixed.help,
    },
  ]

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{d.title}</h3>

      <p className="mt-1 text-sm text-slate-500">
        {d.intro}
      </p>

      <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 space-y-3">
        <fieldset className="space-y-3">
          <legend className="sr-only">{d.showTimesIn}</legend>

          {options.map((option) => (
            <label key={option.mode} className="flex items-start gap-3 text-sm">
              <input
                type="radio"
                name={`${id}-mode`}
                value={option.mode}
                checked={mode === option.mode}
                onChange={() => setMode(option.mode)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">{option.label}</span>
                <span className="block text-xs text-slate-500">{option.help}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {mode === 'fixed' && (
          <div className="max-w-sm">
            <TimezoneField
              id={`${id}-zone`}
              value={fixedZone}
              onChange={setFixedZone}
              help={d.fixedHelp}
            />
          </div>
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

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? t.saving : d.save}
        </button>
      </form>
    </section>
  )
}
