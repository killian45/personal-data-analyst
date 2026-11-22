import { useEffect, useState } from 'react'

import { downloadBackup } from '../backup/download'
import { messages } from '../i18n'
import {
  getPersistenceStatus,
  getStorageEstimate,
  requestPersistentStorage,
} from '../storage/persistence'

import type {
  PersistenceStatus,
  StorageEstimateResult,
} from '../storage/persistence'

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function describeCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([table, count]) => messages().backup.tableCounts[table]?.(count) ?? `${count} ${table}`)
    .join(', ')
}

export function DataBackupPanel() {
  const t = messages().backup
  const [persistence, setPersistence] =
    useState<PersistenceStatus | null>(null)
  const [estimate, setEstimate] =
    useState<StorageEstimateResult | null>(null)

  const [exporting, setExporting] = useState(false)
  const [requesting, setRequesting] = useState(false)

  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    let cancelled = false

    Promise.all([getPersistenceStatus(), getStorageEstimate()])
      .then(([status, storageEstimate]) => {
        if (!cancelled) {
          setPersistence(status)
          setEstimate(storageEstimate)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPersistence('unsupported')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function handleExport() {
    setError('')
    setSuccess('')
    setExporting(true)

    try {
      const backup = await downloadBackup()

      setSuccess(
        t.downloaded(describeCounts(backup.counts)),
      )
    } catch (caughtError) {
      console.error('Backup export failed:', caughtError)

      setError(
        caughtError instanceof Error
          ? t.failedWith(caughtError.message)
          : t.failed,
      )
    } finally {
      setExporting(false)
    }
  }

  async function handleRequestPersistence() {
    setError('')
    setSuccess('')
    setRequesting(true)

    try {
      const status = await requestPersistentStorage()
      setPersistence(status)

      if (status === 'not-persistent') {
        setError(t.persistRefused)
      }
    } finally {
      setRequesting(false)
    }
  }

  return (
    <div className="space-y-6">
      {(error || success) && (
        <div className="space-y-2">
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          {success && (
            <p
              role="status"
              className="rounded-lg bg-green-50 p-3 text-sm text-green-700"
            >
              {success}
            </p>
          )}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold">{t.title}</h3>

        <p className="mt-1 text-sm text-slate-500">
          {t.intro}
        </p>

        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? t.preparing : t.download}
        </button>

        <p className="mt-3 text-xs text-slate-500">
          {t.restoreHint}
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold">{t.storageTitle}</h3>

        <p className="mt-2 text-sm text-slate-700">
          {persistence === null
            ? t.checking
            : t.persistence[persistence]}
        </p>

        {estimate && (
          <p className="mt-1 text-xs text-slate-500">
            {t.storageUsed(formatBytes(estimate.usageBytes))}
          </p>
        )}

        {persistence === 'not-persistent' && (
          <button
            type="button"
            onClick={() => void handleRequestPersistence()}
            disabled={requesting}
            className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {requesting
              ? t.asking
              : t.askPersist}
          </button>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold">{t.risksTitle}</h3>

        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
          {t.risks.map((risk) => (
            <li key={risk}>{risk}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
