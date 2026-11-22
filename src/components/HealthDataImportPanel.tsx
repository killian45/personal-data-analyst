import { useEffect, useState, useSyncExternalStore } from 'react'

import { HEALTH_LABELS } from '../healthData/healthData'
import { applyHealthImport, grantedKinds, healthImporter, IMPORT_KINDS, previewHealthImport } from '../healthData/healthImport'
import type { HealthPreview, ImportKind } from '../healthData/healthImport'
import { messages } from '../i18n'
import { formatDayMonthYear } from '../import/screenTimeImport'
import { describeImportedDays } from '../screenTime/autoImport'
import type { AutoImportOutcome } from '../screenTime/autoImport'
import type { SyncController, SyncSnapshot } from '../sync/syncController'
import { formatInTimezone, getDeviceTimezone } from '../time/time'

interface HealthDataImportPanelProps {
  controller: SyncController | null
  syncConfigured: boolean
  onImported: () => void
}

const noSubscription = () => () => {}
const noSnapshot = (): SyncSnapshot | null => null
const primaryButton =
  'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50'

function outcomeText(outcome: AutoImportOutcome): string {
  const t = messages().healthData
  if (outcome.kind === 'imported') return t.outcomeImported(describeImportedDays(outcome.dates))
  if (outcome.kind === 'nothing-new') return t.outcomeNothingNew
  return t.outcomeFailed(outcome.message)
}

/**
 * Health Connect activity and heart data on the phone (Android app only;
 * docs/HEALTH_DATA_PLAN.md): access, automatic import and "Import now".
 */
export default function HealthDataImportPanel({ controller, syncConfigured, onImported }: HealthDataImportPanelProps) {
  const t = messages()
  const h = t.healthData
  const i = t.imports
  const snapshot = useSyncExternalStore(controller ? controller.subscribe : noSubscription, controller ? controller.getSnapshot : noSnapshot)
  const auto = useSyncExternalStore(healthImporter.subscribe, healthImporter.getState)
  const [kinds, setKinds] = useState<ImportKind[] | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<HealthPreview | null>(null)

  const waitingForSync = syncConfigured && !controller
  const mustSyncFirst = Boolean(snapshot?.linkedUserId) && snapshot?.lastResult?.status !== 'ok'

  useEffect(() => {
    let cancelled = false
    import('../healthData/healthDataPlugin')
      .then(({ grantedHealthPermissions }) => grantedHealthPermissions())
      .then((granted) => {
        if (!cancelled) setKinds(grantedKinds(granted))
      })
      .catch((caught: unknown) => {
        console.error('Health Connect permission check failed:', caught)
        if (!cancelled) setError(messages().healthData.checkFailed)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function allow() {
    setError('')
    try {
      const { requestHealthDataPermissions } = await import('../healthData/healthDataPlugin')
      setKinds(grantedKinds(await requestHealthDataPermissions()))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : h.askFailed)
    }
  }

  async function importNow() {
    setError('')
    setResult(null)
    setWorking(true)
    try {
      const plan = await previewHealthImport()
      if (plan.toAdd.length + plan.toUpdate.length > 0) {
        await applyHealthImport(plan)
        onImported()
        if (snapshot?.linkedUserId) void controller?.syncNow()
      }
      setResult(plan)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : i.nothingImported)
    } finally {
      setWorking(false)
    }
  }

  const when = (ms: number) => formatInTimezone(new Date(ms).toISOString(), getDeviceTimezone(), 'dd/MM/yyyy HH:mm')
  const missing = kinds ? IMPORT_KINDS.filter((kind) => !kinds.includes(kind)) : []

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{h.title}</h3>
      <p className="mt-1 text-sm text-slate-500">
        {h.intro}
      </p>

      {kinds === null ? (
        !error && <p className="mt-4 text-sm text-slate-500">{h.checkingAccess}</p>
      ) : (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            {h.allowed} <span className="font-medium">{kinds.length === 0 ? h.nothingYet : kinds.map((kind) => HEALTH_LABELS[kind]).join(', ')}</span>
          </p>
          {missing.length > 0 && (
            <button type="button" onClick={() => void allow()} className={secondaryButton}>
              {kinds.length === 0 ? h.allowAccess : h.allowOthers(missing.map((kind) => HEALTH_LABELS[kind]).join(', '))}
            </button>
          )}
        </div>
      )}

      {kinds !== null && kinds.length > 0 && (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            {h.automatic} <span className="font-medium">{auto.enabled ? h.on : h.off}</span>
            {auto.last && h.lastRun(when(auto.last.atMs), outcomeText(auto.last))}
          </p>
          <button type="button" onClick={() => healthImporter.setEnabled(!auto.enabled)} className={secondaryButton}>
            {auto.enabled ? h.turnOff : h.turnOn}
          </button>

          {waitingForSync ? (
            <p className="text-slate-500">{i.loadingSync}</p>
          ) : mustSyncFirst ? (
            <div className="space-y-2">
              <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
                {h.syncFirst}
              </p>
              <button type="button" disabled={snapshot?.running} onClick={() => void controller?.syncNow()} className={secondaryButton}>
                {snapshot?.running ? i.syncing : i.syncNow}
              </button>
            </div>
          ) : (
            <button type="button" disabled={working} onClick={() => void importNow()} className={`block ${primaryButton}`}>
              {working ? i.importing : h.importNow}
            </button>
          )}
        </div>
      )}

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {result && (
        <div role="status" className="mt-4 space-y-1 rounded-lg bg-green-50 p-3 text-sm text-green-700">
          <p>
            {h.result(formatDayMonthYear(result.from), formatDayMonthYear(result.to), result.toAdd.length, result.toUpdate.length, result.unchanged, result.deletedInPda)}
          </p>
          {result.notImported.length > 0 && (
            <details>
              <summary className="cursor-pointer">{h.notImported(result.notImported.length)}</summary>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {result.notImported.slice(0, 50).map((item, index) => <li key={index}>{i.issueNoDot(item.label, item.reason)}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  )
}
