-- Shift - close the function grants the Supabase security advisor flags.
--
-- Postgres lets everyone (PUBLIC) execute a new function unless told otherwise.
-- 0001-0006 revoke that for the membership and invite functions, but not for:
--
--   * the three trigger functions (handle_new_user, changes_consistency,
--     observations_consistency). They run only as triggers, and a trigger does
--     not check EXECUTE when it fires, so nobody needs to call them directly.
--   * peek_invite, which stays callable by signed-out visitors on purpose (an
--     invite link usually arrives before the person has an account). It keeps
--     its explicit grants to anon and authenticated; only the PUBLIC grant goes.
--   * public.keepalive(), which also had no fixed search_path. It only returns
--     now(), which lives in pg_catalog and is found with an empty search_path.
--
-- is_member() and is_admin() keep their grant to authenticated on purpose: the
-- Row Level Security policies call them as the signed-in user.
--
-- Safe to run more than once. No table, row or policy changes.

revoke all on function shift.handle_new_user() from public, anon, authenticated;
revoke all on function shift.changes_consistency() from public, anon, authenticated;
revoke all on function shift.observations_consistency() from public, anon, authenticated;

revoke all on function shift.peek_invite(text) from public;
grant execute on function shift.peek_invite(text) to anon, authenticated;

alter function public.keepalive() set search_path = '';
revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
