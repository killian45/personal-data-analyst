/**
 * Record transformations between database schema versions.
 *
 * Pure functions shared by the Dexie upgrades (src/database/db.ts) and
 * by backup restore (src/backup/restore), so that an old backup is
 * converted exactly like an old database.
 *
 * Records are handled as plain objects because old versions do not
 * match the current TypeScript types.
 */

export type PlainRecord = Record<string, unknown>

/**
 * Version 3 → 4 for a habit: adds sync fields. createdAt and updatedAt
 * are not changed (this is not a user edit).
 */
export function upgradeHabitToV4(habit: PlainRecord): PlainRecord {
  return { ...habit, syncStatus: 'pending', revision: 1 }
}

/**
 * Version 3 → 4 for an entry: copies the habit type, adds externalId and
 * sync fields, and turns a stopwatch start/end into a single period.
 *
 * Throws (without a prefix; callers add context) if the habit is missing
 * or a stopwatch entry has no end.
 */
export function upgradeEntryToV4(
  entry: PlainRecord,
  habitType: string | undefined,
): PlainRecord {
  if (!habitType) {
    throw new Error(
      `entry ${String(entry.id)} refers to a missing habit (${String(entry.habitId)})`,
    )
  }

  const upgraded: PlainRecord = {
    ...entry,
    habitType,
    externalId: entry.externalId ?? null,
    syncStatus: 'pending',
    revision: 1,
  }

  if (habitType === 'stopwatch') {
    if (typeof entry.occurredEnd !== 'string') {
      throw new Error(`stopwatch entry ${String(entry.id)} has no end time`)
    }

    upgraded.value = {
      segments: [{ start: entry.occurredStart, end: entry.occurredEnd }],
    }
  }

  return upgraded
}

/**
 * Version 3 → 4 for a running stopwatch: no completed periods, running
 * since its start.
 */
export function upgradeTimerToV4(timer: PlainRecord): PlainRecord {
  return { ...timer, completedSegments: [], runningSince: timer.startedAt }
}

/**
 * Upgrades the tables of a version 3 database or backup to version 4.
 */
export function upgradeTablesToV4(tables: {
  habits: PlainRecord[]
  entries: PlainRecord[]
  activeTimers: PlainRecord[]
}): { habits: PlainRecord[]; entries: PlainRecord[]; activeTimers: PlainRecord[] } {
  const habitTypes = new Map(
    tables.habits.map((habit) => [String(habit.id), String(habit.type)]),
  )

  return {
    habits: tables.habits.map(upgradeHabitToV4),
    entries: tables.entries.map((entry) =>
      upgradeEntryToV4(entry, habitTypes.get(String(entry.habitId))),
    ),
    activeTimers: tables.activeTimers.map(upgradeTimerToV4),
  }
}

/**
 * Version 6 → 7 for a habit: number habits get dailyAggregation "sum"
 * (the previous implicit behaviour) and no target. Other habit types are
 * unchanged. Habits that already have the fields are left as they are.
 */
export function upgradeHabitToV7(habit: PlainRecord): PlainRecord {
  if (habit.type !== 'number' || habit.dailyAggregation !== undefined) {
    return habit
  }

  return { ...habit, dailyAggregation: 'sum', target: null }
}

/**
 * Version 7 → 8 for a synchronised record (habit, entry, sleep session,
 * imported sample): adds syncedRevision null ("never synchronised").
 * Nothing else changes. Records that already have the field are kept.
 */
export function upgradeSyncedRecordToV8(record: PlainRecord): PlainRecord {
  return record.syncedRevision === undefined ? { ...record, syncedRevision: null } : record
}

/**
 * Version 7 → 8 for a setting: adds sync fields (pending, revision 1,
 * never synchronised) and deletedAt null. key, value and updatedAt are
 * not changed. Settings that already have the fields are kept.
 */
export function upgradeSettingToV8(setting: PlainRecord): PlainRecord {
  if (setting.revision !== undefined) {
    return setting
  }

  return { ...setting, syncStatus: 'pending', revision: 1, syncedRevision: null, deletedAt: null }
}

export interface SyncedTablesV8 {
  habits: PlainRecord[]
  entries: PlainRecord[]
  sleepSessions: PlainRecord[]
  externalSamples: PlainRecord[]
  settings: PlainRecord[]
}

/** Upgrades the synchronised tables of a version 7 database or backup to version 8. */
export function upgradeTablesToV8(tables: SyncedTablesV8): SyncedTablesV8 {
  return {
    habits: tables.habits.map(upgradeSyncedRecordToV8),
    entries: tables.entries.map(upgradeSyncedRecordToV8),
    sleepSessions: tables.sleepSessions.map(upgradeSyncedRecordToV8),
    externalSamples: tables.externalSamples.map(upgradeSyncedRecordToV8),
    settings: tables.settings.map(upgradeSettingToV8),
  }
}

export interface CrmTablesV9 {
  contacts: PlainRecord[]
  contactInteractions: PlainRecord[]
}

/**
 * Version 8 → 9 for a backup: the Personal CRM tables did not exist, so
 * they are empty. Nothing else changes (the database upgrade only adds
 * the two tables).
 */
export function upgradeTablesToV9<T extends object>(tables: T): T & CrmTablesV9 {
  return { ...tables, contacts: [], contactInteractions: [] }
}
