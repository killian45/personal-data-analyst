import type { SyncFields } from './types'

/**
 * Synchronisation bookkeeping for local changes.
 *
 * Every local create, update, archive, reorder or soft delete marks the
 * record "pending" and increases its revision. Only the sync engine
 * (Phase 3) may mark records "synced" or "conflict", or change
 * syncedRevision.
 */

/** Sync fields for a newly created record. */
export function initialSyncFields(): SyncFields {
  return { syncStatus: 'pending', revision: 1, syncedRevision: null }
}

/**
 * Sync fields for a record that is being changed locally. syncedRevision
 * is not returned, so spreading the result over the existing record keeps
 * it. A record in conflict stays in conflict: the user still has to choose
 * between the versions, and the choice will use this latest local edit.
 */
export function nextSyncFields(
  record: Pick<SyncFields, 'syncStatus' | 'revision'>,
): Pick<SyncFields, 'syncStatus' | 'revision'> {
  return {
    syncStatus: record.syncStatus === 'conflict' ? 'conflict' : 'pending',
    revision: record.revision + 1,
  }
}
