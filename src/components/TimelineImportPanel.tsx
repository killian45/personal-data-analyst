import { useId, useState } from 'react'

import type { ChangeEvent } from 'react'

import { applyLocationImport, locationResultText, previewLocationImport } from '../import/locationImport'
import type { LocationImportPlan } from '../import/locationImport'
import { messages } from '../i18n'
import { formatInTimezone, getDeviceTimezone } from '../time/time'
import { IssueList } from './SleepImportPreview'

interface TimelineImportPanelProps {
  /** Called after segments were imported, so pages can reload data. */
  onImported?: () => void
}

/**
 * Import location history (visits and movements) from a Google Maps
 * Timeline export. The file is read on this device only; a preview shows
 * what will happen; the import is all or nothing.
 */
export function TimelineImportPanel({ onImported }: TimelineImportPanelProps) {
  const t = messages()
  const l = t.timeline
  const i = t.imports
  const id = useId()
  const [plan, setPlan] = useState<LocationImportPlan | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [inputKey, setInputKey] = useState(0)

  function reset() {
    setPlan(null)
    setInputKey((key) => key + 1)
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setError('')
    setResult('')
    setPlan(null)
    if (!file) return

    setWorking(true)
    try {
      setPlan(await previewLocationImport(file.name, await file.text()))
    } catch (caught) {
      console.error('Timeline preview failed:', caught)
      setError(caught instanceof Error ? caught.message : i.readFileFailed)
    } finally {
      setWorking(false)
    }
  }

  async function handleImport() {
    if (!plan) return
    setError('')
    setWorking(true)
    try {
      const imported = await applyLocationImport(plan)
      setResult(locationResultText(plan, imported))
      reset()
      onImported?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : i.nothingImported)
    } finally {
      setWorking(false)
    }
  }

  const zone = getDeviceTimezone()
  const day = (utc: string) => formatInTimezone(utc, zone, 'dd/MM/yyyy')
  const visits = plan ? plan.toAdd.filter((sample) => sample.measurementType === 'location_visit').length : 0
  const rows: [string, number, string][] = plan
    ? [
        [i.willImport, plan.toAdd.length, l.willImportNote(visits, plan.toAdd.length - visits)],
        [l.willCorrect, plan.corrections.length, l.willCorrectNote],
        [i.skippedDuplicates, plan.duplicates.length, i.alreadyOrTwice],
        [i.needAttention, plan.needsAttention.length, i.notImportedList],
        [i.invalid, plan.invalid.length, i.notImportedReasons],
      ]
    : []

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{l.title}</h3>

      <p className="mt-1 text-sm text-slate-500">
        {l.intro}
      </p>

      <div className="mt-4">
        <label htmlFor={`${id}-file`} className="mb-1 block text-sm font-medium">
          {l.file}
        </label>
        <input
          key={inputKey}
          id={`${id}-file`}
          type="file"
          accept=".json,application/json"
          disabled={working}
          onChange={(event) => void handleFile(event)}
          className="block w-full text-sm text-slate-600"
        />
      </div>

      {working && !plan && <p className="mt-3 text-sm text-slate-500">{i.readingExport}</p>}

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {result && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{result}</p>}

      {plan && (
        <div className="mt-4 space-y-4">
          <p className="text-sm">
            <span className="font-medium">{plan.fileName}</span>: {l.found(plan.visitsFound, plan.movementsFound, plan.firstUtc && plan.lastUtc ? i.fromTo(day(plan.firstUtc), day(plan.lastUtc)) : '')}
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

          <IssueList
            title={l.correctionsTitle}
            issues={plan.corrections.map((item) => ({ label: item.label, reason: l.correctionReason }))}
          />
          <IssueList title={i.needAttention} issues={plan.needsAttention} />
          <IssueList title={i.invalidNotImported} issues={plan.invalid} />
          <IssueList title={i.skippedDuplicates} issues={plan.duplicates} />

          {plan.notImported.length > 0 && (
            <details className="rounded-lg border border-slate-200 p-3 text-sm">
              <summary className="cursor-pointer font-medium">{l.notImportedByDesign(plan.notImported.length)}</summary>
              <p className="mt-2 text-xs text-slate-600">
                {plan.notImported.map((item) => i.labelCount(item.label, item.count)).join(', ')}
              </p>
            </details>
          )}

          {plan.toAdd.length === 0 && plan.corrections.length === 0 && (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{i.nothingNew}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {(plan.toAdd.length > 0 || plan.corrections.length > 0) && (
              <button
                type="button"
                disabled={working}
                onClick={() => void handleImport()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {working
                  ? i.importingDots
                  : plan.toAdd.length > 0
                    ? l.importSegments(plan.toAdd.length, plan.corrections.length)
                    : l.correctSegments(plan.corrections.length)}
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
