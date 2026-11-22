import { useId, useState } from 'react'

import type { ChangeEvent } from 'react'

import { messages } from '../i18n'
import { importResultText } from '../import/importReport'
import type { SleepImportPlan } from '../import/sleepImport'
import { SleepImportPreview } from './SleepImportPreview'

interface HealthConnectImportPanelProps {
  /** Called after sessions were imported, so pages can reload data. */
  onImported?: () => void
}

/**
 * Import sleep sessions from a Health Connect export (.zip or .db).
 * The file is read on this device only. A preview shows what will happen
 * before anything is written; the import itself is all or nothing.
 */
export function HealthConnectImportPanel({ onImported }: HealthConnectImportPanelProps) {
  const t = messages()
  const id = useId()
  const [plan, setPlan] = useState<SleepImportPlan | null>(null)
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

    if (!file) {
      return
    }

    setWorking(true)

    try {
      // Loaded on demand: the zip reader and SQLite engine are only needed here.
      const { previewHealthConnectImport } = await import('../import/sleepImport')
      setPlan(await previewHealthConnectImport(new Uint8Array(await file.arrayBuffer()), file.name))
    } catch (caughtError) {
      console.error('Import preview failed:', caughtError)
      setError(caughtError instanceof Error ? caughtError.message : t.imports.readFileFailed)
    } finally {
      setWorking(false)
    }
  }

  async function handleImport() {
    if (!plan) {
      return
    }

    setError('')
    setWorking(true)

    try {
      const { applySleepImport } = await import('../import/sleepImport')
      const imported = await applySleepImport(plan)

      setResult(importResultText(plan, imported))
      reset()
      onImported?.()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t.imports.nothingImported)
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{t.healthConnectFile.title}</h3>

      <p className="mt-1 text-sm text-slate-500">
        {t.healthConnectFile.intro}
      </p>

      <div className="mt-4">
        <label htmlFor={`${id}-file`} className="mb-1 block text-sm font-medium">
          {t.healthConnectFile.file}
        </label>
        <input
          key={inputKey}
          id={`${id}-file`}
          type="file"
          accept=".zip,.db,application/zip"
          disabled={working}
          onChange={(event) => void handleFile(event)}
          className="block w-full text-sm text-slate-600"
        />
      </div>

      {working && !plan && <p className="mt-3 text-sm text-slate-500">{t.imports.readingExport}</p>}

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {result && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{result}</p>}

      {plan && (
        <div className="mt-4">
          <SleepImportPreview plan={plan} working={working} onImport={() => void handleImport()} onCancel={reset} />
        </div>
      )}
    </section>
  )
}
