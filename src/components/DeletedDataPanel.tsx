import { useCallback, useEffect, useState } from 'react'

import { restoreInteraction } from '../database/contactInteractions'
import { restoreContact } from '../database/contacts'
import { restoreEntry } from '../database/entries'
import { restoreExternalSample } from '../database/externalSamples'
import { restoreHabit } from '../database/habits'
import { restoreSleepSession } from '../database/sleepSessions'
import { loadDeletedData } from '../deleted/loadDeletedData'
import type { DeletedData, DeletedSleep } from '../deleted/loadDeletedData'
import { HABIT_TYPE_LABELS } from '../log/logRows'
import { resolveDisplayZone } from '../settings/displayTimezone'
import type { DisplayTimezone } from '../settings/displayTimezone'
import { formatInTimezone, getDeviceTimezone } from '../time/time'
import { messages } from '../i18n'

interface DeletedDataPanelProps {
  displayTimezone: DisplayTimezone

  /** Called after a habit is restored, so other pages can reload habits. */
  onHabitRestored?: () => void
}

const PAGE_SIZE = 50

const buttonClass =
  'rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Shows deleted habits and entries and lets the user restore them.
 * Deleted data is never erased: it stays stored and in backups.
 */
export function DeletedDataPanel({ displayTimezone, onHabitRestored }: DeletedDataPanelProps) {
  const t = messages().deletedData
  const [data, setData] = useState<DeletedData | null>(null)
  const [entryPage, setEntryPage] = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  const reload = useCallback(
    async () => setData(await loadDeletedData(displayTimezone)),
    [displayTimezone],
  )

  useEffect(() => {
    let cancelled = false

    loadDeletedData(displayTimezone)
      .then((loaded) => {
        if (!cancelled) {
          setData(loaded)
        }
      })
      .catch((caughtError: unknown) => {
        console.error('Failed to load deleted data:', caughtError)

        if (!cancelled) {
          setError(messages().deletedData.loadFailed)
        }
      })

    return () => {
      cancelled = true
    }
  }, [displayTimezone])

  // Deletion times are not event times: show them in the display
  // timezone, or the device timezone when showing event timezones.
  const deletionZone = resolveDisplayZone(displayTimezone, getDeviceTimezone())

  async function restore(kind: 'habit' | 'entry' | 'sleep' | 'screen_time' | 'location' | 'contact' | 'interaction', id: string, name: string) {
    setError('')
    setStatus('')
    setBusyId(id)

    try {
      if (kind === 'habit') {
        await restoreHabit(id)
        onHabitRestored?.()
      } else if (kind === 'sleep') {
        await restoreSleepSession(id)
      } else if (kind === 'screen_time' || kind === 'location') {
        await restoreExternalSample(id)
      } else if (kind === 'contact') {
        await restoreContact(id)
      } else if (kind === 'interaction') {
        await restoreInteraction(id)
      } else {
        await restoreEntry(id)
      }

      await reload()
      setStatus(t.restored(name))
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t.restoreFailed)
    } finally {
      setBusyId(null)
    }
  }

  const entryPageCount = data ? Math.max(1, Math.ceil(data.entries.length / PAGE_SIZE)) : 1
  const shownPage = Math.min(entryPage, entryPageCount)
  const shownEntries = data
    ? data.entries.slice((shownPage - 1) * PAGE_SIZE, shownPage * PAGE_SIZE)
    : []

  /** A list of deleted sleep sessions or screen-time days. */
  function renderDayList(
    kind: 'sleep' | 'screen_time' | 'location',
    name: string,
    title: string,
    plural: string,
    items: DeletedSleep[],
  ) {
    if (items.length === 0) {
      return null
    }

    return (
      <div>
        <h4 className="text-sm font-semibold">{t.listTitle(title, items.length)}</h4>

        <ul className="mt-2 rounded-lg border border-slate-200">
          {items.slice(0, PAGE_SIZE).map(({ row, deletedAt }) => {
            const description = `${name}, ${row.dateLabel} ${row.timeLabel}`

            return (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3 text-sm last:border-b-0">
                <div className="min-w-0">
                  <p className="break-words">
                    <span className="font-medium">{name}</span> · {row.dateLabel} {row.timeLabel} ·{' '}
                    {row.valueLabel} · {row.sourceLabel}
                  </p>
                  {row.comment && (
                    <p className="break-words text-xs text-slate-600">{row.comment}</p>
                  )}
                  <p className="text-xs text-slate-500">
                    {t.deletedOn(formatInTimezone(deletedAt, deletionZone, 'd MMM yyyy, HH:mm'))}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => void restore(kind, row.id, description)}
                  aria-label={t.restoreNamed(description)}
                  className={buttonClass}
                >
                  {t.restore}
                </button>
              </li>
            )
          })}
        </ul>

        {items.length > PAGE_SIZE && (
          <p className="mt-2 text-xs text-slate-500">
            {t.showingRecent(PAGE_SIZE, plural)}
          </p>
        )}
      </div>
    )
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{t.title}</h3>

      <p className="mt-1 text-sm text-slate-500">
        {t.intro}
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {status && (
        <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {status}
        </p>
      )}

      {!data ? (
        !error && <p className="mt-4 text-sm text-slate-500">{t.loading}</p>
      ) : data.habits.length === 0 && data.entries.length === 0 && data.sleep.length === 0 && data.screenTime.length === 0 && data.location.length === 0 && data.contacts.length === 0 && data.contactInteractions.length === 0 ? (
        <p className="mt-4 rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">
          {t.nothing}
        </p>
      ) : (
        <div className="mt-4 space-y-6">
          {data.habits.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">{t.habitsTitle(data.habits.length)}</h4>

              <ul className="mt-2 rounded-lg border border-slate-200">
                {data.habits.map(({ habit, entryCount }) => (
                  <li key={habit.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3 text-sm last:border-b-0">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{habit.name}</p>
                      <p className="text-xs text-slate-500">
                        {HABIT_TYPE_LABELS[habit.type]}
                        {habit.archived ? t.archivedSuffix : ''}
                        {t.habitDetails(formatInTimezone(habit.deletedAt ?? '', deletionZone, 'd MMM yyyy, HH:mm'), entryCount)}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={busyId === habit.id}
                      onClick={() => void restore('habit', habit.id, habit.name)}
                      aria-label={t.restoreHabit(habit.name)}
                      className={buttonClass}
                    >
                      {t.restore}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.entries.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">{t.entriesTitle(data.entries.length)}</h4>

              <ul className="mt-2 rounded-lg border border-slate-200">
                {shownEntries.map(({ row, deletedAt, habitDeleted }) => {
                  const description = `${row.habitName}, ${row.dateLabel} ${row.timeLabel}`

                  return (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3 text-sm last:border-b-0">
                      <div className="min-w-0">
                        <p className="break-words">
                          <span className="font-medium">{row.habitName}</span> · {row.dateLabel}{' '}
                          {row.timeLabel} · {row.valueLabel}
                          {row.unit ? ` ${row.unit}` : ''}
                        </p>
                        {row.comment && (
                          <p className="break-words text-xs text-slate-600">{row.comment}</p>
                        )}
                        <p className="text-xs text-slate-500">
                          {t.deletedOn(formatInTimezone(deletedAt, deletionZone, 'd MMM yyyy, HH:mm'))}
                          {habitDeleted ? t.habitDeletedNote : ''}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={habitDeleted || busyId === row.id}
                        onClick={() => void restore('entry', row.id, description)}
                        aria-label={t.restoreEntry(description)}
                        className={buttonClass}
                      >
                        {t.restore}
                      </button>
                    </li>
                  )
                })}
              </ul>

              {entryPageCount > 1 && (
                <nav aria-label={t.entriesPages} className="mt-3 flex items-center justify-center gap-3 text-sm">
                  <button
                    type="button"
                    disabled={shownPage <= 1}
                    onClick={() => setEntryPage(shownPage - 1)}
                    className={buttonClass}
                  >
                    {t.previous}
                  </button>
                  <span className="text-slate-600">
                    {t.pageOf(shownPage, entryPageCount)}
                  </span>
                  <button
                    type="button"
                    disabled={shownPage >= entryPageCount}
                    onClick={() => setEntryPage(shownPage + 1)}
                    className={buttonClass}
                  >
                    {t.next}
                  </button>
                </nav>
              )}
            </div>
          )}

          {renderDayList('sleep', t.sleep.name, t.sleep.title, t.sleep.plural, data.sleep)}
          {renderDayList('screen_time', t.screenTime.name, t.screenTime.title, t.screenTime.plural, data.screenTime)}
          {renderDayList('location', t.location.name, t.location.title, t.location.plural, data.location)}

          {data.contacts.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">{t.contactsTitle(data.contacts.length)}</h4>
              <ul className="mt-2 rounded-lg border border-slate-200">
                {data.contacts.slice(0, PAGE_SIZE).map(({ contact, interactionCount }) => (
                  <li key={contact.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3 text-sm last:border-b-0">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{contact.name}</p>
                      <p className="text-xs text-slate-500">
                        {t.contactDetails(formatInTimezone(contact.deletedAt, deletionZone, 'd MMM yyyy, HH:mm'), interactionCount)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busyId === contact.id}
                      onClick={() => void restore('contact', contact.id, contact.name)}
                      aria-label={t.restoreContact(contact.name)}
                      className={buttonClass}
                    >
                      {t.restore}
                    </button>
                  </li>
                ))}
              </ul>
              {data.contacts.length > PAGE_SIZE && (
                <p className="mt-2 text-xs text-slate-500">{t.showingRecent(PAGE_SIZE, t.contacts)}</p>
              )}
            </div>
          )}

          {data.contactInteractions.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">{t.interactionsTitle(data.contactInteractions.length)}</h4>
              <ul className="mt-2 rounded-lg border border-slate-200">
                {data.contactInteractions.slice(0, PAGE_SIZE).map((item) => {
                  const description = t.interactionDescription(item.contactName, item.whenLabel)
                  return (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3 text-sm last:border-b-0">
                      <div className="min-w-0">
                        <p className="break-words">
                          <span className="font-medium">{item.contactName}</span> · {item.whenLabel}
                        </p>
                        <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-slate-600">{item.text}</p>
                        <p className="text-xs text-slate-500">
                          {t.deletedOn(formatInTimezone(item.deletedAt, deletionZone, 'd MMM yyyy, HH:mm'))}
                          {item.contactDeleted ? t.contactDeletedNote : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={item.contactDeleted || busyId === item.id}
                        onClick={() => void restore('interaction', item.id, description)}
                        aria-label={t.restoreNamed(description)}
                        className={buttonClass}
                      >
                        {t.restore}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {data.contactInteractions.length > PAGE_SIZE && (
                <p className="mt-2 text-xs text-slate-500">{t.showingRecent(PAGE_SIZE, t.interactions)}</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
