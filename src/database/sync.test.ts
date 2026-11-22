import { describe, expect, it } from 'vitest'

import { initialSyncFields, nextSyncFields } from './sync'
import { upgradeSettingToV8, upgradeSyncedRecordToV8, upgradeTablesToV8 } from './upgrades'

describe('sync fields', () => {
  it('a new record is pending, revision 1, never synchronised', () => {
    expect(initialSyncFields()).toEqual({ syncStatus: 'pending', revision: 1, syncedRevision: null })
  })

  it('a local change makes a synced record pending and increases the revision', () => {
    expect(nextSyncFields({ syncStatus: 'synced', revision: 4 })).toEqual({ syncStatus: 'pending', revision: 5 })
    expect(nextSyncFields({ syncStatus: 'pending', revision: 1 })).toEqual({ syncStatus: 'pending', revision: 2 })
  })

  it('a record in conflict stays in conflict when edited locally', () => {
    expect(nextSyncFields({ syncStatus: 'conflict', revision: 2 })).toEqual({ syncStatus: 'conflict', revision: 3 })
  })

  it('does not return syncedRevision, so spreading over a record keeps it', () => {
    const record = { syncStatus: 'synced' as const, revision: 4, syncedRevision: 4 }
    expect({ ...record, ...nextSyncFields(record) }).toEqual({ syncStatus: 'pending', revision: 5, syncedRevision: 4 })
  })
})

describe('version 8 upgrade functions', () => {
  it('adds syncedRevision null to a synchronised record and changes nothing else', () => {
    const record = { id: 'h1', name: 'Water', syncStatus: 'pending', revision: 3, updatedAt: '2026-11-01T08:00:00.000Z' }
    const upgraded = upgradeSyncedRecordToV8(record)
    expect(upgraded).toEqual({ ...record, syncedRevision: null })
    expect(record).not.toHaveProperty('syncedRevision') // input not modified
  })

  it('keeps an existing syncedRevision', () => {
    const record = { id: 'h1', syncStatus: 'synced', revision: 3, syncedRevision: 3 }
    expect(upgradeSyncedRecordToV8(record)).toBe(record)
  })

  it('gives a setting sync fields and deletedAt null, keeping key, value and updatedAt', () => {
    const setting = { key: 'displayTimezone', value: 'Europe/Paris', updatedAt: '2026-11-09T00:00:00.000Z' }
    expect(upgradeSettingToV8(setting)).toEqual({
      ...setting,
      syncStatus: 'pending',
      revision: 1,
      syncedRevision: null,
      deletedAt: null,
    })
  })

  it('keeps a setting that already has sync fields', () => {
    const setting = {
      key: 'k', value: 'v', updatedAt: '2026-11-09T00:00:00.000Z',
      syncStatus: 'synced', revision: 4, syncedRevision: 4, deletedAt: null,
    }
    expect(upgradeSettingToV8(setting)).toBe(setting)
  })

  it('upgrades every synchronised table', () => {
    const result = upgradeTablesToV8({
      habits: [{ id: 'h' }],
      entries: [{ id: 'e' }],
      sleepSessions: [{ id: 's' }],
      externalSamples: [{ id: 'x' }],
      settings: [{ key: 'k', value: 'v', updatedAt: '2026-11-09T00:00:00.000Z' }],
    })
    expect(result.habits[0]).toHaveProperty('syncedRevision', null)
    expect(result.entries[0]).toHaveProperty('syncedRevision', null)
    expect(result.sleepSessions[0]).toHaveProperty('syncedRevision', null)
    expect(result.externalSamples[0]).toHaveProperty('syncedRevision', null)
    expect(result.settings[0]).toMatchObject({ revision: 1, deletedAt: null })
  })
})
