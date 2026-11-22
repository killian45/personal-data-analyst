import { db } from './db'
import { initialSyncFields, nextSyncFields } from './sync'
import type { SettingRecord } from './types'

/**
 * Settings storage with synchronisation bookkeeping (schema version 8).
 *
 * All setting writes go through these functions so that every change
 * marks the setting "pending" with a higher revision, and a removal is a
 * soft deletion (deletedAt) that can be synchronised, never a hard delete.
 *
 * Callers validate values; this module only stores them.
 */

/** The value of a setting, or null if it was never set or was removed. */
export function activeSettingValue(record: SettingRecord | undefined): string | null {
  return record && record.deletedAt === null ? record.value : null
}

/** Reads one setting's active value (null if missing or removed). */
export async function getSettingValue(key: string): Promise<string | null> {
  return activeSettingValue(await db.settings.get(key))
}

/**
 * Sets a setting. Writing the value it already has (and is not removed)
 * changes nothing, so no needless sync traffic is created.
 */
export async function putSetting(key: string, value: string, now = new Date()): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const existing = await db.settings.get(key)

    if (existing && existing.deletedAt === null && existing.value === value) {
      return
    }

    const record: SettingRecord = existing
      ? { ...existing, value, deletedAt: null, ...nextSyncFields(existing), updatedAt: now.toISOString() }
      : { key, value, deletedAt: null, ...initialSyncFields(), updatedAt: now.toISOString() }

    await db.settings.put(record)
  })
}

/**
 * Removes a setting by soft deletion. The last value is kept with the
 * record. Removing a missing or already removed setting changes nothing.
 */
export async function removeSetting(key: string, now = new Date()): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const existing = await db.settings.get(key)

    if (!existing || existing.deletedAt !== null) {
      return
    }

    const timestamp = now.toISOString()
    await db.settings.put({ ...existing, deletedAt: timestamp, ...nextSyncFields(existing), updatedAt: timestamp })
  })
}
