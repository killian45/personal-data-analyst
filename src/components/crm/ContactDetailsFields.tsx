import { useId } from 'react'

import { CONTACT_FIELD_LABELS } from '../../crm/contactFields'
import { parseBirthdayInput } from '../../crm/contactForm'
import type { ContactFormValues } from '../../crm/contactForm'
import { messages } from '../../i18n'

interface ContactDetailsFieldsProps {
  values: ContactFormValues
  onChange: (values: ContactFormValues) => void
}

const inputBase = 'w-full rounded-md border bg-white px-3 py-2 text-sm'
const inputClass = `${inputBase} border-slate-300`
const labelClass = 'mb-1 block text-xs font-medium text-slate-600'

/** The editable details of a contact (new contact form and contact card). */
export function ContactDetailsFields({ values, onChange }: ContactDetailsFieldsProps) {
  const t = messages().crm.fields
  const id = useId()
  const set = (field: keyof ContactFormValues) => (value: string) => onChange({ ...values, [field]: value })
  const birthdayInvalid = !parseBirthdayInput(values.birthday).ok

  const textArea = (field: 'description' | 'interests' | 'dislikes' | 'address' | 'education', rows: number) => (
    <div>
      <label htmlFor={`${id}-${field}`} className={labelClass}>{CONTACT_FIELD_LABELS[field]}</label>
      <textarea
        id={`${id}-${field}`}
        rows={rows}
        value={values[field]}
        onChange={(event) => set(field)(event.target.value)}
        className={inputClass}
      />
    </div>
  )

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor={`${id}-name`} className={labelClass}>{t.required(CONTACT_FIELD_LABELS.name)}</label>
        <input
          id={`${id}-name`}
          type="text"
          autoComplete="off"
          value={values.name}
          onChange={(event) => set('name')(event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={`${id}-birthday`} className={labelClass}>{CONTACT_FIELD_LABELS.birthday}</label>
        <input
          id={`${id}-birthday`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={t.birthdayPlaceholder}
          maxLength={10}
          value={values.birthday}
          onChange={(event) => set('birthday')(event.target.value)}
          aria-invalid={birthdayInvalid}
          className={`${inputBase} tabular-nums ${birthdayInvalid ? 'border-red-400' : 'border-slate-300'}`}
        />
        {birthdayInvalid && (
          <p className="mt-1 text-xs text-red-700">{t.birthdayInvalid}</p>
        )}
      </div>

      <div className="sm:col-span-2">{textArea('description', 3)}</div>
      {textArea('education', 2)}
      {textArea('address', 2)}
      {textArea('interests', 3)}
      {textArea('dislikes', 3)}
    </div>
  )
}
