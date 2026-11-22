import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CURRENT_SCHEMA_VERSION, db } from '../../database/db'
import { createEntry, deleteEntry, updateEntry } from '../../database/entries'
import { createHabit, deleteHabit, setHabitArchived } from '../../database/habits'
import { createManualSleepSession, deleteSleepSession } from '../../database/sleepSessions'
import { startStopwatch } from '../../database/stopwatches'
import { saveDisplayTimezone } from '../../settings/displayTimezone'
import { BACKUP_FORMAT, computeTablesHash, createBackup, serializeBackup } from '../backup'
import { createContact, deleteContact } from '../../database/contacts'
import { createInteraction } from '../../database/contactInteractions'

import { locationSamples } from '../../location/testLocation'
import { screenTimeSample } from '../../screenTime/testScreenTime'

import { parseBackup } from './parseBackup'
import { applyRestore, countAdditions, previewRestore } from './restore'

const START = '2026-11-09T08:00:00.000Z'

async function snapshot() {
  return {
    habits: await db.habits.orderBy('id').toArray(),
    entries: await db.entries.orderBy('id').toArray(),
    activeTimers: await db.activeTimers.orderBy('habitId').toArray(),
    settings: await db.settings.orderBy('key').toArray(),
    sleepSessions: await db.sleepSessions.orderBy('id').toArray(),
  }
}

async function clearAll() {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear()
    }
  })
}

/** Builds a backup file by hand, with a correct fingerprint. */
async function handMadeBackup(schemaVersion: number, tables: Record<string, unknown[]>) {
  const counts = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]))

  return JSON.stringify({
    format: BACKUP_FORMAT,
    formatVersion: 1,
    schemaVersion,
    exportedAt: '2026-11-01T12:00:00.000Z',
    counts,
    integrity: { algorithm: 'SHA-256', tablesHash: await computeTablesHash(tables) },
    tables,
  })
}

describe('backup restore', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  describe('round trip', () => {
    it('restores everything exactly, including deleted and archived data', async () => {
      const water = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
      const mood = await createHabit({ name: 'Mood', type: 'label', labelOptions: ['Good', 'Bad'] })
      const reading = await createHabit({ name: 'Reading', type: 'stopwatch' })
      const old = await createHabit({ name: 'Old', type: 'checkbox' })

      const kept = await createEntry({ habitId: water.id, value: 500, occurredStart: START, comment: 'Morning' })
      await updateEntry(kept.id, { value: 600 })
      const removed = await createEntry({ habitId: mood.id, value: 'Good', occurredStart: START })
      await deleteEntry(removed.id)
      await createEntry({
        habitId: reading.id,
        value: null,
        occurredStart: START,
        occurredEnd: '2026-11-09T09:00:00.000Z',
        timezone: 'Asia/Tokyo',
      })
      await createEntry({ habitId: old.id, value: true, occurredStart: START })
      await setHabitArchived(mood.id, true)
      await deleteHabit(old.id)
      await startStopwatch(reading.id)
      await saveDisplayTimezone('Europe/Paris')
      await createManualSleepSession({
        startUtc: '2026-11-08T22:30:00.000Z',
        endUtc: '2026-11-09T06:15:00.000Z',
        timezone: 'Europe/Paris',
        comment: 'Slept well',
      })
      const deletedNight = await createManualSleepSession({
        startUtc: '2026-11-07T23:00:00.000Z',
        endUtc: '2026-11-08T07:00:00.000Z',
      })
      await deleteSleepSession(deletedNight.id)

      const before = await snapshot()
      const text = serializeBackup(await createBackup())

      await clearAll()

      const plan = await previewRestore(text)

      expect(countAdditions(plan)).toBe(4 + 4 + 1 + 1 + 2)
      expect(plan.entries.invalid).toEqual([])
      expect(plan.notes).toEqual([])

      await applyRestore(plan)

      expect(await snapshot()).toEqual(before)
    })

    it('skips everything when the same backup is restored twice', async () => {
      const water = await createHabit({ name: 'Water', type: 'number' })
      await createEntry({ habitId: water.id, value: 1, occurredStart: START })

      const text = serializeBackup(await createBackup())
      const plan = await previewRestore(text)

      expect(countAdditions(plan)).toBe(0)
      expect(plan.habits.identical).toBe(1)
      expect(plan.entries.identical).toBe(1)
    })

    it('adds only what is missing and never overwrites this device', async () => {
      const water = await createHabit({ name: 'Water', type: 'number' })
      const first = await createEntry({ habitId: water.id, value: 1, occurredStart: START })
      const second = await createEntry({ habitId: water.id, value: 2, occurredStart: START })

      const text = serializeBackup(await createBackup())

      // After the backup: one entry is edited, one is removed completely.
      await updateEntry(first.id, { value: 10 })
      await db.entries.delete(second.id)

      const plan = await previewRestore(text)

      expect(plan.entries.add.map((entry) => entry.id)).toEqual([second.id])
      expect(plan.entries.differing).toEqual([
        {
          label: `Water entry, ${START.slice(0, 10)}`,
          reason: 'a different version is already on this device; that version was kept',
        },
      ])

      await applyRestore(plan)

      expect((await db.entries.get(first.id))?.value).toBe(10)
      expect((await db.entries.get(second.id))?.value).toBe(2)
    })

    it('changes nothing if the data changed between preview and restore', async () => {
      const water = await createHabit({ name: 'Water', type: 'number' })
      await createEntry({ habitId: water.id, value: 1, occurredStart: START })
      const text = serializeBackup(await createBackup())

      await clearAll()
      const plan = await previewRestore(text)

      // Meanwhile, the habit is added again (e.g. in another tab).
      await db.habits.add(plan.habits.add[0])

      await expect(applyRestore(plan)).rejects.toThrow('Nothing was restored')
      expect(await db.entries.count()).toBe(0)
      expect(await db.habits.count()).toBe(1)
    })
  })

  describe('checking the file', () => {
    it('rejects text that is not JSON or not a backup', async () => {
      await expect(parseBackup('not json')).rejects.toThrow('This file is not valid JSON.')
      await expect(parseBackup('{"hello": 1}')).rejects.toThrow('This file is not a Personal Data Analyst backup.')
    })

    it('rejects a backup made by a newer version', async () => {
      const newer = CURRENT_SCHEMA_VERSION + 1
      const text = await handMadeBackup(newer, {})
      await expect(parseBackup(text)).rejects.toThrow(
        `made by a newer version of the app (database version ${newer})`,
      )
    })

    it('rejects a file whose contents were edited', async () => {
      const water = await createHabit({ name: 'Water', type: 'number' })
      await createEntry({ habitId: water.id, value: 1, occurredStart: START })

      const edited = serializeBackup(await createBackup()).replace('"value": 1', '"value": 999')

      await expect(parseBackup(edited)).rejects.toThrow('do not match its fingerprint')
    })

    it('rejects a file whose counts do not match', async () => {
      const backup = await createBackup()
      backup.counts.habits = 3

      await expect(parseBackup(serializeBackup(backup))).rejects.toThrow('record counts')
    })

    it('rejects missing or unexpected tables', async () => {
      const text = await handMadeBackup(5, { habits: [] })
      await expect(parseBackup(text)).rejects.toThrow("tables are not as expected")
    })
  })

  describe('older backups', () => {
    const v3Habit = {
      id: 'h-reading', name: 'Reading', type: 'stopwatch', unit: null, labelOptions: null,
      color: '#2563eb', archived: false, sortOrder: 0,
      createdAt: '2026-11-01T08:00:00.000Z', updatedAt: '2026-11-01T08:00:00.000Z', deletedAt: null,
    }
    const v3Entry = {
      id: 'e-1', habitId: 'h-reading', occurredStart: '2026-11-01T10:00:00.000Z',
      occurredEnd: '2026-11-01T11:00:00.000Z', timezone: 'Europe/Paris', value: null, comment: 'Novel',
      source: 'manual', createdAt: '2026-11-01T11:00:00.000Z', updatedAt: '2026-11-01T11:00:00.000Z',
      deletedAt: null,
    }

    it('converts and restores a version 3 backup like the database upgrade', async () => {
      const text = await handMadeBackup(3, {
        activeTimers: [], entries: [v3Entry], externalSamples: [], habits: [v3Habit], sleepSessions: [],
      })

      const plan = await previewRestore(text)
      expect(plan.schemaVersion).toBe(3)
      await applyRestore(plan)

      expect(await db.entries.get('e-1')).toEqual({
        ...v3Entry,
        habitType: 'stopwatch',
        value: { segments: [{ start: '2026-11-01T10:00:00.000Z', end: '2026-11-01T11:00:00.000Z' }] },
        externalId: null,
        syncStatus: 'pending',
        revision: 1,
        syncedRevision: null,
      })
      expect(await db.habits.get('h-reading')).toEqual({
        ...v3Habit,
        syncStatus: 'pending',
        revision: 1,
        syncedRevision: null,
      })
    })

    it('refuses a version 3 backup with an entry whose habit is missing', async () => {
      const text = await handMadeBackup(3, {
        activeTimers: [], entries: [v3Entry], externalSamples: [], habits: [], sleepSessions: [],
      })

      await expect(parseBackup(text)).rejects.toThrow('could not be converted to the current version: entry e-1 refers to a missing habit')
    })

    it('gives number habits from a version 6 backup the version 7 defaults', async () => {
      const text = await handMadeBackup(6, {
        activeTimers: [],
        entries: [],
        externalSamples: [],
        habits: [{ ...v3Habit, id: 'h-water', name: 'Water', type: 'number', unit: 'ml', syncStatus: 'pending', revision: 1 }],
        settings: [],
        sleepSessions: [],
      })

      const plan = await previewRestore(text)

      expect(plan.habits.add[0]).toMatchObject({ dailyAggregation: 'sum', target: null })
      expect(plan.notes).toEqual([])
    })

    it('restores a version 4 backup (no settings table)', async () => {
      const text = await handMadeBackup(4, {
        activeTimers: [],
        entries: [],
        externalSamples: [],
        habits: [{ ...v3Habit, syncStatus: 'pending', revision: 1 }],
        sleepSessions: [],
      })

      const plan = await previewRestore(text)
      expect(plan.habits.add).toHaveLength(1)
      expect(plan.settings.add).toEqual([])
    })
  })

  describe('invalid records', () => {
    const habit = {
      id: 'h-water', name: 'Water', type: 'number', unit: 'ml', labelOptions: null, color: '#2563eb',
      archived: false, sortOrder: 0, syncStatus: 'pending', revision: 1,
      createdAt: '2026-11-01T08:00:00.000Z', updatedAt: '2026-11-01T08:00:00.000Z', deletedAt: null,
    }
    const entry = {
      id: 'e-1', habitId: 'h-water', habitType: 'number', occurredStart: START, occurredEnd: null,
      timezone: 'Europe/Paris', value: 500, comment: null, source: 'manual', externalId: null,
      syncStatus: 'pending', revision: 1, createdAt: START, updatedAt: START, deletedAt: null,
    }

    async function planFor(tables: Partial<Record<string, unknown[]>>) {
      return previewRestore(
        await handMadeBackup(5, {
          activeTimers: [], entries: [], externalSamples: [], habits: [], settings: [], sleepSessions: [],
          ...tables,
        } as Record<string, unknown[]>),
      )
    }

    it('lists invalid records with reasons and still restores the valid ones', async () => {
      const plan = await planFor({
        habits: [habit],
        entries: [
          entry,
          { ...entry, id: 'e-2', value: 'lots' },
          { ...entry, id: 'e-3', habitId: 'h-missing' },
          { ...entry, id: 'e-4', occurredStart: 'yesterday' },
        ],
      })

      expect(plan.entries.add.map((item) => item.id)).toEqual(['e-1'])
      expect(plan.entries.invalid.map((item) => item.reason)).toEqual([
        'number habits require a finite numeric value',
        'its habit is neither in the backup nor on this device',
        'invalid start time',
      ])

      await applyRestore(plan)
      expect(await db.entries.count()).toBe(1)
    })

    it('rejects entries whose habit is invalid', async () => {
      const plan = await planFor({
        habits: [{ ...habit, color: 'blue' }],
        entries: [entry],
      })

      expect(plan.habits.invalid[0].reason).toBe('color must be a valid six-digit hexadecimal color')
      expect(plan.entries.invalid[0].reason).toBe('its habit is neither in the backup nor on this device')
    })

    it('checks entries against the habit already on this device', async () => {
      const local = await createHabit({ name: 'Mood', type: 'label', labelOptions: ['Good', 'Bad'] })

      const plan = await planFor({
        entries: [{ ...entry, habitId: local.id, habitType: 'label', value: 'Excellent' }],
      })

      expect(plan.entries.invalid[0].reason).toBe('value must match one of the habit label options')
    })

    it('notes harmless corrections, such as a unit on a checkbox habit', async () => {
      const plan = await planFor({ habits: [{ ...habit, type: 'checkbox', unit: 'times' }] })

      expect(plan.habits.add[0].unit).toBeNull()
      expect(plan.notes).toEqual(['Habit "Water": unit "times" removed (only number habits have units).'])
    })

    it('reports invalid sleep records and imported samples instead of dropping them', async () => {
      const plan = await planFor({
        sleepSessions: [{ id: 's-1' }],
        externalSamples: [
          { id: 'x-1' },
          { ...screenTimeSample('x-2', '2026-11-08'), measurementType: 'steps' },
          screenTimeSample('x-3', '2026-11-07', { value: 90_000 }),
        ],
      })

      expect(plan.sleepSessions.invalid).toEqual([
        { label: 'Sleep session s-1', reason: 'invalid source' },
      ])
      expect(plan.externalSamples.invalid).toEqual([
        { label: 'Imported sample x-1', reason: 'invalid source' },
        { label: 'Screen time 2026-11-08', reason: 'unknown kind of imported sample' },
        { label: 'Screen time 2026-11-07', reason: 'invalid screen time (more than the length of the day, or not whole seconds)' },
      ])
    })

    it('restores location visits and movements and reports invalid ones', async () => {
      const [visit, movement] = locationSamples()
      const plan = await planFor({ externalSamples: [visit, movement, { ...movement, id: 'bad', value: -5 }] })
      expect(plan.externalSamples.add.map((sample) => sample.id)).toEqual(['visit-1', 'move-1'])
      expect(plan.externalSamples.invalid).toEqual([{ label: 'Movement 2026-11-09 11:00 UTC', reason: 'invalid distance' }])
      await applyRestore(plan)
      expect(await db.externalSamples.count()).toBe(2)
    })

    it('restores screen-time days (also deleted ones) and never duplicates a day', async () => {
      const backupDays = [
        screenTimeSample('day-8', '2026-11-08'),
        screenTimeSample('day-9', '2026-11-09', { deletedAt: '2026-11-10T09:00:00.000Z' }),
        screenTimeSample('day-7', '2026-11-07'),
      ]
      // Day 7 is already on this device under another id (imported here too).
      await db.externalSamples.add(screenTimeSample('local-7', '2026-11-07'))

      const plan = await planFor({ externalSamples: backupDays })
      expect(plan.externalSamples.add.map((sample) => sample.id)).toEqual(['day-8', 'day-9'])
      expect(plan.externalSamples.add[0]).toMatchObject({ syncStatus: 'pending', syncedRevision: null })
      expect(plan.externalSamples.differing).toEqual([
        { label: 'Screen time 2026-11-07', reason: 'the same record from the same source is already on this device; that version was kept' },
      ])
      expect(countAdditions(plan)).toBe(2)

      await applyRestore(plan)
      expect(await db.externalSamples.count()).toBe(3)
      expect((await db.externalSamples.get('day-9'))?.deletedAt).toBe('2026-11-10T09:00:00.000Z')

      // Restoring the same backup again adds nothing.
      const again = await planFor({ externalSamples: backupDays })
      expect(again.externalSamples.add).toEqual([])
      expect(again.externalSamples.identical).toBe(2)
    })

    it('validates the Location view setting', async () => {
      const valid = await planFor({ settings: [{ key: 'dashboard.locationMeasure', value: 'places', updatedAt: START }] })
      expect(valid.settings.add.map((setting) => setting.value)).toEqual(['places'])

      const invalid = await planFor({ settings: [{ key: 'dashboard.locationMeasure', value: 'teleport', updatedAt: START }] })
      expect(invalid.settings.invalid[0].reason).toBe('unknown location view "teleport"')
    })

    it('validates place names and the chosen place', async () => {
      const valid = await planFor({ settings: [{ key: 'location.placeNames', value: '{"OFFICE":"Office"}', updatedAt: START }] })
      expect(valid.settings.add).toHaveLength(1)
      const invalid = await planFor({ settings: [{ key: 'location.placeNames', value: '{"OFFICE":""}', updatedAt: START }] })
      expect(invalid.settings.invalid[0].reason).toBe('invalid place names')
      const place = await planFor({ settings: [{ key: 'dashboard.locationAwayPlace', value: '', updatedAt: START }] })
      expect(place.settings.invalid[0].reason).toBe('invalid place for "time away from"')
    })

    it('validates formulas (refuses invalid or unsafe ones)', async () => {
      const ok = JSON.stringify([{ id: 'f_abc12345', name: 'F', unit: null, display: 'number', expression: '{screenTime} * 2' }])
      expect((await planFor({ settings: [{ key: 'formulas', value: ok, updatedAt: START }] })).settings.add).toHaveLength(1)
      const unsafe = JSON.stringify([{ id: 'f_abc12345', name: 'F', unit: null, display: 'number', expression: 'alert(1)' }])
      expect((await planFor({ settings: [{ key: 'formulas', value: unsafe, updatedAt: START }] })).settings.invalid[0].reason).toBe('invalid formulas')
    })

    it('validates sleep target settings', async () => {
      const plan = await planFor({
        settings: [
          { key: 'target.bedtime', value: '23:00', updatedAt: START },
          { key: 'target.wakeTime', value: '7 AM', updatedAt: START },
        ],
      })

      expect(plan.settings.add.map((s) => s.key)).toEqual(['target.bedtime'])
      expect(plan.settings.invalid[0].reason).toBe('invalid target value "7 AM"')
    })

    it('rejects an unknown display timezone setting', async () => {
      const plan = await planFor({
        settings: [{ key: 'displayTimezone', value: 'Mars/Olympus', updatedAt: START }],
      })

      expect(plan.settings.invalid[0].reason).toBe('unknown display timezone "Mars/Olympus"')
    })
  })

  describe('sleep sessions', () => {
    const imported = {
      id: 'sleep-hc-1',
      source: 'health_connect',
      externalId: 'hc-123',
      sourceApp: 'com.example.sleep',
      dedupeKey: 'health_connect:id:hc-123',
      startUtc: '2026-11-08T22:00:00.000Z',
      endUtc: '2026-11-09T06:00:00.000Z',
      timezone: null,
      startOffsetMinutes: 60,
      endOffsetMinutes: 60,
      stages: [
        { start: '2026-11-08T22:10:00.000Z', end: '2026-11-08T23:00:00.000Z', stage: 'light' },
        // Overlapping stage: preserved as reported; the engine decides.
        { start: '2026-11-08T22:50:00.000Z', end: '2026-11-09T00:00:00.000Z', stage: 'deep' },
      ],
      reportedSleepMs: null,
      comment: null,
      importedAt: '2026-11-09T08:00:00.000Z',
      metadata: { recordingMethod: 2 },
      syncStatus: 'pending',
      revision: 1,
      syncedRevision: null,
      createdAt: '2026-11-09T08:00:00.000Z',
      updatedAt: '2026-11-09T08:00:00.000Z',
      deletedAt: null,
    }

    async function planWithSleep(sleepSessions: unknown[]) {
      return previewRestore(
        await handMadeBackup(CURRENT_SCHEMA_VERSION, {
          activeTimers: [], entries: [], externalSamples: [], habits: [], settings: [], sleepSessions,
          contacts: [], contactInteractions: [],
        }),
      )
    }

    it('restores an imported session with its stages and metadata unchanged', async () => {
      const plan = await planWithSleep([imported])

      expect(plan.sleepSessions.add).toEqual([imported])
      await applyRestore(plan)
      expect(await db.sleepSessions.get('sleep-hc-1')).toEqual(imported)
    })

    it('skips a session whose source record is already here under another id', async () => {
      await db.sleepSessions.add({ ...imported, id: 'local-copy' } as never)

      const plan = await planWithSleep([imported])

      expect(plan.sleepSessions.add).toEqual([])
      expect(plan.sleepSessions.differing[0].reason).toBe(
        'the same source record is already on this device; that version was kept',
      )
    })

    it('does not add a manual session identical to one already here', async () => {
      const local = await createManualSleepSession({
        startUtc: '2026-11-08T22:30:00.000Z',
        endUtc: '2026-11-09T06:15:00.000Z',
      })

      const plan = await planWithSleep([
        { ...local, id: 'other-id', dedupeKey: 'manual:other-id' },
      ])

      expect(plan.sleepSessions.add).toEqual([])
      expect(plan.sleepSessions.differing[0].reason).toMatch(/same bedtime and wake time/)
    })

    it('rejects a session whose duplicate key was tampered with', async () => {
      const plan = await planWithSleep([{ ...imported, dedupeKey: 'health_connect:id:other' }])

      expect(plan.sleepSessions.invalid[0].reason).toBe('its duplicate-detection key does not match its data')
    })
  })

  describe('synchronisation fields (database version 8)', () => {
    it('round-trips a version 8 backup made on a device with sync set up', async () => {
      await saveDisplayTimezone('Asia/Tokyo')
      await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
      const dataKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt'])
      await db.syncState.put({ id: 'current', userId: 'u', lastServerSeq: 3, keyVersion: 1, dataKey, linkedAt: START })

      const text = serializeBackup(await createBackup())
      const before = await snapshot()

      await clearAll()
      await applyRestore(await previewRestore(text))

      expect(await snapshot()).toEqual(before)
      // The device link is not part of the backup.
      expect(await db.syncState.count()).toBe(0)
    })

    it('marks restored records as pending and never synchronised, whatever the backup says', async () => {
      const habit = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
      await saveDisplayTimezone('Asia/Tokyo')
      await db.habits.update(habit.id, { syncStatus: 'synced', syncedRevision: 1 })
      await db.settings.update('displayTimezone', { syncStatus: 'conflict', syncedRevision: 1 })

      const text = serializeBackup(await createBackup())
      await clearAll()
      await applyRestore(await previewRestore(text))

      expect(await db.habits.get(habit.id)).toMatchObject({ syncStatus: 'pending', syncedRevision: null, revision: 1 })
      expect(await db.settings.get('displayTimezone')).toMatchObject({
        syncStatus: 'pending',
        syncedRevision: null,
        value: 'Asia/Tokyo',
      })
    })

    it('treats records that differ only in sync state as identical', async () => {
      const habit = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
      const text = serializeBackup(await createBackup())

      // Later this device synchronised the habit.
      await db.habits.update(habit.id, { syncStatus: 'synced', syncedRevision: 1 })

      const plan = await previewRestore(text)
      expect(plan.habits.identical).toBe(1)
      expect(plan.habits.differing).toEqual([])
      expect(plan.habits.add).toEqual([])
    })

    it('restores a removed (soft-deleted) setting as removed', async () => {
      const { saveSleepTargets, loadSleepTargets } = await import('../../settings/sleepTargets')
      await saveSleepTargets({ sleepDuration: '7:30', bedtime: '', wakeTime: '' })
      await saveSleepTargets({ sleepDuration: '', bedtime: '', wakeTime: '' })

      const text = serializeBackup(await createBackup())
      await clearAll()
      await applyRestore(await previewRestore(text))

      expect(await db.settings.get('target.sleepDuration')).toMatchObject({ value: '7:30', deletedAt: expect.any(String) })
      expect((await loadSleepTargets()).sleepDurationMinutes).toBeNull()
    })

    it('gives settings from a version 7 backup the version 8 fields', async () => {
      const text = await handMadeBackup(7, {
        activeTimers: [], entries: [], externalSamples: [], habits: [], sleepSessions: [],
        settings: [{ key: 'displayTimezone', value: 'Europe/Paris', updatedAt: '2026-11-09T00:00:00.000Z' }],
      })

      const plan = await previewRestore(text)
      expect(plan.settings.invalid).toEqual([])
      expect(plan.settings.add).toEqual([
        {
          key: 'displayTimezone', value: 'Europe/Paris', updatedAt: '2026-11-09T00:00:00.000Z',
          deletedAt: null, syncStatus: 'pending', revision: 1, syncedRevision: null,
        },
      ])
    })

    it('refuses a record whose synced revision is higher than its revision', async () => {
      const habit = {
        id: 'h-water', name: 'Water', type: 'number', unit: 'ml', labelOptions: null, color: '#2563eb',
        archived: false, sortOrder: 0, dailyAggregation: 'sum', target: null,
        syncStatus: 'synced', revision: 2, syncedRevision: 3,
        createdAt: START, updatedAt: START, deletedAt: null,
      }
      const plan = await previewRestore(
        await handMadeBackup(8, {
          activeTimers: [], entries: [], externalSamples: [], habits: [habit], settings: [], sleepSessions: [],
        }),
      )
      expect(plan.habits.invalid[0].reason).toBe('invalid synced revision')
    })
  })
})

describe('backup restore: Personal CRM (database version 9)', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  const EMPTY_V9 = {
    activeTimers: [], entries: [], externalSamples: [], habits: [], settings: [], sleepSessions: [],
    contacts: [], contactInteractions: [],
  }
  const contactRecord = {
    id: 'c-1', name: 'Amélie', description: null, education: 'MSc', address: '12 rue X\n75011 Paris', birthday: '--05-17',
    interests: 'Jazz', dislikes: null, externalPhoneId: null,
    syncStatus: 'synced', revision: 3, syncedRevision: 3, createdAt: START, updatedAt: START, deletedAt: null,
  }
  const interactionRecord = {
    id: 'i-1', contactId: 'c-1', occurredStart: '2026-11-10T12:00:00.000Z', timezone: 'Europe/Paris', text: 'Lunch',
    syncStatus: 'synced', revision: 1, syncedRevision: 1, createdAt: START, updatedAt: START, deletedAt: null,
  }

  it('round trip: contacts and interactions (including deleted ones) come back exactly, marked pending', async () => {
    const kept = await createContact({ name: 'Amélie', birthday: '1990-05-17', interests: 'Jazz' })
    const gone = await createContact({ name: 'Old friend' })
    const lunch = await createInteraction({ contactId: kept.id, text: 'Lunch', occurredStart: START, timezone: 'Europe/Paris' })
    await createInteraction({ contactId: gone.id, text: 'Call', occurredStart: START, timezone: 'Europe/Paris' })
    await deleteContact(gone.id)

    const backup = await createBackup()
    expect(backup.counts).toMatchObject({ contacts: 2, contactInteractions: 2 })
    const before = { contacts: await db.contacts.orderBy('id').toArray(), interactions: await db.contactInteractions.orderBy('id').toArray() }

    await clearAll()
    const plan = await previewRestore(serializeBackup(backup))
    expect(plan.contacts.invalid).toEqual([])
    expect(plan.contactInteractions.invalid).toEqual([])
    expect(await applyRestore(plan)).toBe(4)

    expect(await db.contacts.orderBy('id').toArray()).toEqual(before.contacts)
    expect(await db.contactInteractions.orderBy('id').toArray()).toEqual(before.interactions)
    expect(await db.contactInteractions.get(lunch.id)).toEqual(lunch)

    // Restoring the same backup again adds nothing.
    const again = await previewRestore(serializeBackup(backup))
    expect(countAdditions(again)).toBe(0)
    expect(again.contacts.identical).toBe(2)
  })

  it('restored records are pending and never synchronised', async () => {
    const plan = await previewRestore(await handMadeBackup(9, { ...EMPTY_V9, contacts: [contactRecord], contactInteractions: [interactionRecord] }))
    expect(plan.contacts.add).toEqual([{ ...contactRecord, syncStatus: 'pending', syncedRevision: null }])
    expect(plan.contactInteractions.add).toEqual([{ ...interactionRecord, syncStatus: 'pending', syncedRevision: null }])
  })

  it('keeps this device\'s version of a contact that differs', async () => {
    await db.contacts.add({ ...contactRecord, interests: 'Opera' } as never)
    const plan = await previewRestore(await handMadeBackup(9, { ...EMPTY_V9, contacts: [contactRecord] }))
    expect(plan.contacts.add).toEqual([])
    expect(plan.contacts.differing).toEqual([{ label: 'Contact "Amélie"', reason: 'a different version is already on this device; that version was kept' }])
  })

  it('lists invalid records with reasons and never changes them silently', async () => {
    const plan = await previewRestore(await handMadeBackup(9, {
      ...EMPTY_V9,
      contacts: [
        { ...contactRecord, id: 'c-bad-birthday', birthday: '1990-02-30' },
        { ...contactRecord, id: 'c-untrimmed', name: ' Amélie ' },
        { ...contactRecord, id: 'c-empty-text', dislikes: '' },
      ],
      contactInteractions: [
        { ...interactionRecord, id: 'i-orphan', contactId: 'nobody' },
        { ...interactionRecord, id: 'i-empty', contactId: 'c-bad-birthday', text: '' },
      ],
    }))
    expect(plan.contacts.add).toEqual([])
    expect(plan.contacts.invalid.map((issue) => issue.reason)).toEqual([
      'birthday is not a real calendar date',
      'name is not stored in the expected form',
      'dislikes is not stored in the expected form',
    ])
    expect(plan.contactInteractions.invalid.map((issue) => issue.reason)).toEqual([
      'its contact is neither in the backup nor on this device',
      'its contact is neither in the backup nor on this device',
    ])
  })

  it('an interaction can belong to a contact already on this device', async () => {
    const contact = await createContact({ name: 'Bob' })
    const plan = await previewRestore(await handMadeBackup(9, { ...EMPTY_V9, contactInteractions: [{ ...interactionRecord, contactId: contact.id }] }))
    expect(plan.contactInteractions.invalid).toEqual([])
    expect(plan.contactInteractions.add).toHaveLength(1)
  })

  it('a version 8 backup restores with no contacts', async () => {
    const { contacts: _c, contactInteractions: _i, ...v8Tables } = EMPTY_V9
    const parsed = await parseBackup(await handMadeBackup(8, v8Tables))
    expect(parsed.tables.contacts).toEqual([])
    expect(parsed.tables.contactInteractions).toEqual([])
  })

  it('refuses a version 9 backup without the CRM tables', async () => {
    const { contacts: _c, contactInteractions: _i, ...v8Tables } = EMPTY_V9
    await expect(previewRestore(await handMadeBackup(9, v8Tables))).rejects.toThrow('not as expected for database version 9')
  })
})

