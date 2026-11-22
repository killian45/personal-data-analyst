-- Personal CRM step 4 (2026-11-12): contacts and their interactions are
-- synchronised like every other record — end-to-end encrypted rows in
-- public.sync_records. No new table, no unencrypted column: the only
-- change is that the two new collection names are allowed.
--
-- Must match SYNC_COLLECTIONS in src/sync/types.ts.
--
-- Safe for existing rows: the new check allows everything the old one
-- allowed. Apps older than this version stop syncing (they refuse rows of
-- unknown collections, losing nothing) until they are updated.

alter table public.sync_records
  drop constraint if exists sync_records_collection_check;

alter table public.sync_records
  add constraint sync_records_collection_check
  check (collection in ('habits', 'entries', 'sleepSessions', 'settings', 'externalSamples',
                        'contacts', 'contactInteractions'));
