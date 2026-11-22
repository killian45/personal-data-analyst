import { parseTime24 } from '../logging/dateTimeInput'
import { messages } from '../i18n'

import { DateDMYField } from './DateDMYField'

interface DateTime24FieldProps {
  /** Base id; the inputs use `${id}-date` and `${id}-time`. */
  id: string
  label: string
  date: string
  time: string
  onDateChange: (date: string) => void
  onTimeChange: (time: string) => void
}

/**
 * A date field (dd/mm/yyyy) plus a 24-hour time field.
 *
 * Both are typed as text so the app always uses day/month/year and the
 * 24-hour clock, whatever the browser language.
 */
export function DateTime24Field({
  id,
  label,
  date,
  time,
  onDateChange,
  onTimeChange,
}: DateTime24FieldProps) {
  const t = messages()
  const timeInvalid = time.trim() !== '' && parseTime24(time) === null

  return (
    <fieldset>
      <legend className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </legend>

      <div className="flex items-start gap-2">
        <DateDMYField
          id={`${id}-date`}
          label={t.fields.dateLabel(label)}
          value={date}
          onChange={onDateChange}
          className="min-w-0 flex-1"
        />

        <label htmlFor={`${id}-time`} className="sr-only">
          {t.fields.timeLabel(label)}
        </label>

        <input
          id={`${id}-time`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={t.fields.timePlaceholder}
          maxLength={5}
          value={time}
          onChange={(event) => onTimeChange(event.target.value)}
          aria-invalid={timeInvalid}
          className={`w-20 rounded-md border bg-white px-3 py-2 text-sm tabular-nums ${
            timeInvalid ? 'border-red-400' : 'border-slate-300'
          }`}
        />
      </div>

      {timeInvalid && (
        <p className="mt-1 text-xs text-red-700">
          {t.fields.timeInvalid}
        </p>
      )}
    </fieldset>
  )
}
