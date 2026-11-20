-- Shift — move an existing install from `public` into the `shift` schema.
--
-- Only for a database set up before November 2026, when Shift's tables lived
-- in `public`. A new install already creates everything in `shift` (0001) and
-- this file then does nothing, so it is safe inside setup.sql.
--
-- On an existing install, run THIS FILE ONLY (not setup.sql), in this order:
--
--   1. Project Settings -> Data API -> Exposed schemas: add `shift`.
--      (Create the empty schema first if the dashboard will not list it:
--       `create schema if not exists shift;`)
--   2. Run this file. It is one transaction: if anything fails, nothing moves.
--   3. Deploy the app build that asks for schema `shift`.
--      Between 2 and 3 the live app cannot load data, so do them together.
--
-- What moves: the 10 tables and 10 functions. A moved table keeps its rows,
-- indexes, constraints, triggers, Row Level Security policies and grants.
-- Policies and triggers point at functions by internal id, so they follow.
-- Function bodies name their tables as `public.x` (they run with an empty
-- search_path on purpose), so each body is rewritten `public.` -> `shift.`
-- from its live definition and then checked.
--
-- keepalive() stays in `public`: it keeps the whole project awake.

begin;

create schema if not exists shift;
grant usage on schema shift to anon, authenticated, service_role;

do $$
declare
  t text;
  f record;
  def text;
  tables constant text[] := array['profiles','organisations','memberships','invites','projects',
                                  'stakeholders','changes','markers','cycles','observations'];
  funcs constant text[] := array['is_member(uuid)','is_admin(uuid)','handle_new_user()',
                                 'create_organisation(text)','create_invite(uuid, text, text)',
                                 'peek_invite(text)','accept_invite(text)','remove_member(uuid, uuid)',
                                 'changes_consistency()','observations_consistency()'];
  in_public int;
  in_shift int;
begin
  select count(*) into in_public from pg_tables where schemaname = 'public' and tablename = any (tables);
  select count(*) into in_shift  from pg_tables where schemaname = 'shift'  and tablename = any (tables);

  if in_public = 0 then
    raise notice 'Shift is not in public. Nothing to move.';
    return;
  end if;
  if in_shift > 0 then
    raise exception 'Shift tables exist in both public and shift. Stop and check by hand; nothing has been changed.';
  end if;
  if in_public <> 10 then
    raise exception 'Expected 10 Shift tables in public, found %. Nothing has been changed.', in_public;
  end if;

  foreach t in array tables loop
    execute format('alter table public.%I set schema shift', t);
  end loop;
  foreach t in array funcs loop
    execute 'alter function public.' || t || ' set schema shift';
  end loop;

  -- Rewrite the bodies. CREATE OR REPLACE keeps each function's id, owner,
  -- grants and SECURITY DEFINER / search_path settings.
  for f in select p.oid from pg_proc p where p.pronamespace = 'shift'::regnamespace loop
    def := pg_get_functiondef(f.oid);
    if position('public.' in def) > 0 then
      execute replace(def, 'public.', 'shift.');
    end if;
  end loop;

  -- Checks. Any failure undoes the whole file.
  for f in select p.oid, p.proname from pg_proc p where p.pronamespace = 'shift'::regnamespace loop
    if position('public.' in pg_get_functiondef(f.oid)) > 0 then
      raise exception 'shift.% still refers to public. Nothing has been changed.', f.proname;
    end if;
  end loop;
  if (select count(*) from pg_tables where schemaname = 'shift' and tablename = any (tables)) <> 10 then
    raise exception 'Expected 10 tables in shift. Nothing has been changed.';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'shift'::regnamespace) <> 10 then
    raise exception 'Expected 10 functions in shift. Nothing has been changed.';
  end if;

  raise notice 'Shift moved to schema shift.';
end $$;

-- Same rule 0004 sets: future tables here never get a blanket grant to anon.
alter default privileges in schema shift revoke all on tables from anon;

commit;

-- Tell the API to pick up the new layout straight away.
notify pgrst, 'reload schema';
