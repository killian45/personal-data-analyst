/**
 * Local tables that are synchronised (docs/SYNC_DESIGN.md §2).
 * Must match the sync_records.collection check in
 * supabase/migrations/20261110140321_sync_schema.sql, as widened by
 * 20261112170000_crm_collections.sql (Personal CRM).
 * activeTimers are deliberately absent: a running stopwatch stays on its device.
 */
export const SYNC_COLLECTIONS = [
  'habits',
  'entries',
  'sleepSessions',
  'settings',
  'externalSamples',
  'contacts',
  'contactInteractions',
] as const

export type SyncCollection = (typeof SYNC_COLLECTIONS)[number]
