import { db } from './db'
import { messages } from '../i18n'
import { nextSyncFields } from './sync'
import type { ExternalSample } from './types'

/**
 * Imported-sample operations (screen time so far).
 *
 * Imported originals are never edited. They can be deleted (soft: they
 * stay stored, in backups and in sync) and restored.
 */

/** Soft-deletes an imported sample; it stays stored and can be restored. */
export async function deleteExternalSample(id: string): Promise<void> {
  await db.transaction('rw', db.externalSamples, async () => {
    const existing = await db.externalSamples.get(id)

    if (!existing || existing.deletedAt !== null) {
      throw new Error(messages().dbText.sampleNotFound)
    }

    const now = new Date().toISOString()
    await db.externalSamples.put({ ...existing, ...nextSyncFields(existing), deletedAt: now, updatedAt: now })
  })
}

/** Restores a soft-deleted imported sample. */
export async function restoreExternalSample(id: string): Promise<ExternalSample> {
  return db.transaction('rw', db.externalSamples, async () => {
    const existing = await db.externalSamples.get(id)

    if (!existing) {
      throw new Error(messages().dbText.sampleNotFound)
    }

    if (existing.deletedAt === null) {
      throw new Error(messages().dbText.sampleNotDeleted)
    }

    const restored: ExternalSample = {
      ...existing,
      ...nextSyncFields(existing),
      deletedAt: null,
      updatedAt: new Date().toISOString(),
    }

    await db.externalSamples.put(restored)

    return restored
  })
}
