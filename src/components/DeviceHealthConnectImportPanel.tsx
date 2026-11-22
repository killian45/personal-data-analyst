import { useState, useSyncExternalStore } from 'react'

import { messages } from '../i18n'
import { importResultText } from '../import/importReport'
import type { SleepImportPlan } from '../import/sleepImport'
import type { SyncController, SyncSnapshot } from '../sync/syncController'
import { SleepImportPreview } from './SleepImportPreview'

interface DeviceHealthConnectImportPanelProps {
  /** Sync controller once loaded (null: sync off or still loading). */
  controller: SyncController | null
  /** Sync is configured for this build (then wait for the controller). */
  syncConfigured: boolean
  onImported: () => void
}

const noSubscription = () => () => {}
const noSnapshot = (): SyncSnapshot | null => null

/**
 * Health Connect import on the phone (Android app only). Reads sleep only;
 * a preview shows what will happen before anything is saved.
 *
 * Sync first (docs/ANDROID_PLAN.md §3.7): on a device linked to sync, the
 * import is available only after a successful sync in this session, so
 * nights already imported on another device arrive first and are skipped
 * as duplicates instead of becoming sync problems.
 */
export default function DeviceHealthConnectImportPanel({
  controller,
  syncConfigured,
  onImported,
}: DeviceHealthConnectImportPanelProps) {
  const t = messages()
  const i = t.imports
  const snapshot = useSyncExternalStore(
    controller ? controller.subscribe : noSubscription,
    controller ? controller.getSnapshot : noSnapshot,
  )
  const [plan, setPlan] = useState<SleepImportPlan | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')

  const waitingForSync = syncConfigured && !controller
  const mustSyncFirst = Boolean(snapshot?.linkedUserId) && snapshot?.lastResult?.status !== 'ok'

  async function preview() {
    setError('')
    setResult('')
    setPlan(null)
    setWorking(true)
    try {
      const { previewDeviceSleepImport } = await import('../import/deviceSleepImport')
      setPlan(await previewDeviceSleepImport())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.deviceSleep.readFailed)
    } finally {
      setWorking(false)
    }
  }

  async function confirmImport() {
    if (!plan) return
    setError('')
    setWorking(true)
    try {
      const { applySleepImport } = await import('../import/sleepImport')
      const imported = await applySleepImport(plan)
      setResult(importResultText(plan, imported))
      setPlan(null)
      onImported()
      // Send the new nights to the other devices.
      if (snapshot?.linkedUserId && imported > 0) void controller?.syncNow()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : i.nothingImported)
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{t.deviceSleep.title}</h3>
      <p className="mt-1 text-sm text-slate-500">
        {t.deviceSleep.intro}
      </p>

      {waitingForSync ? (
        <p className="mt-4 text-sm text-slate-500">{i.loadingSync}</p>
      ) : mustSyncFirst ? (
        <div className="mt-4 space-y-2 text-sm">
          <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
            {t.deviceSleep.syncFirst}
            {snapshot?.lastResult && snapshot.lastResult.status !== 'ok' && i.lastSyncUnfinished}
          </p>
          <button
            type="button"
            disabled={snapshot?.running}
            onClick={() => void controller?.syncNow()}
            className="rounded-lg border border-slate-300 px-4 py-2 font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            {snapshot?.running ? i.syncing : i.syncNow}
          </button>
        </div>
      ) : (
        !plan && (
          <button
            type="button"
            disabled={working}
            onClick={() => void preview()}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {working ? t.deviceSleep.reading : t.deviceSleep.check}
          </button>
        )
      )}

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {result && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{result}</p>}

      {plan && (
        <div className="mt-4">
          <SleepImportPreview
            plan={plan}
            working={working}
            onImport={() => void confirmImport()}
            onCancel={() => setPlan(null)}
          />
        </div>
      )}
    </section>
  )
}
