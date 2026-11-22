/**
 * Whether to show the welcome screen (sharing plan S4).
 *
 * Shown only on a device that has never been set up: no "done" mark AND
 * an empty database AND not linked to sync. A device that already has
 * data (the owner's computer, phone and tablet, or any device after a
 * restore or sync) is marked done silently and never sees it; its feature
 * switches stay unset, which means every feature on.
 *
 * The mark is kept in this device's localStorage (not synced). "Delete all
 * data on this device" does not remove it, so the app then starts empty
 * without asking again.
 */

import type { PersonalDataDatabase } from '../database/db'

export const WELCOME_DONE_KEY = 'pda.welcomeDone'

export function isWelcomeDone(): boolean {
  try {
    return localStorage.getItem(WELCOME_DONE_KEY) === '1'
  } catch {
    // Storage unavailable: never block the app behind a welcome screen.
    return true
  }
}

export function markWelcomeDone(): void {
  try {
    localStorage.setItem(WELCOME_DONE_KEY, '1')
  } catch (caught) {
    console.error('Could not save that the welcome screen was done:', caught)
  }
}

/** True when this device has no data of any kind and is not linked to sync. */
export async function isDatabaseEmpty(database: PersonalDataDatabase): Promise<boolean> {
  const tables = [
    database.habits,
    database.entries,
    database.activeTimers,
    database.sleepSessions,
    database.externalSamples,
    database.settings,
    database.syncState,
    database.syncConflicts,
    database.contacts,
    database.contactInteractions,
  ]
  for (const table of tables) {
    if ((await table.count()) > 0) return false
  }
  return true
}

/**
 * Decides once at start-up. Marks existing devices as done so that the
 * question is never asked again, even if their data is later deleted.
 */
export async function needsWelcome(database: PersonalDataDatabase): Promise<boolean> {
  if (isWelcomeDone()) return false
  if (await isDatabaseEmpty(database)) return true
  markWelcomeDone()
  return false
}
