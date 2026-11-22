import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { contactChanges, formFromContact, isContactFormDirty } from '../../crm/contactForm'
import { deleteContact, updateContact } from '../../database/contacts'
import type { Contact } from '../../database/types'
import type { DisplayTimezone } from '../../settings/displayTimezone'
import { messages } from '../../i18n'

import { ContactDetailsFields } from './ContactDetailsFields'
import { InteractionLog } from './InteractionLog'

interface ContactCardProps {
  contact: Contact
  displayTimezone: DisplayTimezone
  /** Changes when data changed elsewhere (sync): the interaction log reloads. */
  dataVersion: number
  onSaved: (contact: Contact) => void
  onDeleted: (contact: Contact) => void
  /** Tells the page whether there are unsaved changes (to warn before leaving the contact). */
  onDirtyChange: (dirty: boolean) => void
}

const primaryButton =
  'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50'
const dangerButton =
  'rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50'

/**
 * One contact: editable details (only the fields that really changed are
 * saved), deletion with a confirmation step, and the interaction log.
 */
export function ContactCard({ contact, displayTimezone, dataVersion, onSaved, onDeleted, onDirtyChange }: ContactCardProps) {
  const t = messages().crm
  const c = t.card
  const [saved, setSaved] = useState(contact)
  const [form, setForm] = useState(() => formFromContact(contact))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  const dirty = isContactFormDirty(saved, form)
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  // A newer version arrived (e.g. edited on another device): show it,
  // unless the user is editing — then the edits stay, and saving sends
  // only the fields the user changed.
  if (!dirty && (contact.revision !== saved.revision || contact.updatedAt !== saved.updatedAt)) {
    setSaved(contact)
    setForm(formFromContact(contact))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setStatus('')
    const result = contactChanges(saved, form)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setSaving(true)
    try {
      const updated = await updateContact(saved.id, result.changes)
      setSaved(updated)
      setForm(formFromContact(updated))
      setStatus(c.changesSaved)
      onSaved(updated)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : c.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setError('')
    try {
      await deleteContact(saved.id)
      onDirtyChange(false)
      onDeleted(saved)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : c.deleteFailed)
      setConfirmDelete(false)
    }
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="break-words text-xl font-semibold">{saved.name}</h3>
      {saved.externalPhoneId !== null && <p className="mt-1 text-xs text-slate-500">{c.importedFromPhone}</p>}

      <form onSubmit={(event) => void save(event)} className="mt-5 space-y-4">
        <ContactDetailsFields
          values={form}
          onChange={(values) => {
            setForm(values)
            setStatus('')
          }}
        />

        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {status && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{status}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={!dirty || saving} className={primaryButton}>
            {saving ? t.saving : c.saveChanges}
          </button>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => {
              setForm(formFromContact(saved))
              setError('')
            }}
            className={secondaryButton}
          >
            {c.cancelChanges}
          </button>

          <span className="ml-auto flex gap-2">
            {confirmDelete ? (
              <>
                <button type="button" onClick={() => void remove()} className={dangerButton}>{c.confirmDelete}</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className={secondaryButton}>{c.keep}</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className={dangerButton}>{c.deleteContact}</button>
            )}
          </span>
        </div>
        {confirmDelete && (
          <p className="text-xs text-slate-500">
            {c.deleteNote}
          </p>
        )}
      </form>

      <InteractionLog contactId={saved.id} contactName={saved.name} displayTimezone={displayTimezone} dataVersion={dataVersion} />
    </article>
  )
}
