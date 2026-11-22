import { messages } from '../i18n'
import type { DeviceScreenTimePlan } from '../import/deviceScreenTimeImport'
import { formatDayMonthYear } from '../import/screenTimeImport'
import { formatInTimezone } from '../time/time'

/**
 * Automatic screen-time import on the phone (post-spec improvement 4,
 * approved 2026-11-12).
 *
 * Does what "Check this phone for screen time" + "Import" do, when the app
 * is opened or comes back to the screen:
 * - only the days the manual preview would add (finished, fully covered,
 *   not stored yet); stored days are never replaced; days that need
 *   attention, incomplete days and invalid days are left for the manual
 *   import, which still lists them;
 * - sync first: on a device linked to sync, only after a successful sync
 *   round (days imported elsewhere must arrive first);
 * - at most once an hour, or again once the local date has changed;
 * - one run at a time (and the database's unique day key makes two
 *   parallel imports of the same day impossible: nothing is imported).
 *
 * The on/off choice and the last result are kept on this device only
 * (localStorage), never synced.
 */

export const AUTO_IMPORT_MIN_INTERVAL_MS = 60 * 60 * 1000
export const AUTO_IMPORT_STORAGE_KEY = 'pda.screenTimeAutoImport'

export type AutoImportOutcome =
  | { kind: 'imported'; atMs: number; dates: string[] }
  | { kind: 'nothing-new'; atMs: number }
  | { kind: 'failed'; atMs: number; message: string }

export interface AutoImportState {
  enabled: boolean
  last: AutoImportOutcome | null
}

export const DEFAULT_AUTO_IMPORT_STATE: AutoImportState = { enabled: true, last: null }

/** Sync status as far as the import cares. */
export type SyncGate =
  | { kind: 'loading' }
  | { kind: 'not-linked' }
  | { kind: 'linked'; running: boolean; lastStatus: string | null }

export type AutoImportDecision =
  | { run: true }
  | { run: false; reason: 'off' | 'recent' | 'sync-loading' | 'sync-first' }

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseOutcome(value: unknown): AutoImportOutcome | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (!isTime(record.atMs)) return null
  if (record.kind === 'imported' && Array.isArray(record.dates) && record.dates.every((date) => typeof date === 'string' && LOCAL_DATE.test(date))) {
    return { kind: 'imported', atMs: record.atMs, dates: record.dates as string[] }
  }
  if (record.kind === 'nothing-new') return { kind: 'nothing-new', atMs: record.atMs }
  if (record.kind === 'failed' && typeof record.message === 'string') return { kind: 'failed', atMs: record.atMs, message: record.message }
  return null
}

/** Reads the stored state; anything unreadable falls back to the default (on, never run). */
export function parseAutoImportState(raw: string | null): AutoImportState {
  if (raw === null) return DEFAULT_AUTO_IMPORT_STATE
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return DEFAULT_AUTO_IMPORT_STATE
    const record = value as Record<string, unknown>
    return {
      enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
      last: parseOutcome(record.last),
    }
  } catch {
    return DEFAULT_AUTO_IMPORT_STATE
  }
}

/** Pure: should an automatic import run now? */
export function decideAutoImport(input: {
  state: AutoImportState
  sync: SyncGate
  nowMs: number
  timezone: string
}): AutoImportDecision {
  const { state, sync, nowMs, timezone } = input
  if (!state.enabled) return { run: false, reason: 'off' }
  if (sync.kind === 'loading') return { run: false, reason: 'sync-loading' }
  if (sync.kind === 'linked' && (sync.running || sync.lastStatus !== 'ok')) return { run: false, reason: 'sync-first' }

  const last = state.last
  if (last && last.atMs <= nowMs && nowMs - last.atMs < AUTO_IMPORT_MIN_INTERVAL_MS) {
    const day = (ms: number) => formatInTimezone(new Date(ms).toISOString(), timezone, 'yyyy-MM-dd')
    if (day(last.atMs) === day(nowMs)) return { run: false, reason: 'recent' }
  }
  return { run: true }
}

/** Short description of the imported days, e.g. "1 day (11/11/2026)". */
export function describeImportedDays(dates: readonly string[]): string {
  const sorted = [...dates].sort()
  const t = messages().importText
  const count = t.days(sorted.length)
  if (sorted.length === 0) return count
  if (sorted.length <= 3) return t.daysList(count, sorted.map(formatDayMonthYear).join(', '))
  return t.daysRange(count, formatDayMonthYear(sorted[0]), formatDayMonthYear(sorted[sorted.length - 1]))
}

// ---------------------------------------------------------------------------
// A reusable automatic importer (screen time; Health Connect activity and
// heart data). Each has its own on/off choice and last result, stored on
// this device only, readable by React via subscribe/getState.

export interface AutoImporterDeps<Plan> {
  readSyncGate(): Promise<SyncGate>
  /** Permission / access on the phone; when false nothing runs or is recorded. */
  hasAccess(): Promise<boolean>
  /** Reads the phone and plans the import (writes nothing to the database). */
  preview(): Promise<Plan>
  /** Saves the plan in one transaction; throws (saving nothing) on any problem. */
  apply(plan: Plan): Promise<number>
  nowMs(): number
  timezone(): string
}

export interface AutoImporter<Plan> {
  getState(): AutoImportState
  subscribe(listener: () => void): () => void
  setEnabled(enabled: boolean): void
  /** Turns automatic import off and forgets the last result (after "Delete all data"). */
  resetAfterDeletion(): void
  /** Tests only: forget the in-memory copy so the next read comes from storage. */
  resetForTests(): void
  /**
   * Runs an automatic import if it is due. Returns the outcome of a run, or
   * null when nothing ran (off, too recent, waiting for sync, no access, or
   * a run already in progress — which then gets the same result).
   */
  maybeRun(deps: AutoImporterDeps<Plan>): Promise<AutoImportOutcome | null>
}

export function createAutoImporter<Plan>(
  storageKey: string,
  /** The local dates the plan adds or changes (empty: nothing new). */
  changedDates: (plan: Plan) => string[],
  label: string,
): AutoImporter<Plan> {
  const listeners = new Set<() => void>()
  let cached: AutoImportState | null = null
  let inFlight: Promise<AutoImportOutcome | null> | null = null

  function readStorage(): AutoImportState {
    try {
      return parseAutoImportState(localStorage.getItem(storageKey))
    } catch {
      return DEFAULT_AUTO_IMPORT_STATE
    }
  }

  function writeState(next: AutoImportState): void {
    cached = next
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch (error) {
      console.error('Could not save the automatic import setting:', error)
    }
    for (const listener of listeners) listener()
  }

  function getState(): AutoImportState {
    cached ??= readStorage()
    return cached
  }

  return {
    getState,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setEnabled(enabled) {
      writeState({ ...getState(), enabled })
    },
    resetAfterDeletion() {
      writeState({ enabled: false, last: null })
    },
    resetForTests() {
      cached = null
      inFlight = null
    },
    maybeRun(deps) {
      if (inFlight) return inFlight.then(() => null)
      const run = (async (): Promise<AutoImportOutcome | null> => {
        const decision = decideAutoImport({
          state: getState(),
          sync: await deps.readSyncGate(),
          nowMs: deps.nowMs(),
          timezone: deps.timezone(),
        })
        if (!decision.run) return null
        // No access: the panel already says so; nothing is recorded.
        if (!(await deps.hasAccess())) return null

        let outcome: AutoImportOutcome
        try {
          const plan = await deps.preview()
          const dates = changedDates(plan)
          if (dates.length === 0) {
            outcome = { kind: 'nothing-new', atMs: deps.nowMs() }
          } else {
            await deps.apply(plan)
            outcome = { kind: 'imported', atMs: deps.nowMs(), dates: [...new Set(dates)].sort() }
          }
        } catch (error) {
          console.error(`Automatic ${label} import failed:`, error)
          outcome = { kind: 'failed', atMs: deps.nowMs(), message: error instanceof Error ? error.message : messages().importText.unknownError }
        }
        writeState({ ...getState(), last: outcome })
        return outcome
      })()
      inFlight = run
      return run.finally(() => {
        if (inFlight === run) inFlight = null
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Screen time (the functions used by the screen-time panel and hook).

export const screenTimeImporter = createAutoImporter<DeviceScreenTimePlan>(
  AUTO_IMPORT_STORAGE_KEY,
  (plan) => plan.toAdd.map((sample) => (sample.metadata as { localDate: string }).localDate),
  'screen-time',
)

export const getAutoImportState = screenTimeImporter.getState
export const subscribeAutoImport = screenTimeImporter.subscribe
export const setAutoImportEnabled = screenTimeImporter.setEnabled
export const resetAutoImportAfterDeletion = screenTimeImporter.resetAfterDeletion
export const resetAutoImportCacheForTests = screenTimeImporter.resetForTests

export interface AutoImportDeps extends Omit<AutoImporterDeps<DeviceScreenTimePlan>, 'hasAccess'> {
  hasUsageAccess(): Promise<boolean>
}

export function maybeRunAutoImport(deps: AutoImportDeps): Promise<AutoImportOutcome | null> {
  return screenTimeImporter.maybeRun({ ...deps, hasAccess: deps.hasUsageAccess })
}
