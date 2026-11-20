-- Shift — explicit table privileges.
--
-- Run after 0003. Safe to re-run, and safe to run on a database already in use.
--
-- ============================================================================
-- Why this file exists
-- ============================================================================
--
-- 0001-0003 create the tables and their Row Level Security policies, but never
-- grant table privileges — they assume Supabase's default privileges have
-- already granted anon and authenticated everything on new tables in `public`.
--
-- That assumption is wrong to rely on. Two reasons:
--
--   1. It is not ours to depend on. This file is meant to be run by any
--      organisation against its own project, and default privileges are
--      project configuration that may have been changed, or may change.
--
--   2. RLS and GRANT are two separate gates, and BOTH must pass. A policy that
--      says "members of this organisation may read this row" does nothing if
--      the role has no SELECT privilege on the table in the first place — the
--      request fails with "permission denied for table", and the app cannot
--      read its own data. Relying on an implicit grant to satisfy half of a
--      security model is exactly the kind of thing that works on the machine
--      it was written on.
--
-- So: revoke everything from anon and authenticated, then grant back precisely
-- what each table's policies actually need, and nothing else. Deterministic
-- whatever state the project was in.
--
-- `anon` gets no table privileges at all. Every policy in this schema is
-- `to authenticated`; an unauthenticated caller has no business reading any of
-- it, and the only thing anon needs is execute on peek_invite() and
-- keepalive(), both granted in earlier migrations.

grant usage on schema shift to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Start from nothing, for both roles, on every table this schema owns.
-- ---------------------------------------------------------------------------

revoke all on shift.profiles      from anon, authenticated;
revoke all on shift.organisations from anon, authenticated;
revoke all on shift.memberships   from anon, authenticated;
revoke all on shift.invites       from anon, authenticated;
revoke all on shift.projects      from anon, authenticated;
revoke all on shift.stakeholders  from anon, authenticated;
revoke all on shift.changes       from anon, authenticated;
revoke all on shift.markers       from anon, authenticated;
revoke all on shift.cycles        from anon, authenticated;
revoke all on shift.observations  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grant back exactly what the policies need. Each line matches the policies
-- created in 0001 and 0002 — if you add a policy, add the grant here too, or
-- the policy will never get the chance to run.
-- ---------------------------------------------------------------------------

-- Your own profile, and the profiles of people you share an organisation with.
grant select, update on shift.profiles to authenticated;

-- Organisations are created through create_organisation(), which is SECURITY
-- DEFINER, so no INSERT privilege is needed or wanted here.
grant select, update, delete on shift.organisations to authenticated;

-- Joining happens only through accept_invite(). No INSERT: if clients could
-- write this table, anyone could add themselves to any organisation, which is
-- the entire isolation model undone.
grant select, update on shift.memberships to authenticated;

-- Invites are minted by create_invite(). Admins can list and revoke them.
grant select, delete on shift.invites to authenticated;

-- The working data.
grant select, insert, update, delete on shift.projects     to authenticated;
grant select, insert, update, delete on shift.stakeholders to authenticated;
grant select, insert, update, delete on shift.markers      to authenticated;

-- A cycle's summary is editable while the review is open.
grant select, insert, update on shift.cycles to authenticated;

-- ---------------------------------------------------------------------------
-- The append-only tables. SELECT and INSERT, and deliberately nothing else.
--
-- This is the same guarantee the missing UPDATE/DELETE policies give, enforced
-- a second time at the privilege level. Belt and braces on purpose: it is the
-- property the whole product rests on, and one of the two gates failing open
-- should not be enough to lose it.
-- ---------------------------------------------------------------------------

grant select, insert on shift.changes      to authenticated;
grant select, insert on shift.observations to authenticated;

-- ---------------------------------------------------------------------------
-- And make sure future tables do not inherit a blanket grant behind our backs.
-- ---------------------------------------------------------------------------

alter default privileges in schema shift revoke all on tables from anon;

-- ============================================================================
-- VERIFY — this is the query that actually answers the question
-- ============================================================================
--
-- information_schema.role_table_grants can under-report depending on which
-- roles are enabled for the session. has_table_privilege() resolves the real
-- effective privilege and is the one to trust.
--
--   select t.tablename,
--          has_table_privilege('authenticated', 'shift.'||t.tablename, 'SELECT') as sel,
--          has_table_privilege('authenticated', 'shift.'||t.tablename, 'INSERT') as ins,
--          has_table_privilege('authenticated', 'shift.'||t.tablename, 'UPDATE') as upd,
--          has_table_privilege('authenticated', 'shift.'||t.tablename, 'DELETE') as del
--     from pg_tables t
--    where t.schemaname = 'shift'
--      and t.tablename in ('profiles','organisations','memberships','invites',
--                          'projects','stakeholders','changes',
--                          'markers','cycles','observations')
--    order by t.tablename;
--
-- Expected, and the two rows that matter most are the last two:
--
--   changes         sel=true  ins=true  upd=FALSE  del=FALSE
--   observations    sel=true  ins=true  upd=FALSE  del=FALSE
--   cycles          sel=true  ins=true  upd=true   del=false
--   invites         sel=true  ins=false upd=false  del=true
--   markers         sel=true  ins=true  upd=true   del=true
--   memberships     sel=true  ins=false upd=true   del=false
--   organisations   sel=true  ins=false upd=true   del=true
--   profiles        sel=true  ins=false upd=true   del=false
--   projects        sel=true  ins=true  upd=true   del=true
--   stakeholders    sel=true  ins=true  upd=true   del=true
--
-- ============================================================================
