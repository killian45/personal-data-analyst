
import Dexie from 'dexie'

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

import { CURRENT_SCHEMA_VERSION, db } from './db'

describe('PersonalDataDatabase', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('stores and retrieves a habit', async () => {
    const now = new Date().toISOString()

    const habit = {
      id: 'habit-1',
      name: 'Water intake',
      type: 'number' as const,
      unit: 'ml',
      labelOptions: null,
      dailyAggregation: 'sum' as const,
      target: null,
      color: '#2563eb',
      archived: false,
      sortOrder: 0,
      syncStatus: 'pending' as const,
      revision: 1,
      syncedRevision: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }

    await db.habits.add(habit)

    const storedHabit = await db.habits.get('habit-1')

    expect(storedHabit).toEqual(habit)
  })

  it('initializes all five database tables', () => {
    expect(db.tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'habits',
        'entries',
        'activeTimers',
        'sleepSessions',
        'externalSamples',
      ]),
    )
  })

  it('assigns alphabetical sort order when upgrading from version 2', async () => {
    // Close and remove the current version 3 database.
    db.close()
    await db.delete()

    // Create a temporary database using the old version 2 schema.
    const legacyDb = new Dexie('PersonalDataAnalyst')

    legacyDb.version(2).stores({
      habits:
        '&id, name, type, archived, createdAt, updatedAt, deletedAt',

      entries:
        '&id, habitId, occurredStart, occurredEnd, source, createdAt, updatedAt, deletedAt, [habitId+occurredStart]',

      activeTimers:
        '&habitId, startedAt, updatedAt',

      sleepSessions:
        '&id, externalId, startUtc, endUtc, source, createdAt, updatedAt, deletedAt',

      externalSamples:
        '&id, source, externalId, metricType, startUtc, endUtc, createdAt, updatedAt, deletedAt, [source+externalId]',
    })

    await legacyDb.open()

    const now = new Date().toISOString()

    // These records deliberately have no sortOrder property.
    await legacyDb.table('habits').bulkAdd([
      {
        id: 'habit-zebra',
        name: 'Zebra',
        type: 'checkbox',
        unit: null,
        labelOptions: null,
        color: '#2563eb',
        archived: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: 'habit-apple',
        name: 'Apple',
        type: 'checkbox',
        unit: null,
        labelOptions: null,
        color: '#2563eb',
        archived: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: 'habit-middle',
        name: 'Middle',
        type: 'checkbox',
        unit: null,
        labelOptions: null,
        color: '#2563eb',
        archived: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ])

    // Close version 2 before opening the current version 3 database.
    legacyDb.close()

    await db.open()

    const upgradedHabits = await db.habits
      .orderBy('sortOrder')
      .toArray()

    expect(
      upgradedHabits.map((habit) => habit.name),
    ).toEqual([
      'Apple',
      'Middle',
      'Zebra',
    ])

    expect(
      upgradedHabits.map((habit) => habit.sortOrder),
    ).toEqual([0, 1, 2])
  })

  describe('upgrade from version 3 to version 4', () => {
    const V3_STORES = {
      habits:
        '&id, name, type, archived, sortOrder, createdAt, updatedAt, deletedAt',
      entries:
        '&id, habitId, occurredStart, occurredEnd, source, createdAt, updatedAt, deletedAt, [habitId+occurredStart]',
      activeTimers:
        '&habitId, startedAt, updatedAt',
      sleepSessions:
        '&id, externalId, startUtc, endUtc, source, createdAt, updatedAt, deletedAt',
      externalSamples:
        '&id, source, externalId, metricType, startUtc, endUtc, createdAt, updatedAt, deletedAt, [source+externalId]',
    }

    const CREATED = '2026-11-01T08:00:00.000Z'
    const UPDATED = '2026-11-02T09:00:00.000Z'

    function v3Habit(id: string, type: string) {
      return {
        id,
        name: `Habit ${id}`,
        type,
        unit: null,
        labelOptions: null,
        color: '#2563eb',
        archived: false,
        sortOrder: 0,
        createdAt: CREATED,
        updatedAt: UPDATED,
        deletedAt: null,
      }
    }

    const numberEntry = {
      id: 'entry-number',
      habitId: 'habit-number',
      occurredStart: '2026-11-01T10:00:00.000Z',
      occurredEnd: null,
      timezone: 'Europe/Paris',
      value: 500,
      comment: 'Morning',
      source: 'manual',
      createdAt: CREATED,
      updatedAt: UPDATED,
      deletedAt: null,
    }

    const stopwatchEntry = {
      id: 'entry-stopwatch',
      habitId: 'habit-stopwatch',
      occurredStart: '2026-11-01T10:00:00.000Z',
      occurredEnd: '2026-11-01T11:00:00.000Z',
      timezone: 'Europe/Paris',
      value: null,
      comment: null,
      source: 'manual',
      createdAt: CREATED,
      updatedAt: UPDATED,
      deletedAt: '2026-11-03T10:00:00.000Z',
    }

    const timer = {
      habitId: 'habit-stopwatch',
      startedAt: '2026-11-04T07:00:00.000Z',
      timezone: 'Europe/Paris',
      comment: 'Running',
      createdAt: CREATED,
      updatedAt: UPDATED,
    }

    async function createV3Database(entries: object[]) {
      db.close()
      await db.delete()

      const legacyDb = new Dexie('PersonalDataAnalyst')
      legacyDb.version(3).stores(V3_STORES)
      await legacyDb.open()

      await legacyDb.table('habits').bulkAdd([
        v3Habit('habit-number', 'number'),
        v3Habit('habit-stopwatch', 'stopwatch'),
      ])
      await legacyDb.table('entries').bulkAdd(entries)
      await legacyDb.table('activeTimers').add(timer)

      legacyDb.close()

      return legacyDb
    }

    it('keeps every record and adds the new fields', async () => {
      await createV3Database([numberEntry, stopwatchEntry])

      await db.open()

      // Opening runs every upgrade up to the current version.
      expect(db.verno).toBe(CURRENT_SCHEMA_VERSION)
      expect(await db.habits.count()).toBe(2)
      expect(await db.entries.count()).toBe(2)
      expect(await db.activeTimers.count()).toBe(1)

      // Habits: unchanged except for the new sync fields.
      expect(await db.habits.get('habit-number')).toEqual({
        ...v3Habit('habit-number', 'number'),
        syncStatus: 'pending',
        revision: 1,
        // Added by the version 7 upgrade.
        dailyAggregation: 'sum',
        target: null,
        // Added by the version 8 upgrade.
        syncedRevision: null,
      })

      // Number entry: unchanged except for the new fields.
      expect(await db.entries.get('entry-number')).toEqual({
        ...numberEntry,
        habitType: 'number',
        externalId: null,
        syncStatus: 'pending',
        revision: 1,
        syncedRevision: null,
      })

      // Stopwatch entry: start/end become one period; soft deletion kept.
      expect(await db.entries.get('entry-stopwatch')).toEqual({
        ...stopwatchEntry,
        habitType: 'stopwatch',
        value: {
          segments: [
            { start: '2026-11-01T10:00:00.000Z', end: '2026-11-01T11:00:00.000Z' },
          ],
        },
        externalId: null,
        syncStatus: 'pending',
        revision: 1,
        syncedRevision: null,
      })

      // Running timer keeps running from its original start.
      expect(await db.activeTimers.get('habit-stopwatch')).toEqual({
        ...timer,
        completedSegments: [],
        runningSince: '2026-11-04T07:00:00.000Z',
      })
    })

    it('stops without changing anything when an entry refers to a missing habit', async () => {
      const orphan = { ...numberEntry, id: 'entry-orphan', habitId: 'habit-missing' }
      const legacyDb = await createV3Database([numberEntry, orphan])

      await expect(db.open()).rejects.toThrow('refers to a missing habit')

      // The database is still at version 3 with its data untouched.
      await legacyDb.open()

      expect(legacyDb.verno).toBe(3)
      expect(await legacyDb.table('entries').get('entry-number')).toEqual(numberEntry)
      expect(await legacyDb.table('entries').get('entry-orphan')).toEqual(orphan)
      expect(await legacyDb.table('habits').get('habit-number')).toEqual(
        v3Habit('habit-number', 'number'),
      )

      legacyDb.close()
    })

    it('stops without changing anything when a stopwatch entry has no end', async () => {
      const broken = { ...stopwatchEntry, id: 'entry-broken', occurredEnd: null }
      const legacyDb = await createV3Database([broken])

      await expect(db.open()).rejects.toThrow('has no end time')

      await legacyDb.open()

      expect(legacyDb.verno).toBe(3)
      expect(await legacyDb.table('entries').get('entry-broken')).toEqual(broken)

      legacyDb.close()
    })
  })

  it('upgrades from version 4 onwards keeping every record (number habits gain v7 fields)', async () => {
    db.close()
    await db.delete()

    const v4 = new Dexie('PersonalDataAnalyst')
    v4.version(4).stores({
      habits: '&id, name, type, archived, sortOrder, syncStatus, createdAt, updatedAt, deletedAt',
      entries: '&id, habitId, habitType, occurredStart, occurredEnd, source, externalId, syncStatus, createdAt, updatedAt, deletedAt, [habitId+occurredStart]',
      activeTimers: '&habitId, startedAt, updatedAt',
      sleepSessions: '&id, externalId, startUtc, endUtc, source, createdAt, updatedAt, deletedAt',
      externalSamples: '&id, source, externalId, metricType, startUtc, endUtc, createdAt, updatedAt, deletedAt, [source+externalId]',
    })
    await v4.open()

    const habit = {
      id: 'h1', name: 'Water', type: 'number', unit: 'ml', labelOptions: null, color: '#2563eb',
      archived: false, sortOrder: 0, syncStatus: 'pending', revision: 1,
      createdAt: '2026-11-01T08:00:00.000Z', updatedAt: '2026-11-01T08:00:00.000Z', deletedAt: null,
    }
    const entry = {
      id: 'e1', habitId: 'h1', habitType: 'number', occurredStart: '2026-11-01T10:00:00.000Z', occurredEnd: null,
      timezone: 'Europe/Paris', value: 500, comment: null, source: 'manual', externalId: null,
      syncStatus: 'pending', revision: 1,
      createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', deletedAt: null,
    }
    await v4.table('habits').add(habit)
    await v4.table('entries').add(entry)
    v4.close()

    await db.open()

    expect(db.verno).toBe(CURRENT_SCHEMA_VERSION)
    expect(await db.habits.get('h1')).toEqual({
      ...habit,
      dailyAggregation: 'sum',
      target: null,
      syncedRevision: null,
    })
    expect(await db.entries.get('e1')).toEqual({ ...entry, syncedRevision: null })
    expect(await db.settings.count()).toBe(0)
  })

  describe('upgrade from version 5 to version 6', () => {
    const V5_STORES = {
      habits: '&id, name, type, archived, sortOrder, syncStatus, createdAt, updatedAt, deletedAt',
      entries: '&id, habitId, habitType, occurredStart, occurredEnd, source, externalId, syncStatus, createdAt, updatedAt, deletedAt, [habitId+occurredStart]',
      activeTimers: '&habitId, startedAt, updatedAt',
      sleepSessions: '&id, externalId, startUtc, endUtc, source, createdAt, updatedAt, deletedAt',
      externalSamples: '&id, source, externalId, metricType, startUtc, endUtc, createdAt, updatedAt, deletedAt, [source+externalId]',
      settings: '&key',
    }

    async function createV5(withOldSleepRecord: boolean) {
      db.close()
      await db.delete()

      const v5 = new Dexie('PersonalDataAnalyst')
      v5.version(5).stores(V5_STORES)
      await v5.open()

      await v5.table('settings').add({ key: 'displayTimezone', value: 'Europe/Paris', updatedAt: '2026-11-09T00:00:00.000Z' })

      if (withOldSleepRecord) {
        await v5.table('sleepSessions').add({ id: 'old', startUtc: '2026-11-08T22:00:00.000Z', endUtc: '2026-11-09T06:00:00.000Z' })
      }

      v5.close()
      return v5
    }

    it('keeps existing data and accepts the redesigned tables', async () => {
      await createV5(false)

      await db.open()

      expect(db.verno).toBe(CURRENT_SCHEMA_VERSION)
      expect((await db.settings.get('displayTimezone'))?.value).toBe('Europe/Paris')
      expect(await db.sleepSessions.count()).toBe(0)
    })

    it('stops without changing anything if old sleep records exist', async () => {
      const v5 = await createV5(true)

      await expect(db.open()).rejects.toThrow('unexpectedly contains 1 record(s) in an old format')

      await v5.open()
      expect(v5.verno).toBe(5)
      expect(await v5.table('sleepSessions').count()).toBe(1)
      v5.close()
    })
  })

  it('upgrades from version 6 to 7: number habits get "sum" and no target', async () => {
    db.close()
    await db.delete()

    const v6 = new Dexie('PersonalDataAnalyst')
    v6.version(6).stores({
      habits: '&id, name, type, archived, sortOrder, syncStatus, createdAt, updatedAt, deletedAt',
      entries: '&id, habitId, habitType, occurredStart, occurredEnd, source, externalId, syncStatus, createdAt, updatedAt, deletedAt, [habitId+occurredStart]',
      activeTimers: '&habitId, startedAt, updatedAt',
      sleepSessions: '&id, &dedupeKey, source, externalId, startUtc, endUtc, syncStatus, createdAt, updatedAt, deletedAt',
      externalSamples: '&id, &dedupeKey, source, externalId, measurementType, startUtc, endUtc, syncStatus, createdAt, updatedAt, deletedAt, [measurementType+startUtc]',
      settings: '&key',
    })
    await v6.open()

    const base = {
      color: '#2563eb', archived: false, sortOrder: 0, syncStatus: 'pending', revision: 1,
      createdAt: '2026-11-01T08:00:00.000Z', updatedAt: '2026-11-02T08:00:00.000Z', deletedAt: null,
    }
    await v6.table('habits').bulkAdd([
      { ...base, id: 'n', name: 'Water', type: 'number', unit: 'ml', labelOptions: null },
      { ...base, id: 'c', name: 'Gym', type: 'checkbox', unit: null, labelOptions: null },
    ])
    v6.close()

    await db.open()

    expect(await db.habits.get('n')).toEqual({
      ...base, id: 'n', name: 'Water', type: 'number', unit: 'ml', labelOptions: null,
      dailyAggregation: 'sum', target: null, syncedRevision: null,
    })
    expect(await db.habits.get('c')).toEqual({
      ...base, id: 'c', name: 'Gym', type: 'checkbox', unit: null, labelOptions: null,
      syncedRevision: null,
    })
  })

  describe('upgrade from version 7 to version 8', () => {
    const V7_STORES = {
      habits: '&id, name, type, archived, sortOrder, syncStatus, createdAt, updatedAt, deletedAt',
      entries: '&id, habitId, habitType, occurredStart, occurredEnd, source, externalId, syncStatus, createdAt, updatedAt, deletedAt, [habitId+occurredStart]',
      activeTimers: '&habitId, startedAt, updatedAt',
      sleepSessions: '&id, &dedupeKey, source, externalId, startUtc, endUtc, syncStatus, createdAt, updatedAt, deletedAt',
      externalSamples: '&id, &dedupeKey, source, externalId, measurementType, startUtc, endUtc, syncStatus, createdAt, updatedAt, deletedAt, [measurementType+startUtc]',
      settings: '&key',
    }

    const habitBase = {
      color: '#2563eb', archived: false, syncStatus: 'pending', revision: 3,
      createdAt: '2026-11-01T08:00:00.000Z', updatedAt: '2026-11-02T08:00:00.000Z', deletedAt: null,
    }
    const habits = [
      { ...habitBase, id: 'h-water', name: 'Water', type: 'number', unit: 'ml', labelOptions: null, sortOrder: 0, dailyAggregation: 'sum', target: 2000 },
      { ...habitBase, id: 'h-read', name: 'Reading', type: 'stopwatch', unit: null, labelOptions: null, sortOrder: 1 },
      { ...habitBase, id: 'h-old', name: 'Old', type: 'checkbox', unit: null, labelOptions: null, sortOrder: 2, deletedAt: '2026-11-05T08:00:00.000Z' },
    ]
    const entries = [
      {
        id: 'e-1', habitId: 'h-water', habitType: 'number', occurredStart: '2026-11-03T07:00:00.000Z', occurredEnd: null,
        timezone: 'Europe/Paris', value: 500, comment: 'Été', source: 'manual', externalId: null,
        syncStatus: 'pending', revision: 1, createdAt: '2026-11-03T07:00:00.000Z', updatedAt: '2026-11-03T07:00:00.000Z', deletedAt: null,
      },
      {
        id: 'e-2', habitId: 'h-read', habitType: 'stopwatch', occurredStart: '2026-11-03T20:00:00.000Z', occurredEnd: '2026-11-03T21:00:00.000Z',
        timezone: 'America/New_York', value: { segments: [{ start: '2026-11-03T20:00:00.000Z', end: '2026-11-03T21:00:00.000Z' }] },
        comment: null, source: 'manual', externalId: null,
        syncStatus: 'pending', revision: 2, createdAt: '2026-11-03T21:00:00.000Z', updatedAt: '2026-11-04T08:00:00.000Z', deletedAt: '2026-11-04T08:00:00.000Z',
      },
    ]
    // Many Health Connect nights, like the user's real history.
    const sleepSessions = Array.from({ length: 1500 }, (_, i) => {
      const start = Date.UTC(2022, 0, 1, 22) + i * 86_400_000
      return {
        id: `sleep-${i}`, source: 'health_connect', externalId: `hc-${i}`, sourceApp: 'com.example.sleep',
        dedupeKey: `health_connect:id:hc-${i}`,
        startUtc: new Date(start).toISOString(), endUtc: new Date(start + 8 * 3_600_000).toISOString(),
        timezone: null, startOffsetMinutes: 60, endOffsetMinutes: 60,
        stages: [{ start: new Date(start).toISOString(), end: new Date(start + 3_600_000).toISOString(), stage: 'light' }],
        reportedSleepMs: null, comment: i === 0 ? 'Première nuit' : null, importedAt: '2026-11-10T08:00:00.000Z',
        metadata: { recordingMethod: 2 },
        syncStatus: 'pending', revision: 1,
        createdAt: '2026-11-10T08:00:00.000Z', updatedAt: '2026-11-10T08:00:00.000Z', deletedAt: null,
      }
    })
    const settings = [
      { key: 'displayTimezone', value: 'Europe/Paris', updatedAt: '2026-11-09T00:00:00.000Z' },
      { key: 'dashboard.metrics', value: '{"sleep":["mean"]}', updatedAt: '2026-11-09T01:00:00.000Z' },
      { key: 'target.bedtime', value: '23:00', updatedAt: '2026-11-09T02:00:00.000Z' },
    ]
    const timer = {
      habitId: 'h-read', startedAt: '2026-11-10T07:00:00.000Z', timezone: 'Europe/Paris', comment: null,
      completedSegments: [], runningSince: '2026-11-10T07:00:00.000Z',
      createdAt: '2026-11-10T07:00:00.000Z', updatedAt: '2026-11-10T07:00:00.000Z',
    }

    async function createV7() {
      db.close()
      await db.delete()

      const v7 = new Dexie('PersonalDataAnalyst')
      v7.version(7).stores(V7_STORES)
      await v7.open()
      await v7.table('habits').bulkAdd(habits)
      await v7.table('entries').bulkAdd(entries)
      await v7.table('sleepSessions').bulkAdd(sleepSessions)
      await v7.table('settings').bulkAdd(settings)
      await v7.table('activeTimers').add(timer)
      v7.close()
    }

    it('keeps every record and value, adding only the sync fields', async () => {
      await createV7()

      await db.open()

      // Opens at the current version (9: the CRM tables are added on top).
      expect(db.verno).toBe(9)
      expect(CURRENT_SCHEMA_VERSION).toBe(9)

      const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id))

      expect(byId(await db.habits.toArray())).toEqual(
        byId(habits.map((habit) => ({ ...habit, syncedRevision: null }))),
      )
      expect(byId(await db.entries.toArray())).toEqual(
        byId(entries.map((entry) => ({ ...entry, syncedRevision: null }))),
      )
      expect(await db.sleepSessions.count()).toBe(1500)
      expect(byId(await db.sleepSessions.toArray())).toEqual(
        byId(sleepSessions.map((session) => ({ ...session, syncedRevision: null }))),
      )

      // Settings: key, value and updatedAt unchanged; sync fields added.
      const storedSettings = await db.settings.orderBy('key').toArray()
      expect(storedSettings).toEqual(
        [...settings]
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((setting) => ({
            ...setting,
            syncStatus: 'pending',
            revision: 1,
            syncedRevision: null,
            deletedAt: null,
          })),
      )

      // Running stopwatch untouched (never synchronised).
      expect(await db.activeTimers.get('h-read')).toEqual(timer)

      // New device-only tables start empty.
      expect(await db.syncState.count()).toBe(0)
      expect(await db.syncConflicts.count()).toBe(0)

      // The new settings index works.
      expect(await db.settings.where('syncStatus').equals('pending').count()).toBe(3)
    }, 20_000) // 1,500 records: allow for a busy machine

    it('the app keeps working on upgraded data: a setting change increases its revision', async () => {
      await createV7()
      await db.open()

      const { saveDisplayTimezone, loadDisplayTimezone } = await import('../settings/displayTimezone')
      expect(await loadDisplayTimezone()).toBe('Europe/Paris')

      await saveDisplayTimezone('Asia/Tokyo')

      expect(await db.settings.get('displayTimezone')).toMatchObject({
        value: 'Asia/Tokyo',
        revision: 2,
        syncStatus: 'pending',
        syncedRevision: null,
        deletedAt: null,
      })
    }, 20_000)
  })

  describe('upgrade from version 8 to version 9', () => {
    const V8_STORES = {
      habits: '&id, name, type, archived, sortOrder, syncStatus, createdAt, updatedAt, deletedAt',
      entries: '&id, habitId, habitType, occurredStart, occurredEnd, source, externalId, syncStatus, createdAt, updatedAt, deletedAt, [habitId+occurredStart]',
      activeTimers: '&habitId, startedAt, updatedAt',
      sleepSessions: '&id, &dedupeKey, source, externalId, startUtc, endUtc, syncStatus, createdAt, updatedAt, deletedAt',
      externalSamples: '&id, &dedupeKey, source, externalId, measurementType, startUtc, endUtc, syncStatus, createdAt, updatedAt, deletedAt, [measurementType+startUtc]',
      settings: '&key, syncStatus',
      syncState: '&id',
      syncConflicts: '&id, collection, kind, detectedAt',
    }
    const sync = { syncStatus: 'synced', revision: 2, syncedRevision: 2 }
    const times = { createdAt: '2026-11-01T08:00:00.000Z', updatedAt: '2026-11-02T08:00:00.000Z', deletedAt: null }
    const tables: Record<string, Record<string, unknown>[]> = {
      habits: [{ id: 'h-water', name: 'Water', type: 'number', unit: 'ml', labelOptions: null, color: '#2563eb', archived: false, sortOrder: 0, dailyAggregation: 'sum', target: 2000, ...sync, ...times }],
      entries: [{
        id: 'e-1', habitId: 'h-water', habitType: 'number', occurredStart: '2026-11-03T07:00:00.000Z', occurredEnd: null,
        timezone: 'Europe/Paris', value: 500, comment: 'Été', source: 'manual', externalId: null, ...sync, ...times,
      }],
      sleepSessions: Array.from({ length: 140 }, (_, i) => {
        const start = Date.UTC(2026, 5, 1, 22) + i * 86_400_000
        return {
          id: `sleep-${i}`, source: 'health_connect', externalId: `hc-${i}`, sourceApp: 'com.example.sleep', dedupeKey: `health_connect:id:hc-${i}`,
          startUtc: new Date(start).toISOString(), endUtc: new Date(start + 8 * 3_600_000).toISOString(),
          timezone: null, startOffsetMinutes: 120, endOffsetMinutes: 120, stages: [], reportedSleepMs: null, comment: null,
          importedAt: '2026-11-10T08:00:00.000Z', metadata: null, syncStatus: 'pending', revision: 1, syncedRevision: null, ...times,
        }
      }),
      externalSamples: [{
        id: 's-1', source: 'android_usage', externalId: null, sourceApp: 'Android (Usage access)', dedupeKey: 'android_usage:screen_time:2026-11-11',
        measurementType: 'screen_time_daily', value: 7200, unit: 's', startUtc: '2026-11-10T23:00:00.000Z', endUtc: '2026-11-11T23:00:00.000Z',
        timezone: 'Europe/Paris', startOffsetMinutes: 60, importedAt: '2026-11-12T13:00:00.000Z', metadata: { localDate: '2026-11-11' }, ...sync, ...times,
      }],
      settings: [{ key: 'displayTimezone', value: 'Europe/Paris', updatedAt: '2026-11-09T00:00:00.000Z', ...sync, deletedAt: null }],
      syncState: [{ id: 'current', userId: 'user-1', lastServerSeq: 812, keyVersion: 1, dataKey: 'stand-in for the key', linkedAt: '2026-11-10T09:00:00.000Z' }],
      syncConflicts: [{ id: 'entries:e-9', collection: 'entries', recordId: 'e-9', kind: 'conflict', remoteRecord: null, remoteRevision: null, detectedAt: '2026-11-11T09:00:00.000Z' }],
      activeTimers: [{
        habitId: 'h-water', startedAt: '2026-11-12T07:00:00.000Z', timezone: 'Europe/Paris', comment: null,
        completedSegments: [], runningSince: '2026-11-12T07:00:00.000Z', createdAt: '2026-11-12T07:00:00.000Z', updatedAt: '2026-11-12T07:00:00.000Z',
      }],
    }

    it('keeps every table and record unchanged and adds two empty CRM tables', async () => {
      db.close()
      await db.delete()
      const v8 = new Dexie('PersonalDataAnalyst')
      v8.version(8).stores(V8_STORES)
      await v8.open()
      for (const [name, rows] of Object.entries(tables)) await v8.table(name).bulkAdd(rows)
      v8.close()

      await db.open()

      expect(db.verno).toBe(9)
      // Compared in primary-key order (text order: "sleep-10" before "sleep-2").
      const key = (row: Record<string, unknown>) => String(row.id ?? row.key ?? row.habitId)
      const sorted = (rows: Record<string, unknown>[]) => [...rows].sort((a, b) => (key(a) < key(b) ? -1 : 1))
      for (const [name, rows] of Object.entries(tables)) {
        expect(await db.table(name).toArray(), name).toEqual(sorted(rows))
      }
      expect(await db.contacts.count()).toBe(0)
      expect(await db.contactInteractions.count()).toBe(0)

      // The new indexes work.
      await db.contacts.add({
        id: 'c-1', name: 'Bob', description: null, education: null, address: null, birthday: null, interests: null, dislikes: null,
        externalPhoneId: '7', syncStatus: 'pending', revision: 1, syncedRevision: null, ...times,
      })
      expect(await db.contacts.where('externalPhoneId').equals('7').count()).toBe(1)
      expect(await db.contactInteractions.where('[contactId+occurredStart]').between(['c-1', ''], ['c-1', '\uffff']).count()).toBe(0)
    }, 20_000)
  })
})

