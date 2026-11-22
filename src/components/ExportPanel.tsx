import { useEffect, useId, useState } from 'react'

import { db } from '../database/db'
import type { Habit } from '../database/types'
import { DEFAULT_EXPORT_CATEGORIES, EXPORT_CATEGORIES } from '../export/buildExport'
import type { ExportCategory } from '../export/buildExport'
import { EXPORT_FORMATS, runExport } from '../export/runExport'
import type { ExportFormat } from '../export/runExport'
import { parseDateDMY } from '../logging/dateTimeInput'
import { messages } from '../i18n'

import { DateDMYField } from './DateDMYField'

/**
 * Export data as CSV, XLSX, JSON or Markdown, filtered by date range,
 * habits and data types (PROJECT_SPEC.md §10).
 */
export function ExportPanel() {
  const t = messages().exportPanel
  const id = useId()
  const [habits, setHabits] = useState<Habit[] | null>(null)
  const [format, setFormat] = useState<ExportFormat>('xlsx')
  const [categories, setCategories] = useState<ExportCategory[]>(DEFAULT_EXPORT_CATEGORIES)
  const [allHabits, setAllHabits] = useState(true)
  const [habitIds, setHabitIds] = useState<string[]>([])
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')

  useEffect(() => {
    let cancelled = false

    db.habits
      .toArray()
      .then((stored) => {
        if (!cancelled) {
          setHabits(
            stored
              .filter((habit) => habit.deletedAt === null)
              .sort((a, b) => a.name.localeCompare(b.name)),
          )
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(messages().exportPanel.loadFailed)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  function toggle<T>(list: T[], item: T, checked: boolean): T[] {
    return checked ? [...list.filter((value) => value !== item), item] : list.filter((value) => value !== item)
  }

  /**
   * Exports the chosen data. For CSV, `onlyCategory` exports a single
   * data type: each CSV file has its own button, because some browsers
   * (e.g. GNOME Web) keep only the last of several downloads started at
   * the same moment.
   */
  async function handleExport(onlyCategory?: ExportCategory) {
    setError('')
    setResult('')

    let range = null

    if (fromText.trim() !== '' || toText.trim() !== '') {
      const start = parseDateDMY(fromText)
      const end = parseDateDMY(toText)

      if (start === null || end === null) {
        setError(t.bothDates)
        return
      }

      if (end < start) {
        setError(t.dateOrder)
        return
      }

      range = { start, end }
    }

    if (categories.length === 0) {
      setError(t.chooseData)
      return
    }

    if (categories.includes('entries') && !allHabits && habitIds.length === 0) {
      setError(t.chooseHabit)
      return
    }

    setExporting(true)

    try {
      const data = await runExport(
        {
          range,
          habitIds: allHabits ? 'all' : habitIds,
          categories: onlyCategory
            ? [onlyCategory]
            : EXPORT_CATEGORIES.map((item) => item.id).filter((item) => categories.includes(item)),
        },
        format,
      )

      setResult(
        t.downloaded(data.tables
          .map((table) => t.tableCount(table.rows.length, t.categories[table.category].toLowerCase()))
          .join(', ')),
      )
    } catch (caughtError) {
      console.error('Export failed:', caughtError)
      setError(caughtError instanceof Error ? t.failedWith(caughtError.message) : t.failed)
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{t.title}</h3>

      <p className="mt-1 text-sm text-slate-500">
        {t.intro}
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">{t.format}</legend>
          {EXPORT_FORMATS.map((item) => (
            <label key={item.id} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name={`${id}-format`}
                value={item.id}
                checked={format === item.id}
                onChange={() => setFormat(item.id)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{t.formats[item.id].label}</span>
                <span className="block text-xs text-slate-500">{t.formats[item.id].note}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">{t.data}</legend>
          {EXPORT_CATEGORIES.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={categories.includes(item.id)}
                onChange={(event) => setCategories(toggle(categories, item.id, event.target.checked))}
              />
              {t.categories[item.id]}
            </label>
          ))}
        </fieldset>

        <div>
          <p className="mb-1 text-sm font-medium">{t.dateRange}</p>
          <div className="flex flex-wrap gap-2">
            <DateDMYField id={`${id}-from`} label={t.from} showLabel value={fromText} onChange={setFromText} className="w-36" />
            <DateDMYField id={`${id}-to`} label={t.to} showLabel value={toText} onChange={setToText} className="w-36" />
          </div>
          <p className="mt-1 text-xs text-slate-500">{t.allDatesHint}</p>
        </div>

        <fieldset className="space-y-2" disabled={!categories.includes('entries')}>
          <legend className="mb-1 text-sm font-medium">{t.habits}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allHabits} onChange={(event) => setAllHabits(event.target.checked)} />
            {t.allHabits}
          </label>
          {!allHabits && habits && (
            <div className="max-h-40 space-y-1 overflow-auto pl-6">
              {habits.length === 0 && <p className="text-xs text-slate-500">{t.noHabits}</p>}
              {habits.map((habit) => (
                <label key={habit.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={habitIds.includes(habit.id)}
                    onChange={(event) => setHabitIds(toggle(habitIds, habit.id, event.target.checked))}
                  />
                  {habit.name}
                  {habit.archived ? <span className="text-xs text-slate-500">{t.archived}</span> : null}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      {result && (
        <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{result}</p>
      )}

      {format === 'csv' ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-slate-500">
            {t.csvNote}
          </p>
          <div className="flex flex-wrap gap-2">
            {EXPORT_CATEGORIES.filter((item) => categories.includes(item.id)).map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={exporting}
                onClick={() => void handleExport(item.id)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.downloadCsv(t.categories[item.id])}
              </button>
            ))}
          </div>
          {categories.length === 0 && (
            <p className="text-xs text-slate-500">{t.chooseAbove}</p>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={exporting}
          onClick={() => void handleExport()}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? t.preparing : t.download}
        </button>
      )}

      <p className="mt-3 text-xs text-slate-500">
        {t.warning} {t.englishFiles}
      </p>
    </section>
  )
}
