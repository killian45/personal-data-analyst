import Dexie, { type Table } from 'dexie'
import { messages } from '../i18n'

import { upgradeHabitToV7, upgradeTablesToV4, upgradeTablesToV8 } from './upgrades'

import type {
  ActiveTimer,
  Contact,
  ContactInteraction,
  Entry,
  ExternalSample,
  Habit,
  SettingRecord,
  SleepSession,
  SyncConflictRecord,
  SyncStateRecord,
} from './types'

/** The current Dexie schema version (the highest this.version(n)). */
export const CURRENT_SCHEMA_VERSION = 9

/**
 * Tables that belong to this device only: never synchronised and never
 * included in backups (syncState holds a non-extractable key that cannot
 * be written to a file).
 */
export const DEVICE_ONLY_TABLES: readonly string[] = ['syncState', 'syncConflicts']

export class PersonalDataDatabase extends Dexie {
  habits!: Table<Habit, string>
  entries!: Table<Entry, string>
  activeTimers!: Table<ActiveTimer, string>
  sleepSessions!: Table<SleepSession, string>
  externalSamples!: Table<ExternalSample, string>
  settings!: Table<SettingRecord, string>
  syncState!: Table<SyncStateRecord, string>
  syncConflicts!: Table<SyncConflictRecord, string>
  contacts!: Table<Contact, string>
  contactInteractions!: Table<ContactInteraction, string>

  /**
   * @param name IndexedDB database name. The app always uses the default;
   *   tests pass other names to simulate several devices.
   */
  constructor(name = 'PersonalDataAnalyst') {
    super(name)

    // Version 1: Initial database structure.
    this.version(1).stores({
      habits:
        '&id, name, type, archived, createdAt, updatedAt, deletedAt',

      entries:
        '&id, habitId, occurredStart, occurredEnd, source, createdAt, updatedAt, deletedAt, [habitId+occurredStart]',

      sleepSessions:
        '&id, externalId, startUtc, endUtc, source, createdAt, updatedAt, deletedAt',

      externalSamples:
        '&id, source, externalId, metricType, startUtc, endUtc, createdAt, updatedAt, deletedAt, [source+externalId]',
    })

    // Version 2: Adds persistent stopwatch storage.
    this.version(2).stores({
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

    // Version 3: Adds persistent custom habit ordering.
    this.version(3)
      .stores({
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
      })
      .upgrade(async (transaction) => {
        const habits = await transaction
          .table('habits')
          .toArray()

        // Preserve the alphabetical order users currently see.
        habits.sort(
          (a, b) =>
            a.name.localeCompare(b.name) ||
            a.id.localeCompare(b.id),
        )

        // Assign a unique sequential position to each existing habit.
        const updatedHabits = habits.map((habit, index) => ({
          ...habit,
          sortOrder: index,
        }))

        await transaction
          .table('habits')
          .bulkPut(updatedHabits)
      })

    // Version 4: synchronisation fields, entry habit type and
    // stopwatch periods (pause/resume).
    //
    // - Habits and entries get syncStatus "pending" and revision 1.
    // - Entries get habitType (copied from their habit) and externalId null.
    // - Stopwatch entries get a single period from their start and end.
    // - Active timers get no completed periods and keep running.
    // - createdAt and updatedAt are not changed: this is not a user edit.
    //
    // If an entry refers to a missing habit, or a stopwatch entry has no
    // end, the upgrade stops. Dexie then rolls everything back, so the
    // version 3 data stays exactly as it was.
    this.version(4)
      .stores({
        habits:
          '&id, name, type, archived, sortOrder, syncStatus, createdAt, updatedAt, deletedAt',

        entries:
          '&id, habitId, habitType, occurredStart, occurredEnd, source, externalId, syncStatus, createdAt, updatedAt, deletedAt, [habitId+occurredStart]',

        activeTimers:
          '&habitId, startedAt, updatedAt',

        sleepSessions:
          '&id, externalId, startUtc, endUtc, source, createdAt, updatedAt, deletedAt',

        externalSamples:
          '&id, source, externalId, metricType, startUtc, endUtc, createdAt, updatedAt, deletedAt, [source+externalId]',
      })
      .upgrade(async (transaction) => {
        const habitsTable = transaction.table('habits')
        const entriesTable = transaction.table('entries')
        const timersTable = transaction.table('activeTimers')

        let upgraded

        try {
          upgraded = upgradeTablesToV4({
            habits: await habitsTable.toArray(),
            entries: await entriesTable.toArray(),
            activeTimers: await timersTable.toArray(),
          })
        } catch (caughtError) {
          const reason =
            caughtError instanceof Error ? caughtError.message : 'unknown error'

          throw new Error(
            messages().dbText.upgradeStopped(reason),
          )
        }

        await habitsTable.bulkPut(upgraded.habits)
        await entriesTable.bulkPut(upgraded.entries)
        await timersTable.bulkPut(upgraded.activeTimers)
      })

    // Version 5: adds application settings (e.g. display timezone).
    // Additive only: no existing table or record changes.
    this.version(5).stores({
      habits:
        '&id, name, type, archived, sortOrder, syncStatus, createdAt, updatedAt, deletedAt',

      entries:
        '&id, habitId, habitType, occurredStart, occurredEnd, source, externalId, syncStatus, createdAt, updatedAt, deletedAt, [habitId+occurredStart]',

      activeTimers:
        '&habitId, startedAt, updatedAt',

      sleepSessions:
        '&id, externalId, startUtc, endUtc, source, createdAt, updatedAt, deletedAt',

      externalSamples:
        '&id, source, externalId, metricType, startUtc, endUtc, createdAt, updatedAt, deletedAt, [source+externalId]',

      settings:
        '&key',
    })

    // Version 6: redesigned sleep sessions and imported samples
    // (Health Connect-shaped, unique dedupeKey, sync fields).
    //
    // Both tables were never written before version 6, so there is
    // nothing to convert. If records are found anyway, the upgrade stops
    // and rolls back instead of guessing how to convert them.
    this.version(6)
      .stores({
        habits:
          '&id, name, type, archived, sortOrder, syncStatus, createdAt, updatedAt, deletedAt',

        entries:
          '&id, habitId, habitType, occurredStart, occurredEnd, source, externalId, syncStatus, createdAt, updatedAt, deletedAt, [habitId+occurredStart]',

        activeTimers:
          '&habitId, startedAt, updatedAt',

        sleepSessions:
          '&id, &dedupeKey, source, externalId, startUtc, endUtc, syncStatus, createdAt, updatedAt, deletedAt',

        externalSamples:
          '&id, &dedupeKey, source, externalId, measurementType, startUtc, endUtc, syncStatus, createdAt, updatedAt, deletedAt, [measurementType+startUtc]',

        settings:
          '&key',
      })
      .upgrade(async (transaction) => {
        for (const name of ['sleepSessions', 'externalSamples']) {
          const count = await transaction.table(name).count()

          if (count > 0) {
            throw new Error(
              messages().dbText.upgradeOldFormat(name, count),
            )
          }
        }
      })

    // Version 7: number habits get a daily aggregation ("sum" by default)
    // and an optional target. No index changes; createdAt/updatedAt kept.
    this.version(7)
      .stores({
        habits:
          '&id, name, type, archived, sortOrder, syncStatus, createdAt, updatedAt, deletedAt',

        entries:
          '&id, habitId, habitType, occurredStart, occurredEnd, source, externalId, syncStatus, createdAt, updatedAt, deletedAt, [habitId+occurredStart]',

        activeTimers:
          '&habitId, startedAt, updatedAt',

        sleepSessions:
          '&id, &dedupeKey, source, externalId, startUtc, endUtc, syncStatus, createdAt, updatedAt, deletedAt',

        externalSamples:
          '&id, &dedupeKey, source, externalId, measurementType, startUtc, endUtc, syncStatus, createdAt, updatedAt, deletedAt, [measurementType+startUtc]',

        settings:
          '&key',
      })
      .upgrade(async (transaction) => {
        const habits = transaction.table('habits')
        await habits.bulkPut((await habits.toArray()).map(upgradeHabitToV7))
      })

    // Version 8: synchronisation bookkeeping (docs/SYNC_DESIGN.md §5.1).
    //
    // - Habits, entries, sleep sessions and imported samples get
    //   syncedRevision null (never synchronised).
    // - Settings get syncStatus "pending", revision 1, syncedRevision null
    //   and deletedAt null, and an index on syncStatus.
    // - New device-only tables syncState and syncConflicts (empty).
    // - No value, timestamp or identifier changes; activeTimers untouched.
    this.version(8)
      .stores({
        habits:
          '&id, name, type, archived, sortOrder, syncStatus, createdAt, updatedAt, deletedAt',

        entries:
          '&id, habitId, habitType, occurredStart, occurredEnd, source, externalId, syncStatus, createdAt, updatedAt, deletedAt, [habitId+occurredStart]',

        activeTimers:
          '&habitId, startedAt, updatedAt',

        sleepSessions:
          '&id, &dedupeKey, source, externalId, startUtc, endUtc, syncStatus, createdAt, updatedAt, deletedAt',

        externalSamples:
          '&id, &dedupeKey, source, externalId, measurementType, startUtc, endUtc, syncStatus, createdAt, updatedAt, deletedAt, [measurementType+startUtc]',

        settings:
          '&key, syncStatus',

        syncState:
          '&id',

        syncConflicts:
          '&id, collection, kind, detectedAt',
      })
      .upgrade(async (transaction) => {
        const names = ['habits', 'entries', 'sleepSessions', 'externalSamples', 'settings'] as const
        const before = Object.fromEntries(
          await Promise.all(names.map(async (name) => [name, await transaction.table(name).toArray()])),
        ) as Record<(typeof names)[number], Record<string, unknown>[]>

        const upgraded = upgradeTablesToV8(before)

        for (const name of names) {
          await transaction.table(name).bulkPut(upgraded[name])
        }
      })

    // Version 9: Personal CRM (contacts and their logged interactions).
    //
    // - Two new, empty tables; no existing table, record or value changes,
    //   so no upgrade function is needed.
    // - externalPhoneId is indexed but NOT unique: duplicates are prevented
    //   by the phone import, and a unique index could make a whole sync
    //   round fail on a record coming from another device.
    this.version(9).stores({
      contacts:
        '&id, name, externalPhoneId, syncStatus, createdAt, updatedAt, deletedAt',

      contactInteractions:
        '&id, contactId, occurredStart, syncStatus, createdAt, updatedAt, deletedAt, [contactId+occurredStart]',
    })
  }
}

export const db = new PersonalDataDatabase()
