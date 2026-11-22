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
