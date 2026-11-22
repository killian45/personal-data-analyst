import { parseDateDMY } from '../logging/dateTimeInput'
import { messages } from '../i18n'

interface DateDMYFieldProps {
  id: string
  /** Accessible label of the input. */
  label: string
  value: string
  onChange: (text: string) => void
  /** Show the label visibly above the field (default: screen readers only). */
  showLabel?: boolean
  className?: string
}

/**
 * Date typed as dd/mm/yyyy, whatever the browser language.
 * Also accepts "9/11/2026", "09.11.2026" and "09-11-2026".
 */
export function DateDMYField({
  id,
  label,
  value,
  onChange,
  showLabel = false,
  className = '',
}: DateDMYFieldProps) {
  const t = messages()
  const invalid = value.trim() !== '' && parseDateDMY(value) === null

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={
          showLabel ? 'mb-1 block text-xs font-medium text-slate-600' : 'sr-only'
        }
      >
        {label}
      </label>

      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={t.fields.datePlaceholder}
        maxLength={10}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        className={`w-full rounded-md border bg-white px-3 py-2 text-sm tabular-nums ${
          invalid ? 'border-red-400' : 'border-slate-300'
        }`}
      />

      {invalid && (
        <p className="mt-1 text-xs text-red-700">
          {t.fields.dateInvalid}
        </p>
      )}
    </div>
  )
}
