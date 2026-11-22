import { db } from '../database/db'
import type { Contact, Habit } from '../database/types'
import { LOCATION_TYPES } from '../location/location'
import { toLocationLogRow, toLogRow, toScreenTimeLogRow, toSleepLogRow } from '../log/logRows'
import type { LogRow } from '../log/logRows'
import { resolveDisplayZone } from '../settings/displayTimezone'
import type { DisplayTimezone } from '../settings/displayTimezone'
import { SCREEN_TIME_DAILY } from '../screenTime/screenTime'
import { formatInTimezone, getDeviceTimezone } from '../time/time'

/**
 * Deleted data: soft-deleted habits and entries, so the user can see and
 * restore them. Nothing here changes the database.
 */

export interface DeletedHabit {
  habit: Habit
  /** Entries that are not deleted themselves and reappear on restore. */
  entryCount: number
}

export interface DeletedEntry {
  row: LogRow
  deletedAt: string
  /** True when the entry's habit is deleted too (restore it first). */
  habitDeleted: boolean
}

export interface DeletedSleep {
  row: LogRow
  deletedAt: string
}

export interface DeletedContact {
  contact: Contact & { deletedAt: string }
  /** Interactions that are not deleted themselves and reappear on restore. */
  interactionCount: number
}

export interface DeletedInteraction {
  id: string
  contactName: string
  /** "dd/MM/yyyy HH:mm" in the display timezone. */
  whenLabel: string
  text: string
  deletedAt: string
  /** True when the contact is deleted too (restore it first). */
  contactDeleted: boolean
}

export interface DeletedData {
  habits: DeletedHabit[]
  entries: DeletedEntry[]
  sleep: DeletedSleep[]
  /** Deleted screen-time days (same shape as sleep). */
  screenTime: DeletedSleep[]
  /** Deleted location visits and movements (same shape as sleep). */
  location: DeletedSleep[]
  contacts: DeletedContact[]
  contactInteractions: DeletedInteraction[]
}

/** Every list is ordered most recently deleted first. */
export async function loadDeletedData(
  displayTimezone: DisplayTimezone = 'event',
): Promise<DeletedData> {
  return db.transaction('r', [db.habits, db.entries, db.sleepSessions, db.externalSamples, db.contacts, db.contactInteractions], async () => {
    const allHabits = await db.habits.toArray()
    const habitsById = new Map(allHabits.map((habit) => [habit.id, habit]))
    const deviceTimezone = getDeviceTimezone()

    const visibleEntryCounts = new Map<string, number>()
    const entries: DeletedEntry[] = []

    await db.entries.each((entry) => {
      const habit = habitsById.get(entry.habitId)

      if (!habit) {
        return
      }

      if (entry.deletedAt === null) {
        visibleEntryCounts.set(habit.id, (visibleEntryCounts.get(habit.id) ?? 0) + 1)
        return
      }

      entries.push({
        row: toLogRow(entry, habit, deviceTimezone, displayTimezone),
        deletedAt: entry.deletedAt,
        habitDeleted: habit.deletedAt !== null,
      })
    })

    const habits = allHabits
      .filter((habit): habit is Habit & { deletedAt: string } => habit.deletedAt !== null)
      .map((habit) => ({ habit, entryCount: visibleEntryCounts.get(habit.id) ?? 0 }))
      .sort((a, b) => (b.habit.deletedAt ?? '').localeCompare(a.habit.deletedAt ?? ''))

    entries.sort(
      (a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.row.id.localeCompare(b.row.id),
    )

    const sleep: DeletedSleep[] = []

    await db.sleepSessions.each((session) => {
      if (session.deletedAt !== null) {
        sleep.push({
          row: toSleepLogRow(session, deviceTimezone, displayTimezone),
          deletedAt: session.deletedAt,
        })
      }
    })

    sleep.sort(
      (a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.row.id.localeCompare(b.row.id),
    )

    const screenTime: DeletedSleep[] = []

    await db.externalSamples.where('measurementType').equals(SCREEN_TIME_DAILY).each((sample) => {
      if (sample.deletedAt !== null) {
        screenTime.push({
          row: toScreenTimeLogRow(sample, deviceTimezone, displayTimezone),
          deletedAt: sample.deletedAt,
        })
      }
    })

    screenTime.sort(
      (a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.row.id.localeCompare(b.row.id),
    )

    const location: DeletedSleep[] = []

    await db.externalSamples.where('measurementType').anyOf([...LOCATION_TYPES]).each((sample) => {
      if (sample.deletedAt !== null) {
        location.push({ row: toLocationLogRow(sample, deviceTimezone, displayTimezone), deletedAt: sample.deletedAt })
      }
    })

    location.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.row.id.localeCompare(b.row.id))

    // Personal CRM, like habits and their entries.
    const allContacts = await db.contacts.toArray()
    const contactsById = new Map(allContacts.map((contact) => [contact.id, contact]))
    const visibleInteractionCounts = new Map<string, number>()
    const contactInteractions: DeletedInteraction[] = []

    await db.contactInteractions.each((interaction) => {
      const contact = contactsById.get(interaction.contactId)
      if (!contact) return
      if (interaction.deletedAt === null) {
        visibleInteractionCounts.set(contact.id, (visibleInteractionCounts.get(contact.id) ?? 0) + 1)
        return
      }
      const zone = resolveDisplayZone(displayTimezone, interaction.timezone, deviceTimezone)
      contactInteractions.push({
        id: interaction.id,
        contactName: contact.name,
        whenLabel: formatInTimezone(interaction.occurredStart, zone, 'dd/MM/yyyy HH:mm'),
        text: interaction.text,
        deletedAt: interaction.deletedAt,
        contactDeleted: contact.deletedAt !== null,
      })
    })

    const contacts = allContacts
      .filter((contact): contact is Contact & { deletedAt: string } => contact.deletedAt !== null)
      .map((contact) => ({ contact, interactionCount: visibleInteractionCounts.get(contact.id) ?? 0 }))
      .sort((a, b) => b.contact.deletedAt.localeCompare(a.contact.deletedAt))

    contactInteractions.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.id.localeCompare(b.id))

    return { habits, entries, sleep, screenTime, location, contacts, contactInteractions }
  })
}
