import { Fragment, useEffect, useId, useMemo, useState } from 'react'

import { deleteEntry, restoreEntry, updateEntry } from '../database/entries'
import { deleteExternalSample, restoreExternalSample } from '../database/externalSamples'
import type { UpdateEntryInput } from '../database/entries'
import {
  deleteSleepSession,
  restoreSleepSession,
  updateSleepSession,
} from '../database/sleepSessions'
import type { SleepSessionChanges } from '../database/sleepSessions'
import { messages } from '../i18n'
import type { Messages } from '../i18n'
import { HABIT_TYPES } from '../database/types'
import { loadLogRows } from '../log/loadLogRows'
import type { LogData } from '../log/loadLogRows'
import {
  DEFAULT_LOG_CRITERIA,
  filterSortPage,
  HABIT_TYPE_LABELS,
  LOCATION_ROW_HABIT_ID,
  SCREEN_TIME_ROW_HABIT_ID,
  SLEEP_ROW_HABIT_ID,
} from '../log/logRows'
import type { LogCriteria, LogRow, LogRowType, SortColumn } from '../log/logRows'
import { parseDateDMY } from '../logging/dateTimeInput'
import { describeDisplayTimezone } from '../settings/displayTimezone'
import type { DisplayTimezone } from '../settings/displayTimezone'

import { DateDMYField } from './DateDMYField'
import { EntryEditor } from './EntryEditor'
import { SleepEditor } from './SleepEditor'

type ColumnId = keyof Messages['dataLog']['columns']

const COLUMNS: { id: ColumnId; key: SortColumn | null }[] = [
  { id: 'date', key: 'date' },
  { id: 'time', key: null },
  { id: 'habit', key: 'habit' },
  { id: 'type', key: 'type' },
  { id: 'value', key: 'value' },
  { id: 'unit', key: null },
  { id: 'source', key: 'source' },
  { id: 'comment', key: null },
  { id: 'actions', key: null },
]

const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'

interface PersonalDataLogProps {
  /** Display timezone setting (see src/settings/displayTimezone.ts). */
  displayTimezone?: DisplayTimezone
}

/**
 * Personal Data Log: every entry in a sortable, searchable, filterable
 * table. Only one page of rows is rendered at a time.
 */
export function PersonalDataLog({ displayTimezone = 'event' }: PersonalDataLogProps) {
  const t = messages()
  const id = useId()

  const [data, setData] = useState<LogData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [criteria, setCriteria] = useState<LogCriteria>(DEFAULT_LOG_CRITERIA)

  // What the user typed in the date filters (dd/mm/yyyy). The filter is
  // only applied once the date is complete and valid.
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')

  // Editing, deleting and undo.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [actionStatus, setActionStatus] = useState('')
  const [undo, setUndo] = useState<{
    id: string
    kind: LogRow['kind']
    description: string
  } | null>(null)

  useEffect(() => {
    let cancelled = false

    loadLogRows(displayTimezone)
      .then((loaded) => {
        if (!cancelled) {
          setData(loaded)
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load the data log:', error)

        if (!cancelled) {
          setLoadError(messages().dataLog.loadFailed)
        }
      })

    return () => {
      cancelled = true
    }
  }, [displayTimezone])

  /** Reloads the rows after a change, keeping search, filters and page. */
  async function reload() {
    setData(await loadLogRows(displayTimezone))
  }

  async function handleSave(
    entryId: string,
    changes: UpdateEntryInput,
    ambiguousTime: boolean,
  ) {
    // Errors are shown inside the edit form.
    await updateEntry(entryId, changes)
    await afterSave(ambiguousTime)
  }

  async function handleSleepSave(
    sessionId: string,
    changes: SleepSessionChanges,
    ambiguousTime: boolean,
  ) {
    await updateSleepSession(sessionId, changes)
    await afterSave(ambiguousTime)
  }

  async function afterSave(ambiguousTime: boolean) {
    // Messages are shown only once the table shows the new state.
    await reload()
    setEditingId(null)
    setActionError('')
    setActionStatus(
      ambiguousTime
        ? t.dataLog.updatedTimeTwice
        : t.dataLog.updated,
    )
  }

  async function handleDelete(entryId: string, kind: LogRow['kind'], description: string) {
    setActionError('')
    setActionStatus('')
    setBusyId(entryId)

    try {
      if (kind === 'sleep') {
        await deleteSleepSession(entryId)
      } else if (kind === 'screen_time' || kind === 'location') {
        await deleteExternalSample(entryId)
      } else {
        await deleteEntry(entryId)
      }

      await reload()

      if (editingId === entryId) {
        setEditingId(null)
      }

      setUndo({ id: entryId, kind, description })
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error ? caughtError.message : t.dataLog.deleteFailed,
      )
    } finally {
      setBusyId(null)
    }
  }

  async function handleUndo() {
    if (!undo) {
      return
    }

    setActionError('')

    try {
      if (undo.kind === 'sleep') {
        await restoreSleepSession(undo.id)
      } else if (undo.kind === 'screen_time' || undo.kind === 'location') {
        await restoreExternalSample(undo.id)
      } else {
        await restoreEntry(undo.id)
      }

      await reload()
      setUndo(null)
      setActionStatus(t.dataLog.restored)
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error ? caughtError.message : t.dataLog.restoreFailed,
      )
    }
  }

  const page = useMemo(
    () => (data ? filterSortPage(data.rows, criteria) : null),
    [data, criteria],
  )

  /** Changes search/filters and goes back to the first page. */
  function updateFilters(changes: Partial<LogCriteria>) {
    setCriteria((current) => ({ ...current, ...changes, page: 1 }))
  }

  function updateDateFilter(which: 'fromDate' | 'toDate', text: string) {
    if (which === 'fromDate') {
      setFromText(text)
    } else {
      setToText(text)
    }

    if (text.trim() === '') {
      updateFilters({ [which]: '' })
      return
    }

    const isoDate = parseDateDMY(text)

    if (isoDate !== null) {
      updateFilters({ [which]: isoDate })
    }
  }

  function toggleSort(column: SortColumn) {
    setCriteria((current) => ({
      ...current,
      sortColumn: column,
      sortDirection:
        current.sortColumn === column && current.sortDirection === 'desc'
          ? 'asc'
          : current.sortColumn === column
            ? 'desc'
            : column === 'date'
              ? 'desc'
              : 'asc',
      page: 1,
    }))
  }

  const filtersActive =
    fromText !== '' ||
    toText !== '' ||
    criteria.search !== '' ||
    criteria.habitId !== 'all' ||
    criteria.habitType !== 'all' ||
    criteria.fromDate !== '' ||
    criteria.toDate !== ''

  if (loadError) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
        {loadError}
      </p>
    )
  }

  if (!data || !page) {
    return <p className="py-8 text-center text-sm text-slate-500">{t.dataLog.loading}</p>
  }

  const notices = (actionError || actionStatus || undo) && (
    <div className="space-y-2">
      {undo && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm"
        >
          <span>{t.dataLog.deleted(undo.description)}</span>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleUndo()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              {t.dataLog.undo}
            </button>

            <button
              type="button"
              onClick={() => setUndo(null)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100"
            >
              {t.dataLog.dismiss}
            </button>
          </div>
        </div>
      )}

      {actionError && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {actionStatus && !undo && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {actionStatus}
        </p>
      )}
    </div>
  )

  if (data.rows.length === 0) {
    return (
      <div className="space-y-4">
        {notices}

        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-sm text-slate-500">
          {t.dataLog.noEntries}
        </div>
      </div>
    )
  }

  const firstShown = page.total === 0 ? 0 : (page.page - 1) * criteria.pageSize + 1
  const lastShown = Math.min(page.page * criteria.pageSize, page.total)

  return (
    <div className="space-y-4">
      {notices}

      <section
        aria-label={t.dataLog.searchAndFilters}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
      >
        <div className="sm:col-span-2 lg:col-span-1">
          <label htmlFor={`${id}-search`} className="mb-1 block text-xs font-medium text-slate-600">
            {t.dataLog.search}
          </label>
          <input
            id={`${id}-search`}
            type="search"
            value={criteria.search}
            onChange={(event) => updateFilters({ search: event.target.value })}
            placeholder={t.dataLog.searchPlaceholder}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={`${id}-habit`} className="mb-1 block text-xs font-medium text-slate-600">
            {t.dataLog.habit}
          </label>
          <select
            id={`${id}-habit`}
            value={criteria.habitId}
            onChange={(event) => updateFilters({ habitId: event.target.value })}
            className={inputClass}
          >
            <option value="all">{t.dataLog.allHabits}</option>
            {data.sleepById.size > 0 && <option value={SLEEP_ROW_HABIT_ID}>{t.dataLog.sleep}</option>}
            {data.hasScreenTime && <option value={SCREEN_TIME_ROW_HABIT_ID}>{t.dataLog.screenTime}</option>}
            {data.hasLocation && <option value={LOCATION_ROW_HABIT_ID}>{t.dataLog.location}</option>}
            {data.habits.map((habit) => (
              <option key={habit.id} value={habit.id}>
                {habit.name}
                {habit.archived ? t.dataLog.archivedSuffix : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-type`} className="mb-1 block text-xs font-medium text-slate-600">
            {t.dataLog.type}
          </label>
          <select
            id={`${id}-type`}
            value={criteria.habitType}
            onChange={(event) =>
              updateFilters({ habitType: event.target.value as LogRowType | 'all' })
            }
            className={inputClass}
          >
            <option value="all">{t.dataLog.allTypes}</option>
            {HABIT_TYPES.map((type) => (
              <option key={type} value={type}>
                {HABIT_TYPE_LABELS[type]}
              </option>
            ))}
            <option value="sleep">{t.dataLog.sleep}</option>
            <option value="screen_time">{t.dataLog.screenTime}</option>
            <option value="location">{t.dataLog.location}</option>
          </select>
        </div>

        <DateDMYField
          id={`${id}-from`}
          label={t.dataLog.from}
          showLabel
          value={fromText}
          onChange={(text) => updateDateFilter('fromDate', text)}
        />

        <DateDMYField
          id={`${id}-to`}
          label={t.dataLog.to}
          showLabel
          value={toText}
          onChange={(text) => updateDateFilter('toDate', text)}
        />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <p className="w-full text-xs text-slate-500">
          {t.dataLog.timesShownIn(describeDisplayTimezone(displayTimezone))}
        </p>

        <p aria-live="polite">
          {page.total === 0
            ? t.dataLog.noMatching
            : t.dataLog.showing(firstShown, lastShown, page.total)}
        </p>

        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              setFromText('')
              setToText('')
              setCriteria((current) => ({
                ...DEFAULT_LOG_CRITERIA,
                sortColumn: current.sortColumn,
                sortDirection: current.sortDirection,
              }))
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100"
          >
            {t.dataLog.clearFilters}
          </button>
        )}
      </div>

      {page.total === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
          {t.dataLog.noMatch}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {COLUMNS.map((column) => {
                  const sorted = column.key !== null && criteria.sortColumn === column.key

                  return (
                    <th
                      key={column.id}
                      scope="col"
                      aria-sort={
                        sorted
                          ? criteria.sortDirection === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : undefined
                      }
                      className="whitespace-nowrap px-4 py-3 font-medium"
                    >
                      {column.key === null ? (
                        t.dataLog.columns[column.id]
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleSort(column.key as SortColumn)}
                          className="uppercase tracking-wide hover:text-slate-900"
                        >
                          {t.dataLog.columns[column.id]}
                          {sorted ? (criteria.sortDirection === 'asc' ? ' ▲' : ' ▼') : ''}
                        </button>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>

            <tbody>
              {page.rows.map((row) => {
                const entry = data.entriesById.get(row.id)
                const sleep = data.sleepById.get(row.id)
                const habit = data.habits.find((item) => item.id === row.habitId)
                const description = `${row.habitName}, ${row.dateLabel} ${row.timeLabel}`

                return (
                <Fragment key={row.id}>
                <tr className="border-b border-slate-200 last:border-b-0 align-top">
                  <td className="whitespace-nowrap px-4 py-3">{row.dateLabel}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                    {row.timeLabel}
                    {row.showTimezone && (
                      <span className="block text-xs text-slate-500">
                        {displayTimezone === 'event' ? row.timezone : t.dataLog.recordedIn(row.timezone)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.habitName}
                    {row.habitArchived && (
                      <span className="block text-xs text-slate-500">{t.dataLog.archived}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{row.typeLabel}</td>
                  <td className="max-w-xs break-words px-4 py-3">{row.valueLabel}</td>
                  <td className="whitespace-nowrap px-4 py-3">{row.unit}</td>
                  <td className="whitespace-nowrap px-4 py-3">{row.sourceLabel}</td>
                  <td className="max-w-xs break-words px-4 py-3 text-slate-600">{row.comment}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex gap-2">
                      {/* Imported screen time and location are originals: delete only. */}
                      {row.kind !== 'screen_time' && row.kind !== 'location' && (
                      <button
                        type="button"
                        onClick={() => {
                          setActionError('')
                          setActionStatus('')
                          setEditingId(editingId === row.id ? null : row.id)
                        }}
                        aria-label={t.dataLog.editRow(description)}
                        aria-expanded={editingId === row.id}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100"
                      >
                        {t.common.edit}
                      </button>
                      )}

                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void handleDelete(row.id, row.kind, description)}
                        aria-label={t.dataLog.deleteRow(description)}
                        className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        {t.common.delete}
                      </button>
                    </div>
                  </td>
                </tr>

                {editingId === row.id && sleep && (
                  <tr className="border-b border-slate-200">
                    <td colSpan={COLUMNS.length} className="px-4 py-3">
                      <SleepEditor
                        session={sleep}
                        onSave={(changes, ambiguousTime) =>
                          handleSleepSave(row.id, changes, ambiguousTime)
                        }
                        onCancel={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                )}

                {editingId === row.id && entry && habit && (
                  <tr className="border-b border-slate-200">
                    <td colSpan={COLUMNS.length} className="px-4 py-3">
                      <EntryEditor
                        entry={entry}
                        habit={habit}
                        onSave={(changes, ambiguousTime) =>
                          handleSave(row.id, changes, ambiguousTime)
                        }
                        onCancel={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {page.pageCount > 1 && (
        <nav aria-label={t.dataLog.pages} className="flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            disabled={page.page <= 1}
            onClick={() => setCriteria((current) => ({ ...current, page: page.page - 1 }))}
            className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.dataLog.previous}
          </button>

          <span className="text-slate-600">
            {t.dataLog.pageOf(page.page, page.pageCount)}
          </span>

          <button
            type="button"
            disabled={page.page >= page.pageCount}
            onClick={() => setCriteria((current) => ({ ...current, page: page.page + 1 }))}
            className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.dataLog.next}
          </button>
        </nav>
      )}
    </div>
  )
}
