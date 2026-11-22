import { useState, useSyncExternalStore } from 'react'

import {
  DEVICE_IMPORT_KINDS,
  getDeviceImports,
  isDeviceImportAvailable,
  setDeviceImport,
  subscribeDeviceImports,
} from '../settings/deviceImports'
import type { DeviceImportKind } from '../settings/deviceImports'
import { messages } from '../i18n'
import { getFeatures, subscribeFeatures } from '../settings/features'

const secondaryButton =
  'rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50'



interface DeviceImportSwitchesPanelProps {
  /** Called after screen time is turned off (stops the background saving). */
  onScreenTimeOff?: () => Promise<void>
}

/**
 * "What this device imports" (Android app only): one on/off switch per
 * kind of data, for this device only (src/settings/deviceImports.ts).
 */
export function DeviceImportSwitchesPanel({ onScreenTimeOff }: DeviceImportSwitchesPanelProps) {
  const t = messages().settings.deviceImports
  const switches = useSyncExternalStore(subscribeDeviceImports, getDeviceImports)
  // Re-render when a feature changes: kinds of features that are off are not listed (S4).
  useSyncExternalStore(subscribeFeatures, getFeatures)
  const [error, setError] = useState('')

  function toggle(kind: DeviceImportKind) {
    const on = !switches[kind]
    setError('')
    setDeviceImport(kind, on)
    if (kind === 'screenTime' && !on && onScreenTimeOff) {
      onScreenTimeOff().catch((caught: unknown) => {
        console.error('Could not stop saving screen time in the background:', caught)
        setError(t.stopFailed)
      })
    }
  }

  return (
    <section aria-labelledby="device-imports-heading" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 id="device-imports-heading" className="text-lg font-semibold">{t.title}</h2>
      <p className="mt-1 text-sm text-slate-600">
        {t.intro}
      </p>

      <ul className="mt-4 text-sm">
        {DEVICE_IMPORT_KINDS.filter(isDeviceImportAvailable).map((kind) => (
          <li key={kind} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 py-2 first:border-t-0">
            <span>
              {t.kinds[kind]}: <span className="font-medium">{switches[kind] ? t.on : t.off}</span>
            </span>
            <button
              type="button"
              onClick={() => toggle(kind)}
              className={secondaryButton}
              aria-label={t.toggleNamed(switches[kind], t.kinds[kind])}
            >
              {switches[kind] ? t.turnOff : t.turnOn}
            </button>
          </li>
        ))}
      </ul>

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </section>
  )
}

/** One line shown instead of hidden import panels. */
export function DeviceImportOffNote({ kind }: { kind: DeviceImportKind }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
      {messages().settings.deviceImports.offNote(messages().settings.deviceImports.kinds[kind])}
    </p>
  )
}
