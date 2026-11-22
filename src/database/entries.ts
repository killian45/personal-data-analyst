import { db } from './db'
import { messages } from '../i18n'
import { initialSyncFields, nextSyncFields } from './sync'
import type {
  DataSource,
  Entry,
  EntryValue,
  Habit,
  StopwatchValue,
} from './types'
import { entryKey } from '../import/habitRows'
import { getDeviceTimezone } from '../time/time'
import {
  normalizeComment,
  normalizeTimestamp,
  validateEntryTimes,
  validateEntryValue,
  validateStopwatchValue,
  validateTimezone,
} from './validation'

export interface CreateEntryInput {
  habitId: string

  /**
   * The entry value. For stopwatch habits, null means "create a single
   * period from occurredStart and occurredEnd".
   */
  value: EntryValue | null
  occurredStart?: string
  occurredEnd?: string | null
  timezone?: string
  comment?: string | null
}

export interface UpdateEntryInput {
  value?: EntryValue
  occurredStart?: string
  occurredEnd?: string | null
  timezone?: string
  comment?: string | null
}

export interface EntryDateRange {
  start: string
  end: string
}

/**
 * Returns a non-deleted habit. Archived habits are allowed,
 * so that historical entries can still be corrected.
 */
async function getExistingHabit(habitId: string): Promise<Habit> {
  const habit = await db.habits.get(habitId)

  if (!habit || habit.deletedAt !== null) {
    throw new Error(messages().dbText.habitNotFound)
  }

  return habit
}

/**
 * Returns a habit that can receive new entries:
 * it must exist, not be deleted and not be archived.
 */
async function getUsableHabit(habitId: string): Promise<Habit> {
  const habit = await getExistingHabit(habitId)

  if (habit.archived) {
    throw new Error(messages().dbText.archivedNoEntries)
  }

  return habit
}

interface EntryTiming {
  value: EntryValue
  occurredStart: string
  occurredEnd: string | null
}

/**
 * Works out a stopwatch entry's periods, start and end.
 *
 * - If periods are given, start/end are taken from the first and last
 *   period. Start/end given as well must match them.
 * - If no periods are given (value null), start and end are required and
 *   become a single period (manual start/end entry).
 */
function resolveStopwatchTiming(
  value: EntryValue | null | undefined,
  occurredStart: string | undefined,
  occurredEnd: string | null | undefined,
): EntryTiming {
  let stopwatchValue: StopwatchValue

  if (value === null || value === undefined) {
    if (occurredStart === undefined || occurredEnd == null) {
      throw new Error(messages().validation.stopwatchEnd)
    }

    stopwatchValue = validateStopwatchValue({
      segments: [{ start: occurredStart, end: occurredEnd }],
    })
  } else {
    stopwatchValue = validateStopwatchValue(value)
  }

  const { segments } = stopwatchValue
  const derivedStart = segments[0].start
  const derivedEnd = segments[segments.length - 1].end

  if (
    (occurredStart !== undefined &&
      normalizeTimestamp(occurredStart) !== derivedStart) ||
    (occurredEnd != null &&
      normalizeTimestamp(occurredEnd) !== derivedEnd)
  ) {
    throw new Error(
      messages().validation.stopwatchMatchPeriods,
    )
  }

  return {
    value: stopwatchValue,
    occurredStart: derivedStart,
    occurredEnd: derivedEnd,
  }
}

/**
 * Assembles an entry record.
 *
 * The single type assertion is safe because the value and times have
 * been validated against the habit type before this is called.
 */
function buildEntry(
  fields: Omit<Entry, 'habitType' | 'value' | 'occurredEnd'>,
  habit: Habit,
  timing: EntryTiming,
): Entry {
  validateEntryTimes(
    habit.type,
    timing.occurredStart,
    timing.occurredEnd,
    timing.value,
  )

  return {
    ...fields,
    occurredStart: timing.occurredStart,
    occurredEnd: timing.occurredEnd,
    habitType: habit.type,
    value: timing.value,
  } as Entry
}

/**
 * Creates a manual entry for an existing, active habit.
 *
 * Stopwatch entries can be given either their periods (value) or just a
 * start and end (value null), which creates a single period.
 */
export async function createEntry(
  input: CreateEntryInput,
): Promise<Entry> {
  const habit = await getUsableHabit(input.habitId)

  const timezone = validateTimezone(
    input.timezone ?? getDeviceTimezone(),
  )

  const timing: EntryTiming = habit.type === 'stopwatch'
    ? resolveStopwatchTiming(
        input.value,
        input.occurredStart,
        input.occurredEnd,
      )
    : {
        value: validateEntryValue(habit, input.value),
        occurredStart: normalizeTimestamp(
          input.occurredStart ?? new Date().toISOString(),
        ),
        occurredEnd: input.occurredEnd == null
          ? null
          : normalizeTimestamp(input.occurredEnd),
      }

  const now = new Date().toISOString()

  const entry = buildEntry(
    {
      id: crypto.randomUUID(),
      habitId: habit.id,
      occurredStart: timing.occurredStart,
      timezone,
      comment: normalizeComment(input.comment),
      source: 'manual' satisfies DataSource,
      externalId: null,
      ...initialSyncFields(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    habit,
    timing,
  )

  await db.entries.add(entry)

  return entry
}

/**
 * Saves several manual entries in one transaction: either all are saved
 * or none (used when several categories are logged at once — one entry
 * per category, like the spreadsheet import). Each entry is checked
 * exactly like createEntry.
 */
export async function createEntries(
  inputs: readonly CreateEntryInput[],
): Promise<Entry[]> {
  if (inputs.length === 0) {
    throw new Error(messages().dbText.nothingToSave)
  }

  return db.transaction('rw', db.habits, db.entries, async () => {
    const saved: Entry[] = []

    for (const input of inputs) {
      saved.push(await createEntry(input))
    }

    return saved
  })
}

/**
 * Updates an existing entry and validates it against its habit.
 *
 * For stopwatch entries:
 * - New periods can be given as the value.
 * - Start/end can be changed directly only when the entry has a single
 *   period (no pauses); otherwise its periods must be edited.
 */
export async function updateEntry(
  id: string,
  changes: UpdateEntryInput,
): Promise<Entry> {
  const existingEntry = await db.entries.get(id)

  if (!existingEntry || existingEntry.deletedAt !== null) {
    throw new Error(messages().dbText.entryNotFound)
  }

  // Editing historical entries of archived habits is allowed.
  const habit = await getExistingHabit(existingEntry.habitId)

  if (existingEntry.habitType !== habit.type) {
    throw new Error(messages().dbText.entryTypeMismatch)
  }

  const timezone = validateTimezone(
    changes.timezone ?? existingEntry.timezone,
  )

  let timing: EntryTiming

  if (existingEntry.habitType === 'stopwatch') {
    const timesChanged =
      changes.occurredStart !== undefined ||
      changes.occurredEnd !== undefined

    if (changes.value !== undefined) {
      timing = resolveStopwatchTiming(
        changes.value,
        changes.occurredStart,
        changes.occurredEnd,
      )
    } else if (timesChanged) {
      if (existingEntry.value.segments.length > 1) {
        throw new Error(
          messages().dbText.entryHasPauses,
        )
      }

      timing = resolveStopwatchTiming(
        null,
        changes.occurredStart ?? existingEntry.occurredStart,
        changes.occurredEnd === undefined
          ? existingEntry.occurredEnd
          : changes.occurredEnd,
      )
    } else {
      timing = resolveStopwatchTiming(
        existingEntry.value,
        undefined,
        undefined,
      )
    }
  } else {
    timing = {
      value: validateEntryValue(
        habit,
        changes.value === undefined
          ? existingEntry.value
          : changes.value,
      ),
      occurredStart: normalizeTimestamp(
        changes.occurredStart ?? existingEntry.occurredStart,
      ),
      occurredEnd: changes.occurredEnd === undefined
        ? existingEntry.occurredEnd
        : changes.occurredEnd === null
          ? null
          : normalizeTimestamp(changes.occurredEnd),
    }
  }

  const comment = normalizeComment(
    changes.comment === undefined
      ? existingEntry.comment
      : changes.comment,
  )

  const updatedEntry = buildEntry(
    {
      ...existingEntry,
      timezone,
      comment,
      ...nextSyncFields(existingEntry),
      updatedAt: new Date().toISOString(),
    },
    habit,
    timing,
  )

  await db.entries.put(updatedEntry)

  return updatedEntry
}

/**
 * Soft-deletes an entry without physically removing it.
 */
export async function deleteEntry(id: string): Promise<void> {
  const existingEntry = await db.entries.get(id)

  if (!existingEntry || existingEntry.deletedAt !== null) {
    throw new Error(messages().dbText.entryNotFound)
  }

  const now = new Date().toISOString()

  await db.entries.put({
    ...existingEntry,
    ...nextSyncFields(existingEntry),
    deletedAt: now,
    updatedAt: now,
  })
}

/**
 * Restores a soft-deleted entry (used by "Undo").
 *
 * The entry's habit must still exist; archived habits are allowed.
 */
export async function restoreEntry(id: string): Promise<Entry> {
  return db.transaction('rw', db.habits, db.entries, async () => {
    const existingEntry = await db.entries.get(id)

    if (!existingEntry) {
      throw new Error(messages().dbText.entryNotFound)
    }

    if (existingEntry.deletedAt === null) {
      throw new Error(messages().dbText.entryNotDeleted)
    }

    await getExistingHabit(existingEntry.habitId)

    const restoredEntry: Entry = {
      ...existingEntry,
      ...nextSyncFields(existingEntry),
      deletedAt: null,
      updatedAt: new Date().toISOString(),
    }

    await db.entries.put(restoredEntry)

    return restoredEntry
  })
}

/**
 * Retrieves non-deleted entries for one habit.
 * Results are ordered newest first.
 *
 * The date range uses an inclusive start and exclusive end.
 */
export async function getEntriesByHabit(
  habitId: string,
  dateRange?: EntryDateRange,
): Promise<Entry[]> {
  const habit = await db.habits.get(habitId)

  if (!habit || habit.deletedAt !== null) {
    throw new Error(messages().dbText.habitNotFound)
  }

  let entries: Entry[]

  if (dateRange) {
    const start = normalizeTimestamp(dateRange.start)
    const end = normalizeTimestamp(dateRange.end)

    if (Date.parse(end) <= Date.parse(start)) {
      throw new Error(messages().dbText.rangeEnd)
    }

    entries = await db.entries
      .where('[habitId+occurredStart]')
      .between(
        [habitId, start],
        [habitId, end],
        true,
        false,
      )
      .toArray()
  } else {
    entries = await db.entries
      .where('habitId')
      .equals(habitId)
      .toArray()
  }

  return entries
    .filter((entry) => entry.deletedAt === null)
    .sort((a, b) =>
      b.occurredStart.localeCompare(a.occurredStart),
    )
}

export interface ImportEntryInput {
  /** Spreadsheet row (kept in externalId for traceability). */
  row: number
  /** Several categories from one cell: their number (externalId "<row>.<part>"). */
  part?: number | null
  value: EntryValue | null
  occurredStart: string
  occurredEnd: string | null
  comment: string | null
}

/**
 * Saves entries imported from a spreadsheet (docs/HABIT_IMPORT.md) for one
 * active habit, all in one transaction: either every entry is saved or
 * none. Each entry is checked like a manual one; entries already present
 * (same times and value) are skipped, re-checked here in case data changed
 * since the preview. Source "import", externalId "sheet:<batch>:<row>".
 */
export async function importEntries(
  habitId: string,
  items: readonly ImportEntryInput[],
  timezone: string,
  batchId: string,
): Promise<{ added: Entry[]; skipped: number }> {
  const zone = validateTimezone(timezone)

  return db.transaction('rw', db.habits, db.entries, async () => {
    const habit = await getUsableHabit(habitId)
    const existing = await db.entries.where('habitId').equals(habitId).toArray()
    const keys = new Set(existing.filter((entry) => entry.deletedAt === null).map(entryKey))
    const now = new Date().toISOString()
    const added: Entry[] = []

    for (const item of items) {
      const timing: EntryTiming = habit.type === 'stopwatch'
        ? resolveStopwatchTiming(null, item.occurredStart, item.occurredEnd)
        : {
            value: validateEntryValue(habit, item.value),
            occurredStart: normalizeTimestamp(item.occurredStart),
            occurredEnd: null,
          }
      const key = entryKey({ ...timing, habitType: habit.type })
      if (keys.has(key)) continue
      keys.add(key)

      added.push(buildEntry(
        {
          id: crypto.randomUUID(),
          habitId: habit.id,
          occurredStart: timing.occurredStart,
          timezone: zone,
          comment: normalizeComment(item.comment),
          source: 'import' satisfies DataSource,
          externalId: `sheet:${batchId}:${item.row}${item.part ? `.${item.part}` : ''}`,
          ...initialSyncFields(),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        habit,
        timing,
      ))
    }

    await db.entries.bulkAdd(added)
    return { added, skipped: items.length - added.length }
  })
}

/** Soft-deletes the entries of one import ("Undo this import"); returns how many. */
export async function undoImport(batchId: string): Promise<number> {
  return db.transaction('rw', db.entries, async () => {
    const prefix = `sheet:${batchId}:`
    const entries = await db.entries.where('externalId').startsWith(prefix).toArray()
    const now = new Date().toISOString()
    const live = entries.filter((entry) => entry.deletedAt === null)
    await db.entries.bulkPut(live.map((entry) => ({ ...entry, ...nextSyncFields(entry), deletedAt: now, updatedAt: now })))
    return live.length
  })
}
