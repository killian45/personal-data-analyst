import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import type { DeviceScreenTimePlan } from '../import/deviceScreenTimeImport'
import { applyScreenTimeImport } from '../import/screenTimeImport'

import {
  AUTO_IMPORT_STORAGE_KEY,
  DEFAULT_AUTO_IMPORT_STATE,
  decideAutoImport,
  describeImportedDays,
  getAutoImportState,
  maybeRunAutoImport,
  parseAutoImportState,
  resetAutoImportAfterDeletion,
  resetAutoImportCacheForTests,
  setAutoImportEnabled,
} from './autoImport'
import type { AutoImportDeps, AutoImportState, SyncGate } from './autoImport'
import { screenTimeSample } from './testScreenTime'

const PARIS = 'Europe/Paris'
// 12/11/2026 14:00 in Paris (UTC+1).
const NOW = Date.parse('2026-11-12T13:00:00Z')
const HOUR = 60 * 60 * 1000
const notLinked: SyncGate = { kind: 'not-linked' }

function plan(dates: string[]): DeviceScreenTimePlan {
  return {
    timezone: PARIS,
    found: dates.length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    toAdd: dates.map((date) => screenTimeSample(`id-${date}`, date)),
    duplicates: [],
    needsAttention: [],
    skipped: [],
    invalid: [],
    notes: [],
  }
}

function fakeDeps(changes: Partial<AutoImportDeps> = {}) {
  const deps = {
    readSyncGate: vi.fn(async (): Promise<SyncGate> => notLinked),
    hasUsageAccess: vi.fn(async () => true),
    preview: vi.fn(async () => plan(['2026-11-11'])),
    apply: vi.fn(async (p: DeviceScreenTimePlan) => p.toAdd.length),
    nowMs: () => NOW,
    timezone: () => PARIS,
    ...changes,
  }
  return deps
}

function state(changes: Partial<AutoImportState> = {}): AutoImportState {
  return { ...DEFAULT_AUTO_IMPORT_STATE, ...changes }
}

beforeEach(async () => {
  localStorage.clear()
  resetAutoImportCacheForTests()
  await db.delete()
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe('parseAutoImportState', () => {
  it('defaults to on and never run', () => {
    expect(parseAutoImportState(null)).toEqual({ enabled: true, last: null })
    expect(parseAutoImportState('not json')).toEqual({ enabled: true, last: null })
    expect(parseAutoImportState('42')).toEqual({ enabled: true, last: null })
  })

  it('reads a valid stored state', () => {
    const stored = { enabled: false, last: { kind: 'imported', atMs: NOW, dates: ['2026-11-11'] } }
    expect(parseAutoImportState(JSON.stringify(stored))).toEqual(stored)
  })

  it('drops an unreadable last result but keeps the choice', () => {
    expect(parseAutoImportState(JSON.stringify({ enabled: false, last: { kind: 'imported', atMs: NOW, dates: ['11/11/2026'] } })))
      .toEqual({ enabled: false, last: null })
    expect(parseAutoImportState(JSON.stringify({ enabled: true, last: { kind: 'failed', atMs: 'yesterday', message: 'x' } })))
      .toEqual({ enabled: true, last: null })
  })
})

describe('decideAutoImport', () => {
  const decide = (s: AutoImportState, sync: SyncGate = notLinked, nowMs = NOW) =>
    decideAutoImport({ state: s, sync, nowMs, timezone: PARIS })

  it('runs when on, not linked and never run', () => {
    expect(decide(state())).toEqual({ run: true })
  })

  it('does not run when turned off', () => {
    expect(decide(state({ enabled: false }))).toEqual({ run: false, reason: 'off' })
  })

  it('waits while sync is loading', () => {
    expect(decide(state(), { kind: 'loading' })).toEqual({ run: false, reason: 'sync-loading' })
  })

  it('on a linked device, runs only after a successful sync round', () => {
    expect(decide(state(), { kind: 'linked', running: false, lastStatus: null })).toEqual({ run: false, reason: 'sync-first' })
    expect(decide(state(), { kind: 'linked', running: false, lastStatus: 'failed' })).toEqual({ run: false, reason: 'sync-first' })
    expect(decide(state(), { kind: 'linked', running: true, lastStatus: 'ok' })).toEqual({ run: false, reason: 'sync-first' })
    expect(decide(state(), { kind: 'linked', running: false, lastStatus: 'ok' })).toEqual({ run: true })
  })

  it('runs at most once an hour on the same day', () => {
    const last = { kind: 'nothing-new' as const, atMs: NOW - 59 * 60 * 1000 }
    expect(decide(state({ last }))).toEqual({ run: false, reason: 'recent' })
    expect(decide(state({ last: { ...last, atMs: NOW - HOUR } }))).toEqual({ run: true })
  })

  it('a failed run also waits an hour', () => {
    expect(decide(state({ last: { kind: 'failed', atMs: NOW - 10 * 60 * 1000, message: 'x' } }))).toEqual({ run: false, reason: 'recent' })
  })

  it('runs again once the local date has changed, even within the hour', () => {
    // 23:40 on 11/11 and 00:10 on 12/11 in Paris: 30 minutes apart.
    const lastAt = Date.parse('2026-11-11T22:40:00Z')
    const now = Date.parse('2026-11-11T23:10:00Z')
    expect(decide(state({ last: { kind: 'nothing-new', atMs: lastAt } }), notLinked, now)).toEqual({ run: true })
  })

  it('runs if the last run looks like it is in the future (clock changed)', () => {
    expect(decide(state({ last: { kind: 'nothing-new', atMs: NOW + 10 * 60 * 1000 } }))).toEqual({ run: true })
  })
})

describe('describeImportedDays', () => {
  it('lists up to three days in date order, a range beyond', () => {
    expect(describeImportedDays(['2026-11-11'])).toBe('1 day (11/11/2026)')
    expect(describeImportedDays(['2026-11-11', '2026-11-09'])).toBe('2 days (09/11/2026, 11/11/2026)')
    expect(describeImportedDays(['2026-11-04', '2026-11-11', '2026-11-05', '2026-11-06'])).toBe('4 days (04/11/2026 to 11/11/2026)')
  })
})

describe('stored setting', () => {
  it('is kept on this device and survives a restart', () => {
    setAutoImportEnabled(false)
    resetAutoImportCacheForTests()
    expect(getAutoImportState().enabled).toBe(false)
    expect(JSON.parse(localStorage.getItem(AUTO_IMPORT_STORAGE_KEY) ?? '{}')).toMatchObject({ enabled: false })
  })

  it('is turned off and cleared after "Delete all data"', () => {
    localStorage.setItem(AUTO_IMPORT_STORAGE_KEY, JSON.stringify({ enabled: true, last: { kind: 'nothing-new', atMs: NOW } }))
    resetAutoImportAfterDeletion()
    expect(getAutoImportState()).toEqual({ enabled: false, last: null })
  })
})

describe('maybeRunAutoImport', () => {
  it('imports the new days and records the result', async () => {
    const deps = fakeDeps({ preview: vi.fn(async () => plan(['2026-11-10', '2026-11-11'])) })
    const outcome = await maybeRunAutoImport(deps)
    expect(outcome).toEqual({ kind: 'imported', atMs: NOW, dates: ['2026-11-10', '2026-11-11'] })
    expect(deps.apply).toHaveBeenCalledTimes(1)
    expect(getAutoImportState().last).toEqual(outcome)
  })

  it('records "nothing new" without writing anything', async () => {
    const deps = fakeDeps({ preview: vi.fn(async () => plan([])) })
    expect(await maybeRunAutoImport(deps)).toEqual({ kind: 'nothing-new', atMs: NOW })
    expect(deps.apply).not.toHaveBeenCalled()
  })

  it('does not run again within the hour', async () => {
    const deps = fakeDeps()
    await maybeRunAutoImport(deps)
    expect(await maybeRunAutoImport(deps)).toBeNull()
    expect(deps.preview).toHaveBeenCalledTimes(1)
  })

  it('records a failure and does not throw', async () => {
    const deps = fakeDeps({ preview: vi.fn(async () => { throw new Error('Usage access is off') }) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await maybeRunAutoImport(deps)).toEqual({ kind: 'failed', atMs: NOW, message: 'Usage access is off' })
    vi.restoreAllMocks()
  })

  it('reads nothing while waiting for sync, and records nothing', async () => {
    const deps = fakeDeps({ readSyncGate: vi.fn(async (): Promise<SyncGate> => ({ kind: 'linked', running: false, lastStatus: 'failed' })) })
    expect(await maybeRunAutoImport(deps)).toBeNull()
    expect(deps.preview).not.toHaveBeenCalled()
    expect(getAutoImportState().last).toBeNull()
  })

  it('does nothing without Usage access, and records nothing', async () => {
    const deps = fakeDeps({ hasUsageAccess: vi.fn(async () => false) })
    expect(await maybeRunAutoImport(deps)).toBeNull()
    expect(deps.preview).not.toHaveBeenCalled()
    expect(getAutoImportState().last).toBeNull()
  })

  it('does nothing when turned off', async () => {
    setAutoImportEnabled(false)
    const deps = fakeDeps()
    expect(await maybeRunAutoImport(deps)).toBeNull()
    expect(deps.readSyncGate).toHaveBeenCalled()
    expect(deps.hasUsageAccess).not.toHaveBeenCalled()
  })

  it('runs only once when started twice at the same moment', async () => {
    const deps = fakeDeps()
    const [first, second] = await Promise.all([maybeRunAutoImport(deps), maybeRunAutoImport(deps)])
    expect(first?.kind).toBe('imported')
    expect(second).toBeNull()
    expect(deps.preview).toHaveBeenCalledTimes(1)
  })

  it('with the real database: imports new days and never duplicates or replaces a stored day', async () => {
    const deps = fakeDeps({ apply: applyScreenTimeImport })
    await maybeRunAutoImport(deps)
    expect(await db.externalSamples.count()).toBe(1)

    // The same day planned again (for example by a manual import started
    // meanwhile): the unique day key refuses it and nothing is added.
    resetAutoImportCacheForTests()
    localStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const again = await maybeRunAutoImport(fakeDeps({
      apply: applyScreenTimeImport,
      preview: vi.fn(async () => plan(['2026-11-10', '2026-11-11'])),
    }))
    vi.restoreAllMocks()
    expect(again?.kind).toBe('failed')
    expect(await db.externalSamples.count()).toBe(1)
    const stored = await db.externalSamples.toArray()
    expect(stored[0].id).toBe('id-2026-11-11')
  })
})
