import { useEffect, useId, useState } from 'react'

import { downloadBackup } from '../backup/download'
import { db } from '../database/db'
import { messages } from '../i18n'
import {
  backupRequired,
  clearJustDeleted,
  deleteAllLocalData,
  markJustDeleted,
  missingSteps,
  summarizeLocalData,
  wasJustDeleted,
} from '../database/deleteAll'
import type { DeleteChoices, LocalDataSummary } from '../database/deleteAll'

/**
 * "Danger zone" at the bottom of Settings & Data (post-spec improvement 2).
 * Deletes every record on THIS device only; see src/database/deleteAll.ts
 * for the safeguards. The cloud copy, other devices and backup files are
 * never touched.
 */

const NO_CHOICES: DeleteChoices = { backupDownloaded: false, acceptLosingUnsent: false, acceptLosingStopwatches: false, confirmation: '' }
const buttonClass = 'rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 disabled:opacity-50'

export interface DeleteAllDataPanelProps {
  /** Sends unsent changes now (null when sync is not available). */
  syncNow: (() => Promise<unknown>) | null
  /** Runs after the local deletion: sign out, clear phone files. Errors are reported, the deletion stays done. */
  afterDeletion: () => Promise<void>
  /** Restarts the app (reload), so no screen keeps showing deleted data. */
  restart: () => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : messages().deleteAll.somethingWrong
}

export function DeleteAllDataPanel({ syncNow, afterDeletion, restart }: DeleteAllDataPanelProps) {
  const t = messages()
  const d = t.deleteAll
  const id = useId()
  const [justDeleted] = useState(wasJustDeleted)
  const [summary, setSummary] = useState<LocalDataSummary | null>(null)
  const [choices, setChoices] = useState<DeleteChoices>(NO_CHOICES)
  const [busy, setBusy] = useState<'' | 'review' | 'sync' | 'backup' | 'delete'>('')
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')

  useEffect(() => {
    if (justDeleted) clearJustDeleted()
  }, [justDeleted])

  async function review(note = '') {
    setBusy('review')
    setError(note)
    try {
      setSummary(await summarizeLocalData(db))
      setChoices(NO_CHOICES)
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy('')
    }
  }

  async function sync() {
    if (!syncNow) return
    setBusy('sync')
    setError('')
    try {
      await syncNow()
    } catch (caught) {
      setError(messageOf(caught))
    }
    await review()
  }

  async function backup() {
    setBusy('backup')
    setError('')
    try {
      await downloadBackup()
      setChoices((current) => ({ ...current, backupDownloaded: true }))
    } catch (caught) {
      setError(d.backupFailed(messageOf(caught)))
    } finally {
      setBusy('')
    }
  }

  async function remove() {
    if (!summary) return
    setBusy('delete')
    setError('')
    try {
      await deleteAllLocalData(db, summary, choices)
    } catch (caught) {
      // Nothing was deleted: show the current state again.
      await review(messageOf(caught))
      return
    }
    try {
      await afterDeletion()
    } catch (caught) {
      setWarning(d.lastStepFailed(messageOf(caught)))
      setBusy('')
      setSummary(null)
      return
    }
    markJustDeleted()
    restart()
  }

  const missing = summary ? missingSteps(summary, choices) : []
  const needsBackup = summary ? backupRequired(summary) : false

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-xl border border-red-200 bg-white p-6 shadow-sm">
      <h3 id={`${id}-title`} className="text-lg font-semibold text-red-700">{d.title}</h3>

      {justDeleted && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {d.justDeleted}
        </p>
      )}
      {warning && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{warning}</p>}

      <p className="text-sm text-slate-600">
        {d.introBefore} <strong>{d.introNot}</strong> {d.introAfter}
      </p>

      {!summary ? (
        <button type="button" className={buttonClass} disabled={busy !== ''} onClick={() => void review()}>
          {busy === 'review' ? d.checking : d.review}
        </button>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium">{d.onThisDevice}</p>
            <ul className="mt-1 list-disc pl-6 text-sm text-slate-700">
              {summary.counts.filter((item) => item.count > 0).map((item) => (
                <li key={item.label}>{d.count(item.count, item.label)}</li>
              ))}
              {summary.total === 0 && <li>{d.noRecords}</li>}
              <li>{summary.linked ? d.linked : d.notLinked}</li>
            </ul>
          </div>

          {summary.linked && summary.pending > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p>{d.pending(summary.pending)}</p>
              {syncNow && (
                <button type="button" className={buttonClass} disabled={busy !== ''} onClick={() => void sync()}>
                  {busy === 'sync' ? d.syncing : d.syncNow}
                </button>
              )}
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={choices.acceptLosingUnsent} onChange={(event) => setChoices({ ...choices, acceptLosingUnsent: event.target.checked })} />
                <span>{d.acceptUnsent(summary.pending)}</span>
              </label>
            </div>
          )}

          {needsBackup && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p>
                {!summary.linked
                  ? d.backupNotLinked
                  : d.backupNotSafe}{' '}
                {d.keepFile}
              </p>
              <button type="button" className={buttonClass} disabled={busy !== ''} onClick={() => void backup()}>
                {busy === 'backup' ? d.preparing : choices.backupDownloaded ? d.downloadAgain : d.downloadBackup}
              </button>
            </div>
          )}

          {summary.runningStopwatches > 0 && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <input type="checkbox" className="mt-1" checked={choices.acceptLosingStopwatches} onChange={(event) => setChoices({ ...choices, acceptLosingStopwatches: event.target.checked })} />
              <span>{d.acceptStopwatches(summary.runningStopwatches)}</span>
            </label>
          )}

          <div>
            <label htmlFor={`${id}-confirm`} className="mb-1 block text-xs font-medium text-slate-600">{t.common.typeToConfirm(t.confirmWords.delete)}</label>
            <input
              id={`${id}-confirm`}
              className="w-48 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
              autoComplete="off"
              value={choices.confirmation}
              onChange={(event) => setChoices({ ...choices, confirmation: event.target.value })}
            />
          </div>

          {missing.length > 0 && (
            <ul className="list-disc pl-6 text-xs text-slate-500" aria-label={d.stillNeeded}>
              {missing.map((step) => <li key={step}>{step}</li>)}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={missing.length > 0 || busy !== ''}
              onClick={() => void remove()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'delete' ? d.deleting : d.deleteAll}
            </button>
            <button type="button" className={buttonClass} disabled={busy !== ''} onClick={() => { setSummary(null); setError('') }}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </section>
  )
}
