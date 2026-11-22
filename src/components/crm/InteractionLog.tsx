import { useCallback, useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'

import {
  ambiguousTimeNote,
  fieldsFromInstant,
  interactionTimeFromFields,
} from '../../crm/contactForm'
import {
  createInteraction,
  deleteInteraction,
  getInteractionsByContact,
  restoreInteraction,
  updateInteraction,
} from '../../database/contactInteractions'
import type { UpdateInteractionInput } from '../../database/contactInteractions'
import type { ContactInteraction } from '../../database/types'
import { resolveDisplayZone } from '../../settings/displayTimezone'
import type { DisplayTimezone } from '../../settings/displayTimezone'
import { formatInTimezone, getDeviceTimezone } from '../../time/time'
import { messages } from '../../i18n'
import { DateTime24Field } from '../DateTime24Field'

interface InteractionLogProps {
  contactId: string
  contactName: string
  displayTimezone: DisplayTimezone
  /** Changes when data changed elsewhere (sync): reload the list. */
  dataVersion?: number
}

const inputClass = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'
const primaryButton =
  'rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50'

/** The current time (read in handlers and timers, never while drawing). */
function nowIso(): string {
  return new Date().toISOString()
}

function errorText(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}

/**
 * The log of interactions with one contact: a form to log a new one (date
 * and time default to now; until changed, the moment of saving is used)
 * and the list, newest first, with edit, delete and undo.
 */
export function InteractionLog({ contactId, contactName, displayTimezone, dataVersion = 0 }: InteractionLogProps) {
  const t = messages()
  const l = t.crm.interactions
  const id = useId()
  const deviceZone = getDeviceTimezone()
  const [interactions, setInteractions] = useState<ContactInteraction[] | null>(null)
  const [text, setText] = useState('')
  const [fields, setFields] = useState(() => fieldsFromInstant(nowIso(), deviceZone))
  const [timeTouched, setTimeTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<{ message: string; undoId?: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const reload = useCallback(async () => setInteractions(await getInteractionsByContact(contactId)), [contactId])

  useEffect(() => {
    let cancelled = false
    getInteractionsByContact(contactId)
      .then((loaded) => {
        if (!cancelled) setInteractions(loaded)
      })
      .catch((caught: unknown) => {
        console.error('Failed to load interactions:', caught)
        if (!cancelled) setError(messages().crm.interactions.loadFailed)
      })
    return () => {
      cancelled = true
    }
  }, [contactId, dataVersion])

  // Until the user changes the date or time, keep showing the current time.
  useEffect(() => {
    if (timeTouched) return
    const timer = window.setInterval(() => setFields(fieldsFromInstant(nowIso(), deviceZone)), 30_000)
    return () => window.clearInterval(timer)
  }, [timeTouched, deviceZone])

  function resetToCurrentTime() {
    setFields(fieldsFromInstant(nowIso(), deviceZone))
    setTimeTouched(false)
  }

  const shownZone = (interaction: ContactInteraction) => resolveDisplayZone(displayTimezone, interaction.timezone, deviceZone)
  const when = (interaction: ContactInteraction) => {
    const zone = shownZone(interaction)
    return `${formatInTimezone(interaction.occurredStart, zone, 'dd/MM/yyyy HH:mm')}${zone === deviceZone ? '' : ` (${zone})`}`
  }

  async function logInteraction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setError('')
    setStatus(null)

    let occurredStart: string | undefined
    let ambiguous = false
    if (timeTouched) {
      const time = interactionTimeFromFields(fields.date, fields.time, deviceZone)
      if (!time.ok) {
        setError(time.message)
        return
      }
      occurredStart = time.occurredStart
      ambiguous = time.ambiguous
    }

    setSaving(true)
    try {
      const created = await createInteraction({ contactId, text, occurredStart, timezone: deviceZone })
      await reload()
      setText('')
      resetToCurrentTime()
      setStatus({ message: l.logged(when(created), ambiguous ? ambiguousTimeNote() : null) })
    } catch (caught) {
      setError(errorText(caught, l.saveFailed))
    } finally {
      setSaving(false)
    }
  }

  async function remove(interaction: ContactInteraction) {
    setError('')
    try {
      await deleteInteraction(interaction.id)
      await reload()
      setStatus({ message: l.deleted(when(interaction)), undoId: interaction.id })
    } catch (caught) {
      setError(errorText(caught, l.deleteFailed))
    }
  }

  async function undo(undoId: string) {
    setError('')
    try {
      await restoreInteraction(undoId)
      await reload()
      setStatus({ message: l.restored })
    } catch (caught) {
      setError(errorText(caught, l.restoreFailed))
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="mt-8 border-t border-slate-200 pt-6">
      <h4 id={`${id}-title`} className="text-base font-semibold">{l.title(contactName)}</h4>

      <form onSubmit={(event) => void logInteraction(event)} className="mt-4 space-y-3 rounded-lg bg-slate-50 p-4">
        <div>
          <label htmlFor={`${id}-text`} className="mb-1 block text-xs font-medium text-slate-600">{l.newInteraction}</label>
          <textarea
            id={`${id}-text`}
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={l.placeholder}
            className={inputClass}
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <DateTime24Field
            id={`${id}-when`}
            label={l.when}
            date={fields.date}
            time={fields.time}
            onDateChange={(date) => {
              setFields((current) => ({ ...current, date }))
              setTimeTouched(true)
            }}
            onTimeChange={(time) => {
              setFields((current) => ({ ...current, time }))
              setTimeTouched(true)
            }}
          />
          {timeTouched && (
            <button type="button" onClick={resetToCurrentTime} className={secondaryButton}>{l.useCurrentTime}</button>
          )}
          <button type="submit" disabled={saving || text.trim() === ''} className={primaryButton}>
            {saving ? t.crm.saving : l.log}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          {timeTouched ? l.timeIn(deviceZone) : l.now(deviceZone)}
        </p>
      </form>

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {status && (
        <p role="status" className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">
          <span>{status.message}</span>
          {status.undoId && (
            <button type="button" onClick={() => void undo(status.undoId as string)} className={secondaryButton}>{t.crm.undo}</button>
          )}
        </p>
      )}

      {interactions === null ? (
        !error && <p className="mt-4 text-sm text-slate-500">{l.loading}</p>
      ) : interactions.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">{l.none}</p>
      ) : (
        <ol aria-label={l.list(contactName)} className="mt-4 rounded-lg border border-slate-200">
          {interactions.map((interaction) => (
            <li key={interaction.id} className="border-b border-slate-200 p-3 text-sm last:border-b-0">
              {editingId === interaction.id ? (
                <InteractionEditor
                  interaction={interaction}
                  onCancel={() => setEditingId(null)}
                  onSaved={async (message) => {
                    setEditingId(null)
                    await reload()
                    setStatus({ message })
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-500 tabular-nums">{when(interaction)}</p>
                    <p className="mt-1 whitespace-pre-wrap break-words">{interaction.text}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEditingId(interaction.id)} aria-label={l.editNamed(when(interaction))} className={secondaryButton}>{t.common.edit}</button>
                    <button type="button" onClick={() => void remove(interaction)} aria-label={l.deleteNamed(when(interaction))} className={secondaryButton}>{t.common.delete}</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

interface InteractionEditorProps {
  interaction: ContactInteraction
  onCancel: () => void
  onSaved: (message: string) => Promise<void>
}

/** Edits one interaction; its time is edited in the timezone it was logged in. */
function InteractionEditor({ interaction, onCancel, onSaved }: InteractionEditorProps) {
  const t = messages()
  const l = t.crm.interactions
  const id = useId()
  const initialFields = fieldsFromInstant(interaction.occurredStart, interaction.timezone)
  const [text, setText] = useState(interaction.text)
  const [fields, setFields] = useState(initialFields)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const changes: UpdateInteractionInput = {}
    let ambiguous = false
    if (text.trim() !== interaction.text) changes.text = text
    if (fields.date !== initialFields.date || fields.time !== initialFields.time) {
      const time = interactionTimeFromFields(fields.date, fields.time, interaction.timezone)
      if (!time.ok) {
        setError(time.message)
        return
      }
      changes.occurredStart = time.occurredStart
      ambiguous = time.ambiguous
    }
    if (Object.keys(changes).length === 0) {
      onCancel()
      return
    }

    setSaving(true)
    try {
      await updateInteraction(interaction.id, changes)
      await onSaved(l.updated(ambiguous ? ambiguousTimeNote() : null))
    } catch (caught) {
      setError(errorText(caught, l.saveFailed))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-3">
      <div>
        <label htmlFor={`${id}-text`} className="mb-1 block text-xs font-medium text-slate-600">{l.interaction}</label>
        <textarea id={`${id}-text`} rows={3} value={text} onChange={(event) => setText(event.target.value)} className={inputClass} />
      </div>
      <DateTime24Field
        id={`${id}-when`}
        label={l.whenIn(interaction.timezone)}
        date={fields.date}
        time={fields.time}
        onDateChange={(date) => setFields((current) => ({ ...current, date }))}
        onTimeChange={(time) => setFields((current) => ({ ...current, time }))}
      />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className={primaryButton}>{saving ? t.crm.saving : l.save}</button>
        <button type="button" disabled={saving} onClick={onCancel} className={secondaryButton}>{t.common.cancel}</button>
      </div>
    </form>
  )
}
