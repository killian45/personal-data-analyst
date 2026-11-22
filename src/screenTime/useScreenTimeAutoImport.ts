import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'

import { db } from '../database/db'
import { isDeviceImportOn } from '../settings/deviceImports'
import type { SyncController } from '../sync/syncController'
import { getDeviceTimezone } from '../time/time'

import { screenTimeImporter } from './autoImport'
import type { AutoImporter, AutoImporterDeps, AutoImportOutcome, SyncGate } from './autoImport'

interface UseAutoImportOptions<Plan> {
  importer: AutoImporter<Plan>
  controller: SyncController | null
  syncConfigured: boolean
  hasAccess: () => Promise<boolean>
  preview: () => Promise<Plan>
  apply: (plan: Plan) => Promise<number>
  onImported: (outcome: Extract<AutoImportOutcome, { kind: 'imported' }>) => void
  /** Run on every platform (YNAB), not only in the phone app. */
  allPlatforms?: boolean
}

/**
 * Phone app only (unless allPlatforms): tries an automatic import when the app starts, when it
 * comes back to the screen and whenever sync changes state (so it runs
 * right after the first successful round). The importer's rules
 * (src/screenTime/autoImport.ts) decide whether anything actually runs.
 * After an import, a sync round sends the new data to the other devices.
 */
export function useAutoImport<Plan>(options: UseAutoImportOptions<Plan>): void {
  const { importer, controller, syncConfigured, allPlatforms = false } = options
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })

  useEffect(() => {
    if (!allPlatforms && Capacitor.getPlatform() !== 'android') return
    let active = true

    const deps: AutoImporterDeps<Plan> = {
      async readSyncGate(): Promise<SyncGate> {
        if (!syncConfigured) return { kind: 'not-linked' }
        if (!controller) return { kind: 'loading' }
        const state = await db.syncState.get('current')
        if (!state?.userId) return { kind: 'not-linked' }
        const snapshot = controller.getSnapshot()
        return { kind: 'linked', running: snapshot.running, lastStatus: snapshot.lastResult?.status ?? null }
      },
      hasAccess: () => latest.current.hasAccess(),
      preview: () => latest.current.preview(),
      apply: (plan) => latest.current.apply(plan),
      nowMs: () => Date.now(),
      timezone: getDeviceTimezone,
    }

    function trigger() {
      importer.maybeRun(deps)
        .then((outcome) => {
          if (!active || outcome?.kind !== 'imported') return
          latest.current.onImported(outcome)
          void db.syncState.get('current').then((state) => {
            if (state?.userId) void controller?.syncNow()
          })
        })
        .catch((error: unknown) => console.error('Automatic import could not start:', error))
    }

    trigger()
    const onVisible = () => {
      if (document.visibilityState === 'visible') trigger()
    }
    document.addEventListener('visibilitychange', onVisible)
    const stopListening = controller ? controller.subscribe(trigger) : () => {}
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVisible)
      stopListening()
    }
  }, [importer, controller, syncConfigured, allPlatforms])
}

/** Screen time (src/screenTime/autoImport.ts). */
export function useScreenTimeAutoImport(options: {
  controller: SyncController | null
  syncConfigured: boolean
  onImported: (outcome: Extract<AutoImportOutcome, { kind: 'imported' }>) => void
}): void {
  useAutoImport({
    importer: screenTimeImporter,
    ...options,
    async hasAccess() {
      // Turned off on this device ("What this device imports").
      if (!isDeviceImportOn('screenTime')) return false
      const plugin = await import('./usageStatsPlugin')
      return plugin.hasUsageAccess()
    },
    async preview() {
      const { previewDeviceScreenTimeImport } = await import('../import/deviceScreenTimeImport')
      return previewDeviceScreenTimeImport()
    },
    async apply(plan) {
      const { applyScreenTimeImport } = await import('../import/screenTimeImport')
      return applyScreenTimeImport(plan)
    },
  })
}
