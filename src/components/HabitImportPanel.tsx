import { useEffect, useId, useMemo, useState } from 'react'

import { getEntriesByHabit, importEntries, undoImport } from '../database/entries'
import { getActiveHabits } from '../database/habits'
import type { Entry, Habit } from '../database/types'
import { formatDuration } from '../stopwatch/duration'
import { columnNames, detectDelimiter, markDuplicates, prepareRows, readTable, summarize } from '../import/habitRows'
import type { DateOrder, ImportMapping, RowResult } from '../import/habitRows'
import { messages } from '../i18n'
import { getDeviceTimezone } from '../time/time'
import { habitTypeLabel } from './habits/habitTypes'
import { TimezoneField } from './TimezoneField'

/**
 * Import habit entries by pasting cells copied from a spreadsheet
 * (docs/HABIT_IMPORT.md; the CSV file option was removed on 2026-11-21). Everything happens on this device;
 * nothing is saved before the user has seen the preview and pressed Import.
 */

const NONE = -1
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
const small = 'rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 disabled:opacity-50'

interface Columns {
  value: number
  date: number
  time: number
  endDate: number
  endTime: number
  comment: number
}

const EMPTY_COLUMNS: Columns = { value: NONE, date: NONE, time: NONE, endDate: NONE, endTime: NONE, comment: NONE }

function buildMapping(habit: Habit, columns: Columns): ImportMapping | null {
  const comment = columns.comment === NONE ? null : columns.comment
  const time = (value: number) => (value === NONE ? null : value)
  if (habit.type === 'stopwatch') {
    if (columns.date === NONE || columns.endDate === NONE) return null
    return { type: 'stopwatch', start: { date: columns.date, time: time(columns.time) }, end: { date: columns.endDate, time: time(columns.endTime) }, comment }
  }
  if (columns.value === NONE || columns.date === NONE) return null
  return { type: habit.type, value: columns.value, when: { date: columns.date, time: time(columns.time) }, comment }
}

function show(local: string | null): string {
  if (!local) return ''
  const [date, time] = local.split('T')
  return `${date.split('-').reverse().join('/')} ${time.slice(0, 5)}`
}

function valueText(value: unknown): string {
  if (value === true) return messages().habitImport.yes
  if (value === false) return messages().habitImport.no
  return value === null || value === undefined ? '' : String(value)
}

function ColumnSelect(props: { id: string; label: string; value: number; names: string[]; onChange: (value: number) => void; noneLabel?: string; help?: string }) {
  return (
    <div>
      <label htmlFor={props.id} className="mb-1 block text-xs font-medium text-slate-600">{props.label}</label>
      <select id={props.id} value={props.value} onChange={(event) => props.onChange(Number(event.target.value))} className={field}>
        <option value={NONE}>{props.noneLabel ?? messages().habitImport.chooseColumn}</option>
        {props.names.map((name, index) => <option key={name} value={index}>{name}</option>)}
      </select>
      {props.help && <p className="mt-1 text-xs text-slate-500">{props.help}</p>}
    </div>
  )
}

/** version: increases when data changed elsewhere (sync, restore), to reload habits and entries without losing the screen. */
export function HabitImportPanel({ onImported, version = 0 }: { onImported: () => void; version?: number }) {
  const t = messages().habitImport
  const id = useId()
  const [habits, setHabits] = useState<Habit[]>([])
  const [habitId, setHabitId] = useState('')
  const [existing, setExisting] = useState<Entry[]>([])
  const [text, setText] = useState('')
  const [delimiter, setDelimiter] = useState<'auto' | ',' | ';' | '\t'>('auto')
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(true)
  const [order, setOrder] = useState<DateOrder>('dmy')
  const [timezone, setTimezone] = useState(getDeviceTimezone)
  const [nextDayIfEarlier, setNextDayIfEarlier] = useState(true)
  const [columns, setColumns] = useState<Columns>(EMPTY_COLUMNS)
  const [acceptProblems, setAcceptProblems] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ batchId: string; added: number; skipped: number; habit: string; undone: number | null } | null>(null)

  useEffect(() => {
    getActiveHabits().then(setHabits).catch(() => setError(messages().habitImport.loadHabitsFailed))
  }, [version])

  const habit = habits.find((item) => item.id === habitId) ?? null

  useEffect(() => {
    if (!habitId) return
    let cancelled = false
    getEntriesByHabit(habitId)
      .then((entries) => { if (!cancelled) setExisting(entries) })
      .catch(() => { if (!cancelled) setError(messages().habitImport.loadEntriesFailed) })
    return () => { cancelled = true }
  }, [habitId, done, version])

  const effectiveDelimiter = delimiter === 'auto' ? detectDelimiter(text) : delimiter
  const table = useMemo(() => {
    if (!text.trim()) return null
    try {
      return readTable(text, effectiveDelimiter)
    } catch (caught) {
      return caught instanceof Error ? caught.message : messages().habitImport.unreadable
    }
  }, [text, effectiveDelimiter])
  const names = Array.isArray(table) ? columnNames(table, firstRowIsHeader) : []
  const results: RowResult[] | null = useMemo(() => {
    const mapping = habit && Array.isArray(table) ? buildMapping(habit, columns) : null
    if (!habit || !mapping || !Array.isArray(table)) return null
    return markDuplicates(prepareRows(table, habit, mapping, { order, timezone, firstRowIsHeader, nextDayIfEarlier }), habit, existing)
  }, [habit, columns, table, order, timezone, firstRowIsHeader, nextDayIfEarlier, existing])
  const counts = results ? summarize(results) : null

  function reset(next: Partial<Columns> = {}) {
    setColumns({ ...EMPTY_COLUMNS, ...next })
    setAcceptProblems(false)
    setDone(null)
    setError('')
  }

  async function runImport() {
    if (!habit || !results) return
    setBusy(true)
    setError('')
    try {
      const items = results.flatMap((result) => (result.kind === 'ready' ? [result.item] : []))
      const batchId = crypto.randomUUID()
      const result = await importEntries(habit.id, items, timezone, batchId)
      setDone({ batchId, added: result.added.length, skipped: result.skipped, habit: habit.name, undone: null })
      setAcceptProblems(false)
      onImported()
    } catch (caught) {
      setError(t.importFailed(caught instanceof Error ? caught.message : t.unknownError))
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    if (!done) return
    setBusy(true)
    try {
      const undone = await undoImport(done.batchId)
      setDone({ ...done, undone })
      onImported()
    } catch (caught) {
      setError(t.undoFailed(caught instanceof Error ? caught.message : t.unknownError))
    } finally {
      setBusy(false)
    }
  }

  const set = (key: keyof Columns) => (value: number) => { setColumns((current) => ({ ...current, [key]: value })); setAcceptProblems(false); setDone(null) }
  const typeLabel = habit ? (habit.type === 'label' ? t.category : habitTypeLabel(habit.type)) : ''
  const problems = results?.filter((result): result is Extract<RowResult, { kind: 'problem' }> => result.kind === 'problem') ?? []
  const duplicates = results?.filter((result): result is Extract<RowResult, { kind: 'duplicate' }> => result.kind === 'duplicate') ?? []
  const ready = results?.filter((result): result is Extract<RowResult, { kind: 'ready' }> => result.kind === 'ready') ?? []
  const canImport = !busy && counts !== null && counts.ready > 0 && (counts.problems === 0 || acceptProblems) && done === null

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h3 id={`${id}-title`} className="text-lg font-semibold">{t.title}</h3>
        <p className="text-sm text-slate-600">
          {t.intro}
        </p>
      </div>

      <div>
        <label htmlFor={`${id}-habit`} className="mb-1 block text-xs font-medium text-slate-600">{t.step1}</label>
        <select id={`${id}-habit`} value={habitId} onChange={(event) => { setHabitId(event.target.value); setExisting([]); reset() }} className={field}>
          <option value="">{t.chooseHabit}</option>
          {habits.map((item) => <option key={item.id} value={item.id}>{t.habitOption(item.name, t.types[item.type])}</option>)}
        </select>
        {habits.length === 0 && <p className="mt-1 text-xs text-slate-500">{t.createFirst}</p>}
      </div>

      <div>
        <label htmlFor={`${id}-paste`} className="mb-1 block text-xs font-medium text-slate-600">{t.step2}</label>
        <textarea
          id={`${id}-paste`}
          rows={3}
          value={text}
          onChange={(event) => { setText(event.target.value); reset() }}
          className={`${field} font-mono`}
        />
      </div>

      {typeof table === 'string' && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{table}</p>}

      {Array.isArray(table) && habit && (
        <div className="space-y-3 rounded-lg border border-slate-200 p-4">
          <p className="text-sm font-medium">{t.step3(typeLabel, habit.name, table.length)}</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={firstRowIsHeader} onChange={(event) => { setFirstRowIsHeader(event.target.checked); setDone(null) }} />{t.firstRowHeader}</label>
            <label className="flex items-center gap-2">
              {t.separator}
              <select value={delimiter} onChange={(event) => setDelimiter(event.target.value as typeof delimiter)} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
                <option value="auto">{t.automatic(effectiveDelimiter === '\t' ? t.tab : effectiveDelimiter === ';' ? t.semicolon : t.comma)}</option>
                <option value=",">{t.commaOption}</option>
                <option value=";">{t.semicolonOption}</option>
                <option value={'\t'}>{t.tabOption}</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {habit.type === 'stopwatch' ? (
              <>
                <ColumnSelect id={`${id}-start-date`} label={t.startDate} value={columns.date} names={names} onChange={set('date')} />
                <ColumnSelect id={`${id}-start-time`} label={t.startTime} value={columns.time} names={names} onChange={set('time')} noneLabel={t.inStartDate} />
                <ColumnSelect id={`${id}-end-date`} label={t.stopDate} value={columns.endDate} names={names} onChange={set('endDate')} help={t.stopDateHelp} />
                <ColumnSelect id={`${id}-end-time`} label={t.stopTime} value={columns.endTime} names={names} onChange={set('endTime')} noneLabel={t.inStopDate} />
              </>
            ) : (
              <>
                <ColumnSelect
                  id={`${id}-value`}
                  label={habit.type === 'number' ? t.value(habit.unit) : habit.type === 'checkbox' ? t.done : habit.type === 'label' ? t.categoryColumn(habit.labelOptions.join(', ')) : t.text}
                  help={habit.type === 'label' ? t.categoryHelp : undefined}
                  value={columns.value}
                  names={names}
                  onChange={set('value')}
                />
                <ColumnSelect id={`${id}-date`} label={t.date} value={columns.date} names={names} onChange={set('date')} />
                <ColumnSelect id={`${id}-time`} label={t.time} value={columns.time} names={names} onChange={set('time')} noneLabel={t.inDate} />
              </>
            )}
            <ColumnSelect id={`${id}-comment`} label={t.comment} value={columns.comment} names={names} onChange={set('comment')} noneLabel={t.noComment} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-order`} className="mb-1 block text-xs font-medium text-slate-600">{t.datesWritten}</label>
              <select id={`${id}-order`} value={order} onChange={(event) => setOrder(event.target.value as DateOrder)} className={field}>
                <option value="dmy">{t.dmy}</option>
                <option value="mdy">{t.mdy}</option>
                <option value="ymd">{t.ymd}</option>
              </select>
            </div>
            <TimezoneField id={`${id}-timezone`} value={timezone} onChange={setTimezone} label={t.timezone} help={t.timezoneHelp} />
          </div>
          {habit.type === 'stopwatch' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={nextDayIfEarlier} onChange={(event) => setNextDayIfEarlier(event.target.checked)} />
              {t.nextDay}
            </label>
          )}
        </div>
      )}

      {counts && (
        <div className="space-y-3 rounded-lg border border-slate-200 p-4" aria-label={t.preview}>
          <p className="text-sm font-medium">{t.step4}</p>
          <ul className="grid gap-2 text-sm sm:grid-cols-4">
            <li className="rounded-lg bg-green-50 p-2"><span className="font-semibold">{counts.ready}</span> {t.ready}</li>
            <li className="rounded-lg bg-slate-50 p-2"><span className="font-semibold">{counts.duplicates}</span> {t.duplicates}</li>
            <li className="rounded-lg bg-slate-50 p-2"><span className="font-semibold">{counts.empty}</span> {t.empty}</li>
            <li className={`rounded-lg p-2 ${counts.problems > 0 ? 'bg-red-50' : 'bg-slate-50'}`}><span className="font-semibold">{counts.problems}</span> {t.problems}</li>
          </ul>
          {counts.ambiguous > 0 && (
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
              {t.ambiguous(counts.ambiguous)}
            </p>
          )}

          {problems.length > 0 && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">
              <p className="font-medium">{t.problemsTitle}</p>
              <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-auto pl-5">
                {problems.map((problem) => <li key={problem.row}>{t.problemRow(problem.row, problem.message)}</li>)}
              </ul>
            </div>
          )}
          {duplicates.length > 0 && (
            <p className="text-xs text-slate-600">
              {t.skippedRows([...new Set(duplicates.map((duplicate) => `${duplicate.item.row}${duplicate.within === 'file' ? t.repeated : ''}`))].join(', '))}
            </p>
          )}

          {ready.length > 0 && (
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-1">{t.row}</th>
                    <th className="px-2 py-1">{habit?.type === 'stopwatch' ? t.start : t.dateAndTime}</th>
                    {habit?.type === 'stopwatch' ? <><th className="px-2 py-1">{t.stop}</th><th className="px-2 py-1">{t.duration}</th></> : <th className="px-2 py-1">{t.valueHeader}</th>}
                    <th className="px-2 py-1">{t.commentHeader}</th>
                  </tr>
                </thead>
                <tbody>
                  {ready.map(({ item }) => (
                    <tr key={`${item.row}.${item.part ?? 0}`} className="border-t border-slate-200">
                      <td className="px-2 py-1">{item.row}</td>
                      <td className="px-2 py-1">{show(item.localStart)}</td>
                      {item.occurredEnd ? (
                        <>
                          <td className="px-2 py-1">{show(item.localEnd)}</td>
                          <td className="px-2 py-1">{formatDuration(Date.parse(item.occurredEnd) - Date.parse(item.occurredStart))}</td>
                        </>
                      ) : (
                        <td className="px-2 py-1">{valueText(item.value)}{habit?.type === 'number' && habit.unit ? ` ${habit.unit}` : ''}</td>
                      )}
                      <td className="px-2 py-1">{item.comment ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {counts.problems > 0 && counts.ready > 0 && done === null && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={acceptProblems} onChange={(event) => setAcceptProblems(event.target.checked)} className="mt-1" />
              {t.acceptProblems(counts.ready, counts.problems)}
            </label>
          )}
          <button type="button" disabled={!canImport} onClick={() => void runImport()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? t.importing : t.importInto(counts.ready, habit?.name ?? '')}
          </button>
          <p className="text-xs text-slate-500">{t.atOnce}</p>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {done && (
        <div role="status" className="space-y-2 rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {done.undone === null ? (
            <>
              <p>
                {t.imported(done.added, done.habit)}
                {done.skipped > 0 && t.skipped(done.skipped)}
              </p>
              <button type="button" className={small} disabled={busy} onClick={() => void undo()}>{t.undo}</button>
            </>
          ) : (
            <p>{t.undone(done.undone)}</p>
          )}
        </div>
      )}
    </section>
  )
}
