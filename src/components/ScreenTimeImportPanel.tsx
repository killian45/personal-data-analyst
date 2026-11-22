import { useId, useState } from 'react'

import type { ChangeEvent } from 'react'

import {
  applyScreenTimeImport,
  formatDayMonthYear,
  previewScreenTimeImport,
  screenTimeResultText,
} from '../import/screenTimeImport'
import type { ScreenTimeFile, ScreenTimeImportPlan } from '../import/screenTimeImport'
import { messages } from '../i18n'
import { getDeviceTimezone, isValidTimezone } from '../time/time'
import { IssueList } from './SleepImportPreview'
import { TimezoneField } from './TimezoneField'

interface ScreenTimeImportPanelProps {
  /** Called after days were imported, so pages can reload data. */
  onImported?: () => void
}

/**
 * Import daily screen time from App Usage "Usage history" CSV files.
 * Files are read on this device only. A preview shows what will happen
 * before anything is written; the import itself is all or nothing.
 */
export function ScreenTimeImportPanel({ onImported }: ScreenTimeImportPanelProps) {
  const t = messages()
  const s = t.screenTimeFile
  const i = t.imports
  const id = useId()
  const [timezone, setTimezone] = useState(getDeviceTimezone)
  const [files, setFiles] = useState<ScreenTimeFile[]>([])
  const [plan, setPlan] = useState<ScreenTimeImportPlan | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [inputKey, setInputKey] = useState(0)

  function reset() {
    setPlan(null)
    setFiles([])
    setInputKey((key) => key + 1)
  }

  async function preview(chosen: ScreenTimeFile[], zone: string) {
    setError('')
    setPlan(null)

    if (chosen.length === 0) return
    if (!isValidTimezone(zone)) {
      setError(s.invalidZone)
      return
    }

    setWorking(true)
    try {
      setPlan(await previewScreenTimeImport(chosen, zone))
    } catch (caughtError) {
      console.error('Screen-time preview failed:', caughtError)
      setError(caughtError instanceof Error ? caughtError.message : s.readFilesFailed)
    } finally {
      setWorking(false)
    }
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    setResult('')
    const list = Array.from(event.target.files ?? [])

    try {
      const chosen = await Promise.all(list.map(async (file) => ({ fileName: file.name, text: await file.text() })))
      setFiles(chosen)
      await preview(chosen, timezone)
    } catch (caughtError) {
      console.error('Reading screen-time files failed:', caughtError)
      setError(s.readChosenFailed)
    }
  }

  function handleTimezone(zone: string) {
    setTimezone(zone)
    if (files.length > 0) void preview(files, zone)
  }

  async function handleImport() {
    if (!plan) return

    setError('')
    setWorking(true)
    try {
      const imported = await applyScreenTimeImport(plan)
      setResult(screenTimeResultText(plan, imported))
      reset()
      onImported?.()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : i.nothingImported)
    } finally {
      setWorking(false)
    }
  }

  const rows: [string, number, string][] = plan
    ? [
        [i.willImport, plan.toAdd.length, s.newDays],
        [i.skippedDuplicates, plan.duplicates.length, s.chosenTwice],
        [i.needAttention, plan.needsAttention.length, i.notImportedList],
        [i.invalid, plan.invalid.length, i.notImportedReasons],
      ]
    : []

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{s.title}</h3>

      <p className="mt-1 text-sm text-slate-500">
        {s.intro}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <TimezoneField
          id={`${id}-timezone`}
          value={timezone}
          onChange={handleTimezone}
          label={s.timezone}
          help={s.timezoneHelp}
        />

        <div>
          <label htmlFor={`${id}-files`} className="mb-1 block text-xs font-medium text-slate-600">
            {s.files}
          </label>
          <input
            key={inputKey}
            id={`${id}-files`}
            type="file"
            multiple
            accept=".csv,text/csv"
            disabled={working}
            onChange={(event) => void handleFiles(event)}
            className="block w-full text-sm text-slate-600"
          />
        </div>
      </div>

      {working && !plan && <p className="mt-3 text-sm text-slate-500">{s.reading}</p>}

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {result && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{result}</p>}

      {plan && (
        <div className="mt-4 space-y-4">
          <p className="text-sm">
            {s.found(plan.fileCount, plan.found)}
            {plan.firstDate && plan.lastDate
              ? i.fromTo(formatDayMonthYear(plan.firstDate), formatDayMonthYear(plan.lastDate))
              : ''}
            {s.readAs(plan.timezone)}
          </p>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <tbody>
                {rows.map(([label, count, note]) => (
                  <tr key={label} className="border-b border-slate-200 last:border-b-0">
                    <th scope="row" className="px-3 py-2 font-normal">{label}</th>
                    <td className="px-3 py-2 tabular-nums font-semibold">{count}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <IssueList title={i.needAttention} issues={plan.needsAttention} />
          <IssueList title={i.invalidNotImported} issues={plan.invalid} />
          <IssueList title={i.skippedDuplicates} issues={plan.duplicates} />

          {plan.notes.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
              {plan.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}

          {plan.toAdd.length === 0 && (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{i.nothingNew}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {plan.toAdd.length > 0 && (
              <button
                type="button"
                disabled={working}
                onClick={() => void handleImport()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {working ? i.importingDots : s.importCount(plan.toAdd.length)}
              </button>
            )}
            <button
              type="button"
              disabled={working}
              onClick={reset}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
