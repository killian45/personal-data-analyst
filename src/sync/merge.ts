/**
 * Merge rules for one record received from the server
 * (docs/SYNC_DESIGN.md §6). Pure: no database, no clock.
 *
 * Inputs: the local record's sync fields (or nothing if the record is not
 * on this device), the server revision, and whether the contents are equal.
 *
 * - skip:         the device already agreed on this server version.
 * - adopt-remote: store the server version as synced. Used when only the
 *                 server changed (rule 2), when both versions are equal
 *                 (rule 1), and for records new to this device.
 * - conflict:     both sides changed differently (rules 3 and 4): keep
 *                 the local version, keep the server version aside, and
 *                 let the user choose. Nothing is overwritten.
 *
 * Device clocks are never used: only revisions and content.
 */

import { stableStringify } from '../database/stableStringify'
import type { SyncFields } from '../database/types'

export type MergeDecision = 'skip' | 'adopt-remote' | 'conflict'

export function decideMerge(
  local: SyncFields | undefined,
  remoteRevision: number,
  sameContent: boolean,
): MergeDecision {
  if (!local) {
    return 'adopt-remote'
  }

  if (local.syncedRevision === remoteRevision) {
    return 'skip'
  }

  if (local.syncStatus === 'synced') {
    // Only the server changed.
    return 'adopt-remote'
  }

  // Changed here (pending), already in conflict, or never synchronised.
  return sameContent ? 'adopt-remote' : 'conflict'
}

/**
 * Fields that describe sync bookkeeping or edit time rather than content.
 * Two versions that differ only in these are the same content (rule 1):
 * the same edit made on two devices at different times is not a conflict.
 */
const NOT_CONTENT = new Set(['syncStatus', 'revision', 'syncedRevision', 'updatedAt'])

/** The part of a record that is compared between devices. */
export function contentOf(record: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !NOT_CONTENT.has(key)))
}

export function sameContent(a: object, b: object): boolean {
  return stableStringify(contentOf(a)) === stableStringify(contentOf(b))
}

/** What is encrypted and uploaded: the record without per-device sync fields. */
export function uploadContent(record: object): Record<string, unknown> {
  const { syncStatus: _status, revision: _revision, syncedRevision: _synced, ...rest } =
    record as Record<string, unknown>
  return rest
}
