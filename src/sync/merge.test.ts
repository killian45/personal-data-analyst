import { describe, expect, it } from 'vitest'

import type { SyncFields } from '../database/types'
import { contentOf, decideMerge, sameContent, uploadContent } from './merge'

const local = (syncStatus: SyncFields['syncStatus'], revision: number, syncedRevision: number | null): SyncFields => ({
  syncStatus,
  revision,
  syncedRevision,
})

describe('decideMerge (SYNC_DESIGN.md §6)', () => {
  it('a record new to this device is stored', () => {
    expect(decideMerge(undefined, 1, false)).toBe('adopt-remote')
  })

  it('skips a server version this device already agreed on (e.g. its own upload)', () => {
    expect(decideMerge(local('synced', 3, 3), 3, true)).toBe('skip')
    expect(decideMerge(local('pending', 4, 3), 3, false)).toBe('skip')
  })

  it('rule 2: only the server changed → the server version is stored', () => {
    expect(decideMerge(local('synced', 3, 3), 5, false)).toBe('adopt-remote')
  })

  it('rule 1: both changed to the same content → no conflict', () => {
    expect(decideMerge(local('pending', 4, 3), 5, true)).toBe('adopt-remote')
  })

  it('rule 3: both changed differently → conflict, nothing overwritten', () => {
    expect(decideMerge(local('pending', 4, 3), 5, false)).toBe('conflict')
  })

  it('never synchronised here but present on the server: equal → stored, different → conflict', () => {
    expect(decideMerge(local('pending', 2, null), 2, true)).toBe('adopt-remote')
    expect(decideMerge(local('pending', 2, null), 2, false)).toBe('conflict')
  })

  it('a record already in conflict: a newer server version keeps the conflict unless equal', () => {
    expect(decideMerge(local('conflict', 4, 3), 6, false)).toBe('conflict')
    expect(decideMerge(local('conflict', 4, 3), 6, true)).toBe('adopt-remote')
  })

  it('a server revision lower than the agreed one (cloud data re-uploaded) counts as a server change', () => {
    expect(decideMerge(local('synced', 5, 5), 2, false)).toBe('adopt-remote')
    expect(decideMerge(local('pending', 6, 5), 2, false)).toBe('conflict')
  })
})

describe('content comparison', () => {
  const base = { id: 'e1', value: 500, comment: 'x', deletedAt: null }

  it('ignores sync fields and the edit time', () => {
    expect(
      sameContent(
        { ...base, syncStatus: 'pending', revision: 4, syncedRevision: 3, updatedAt: '2026-11-10T08:00:00.000Z' },
        { ...base, syncStatus: 'synced', revision: 5, syncedRevision: 5, updatedAt: '2026-11-10T09:00:00.000Z' },
      ),
    ).toBe(true)
  })

  it('ignores key order but not values, deletions or nested changes', () => {
    expect(sameContent({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true)
    expect(sameContent(base, { ...base, comment: 'y' })).toBe(false)
    expect(sameContent(base, { ...base, deletedAt: '2026-11-10T08:00:00.000Z' })).toBe(false)
    expect(sameContent({ s: [{ a: 1 }] }, { s: [{ a: 2 }] })).toBe(false)
  })

  it('contentOf keeps createdAt and all data fields', () => {
    expect(contentOf({ ...base, createdAt: 'c', updatedAt: 'u', revision: 1 })).toEqual({ ...base, createdAt: 'c' })
  })

  it('uploads everything except the per-device sync fields', () => {
    expect(
      uploadContent({ ...base, updatedAt: 'u', syncStatus: 'pending', revision: 2, syncedRevision: 1 }),
    ).toEqual({ ...base, updatedAt: 'u' })
  })
})
