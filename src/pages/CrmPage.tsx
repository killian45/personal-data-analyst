import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { ContactCard } from '../components/crm/ContactCard'
import { ContactDetailsFields } from '../components/crm/ContactDetailsFields'
import { PageHeading } from '../components/layout/PageHeading'
import { EMPTY_CONTACT_FORM, filterContacts, formatBirthdayInput, newContactInput } from '../crm/contactForm'
import { createContact, getContacts, restoreContact } from '../database/contacts'
import type { Contact } from '../database/types'
import { messages } from '../i18n'
import type { DisplayTimezone } from '../settings/displayTimezone'

interface CrmPageProps {
  displayTimezone: DisplayTimezone
  /** Changes when data changed elsewhere (sync, restore): reload in place. */
  dataVersion?: number
}

const primaryButton =
  'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50'

type View = { kind: 'none' } | { kind: 'new' } | { kind: 'contact'; id: string }

/**
 * Personal CRM: a searchable list of contacts, a card for the chosen
 * contact (details and interaction log) and a form for new contacts.
 * On narrow screens the list and the card are shown one at a time.
 */
export default function CrmPage({ displayTimezone, dataVersion = 0 }: CrmPageProps) {
  const t = messages().crm
  const id = useId()
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>({ kind: 'none' })
  const [error, setError] = useState('')
  const [status, setStatus] = useState<{ message: string; undoId?: string } | null>(null)
  const dirtyRef = useRef(false)

  const reload = useCallback(async () => setContacts(await getContacts()), [])

  useEffect(() => {
    let cancelled = false
    getContacts()
      .then((loaded) => {
        if (!cancelled) setContacts(loaded)
      })
      .catch((caught: unknown) => {
        console.error('Failed to load contacts:', caught)
        if (!cancelled) setError(messages().crm.loadFailed)
      })
    return () => {
      cancelled = true
    }
  }, [dataVersion])

  const onDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty
  }, [])

  /** Changes what is shown, asking first if the open contact has unsaved changes. */
  function show(next: View) {
    if (dirtyRef.current && !window.confirm(t.confirmLeave)) return
    dirtyRef.current = false
    setStatus(null)
    setView(next)
  }

  async function undoDelete(contactId: string) {
    setError('')
    try {
      await restoreContact(contactId)
      await reload()
      setStatus(null)
      setView({ kind: 'contact', id: contactId })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.restoreFailed)
    }
  }

  const shown = contacts ? filterContacts(contacts, query) : []
  const selected = view.kind === 'contact' ? contacts?.find((contact) => contact.id === view.id) ?? null : null
  const detailOpen = view.kind === 'new' || selected !== null

  return (
    <section>
      <PageHeading title={t.title} description={t.description} />

      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {status && (
        <p role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">
          <span>{status.message}</span>
          {status.undoId && (
            <button type="button" onClick={() => void undoDelete(status.undoId as string)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100">
              {t.undo}
            </button>
          )}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className={detailOpen ? 'hidden lg:block' : ''}>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor={`${id}-search`} className="mb-1 block text-xs font-medium text-slate-600">{t.searchContacts}</label>
                <input
                  id={`${id}-search`}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t.searchPlaceholder}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </div>
              <button type="button" onClick={() => show({ kind: 'new' })} className={primaryButton}>{t.newContact}</button>
            </div>

            {contacts === null ? (
              !error && <p className="mt-4 text-sm text-slate-500">{t.loading}</p>
            ) : contacts.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">{t.noContacts}</p>
            ) : (
              <>
                <p className="mt-3 text-xs text-slate-500">
                  {query.trim() ? t.countFiltered(shown.length, contacts.length) : t.count(contacts.length)}
                </p>
                {shown.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">{t.noMatch}</p>
                ) : (
                  <ul aria-label={t.contacts} className="mt-2 max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200">
                    {shown.map((contact) => {
                      const active = view.kind === 'contact' && view.id === contact.id
                      return (
                        <li key={contact.id} className="border-b border-slate-200 last:border-b-0">
                          <button
                            type="button"
                            onClick={() => show({ kind: 'contact', id: contact.id })}
                            aria-current={active ? 'true' : undefined}
                            className={`block w-full px-3 py-2 text-left text-sm ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                          >
                            <span className="block break-words font-medium">{contact.name}</span>
                            {(contact.birthday || contact.interests) && (
                              <span className="block truncate text-xs text-slate-500">
                                {[contact.birthday ? t.birthday(formatBirthdayInput(contact.birthday)) : '', contact.interests ?? ''].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>

        <div className={detailOpen ? '' : 'hidden lg:block'}>
          {detailOpen && (
            <button type="button" onClick={() => show({ kind: 'none' })} className={`mb-3 lg:hidden ${secondaryButton}`}>
              {t.allContacts}
            </button>
          )}

          {view.kind === 'new' ? (
            <NewContactForm
              onDirtyChange={onDirtyChange}
              onCancel={() => show({ kind: 'none' })}
              onCreated={async (contact) => {
                dirtyRef.current = false
                await reload()
                setQuery('')
                setView({ kind: 'contact', id: contact.id })
                setStatus({ message: t.created(contact.name) })
              }}
            />
          ) : selected ? (
            <ContactCard
              key={selected.id}
              contact={selected}
              displayTimezone={displayTimezone}
              dataVersion={dataVersion}
              onDirtyChange={onDirtyChange}
              onSaved={(updated) => setContacts((current) => current?.map((contact) => (contact.id === updated.id ? updated : contact)) ?? null)}
              onDeleted={async (deleted) => {
                await reload()
                setView({ kind: 'none' })
                setStatus({ message: t.deleted(deleted.name), undoId: deleted.id })
              }}
            />
          ) : (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
              {t.chooseContact}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

interface NewContactFormProps {
  onCreated: (contact: Contact) => Promise<void>
  onCancel: () => void
  onDirtyChange: (dirty: boolean) => void
}

function NewContactForm({ onCreated, onCancel, onDirtyChange }: NewContactFormProps) {
  const t = messages()
  const [form, setForm] = useState(EMPTY_CONTACT_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const dirty = Object.values(form).some((value) => value.trim() !== '')
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const result = newContactInput(form)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setSaving(true)
    try {
      await onCreated(await createContact(result.input))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.crm.createFailed)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void create(event)} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-xl font-semibold">{t.crm.newContact}</h3>
      <ContactDetailsFields values={form} onChange={setForm} />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving || form.name.trim() === ''} className={primaryButton}>
          {saving ? t.crm.creating : t.crm.create}
        </button>
        <button type="button" disabled={saving} onClick={onCancel} className={secondaryButton}>{t.common.cancel}</button>
      </div>
    </form>
  )
}
