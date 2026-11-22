import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { deviceScreenTimeResultText } from '../import/deviceScreenTimeImport'
import type { DeviceScreenTimePlan } from '../import/deviceScreenTimeImport'
import { applyScreenTimeImport, formatDayMonthYear } from '../import/screenTimeImport'
import { describeImportedDays, getAutoImportState, setAutoImportEnabled, subscribeAutoImport } from '../screenTime/autoImport'
import type { AutoImportOutcome } from '../screenTime/autoImport'
import {
  ensureUsageCapture,
  hasUsageAccess,
  openAppSettings,
  openUsageAccessSettings,
  readCaptureStatus,
  startUsageCapture,
  stopUsageCapture,
} from '../screenTime/usageStatsPlugin'
import type { CaptureStatus } from '../screenTime/usageStatsPlugin'
import { messages } from '../i18n'
import { formatInTimezone, getDeviceTimezone } from '../time/time'
import type { SyncController, SyncSnapshot } from '../sync/syncController'
import { IssueList } from './SleepImportPreview'

interface DeviceScreenTimeImportPanelProps {
  /** Sync controller once loaded (null: sync off or still loading). */
  controller: SyncController | null
  /** Sync is configured for this build (then wait for the controller). */
  syncConfigured: boolean
  onImported: () => void
}

const noSubscription = () => () => {}
const noSnapshot = (): SyncSnapshot | null => null

function autoImportResultText(outcome: AutoImportOutcome): string {
  const t = messages()
  if (outcome.kind === 'imported') return t.deviceScreenTime.outcomeImported(describeImportedDays(outcome.dates))
  if (outcome.kind === 'nothing-new') return t.healthData.outcomeNothingNew
  return t.healthData.outcomeFailed(outcome.message)
}

const secondaryButton =
  'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50'
const primaryButton =
  'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Screen-time import on the phone (Android app only), from Android's
 * usage history ("Usage access", switched on by the user in Settings).
 * Reads only; a preview shows what will happen before anything is saved.
 * Sync first, like the Health Connect import (docs/ANDROID_PLAN.md §3.7).
 */
export default function DeviceScreenTimeImportPanel({ controller, syncConfigured, onImported }: DeviceScreenTimeImportPanelProps) {
  const t = messages()
  const d = t.deviceScreenTime
  const h = t.healthData
  const i = t.imports
  const snapshot = useSyncExternalStore(
    controller ? controller.subscribe : noSubscription,
    controller ? controller.getSnapshot : noSnapshot,
  )
  const [access, setAccess] = useState<boolean | null>(null)
  const [capture, setCapture] = useState<CaptureStatus | null>(null)
  const [plan, setPlan] = useState<DeviceScreenTimePlan | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const autoImport = useSyncExternalStore(subscribeAutoImport, getAutoImportState)

  const waitingForSync = syncConfigured && !controller
  const mustSyncFirst = Boolean(snapshot?.linkedUserId) && snapshot?.lastResult?.status !== 'ok'

  /** Usage access, then (when on) make sure automatic saving runs and read its state. */
  const loadState = useCallback(async (): Promise<{ granted: boolean; status: CaptureStatus | null }> => {
    const granted = await hasUsageAccess()
    if (!granted) return { granted, status: null }
    await ensureUsageCapture()
    return { granted, status: await readCaptureStatus() }
  }, [])

  const checkAccess = useCallback(() => {
    loadState()
      .then(({ granted, status }) => {
        setAccess(granted)
        setCapture(status)
      })
      .catch((caught: unknown) => {
        console.error('Usage access check failed:', caught)
        setError(messages().deviceScreenTime.checkFailed)
      })
  }, [loadState])

  useEffect(() => {
    let cancelled = false
    loadState()
      .then(({ granted, status }) => {
        if (!cancelled) {
          setAccess(granted)
          setCapture(status)
        }
      })
      .catch((caught: unknown) => {
        console.error('Usage access check failed:', caught)
        if (!cancelled) setError(messages().deviceScreenTime.checkFailed)
      })
    // Coming back from the phone's Settings: check again.
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkAccess()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [checkAccess, loadState])

  async function toggleCapture(on: boolean) {
    setError('')
    try {
      if (on) await startUsageCapture()
      else await stopUsageCapture()
      setCapture(await readCaptureStatus())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : d.captureFailed)
    }
  }

  const zone = getDeviceTimezone()
  const when = (ms: number) => formatInTimezone(new Date(ms).toISOString(), zone, 'dd/MM/yyyy HH:mm')

  async function preview() {
    setError('')
    setResult('')
    setPlan(null)
    setWorking(true)
    try {
      const { previewDeviceScreenTimeImport } = await import('../import/deviceScreenTimeImport')
      setPlan(await previewDeviceScreenTimeImport())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : d.readFailed)
    } finally {
      setWorking(false)
    }
  }

  async function confirmImport() {
    if (!plan) return
    setError('')
    setWorking(true)
    try {
      const imported = await applyScreenTimeImport(plan)
      setResult(deviceScreenTimeResultText(plan, imported))
      setPlan(null)
      onImported()
      // Send the new days to the other devices.
      if (snapshot?.linkedUserId && imported > 0) void controller?.syncNow()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : i.nothingImported)
    } finally {
      setWorking(false)
    }
  }

  const rows: [string, number, string][] = plan
    ? [
        [i.willImport, plan.toAdd.length, d.newDays],
        [d.alreadyImported, plan.duplicates.length, d.skipped],
        [i.needAttention, plan.needsAttention.length, i.notImportedList],
        [d.incomplete, plan.skipped.length, i.notImportedList],
        [i.invalid, plan.invalid.length, i.notImportedReasons],
      ]
    : []

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{d.title}</h3>
      <p className="mt-1 text-sm text-slate-500">
        {d.intro}
      </p>

      <p className="mt-4 text-sm">
        {d.usageAccess} <span className="font-medium">{access === null ? d.checking : access ? h.on : h.off}</span>
      </p>

      {access === false && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} onClick={() => void openUsageAccessSettings()}>
              {d.openUsageSettings}
            </button>
            <button type="button" className={secondaryButton} onClick={checkAccess}>
              {d.checkAgain}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            {d.usageHelp}
          </p>
        </div>
      )}

      {access && capture && (
        <div className="mt-3 space-y-2 text-sm">
          <p>
            {d.automaticSaving} <span className="font-medium">{capture.enabled === false ? h.off : h.on}</span>
            {capture.enabled !== false && capture.lastRunMs !== null && d.lastSaved(when(capture.lastRunMs))}
            {capture.coveredFromMs !== null && d.savedFrom(when(capture.coveredFromMs).slice(0, 10))}
          </p>
          {capture.enabled !== false && !capture.batteryUnrestricted && (
            <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              <p>
                {d.batteryNote}
              </p>
              <button type="button" className={`mt-2 ${secondaryButton}`} onClick={() => void openAppSettings()}>
                {d.openAppSettings}
              </button>
            </div>
          )}
          <button type="button" className={secondaryButton} onClick={() => void toggleCapture(capture.enabled === false)}>
            {capture.enabled === false ? d.turnOnSaving : d.turnOffSaving}
          </button>
        </div>
      )}

      {access && (
        <div className="mt-3 space-y-2 text-sm">
          <p>
            {h.automatic} <span className="font-medium">{autoImport.enabled ? h.on : h.off}</span>
            {autoImport.last && h.lastRun(when(autoImport.last.atMs), autoImportResultText(autoImport.last))}
          </p>
          <p className="text-xs text-slate-500">
            {d.autoHelp}
          </p>
          <button type="button" className={secondaryButton} onClick={() => setAutoImportEnabled(!autoImport.enabled)}>
            {autoImport.enabled ? h.turnOff : h.turnOn}
          </button>
        </div>
      )}

      {access &&
        (waitingForSync ? (
          <p className="mt-4 text-sm text-slate-500">{i.loadingSync}</p>
        ) : mustSyncFirst ? (
          <div className="mt-4 space-y-2 text-sm">
            <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
              {d.syncFirst}
              {snapshot?.lastResult && snapshot.lastResult.status !== 'ok' && i.lastSyncUnfinished}
            </p>
            <button type="button" disabled={snapshot?.running} onClick={() => void controller?.syncNow()} className={secondaryButton}>
              {snapshot?.running ? i.syncing : i.syncNow}
            </button>
          </div>
        ) : (
          !plan && (
            <button type="button" disabled={working} onClick={() => void preview()} className={`mt-4 ${primaryButton}`}>
              {working ? d.reading : d.check}
            </button>
          )
        ))}

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {result && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{result}</p>}

      {plan && (
        <div className="mt-4 space-y-4">
          <p className="text-sm">
            {d.found(plan.found)}
            {plan.firstDate && plan.lastDate ? i.fromTo(formatDayMonthYear(plan.firstDate), formatDayMonthYear(plan.lastDate)) : ''}
            {t.screenTimeFile.readAs(plan.timezone)}
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
          <IssueList title={d.incompleteTitle} issues={plan.skipped} />
          <IssueList title={i.invalidNotImported} issues={plan.invalid} />
          <IssueList title={d.alreadyImported} issues={plan.duplicates} />

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
              <button type="button" disabled={working} onClick={() => void confirmImport()} className={primaryButton}>
                {working ? i.importingDots : t.screenTimeFile.importCount(plan.toAdd.length)}
              </button>
            )}
            <button type="button" disabled={working} onClick={() => setPlan(null)} className={secondaryButton}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
