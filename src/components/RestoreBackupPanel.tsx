import { useId, useState } from 'react'

import type { ChangeEvent } from 'react'

import {
  applyRestore,
  countAdditions,
  previewRestore,
  RESTORE_TABLES,
} from '../backup/restore/restore'
import type { RestoreIssue, RestorePlan } from '../backup/restore/restore'
import { formatInTimezone, getDeviceTimezone } from '../time/time'
import { messages } from '../i18n'

interface RestoreBackupPanelProps {
  /** Called after records were added, so pages can reload their data. */
  onRestored?: () => void
}

const MAX_LISTED = 50

function IssueList({ title, issues }: { title: string; issues: RestoreIssue[] }) {
  if (issues.length === 0) {
    return null
  }

  return (
    <details className="rounded-lg border border-slate-200 p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {messages().restore.groupTitle(title, issues.length)}
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
        {issues.slice(0, MAX_LISTED).map((issue, index) => (
          <li key={`${issue.label}-${index}`}>
            {messages().restore.issue(issue.label, issue.reason)}
          </li>
        ))}
      </ul>
      {issues.length > MAX_LISTED && (
        <p className="mt-2 text-xs text-slate-500">
          {messages().restore.andMore(issues.length - MAX_LISTED)}
        </p>
      )}
    </details>
  )
}

/**
 * Restore from a JSON backup: choose a file, review what will happen,
 * then confirm. Restoring only adds records; nothing on this device is
 * overwritten or deleted.
 */
export function RestoreBackupPanel({ onRestored }: RestoreBackupPanelProps) {
  const t = messages()
  const r = t.restore
  const id = useId()

  const [fileName, setFileName] = useState('')
  const [plan, setPlan] = useState<RestorePlan | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [inputKey, setInputKey] = useState(0)

  function reset() {
    setPlan(null)
    setFileName('')
    setInputKey((key) => key + 1)
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    setError('')
    setResult('')
    setPlan(null)

    if (!file) {
      return
    }

    setFileName(file.name)
    setWorking(true)

    try {
      setPlan(await previewRestore(await file.text()))
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : r.readFailed)
    } finally {
      setWorking(false)
    }
  }

  async function handleRestore() {
    if (!plan) {
      return
    }

    setError('')
    setWorking(true)

    try {
      const added = await applyRestore(plan)
      const skipped = RESTORE_TABLES.reduce((total, table) => total + plan[table].identical, 0)

      setResult(
        r.restored(added, skipped),
      )
      reset()
      onRestored?.()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : r.nothingRestored)
    } finally {
      setWorking(false)
    }
  }

  const additions = plan ? countAdditions(plan) : 0
  const differing = plan ? RESTORE_TABLES.flatMap((table) => plan[table].differing) : []
  const invalid = plan ? RESTORE_TABLES.flatMap((table) => plan[table].invalid) : []

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{r.title}</h3>

      <p className="mt-1 text-sm text-slate-500">
        {r.intro}
      </p>

      <div className="mt-4">
        <label htmlFor={`${id}-file`} className="mb-1 block text-sm font-medium">
          {r.file}
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

      {working && !plan && <p className="mt-3 text-sm text-slate-500">{r.checking}</p>}

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {result && (
        <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {result}
        </p>
      )}

      {plan && (
        <div className="mt-4 space-y-4">
          <p className="text-sm">
            {r.madeOn(fileName, formatInTimezone(plan.exportedAt, getDeviceTimezone(), 'd MMM yyyy, HH:mm'), plan.schemaVersion < 5 ? plan.schemaVersion : null)}
          </p>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">{r.columns.data}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{r.columns.add}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{r.columns.identical}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{r.columns.differing}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{r.columns.invalid}</th>
                </tr>
              </thead>
              <tbody>
                {RESTORE_TABLES.map((table) => (
                  <tr key={table} className="border-b border-slate-200 last:border-b-0">
                    <th scope="row" className="px-3 py-2 font-normal">{r.tables[table]}</th>
                    <td className="px-3 py-2 tabular-nums">{plan[table].add.length}</td>
                    <td className="px-3 py-2 tabular-nums">{plan[table].identical}</td>
                    <td className="px-3 py-2 tabular-nums">{plan[table].differing.length}</td>
                    <td className="px-3 py-2 tabular-nums">{plan[table].invalid.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <IssueList title={r.invalidTitle} issues={invalid} />
          <IssueList title={r.differingTitle} issues={differing} />

          {plan.notes.length > 0 && (
            <details className="rounded-lg border border-slate-200 p-3 text-sm">
              <summary className="cursor-pointer font-medium">{r.corrections(plan.notes.length)}</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
                {plan.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </details>
          )}

          {additions === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              {r.nothingToRestore}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {additions > 0 && (
              <button
                type="button"
                disabled={working}
                onClick={() => void handleRestore()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {working ? r.restoring : r.restoreCount(additions)}
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
