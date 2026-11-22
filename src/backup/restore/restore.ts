import { messages } from '../../i18n'
import { db } from '../../database/db'
import type {
  ActiveTimer,
  Contact,
  ContactInteraction,
  Entry,
  ExternalSample,
  Habit,
  SettingRecord,
  SleepSession,
} from '../../database/types'
import { stableStringify } from '../../database/stableStringify'
import type { PlainRecord } from '../../database/upgrades'

import { parseBackup } from './parseBackup'
import type { ParsedBackup } from './parseBackup'
import {
  validateContactInteractionRecord,
  validateContactRecord,
  validateEntryRecord,
  validateExternalSampleRecord,
  validateHabitRecord,
  validateSettingRecord,
  validateSleepSessionRecord,
  validateTimerRecord,
} from './validateRecords'

/**
 * Backup restore (PROJECT_SPEC.md §3.3 and §10.4).
 *
 * Rules:
 * - Restore only ADDS records. Nothing on this device is overwritten or
 *   deleted.
 * - A record whose id already exists on this device:
 *     identical → skipped (restoring the same backup twice creates no
 *                 duplicates);
 *     different → this device's version is kept and the record is listed
 *                 so the user knows.
 * - Invalid records are never silently discarded: each is listed with
 *   the reason, and is not imported.
 * - Entries and running stopwatches are checked against the habit that
 *   will be in the database: this device's version if it exists,
 *   otherwise the backup's version.
 * - All additions are written in one transaction: if anything fails,
 *   nothing is changed.
 * - Restored records are marked "pending" and "never synchronised"
 *   (syncedRevision null): a backup cannot know what the cloud holds now,
 *   so the sync engine checks every restored record with the server
 *   instead of trusting the backup's sync state. For the same reason the
 *   sync state is ignored when comparing with this device's records.
 */

export const RESTORE_TABLES = [
  'habits',
  'entries',
  'activeTimers',
  'settings',
  'sleepSessions',
  'externalSamples',
  'contacts',
  'contactInteractions',
] as const

export type RestoreTable = (typeof RESTORE_TABLES)[number]

export interface RestoreIssue {
  /** Short description of the record, e.g. "Water entry, 2026-11-09". */
  label: string
  reason: string
}

export interface TablePlan<T> {
  add: T[]
  /** Already on this device, identical: skipped. */
  identical: number
  /** Already on this device with different content: device version kept. */
  differing: RestoreIssue[]
  /** Not imported because they are invalid. */
  invalid: RestoreIssue[]
}

export interface RestorePlan {
  exportedAt: string
  schemaVersion: number
  habits: TablePlan<Habit>
  entries: TablePlan<Entry>
  activeTimers: TablePlan<ActiveTimer>
  settings: TablePlan<SettingRecord>
  sleepSessions: TablePlan<SleepSession>
  externalSamples: TablePlan<ExternalSample>
  contacts: TablePlan<Contact>
  contactInteractions: TablePlan<ContactInteraction>
  /** Harmless corrections applied to restored records. */
  notes: string[]
}

export interface LocalData {
  habits: Habit[]
  entries: Entry[]
  activeTimers: ActiveTimer[]
  settings: SettingRecord[]
  sleepSessions: SleepSession[]
  externalSamples: ExternalSample[]
  contacts: Contact[]
  contactInteractions: ContactInteraction[]
}


/** Removes the per-device sync bookkeeping before comparing records. */
function withoutSyncBookkeeping(record: unknown): unknown {
  if (!record || typeof record !== 'object') {
    return record
  }

  const { syncStatus: _status, syncedRevision: _synced, ...rest } = record as Record<string, unknown>
  return rest
}

/** A restored record starts as "pending, never synchronised". */
function asRestored<T>(record: T): T {
  return record && typeof record === 'object' && 'syncStatus' in record
    ? { ...record, syncStatus: 'pending', syncedRevision: null }
    : record
}

function emptyPlan<T>(): TablePlan<T> {
  return { add: [], identical: 0, differing: [], invalid: [] }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Sorts each validated record into add / identical / differing.
 */
function compareWithLocal<T>(
  plan: TablePlan<T>,
  record: T,
  local: T | undefined,
  label: string,
): void {
  if (!local) {
    plan.add.push(asRestored(record))
  } else if (
    stableStringify(withoutSyncBookkeeping(local)) === stableStringify(withoutSyncBookkeeping(record))
  ) {
    plan.identical += 1
  } else {
    plan.differing.push({
      label,
      reason: 'a different version is already on this device; that version was kept',
    })
  }
}

/**
 * Works out what a restore would do. Pure: does not touch the database.
 */
export function planRestore(backup: ParsedBackup, local: LocalData): RestorePlan {
  const { tables } = backup

  const plan: RestorePlan = {
    exportedAt: backup.exportedAt,
    schemaVersion: backup.schemaVersion,
    habits: emptyPlan(),
    entries: emptyPlan(),
    activeTimers: emptyPlan(),
    settings: emptyPlan(),
    sleepSessions: emptyPlan(),
    externalSamples: emptyPlan(),
    contacts: emptyPlan(),
    contactInteractions: emptyPlan(),
    notes: [],
  }

  // Habits: the version that will be in the database after restoring.
  const localHabits = new Map(local.habits.map((habit) => [habit.id, habit]))
  const resultingHabits = new Map(localHabits)

  for (const raw of tables.habits) {
    const label = messages().backupText.habit(String(raw.name))

    try {
      const { habit, notes } = validateHabitRecord(raw)
      plan.notes.push(...notes)
      compareWithLocal(plan.habits, habit, localHabits.get(habit.id), label)

      if (!resultingHabits.has(habit.id)) {
        resultingHabits.set(habit.id, habit)
      }
    } catch (caughtError) {
      plan.habits.invalid.push({ label, reason: reasonOf(caughtError) })
    }
  }

  const habitName = (raw: PlainRecord) =>
    resultingHabits.get(String(raw.habitId))?.name ?? messages().backupText.unknownHabit

  const localEntries = new Map(local.entries.map((entry) => [entry.id, entry]))

  for (const raw of tables.entries) {
    const label = messages().backupText.entry(habitName(raw), String(raw.occurredStart).slice(0, 10))

    try {
      const entry = validateEntryRecord(raw, resultingHabits.get(String(raw.habitId)))
      compareWithLocal(plan.entries, entry, localEntries.get(entry.id), label)
    } catch (caughtError) {
      plan.entries.invalid.push({ label, reason: reasonOf(caughtError) })
    }
  }

  const localTimers = new Map(local.activeTimers.map((timer) => [timer.habitId, timer]))

  for (const raw of tables.activeTimers) {
    const label = messages().backupText.timer(habitName(raw))

    try {
      const timer = validateTimerRecord(raw, resultingHabits.get(String(raw.habitId)))
      compareWithLocal(plan.activeTimers, timer, localTimers.get(timer.habitId), label)
    } catch (caughtError) {
      plan.activeTimers.invalid.push({ label, reason: reasonOf(caughtError) })
    }
  }

  const localSettings = new Map(local.settings.map((setting) => [setting.key, setting]))

  for (const raw of tables.settings) {
    const label = messages().backupText.setting(String(raw.key))

    try {
      const setting = validateSettingRecord(raw)
      compareWithLocal(plan.settings, setting, localSettings.get(setting.key), label)
    } catch (caughtError) {
      plan.settings.invalid.push({ label, reason: reasonOf(caughtError) })
    }
  }

  // Sleep sessions: besides the id, the unique duplicate-detection key
  // and the "no identical manual sessions" rule must hold, otherwise the
  // database would refuse the whole restore.
  const localSleep = new Map(local.sleepSessions.map((session) => [session.id, session]))
  const usedKeys = new Map(local.sleepSessions.map((session) => [session.dedupeKey, session.id]))
  const manualTimes = new Set(
    local.sleepSessions
      .filter((session) => session.source === 'manual' && session.deletedAt === null)
      .map((session) => `${session.startUtc}|${session.endUtc}`),
  )

  for (const raw of tables.sleepSessions) {
    const label = typeof raw.startUtc === 'string'
      ? messages().backupText.sleepAt(raw.startUtc.slice(0, 16).replace('T', ' '))
      : messages().backupText.sleepId(String(raw.id))

    try {
      const session = validateSleepSessionRecord(raw)
      const existing = localSleep.get(session.id)

      if (!existing && usedKeys.has(session.dedupeKey)) {
        plan.sleepSessions.differing.push({
          label,
          reason: 'the same source record is already on this device; that version was kept',
        })
        continue
      }

      const times = `${session.startUtc}|${session.endUtc}`

      if (
        !existing &&
        session.source === 'manual' &&
        session.deletedAt === null &&
        manualTimes.has(times)
      ) {
        plan.sleepSessions.differing.push({
          label,
          reason: 'a manual session with the same bedtime and wake time is already on this device; that one was kept',
        })
        continue
      }

      compareWithLocal(plan.sleepSessions, session, existing, label)

      if (!existing) {
        usedKeys.set(session.dedupeKey, session.id)

        if (session.source === 'manual' && session.deletedAt === null) {
          manualTimes.add(times)
        }
      }
    } catch (caughtError) {
      plan.sleepSessions.invalid.push({ label, reason: reasonOf(caughtError) })
    }
  }

  // Imported samples (screen time): besides the id, the unique
  // duplicate-detection key (one record per source and day) must hold.
  const localSamples = new Map(local.externalSamples.map((sample) => [sample.id, sample]))
  const usedSampleKeys = new Set(local.externalSamples.map((sample) => sample.dedupeKey))

  for (const raw of tables.externalSamples) {
    const day = (raw.metadata as { localDate?: unknown } | null)?.localDate
    const label = typeof day === 'string'
      ? messages().backupText.screenTime(day)
      : raw.measurementType === 'location_visit'
        ? messages().backupText.visit(String(raw.startUtc).slice(0, 16).replace('T', ' '))
        : raw.measurementType === 'location_movement'
          ? messages().backupText.movement(String(raw.startUtc).slice(0, 16).replace('T', ' '))
          : messages().backupText.sample(String(raw.id))

    try {
      const sample = validateExternalSampleRecord(raw)
      const existing = localSamples.get(sample.id)

      if (!existing && usedSampleKeys.has(sample.dedupeKey)) {
        plan.externalSamples.differing.push({
          label,
          reason: 'the same record from the same source is already on this device; that version was kept',
        })
        continue
      }

      compareWithLocal(plan.externalSamples, sample, existing, label)
      usedSampleKeys.add(sample.dedupeKey)
    } catch (caughtError) {
      plan.externalSamples.invalid.push({ label, reason: reasonOf(caughtError) })
    }
  }

  // Personal CRM: interactions are checked against the contact that will
  // be in the database (this device's version if it exists, otherwise the
  // backup's), like entries and their habits.
  const localContacts = new Map(local.contacts.map((contact) => [contact.id, contact]))
  const resultingContacts = new Map(localContacts)

  for (const raw of tables.contacts) {
    const label = messages().backupText.contact(String(raw.name))

    try {
      const contact = validateContactRecord(raw)
      compareWithLocal(plan.contacts, contact, localContacts.get(contact.id), label)

      if (!resultingContacts.has(contact.id)) {
        resultingContacts.set(contact.id, contact)
      }
    } catch (caughtError) {
      plan.contacts.invalid.push({ label, reason: reasonOf(caughtError) })
    }
  }

  const localInteractions = new Map(local.contactInteractions.map((interaction) => [interaction.id, interaction]))

  for (const raw of tables.contactInteractions) {
    const contactName = resultingContacts.get(String(raw.contactId))?.name ?? messages().backupText.unknownContact
    const label = messages().backupText.interaction(contactName, String(raw.occurredStart).slice(0, 10))

    try {
      const interaction = validateContactInteractionRecord(raw, resultingContacts.get(String(raw.contactId)))
      compareWithLocal(plan.contactInteractions, interaction, localInteractions.get(interaction.id), label)
    } catch (caughtError) {
      plan.contactInteractions.invalid.push({ label, reason: reasonOf(caughtError) })
    }
  }

  return plan
}

/** Number of records the plan would add. */
export function countAdditions(plan: RestorePlan): number {
  return (
    plan.habits.add.length +
    plan.entries.add.length +
    plan.activeTimers.add.length +
    plan.settings.add.length +
    plan.sleepSessions.add.length +
    plan.externalSamples.add.length +
    plan.contacts.add.length +
    plan.contactInteractions.add.length
  )
}

async function readLocalData(): Promise<LocalData> {
  return db.transaction(
    'r',
    [db.habits, db.entries, db.activeTimers, db.settings, db.sleepSessions, db.externalSamples, db.contacts, db.contactInteractions],
    async () => ({
      habits: await db.habits.toArray(),
      entries: await db.entries.toArray(),
      activeTimers: await db.activeTimers.toArray(),
      settings: await db.settings.toArray(),
      sleepSessions: await db.sleepSessions.toArray(),
      externalSamples: await db.externalSamples.toArray(),
      contacts: await db.contacts.toArray(),
      contactInteractions: await db.contactInteractions.toArray(),
    }),
  )
}

/**
 * Reads and checks a backup file and compares it with this device.
 * Does not change anything.
 */
export async function previewRestore(text: string): Promise<RestorePlan> {
  const backup = await parseBackup(text)
  return planRestore(backup, await readLocalData())
}

/**
 * Adds the plan's records in one transaction. If any record now exists
 * on this device (the data changed since the preview), nothing is added.
 */
export async function applyRestore(plan: RestorePlan): Promise<number> {
  try {
    await db.transaction(
      'rw',
      [db.habits, db.entries, db.activeTimers, db.settings, db.sleepSessions, db.externalSamples, db.contacts, db.contactInteractions],
      async () => {
        await db.habits.bulkAdd(plan.habits.add)
        await db.entries.bulkAdd(plan.entries.add)
        await db.activeTimers.bulkAdd(plan.activeTimers.add)
        await db.settings.bulkAdd(plan.settings.add)
        await db.sleepSessions.bulkAdd(plan.sleepSessions.add)
        await db.externalSamples.bulkAdd(plan.externalSamples.add)
        await db.contacts.bulkAdd(plan.contacts.add)
        await db.contactInteractions.bulkAdd(plan.contactInteractions.add)
      },
    )
  } catch (caughtError) {
    console.error('Restore failed:', caughtError)
    throw new Error(
      messages().backupText.nothingRestored,
    )
  }

  return countAdditions(plan)
}

