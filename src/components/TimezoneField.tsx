import { useState } from 'react'
import { messages } from '../i18n'

interface TimezoneFieldProps {
  id: string
  value: string
  onChange: (timezone: string) => void
  /** Help text under the field. */
  help?: string
  /** Field label (default "Timezone"). */
  label?: string
}

function listTimezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
}

/**
 * Text field for an IANA timezone, with suggestions from the browser.
 */
export function TimezoneField({
  id,
  value,
  onChange,
  help = messages().fields.timezoneHelp,
  label = messages().fields.timezone,
}: TimezoneFieldProps) {
  // The list is large; compute it once per field.
  const [timezones] = useState(listTimezones)

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-medium text-slate-600"
      >
        {label}
      </label>

      <input
        id={id}
        type="text"
        list={`${id}-options`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
      />

      <datalist id={`${id}-options`}>
        {timezones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>

      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  )
}
