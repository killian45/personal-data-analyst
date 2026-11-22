-- Personal Data Analyst — sync server setup (one file).
--
-- Paste this whole file into the SQL editor of a NEW, empty Supabase
-- project and press Run, once. It creates the tables and security rules
-- the app needs for sync; everything the app stores here is encrypted on
-- your devices first.
--
-- Generated from supabase/migrations by "npm run setup-sql". Do not edit
-- by hand: change the migrations instead.

-- ===== 20261110140321_sync_schema.sql =====

-- Phase 3 synchronisation schema (docs/SYNC_DESIGN.md §4 and §5.3).
--
-- Everything stored here is end-to-end encrypted by the devices. The server
-- cannot read record content, so it validates only the envelope
-- (PROJECT_SPEC.md §11.2, approved exception; SYNC_DESIGN.md §4.3).

-- ---------------------------------------------------------------------------
-- user_keys: the user's data key, wrapped twice (passphrase, recovery key).
-- ---------------------------------------------------------------------------

create table public.user_keys (
  user_id          uuid        primary key default auth.uid()
                               references auth.users (id) on delete cascade,
  wrapped_key_pass bytea       not null
                               check (octet_length(wrapped_key_pass) between 24 and 1024),
  wrapped_key_rec  bytea       not null
                               check (octet_length(wrapped_key_rec) between 24 and 1024),
  salt             bytea       not null check (octet_length(salt) = 16),
  iterations       integer     not null check (iterations >= 100000),
  key_version      integer     not null default 1 check (key_version >= 1),
  updated_at       timestamptz not null default now()
);

comment on table public.user_keys is
  'One row per user: the encrypted (wrapped) data key. The server never sees the unwrapped key.';

create function public.user_keys_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id <> old.user_id then
    raise exception 'user_keys.user_id cannot change' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger user_keys_before_update
  before update on public.user_keys
  for each row execute function public.user_keys_before_update();

alter table public.user_keys enable row level security;

create policy "user_keys: owner can read"
  on public.user_keys for select to authenticated
  using (user_id = (select auth.uid()));

create policy "user_keys: owner can insert"
  on public.user_keys for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "user_keys: owner can update"
  on public.user_keys for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "user_keys: owner can delete"
  on public.user_keys for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- sync_records: one encrypted record per (user, collection, record id).
-- ---------------------------------------------------------------------------

create sequence public.sync_records_server_seq as bigint;

create table public.sync_records (
  user_id           uuid        not null default auth.uid()
                                references auth.users (id) on delete cascade,
  collection        text        not null
                                check (collection in ('habits', 'entries', 'sleepSessions',
                                                      'settings', 'externalSamples')),
  record_id         text        not null
                                check (record_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  revision          integer     not null check (revision >= 1),
  ciphertext        bytea       not null
                                check (octet_length(ciphertext) between 1 and 1048576),
  iv                bytea       not null check (octet_length(iv) = 12),
  key_version       integer     not null check (key_version >= 1),
  server_seq        bigint      not null default nextval('public.sync_records_server_seq'),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, collection, record_id)
);

comment on table public.sync_records is
  'End-to-end encrypted copies of local records. Content is validated on the devices only.';

-- "Changes since server_seq N" for one user.
create index sync_records_user_seq on public.sync_records (user_id, server_seq);

-- Every write: serialise per user, assign a new server_seq and timestamp,
-- forbid identity changes and require the revision to increase.
--
-- The per-user advisory lock (held until the transaction ends) makes a
-- user's writes commit in server_seq order, so "changes since N" can never
-- miss a row that commits late with a lower number.
create function public.sync_records_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id
       or new.collection <> old.collection
       or new.record_id <> old.record_id then
      raise exception 'the identity of a sync record cannot change' using errcode = '22023';
    end if;
    if new.revision <= old.revision then
      raise exception 'revision must increase (stored %, received %)', old.revision, new.revision
        using errcode = '22023';
    end if;
  end if;

  new.server_seq := nextval('public.sync_records_server_seq');
  new.server_updated_at := now();
  return new;
end;
$$;

create trigger sync_records_before_write
  before insert or update on public.sync_records
  for each row execute function public.sync_records_before_write();

alter table public.sync_records enable row level security;

create policy "sync_records: owner can read"
  on public.sync_records for select to authenticated
  using (user_id = (select auth.uid()));

create policy "sync_records: owner can insert"
  on public.sync_records for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "sync_records: owner can update"
  on public.sync_records for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Used only by "delete my cloud data". Ordinary deletions sync as
-- soft-deleted records (tombstones), never as row deletions.
create policy "sync_records: owner can delete"
  on public.sync_records for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- push_record: upload one record with the revision rule (SYNC_DESIGN.md §5.3).
--
-- Accepted only if the stored revision equals p_expected_revision (the
-- revision this device last synced), or the record does not exist yet and
-- p_expected_revision is null. The new revision must be higher.
-- Otherwise nothing is written and the current server version is returned
-- as a conflict.
--
-- Runs with the caller's rights (security invoker), so RLS still applies.
--
-- Returns one of:
--   {"status": "ok", "revision": n, "server_seq": s, "server_updated_at": t}
--   {"status": "conflict", "current": {...server row without user_id...} | null}
-- ---------------------------------------------------------------------------

create function public.push_record(
  p_collection        text,
  p_record_id         text,
  p_expected_revision integer,
  p_revision          integer,
  p_ciphertext        bytea,
  p_iv                bytea,
  p_key_version       integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_current public.sync_records%rowtype;
  v_saved   public.sync_records%rowtype;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_revision is null or p_revision < 1 then
    raise exception 'revision must be at least 1' using errcode = '22023';
  end if;
  if p_expected_revision is not null then
    if p_expected_revision < 1 then
      raise exception 'expected revision must be at least 1 or null' using errcode = '22023';
    end if;
    if p_revision <= p_expected_revision then
      raise exception 'revision must be higher than the expected revision' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select * into v_current
    from public.sync_records
   where user_id = v_user
     and collection = p_collection
     and record_id = p_record_id
     for update;

  if not found then
    if p_expected_revision is not null then
      -- This device synced the record before, but the server no longer has
      -- it (for example after "delete my cloud data"): let the device decide.
      return jsonb_build_object('status', 'conflict', 'current', null);
    end if;

    insert into public.sync_records
      (user_id, collection, record_id, revision, ciphertext, iv, key_version)
    values
      (v_user, p_collection, p_record_id, p_revision, p_ciphertext, p_iv, p_key_version)
    returning * into v_saved;
  else
    if p_expected_revision is null or v_current.revision <> p_expected_revision then
      return jsonb_build_object('status', 'conflict',
                                'current', to_jsonb(v_current) - 'user_id');
    end if;

    update public.sync_records
       set revision    = p_revision,
           ciphertext  = p_ciphertext,
           iv          = p_iv,
           key_version = p_key_version
     where user_id = v_user
       and collection = p_collection
       and record_id = p_record_id
    returning * into v_saved;
  end if;

  return jsonb_build_object('status', 'ok',
                            'revision', v_saved.revision,
                            'server_seq', v_saved.server_seq,
                            'server_updated_at', v_saved.server_updated_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: nothing for anonymous visitors; signed-in users only through
-- RLS. (Supabase grants new tables to anon and authenticated by default.)
-- ---------------------------------------------------------------------------

revoke all on table public.user_keys    from public, anon, authenticated;
revoke all on table public.sync_records from public, anon, authenticated;
revoke all on sequence public.sync_records_server_seq from public, anon, authenticated;

grant select, insert, update, delete on table public.user_keys    to authenticated;
grant select, insert, update, delete on table public.sync_records to authenticated;
grant usage on sequence public.sync_records_server_seq to authenticated;

revoke execute on function public.push_record(text, text, integer, integer, bytea, bytea, integer)
  from public, anon;
grant execute on function public.push_record(text, text, integer, integer, bytea, bytea, integer)
  to authenticated;

revoke execute on function public.user_keys_before_update()   from public, anon, authenticated;
revoke execute on function public.sync_records_before_write() from public, anon, authenticated;

-- ===== 20261110160600_delete_my_cloud_data.sql =====

-- "Delete my cloud data" (docs/SYNC_DESIGN.md §7): removes the signed-in
-- user's encrypted records AND their wrapped key in one transaction, so
-- the cloud is never left half-deleted. Runs with the caller's rights
-- (security invoker): RLS limits it to the caller's own rows.
--
-- Returns the number of encrypted records deleted.
-- The sign-in account itself is not deleted.

create function public.delete_my_cloud_data()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_records integer;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Same per-user lock as push_record: no upload can interleave.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  -- The key first: other devices stop syncing as soon as it is gone.
  delete from public.user_keys where user_id = v_user;
  delete from public.sync_records where user_id = v_user;
  get diagnostics v_records = row_count;

  return v_records;
end;
$$;

revoke execute on function public.delete_my_cloud_data() from public, anon;
grant execute on function public.delete_my_cloud_data() to authenticated;

-- ===== 20261110180516_restrict_rls_auto_enable.sql =====

-- Security advisor (lints 0028/0029) on the hosted project: Supabase's own
-- event-trigger function public.rls_auto_enable() (it switches on RLS for
-- new tables) is executable by "anon" and "authenticated" through the API.
-- It cannot actually run when called directly (event trigger functions only
-- run as triggers), but no one outside the database needs to call it, so
-- the permission is removed. The function does not exist on every stack
-- (e.g. the local one), hence the existence check. The event trigger itself
-- keeps working: event triggers do not check the caller's EXECUTE right.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

-- ===== 20261112170000_crm_collections.sql =====

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
