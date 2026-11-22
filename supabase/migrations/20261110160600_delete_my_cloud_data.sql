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
