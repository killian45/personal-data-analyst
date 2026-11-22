/**
 * Runs sync rounds for the interface and keeps a status snapshot
 * (docs/SYNC_DESIGN.md §5.2: sync at start, periodically while open and
 * online, when the connection returns, and on "Sync now").
 * Framework-free; React reads it with useSyncExternalStore.
 */

import type { PersonalDataDatabase } from '../database/db'
import type { SyncBackend } from './backendTypes'
import { countPendingChanges } from './device'
import { runSyncRound, type SyncRoundResult } from './engine'

export interface SyncSnapshot {
  running: boolean
  /** Account this device is linked to, or null if sync is not set up. */
  linkedUserId: string | null
  pending: number
  issues: number
  lastResult: SyncRoundResult | null
  lastFinishedAt: string | null
}

export interface SyncController {
  getSnapshot(): SyncSnapshot
  subscribe(listener: () => void): () => void
  /** Called after a round changed local data, so the interface reloads it. */
  onDataChanged(listener: () => void): () => void
  /** Re-reads link, pending changes and issues (after local changes). */
  refresh(): Promise<void>
  syncNow(): Promise<SyncRoundResult | null>
  /** Starts automatic syncing; returns a function that stops it. */
  start(): () => void
}

export const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000
const START_DELAY_MS = 2000

export function createSyncController(options: {
  db: PersonalDataDatabase
  backend: SyncBackend
  now?: () => Date
}): SyncController {
  const { db, backend } = options
  const now = options.now ?? (() => new Date())
  const listeners = new Set<() => void>()
  const dataListeners = new Set<() => void>()
  let snapshot: SyncSnapshot = {
    running: false,
    linkedUserId: null,
    pending: 0,
    issues: 0,
    lastResult: null,
    lastFinishedAt: null,
  }

  function update(changes: Partial<SyncSnapshot>) {
    snapshot = { ...snapshot, ...changes }
    for (const listener of listeners) listener()
  }

  async function refresh() {
    const state = await db.syncState.get('current')
    update({
      linkedUserId: state?.userId ?? null,
      pending: await countPendingChanges(db),
      issues: await db.syncConflicts.count(),
    })
  }

  async function syncNow(): Promise<SyncRoundResult | null> {
    if (snapshot.running) return null
    update({ running: true })
    let result: SyncRoundResult
    try {
      result = await runSyncRound({ db, server: backend.server, now })
    } catch (error) {
      result = {
        status: 'failed',
        stage: 'pull',
        kind: 'local',
        message: error instanceof Error ? error.message : String(error),
        notPushed: [],
        pulled: 0,
        applied: 0,
        conflicts: 0,
        problems: 0,
        stale: 0,
        pushed: 0,
      }
    }
    await refresh()
    update({ running: false, lastResult: result, lastFinishedAt: now().toISOString() })

    const changedData =
      result.status === 'cloud-deleted' ||
      ((result.status === 'ok' || result.status === 'failed') && (result.applied > 0 || result.conflicts > 0))
    if (changedData) for (const listener of dataListeners) listener()
    return result
  }

  function reportBackgroundError(error: unknown) {
    console.error('Background sync failed:', error)
  }

  function autoSync() {
    if (snapshot.linkedUserId && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      syncNow().catch(reportBackgroundError)
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onDataChanged(listener) {
      dataListeners.add(listener)
      return () => {
        dataListeners.delete(listener)
      }
    },
    refresh,
    syncNow,
    start() {
      const startTimer = setTimeout(() => {
        refresh().then(autoSync).catch(reportBackgroundError)
      }, START_DELAY_MS)
      const interval = setInterval(autoSync, AUTO_SYNC_INTERVAL_MS)
      window.addEventListener('online', autoSync)
      return () => {
        clearTimeout(startTimer)
        clearInterval(interval)
        window.removeEventListener('online', autoSync)
      }
    },
  }
}
