import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

import { CURRENT_SCHEMA_VERSION, db } from '../database/db'
import { createEntry, deleteEntry } from '../database/entries'
import { createHabit, deleteHabit } from '../database/habits'
import { startStopwatch } from '../database/stopwatches'

import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  backupFileName,
  computeTablesHash,
  createBackup,
  serializeBackup,
} from './backup'

const START = '2026-11-01T10:00:00.000Z'

describe('JSON backup export', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('creates a valid backup of an empty database', async () => {
    const exportedAt = new Date('2026-11-09T15:30:00.000Z')
    const backup = await createBackup(exportedAt)

    expect(backup.format).toBe(BACKUP_FORMAT)
    expect(backup.formatVersion).toBe(BACKUP_FORMAT_VERSION)
    expect(backup.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(backup.exportedAt).toBe('2026-11-09T15:30:00.000Z')
    expect(backup.counts).toEqual({
      activeTimers: 0,
      contactInteractions: 0,
      contacts: 0,
      entries: 0,
      externalSamples: 0,
      habits: 0,
      settings: 0,
      sleepSessions: 0,
    })
  })

  it('includes every database table except the device-only sync tables', async () => {
    const backup = await createBackup()

    expect(Object.keys(backup.tables).sort()).toEqual(
      db.tables
        .map((table) => table.name)
        .filter((name) => name !== 'syncState' && name !== 'syncConflicts')
        .sort(),
    )
    expect(Object.keys(backup.tables)).toHaveLength(8)
  })

  it('never includes the sync account link, encryption key or sync conflicts', async () => {
    const dataKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt'])
    await db.syncState.put({
      id: 'current',
      userId: 'user-1',
      lastServerSeq: 7,
      keyVersion: 1,
      dataKey,
      linkedAt: START,
    })
    await db.syncConflicts.put({
      id: 'habits:h-1',
      kind: 'conflict',
      collection: 'habits',
      recordId: 'h-1',
      remoteRecord: { name: 'Remote' },
      remoteRevision: 2,
      detectedAt: START,
    })

    const backup = await createBackup()

    expect(backup.tables).not.toHaveProperty('syncState')
    expect(backup.tables).not.toHaveProperty('syncConflicts')
    expect(JSON.stringify(backup)).not.toContain('user-1')
  })

  it('preserves every record exactly, including soft-deleted records', async () => {
    const water = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    const reading = await createHabit({ name: 'Reading', type: 'stopwatch' })
    const removed = await createHabit({ name: 'Old habit', type: 'checkbox' })

    const keptEntry = await createEntry({
      habitId: water.id,
      value: 500,
      occurredStart: START,
      comment: 'Morning',
    })

    const deletedEntry = await createEntry({
      habitId: water.id,
      value: 250,
      occurredStart: START,
    })

    await deleteEntry(deletedEntry.id)
    await deleteHabit(removed.id)
    await startStopwatch(reading.id)

    const backup = await createBackup()

    // Records must be identical to what is stored, field by field.
    expect(backup.tables.habits).toEqual(await db.habits.toArray())
    expect(backup.tables.entries).toEqual(await db.entries.toArray())
    expect(backup.tables.activeTimers).toEqual(await db.activeTimers.toArray())

    expect(backup.counts.habits).toBe(3)
    expect(backup.counts.entries).toBe(2)
    expect(backup.counts.activeTimers).toBe(1)

    const backedUpEntries = backup.tables.entries as { id: string; deletedAt: string | null }[]

    expect(backedUpEntries.find((entry) => entry.id === keptEntry.id)?.deletedAt).toBeNull()
    expect(backedUpEntries.find((entry) => entry.id === deletedEntry.id)?.deletedAt).not.toBeNull()
  })

  it('stores a SHA-256 hash that matches the tables', async () => {
    await createHabit({ name: 'Water', type: 'number' })

    const backup = await createBackup()

    expect(backup.integrity.algorithm).toBe('SHA-256')
    expect(backup.integrity.tablesHash).toMatch(/^[0-9a-f]{64}$/)
    expect(await computeTablesHash(backup.tables)).toBe(backup.integrity.tablesHash)
  })

  it('produces a hash that changes when any record changes', async () => {
    await createHabit({ name: 'Water', type: 'number' })

    const backup = await createBackup()
    const tampered = structuredClone(backup.tables)
    ;(tampered.habits[0] as { name: string }).name = 'Changed'

    expect(await computeTablesHash(tampered)).not.toBe(backup.integrity.tablesHash)
  })

  it('matches an independently computed SHA-256 value', async () => {
    // Reference computed outside the app with coreutils:
    //   printf '%s' '{"habits":[]}' | sha256sum
    expect(await computeTablesHash({ habits: [] })).toBe(
      'f5b82b3b472e9d0e62721ad1715adf63e04038a88b4c84a34eea6a3c1a1aa123',
    )
  })

  it('serialises to JSON that reads back identically and keeps the hash valid', async () => {
    const habit = await createHabit({ name: 'Mood', type: 'label', labelOptions: ['Good', 'Bad'] })
    await createEntry({ habitId: habit.id, value: 'Good', occurredStart: START })

    const backup = await createBackup()
    const parsed = JSON.parse(serializeBackup(backup))

    expect(parsed).toEqual(backup)
    expect(await computeTablesHash(parsed.tables)).toBe(backup.integrity.tablesHash)
  })

  it('does not modify the database', async () => {
    await createHabit({ name: 'Water', type: 'number' })
    const before = await db.habits.toArray()

    await createBackup()

    expect(await db.habits.toArray()).toEqual(before)
  })

  it('builds a UTC file name without characters that are invalid on Windows', () => {
    expect(backupFileName(new Date('2026-11-09T15:30:05.123Z'))).toBe(
      'pda-backup-2026-11-09T15-30-05Z.json',
    )
  })
})
