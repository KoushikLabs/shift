-- Shift — complete database setup.
--
-- GENERATED FILE. Do not edit; edit supabase/migrations/*.sql and run
-- `npm run sql`. Generated 2026-11-20 from:
--   supabase/migrations/0001_init.sql
--   supabase/migrations/0002_behaviour.sql
--   supabase/migrations/0003_outcome_map.sql
--   supabase/migrations/0004_grants.sql
--   supabase/migrations/0005_move_to_shift_schema.sql
--   supabase/migrations/0006_profiles_for_other_mel_tools.sql
--
-- ============================================================================
-- HOW TO USE
-- ============================================================================
--
-- Paste this entire file into the Supabase SQL editor and run it once, on a new
-- project. It is idempotent — running it again is safe and changes nothing.
--
-- It creates every table, the Row Level Security policies that keep one
-- organisation's data unreadable to another, and the functions that handle
-- sign-up, invites and membership.
--
-- Two guarantees it exists to enforce, both at the database rather than in the
-- application:
--
--   1. One organisation cannot read another's rows. Not "the app does not show
--      them" — Postgres refuses to return them, so a bug in the client or a
--      crafted API call still cannot cross that line.
--
--   2. Recorded history is append-only. `changes` and `observations` have
--      SELECT and INSERT policies and deliberately no UPDATE or DELETE policy.
--      Nobody — including an organisation's own admin — can rewrite or erase a
--      score change or an observation. A correction is a new row.
--
-- When it finishes, run the verification block at the very bottom.
--
-- ============================================================================

-- Required by create_invite(), which generates invite tokens. Supabase enables
-- this by default; the guard is here so a project that does not cannot fail
-- halfway through with a confusing error.
create extension if not exists pgcrypto with schema extensions;


-- ==========================================================================
-- 0001_init.sql
-- ==========================================================================

-- Shift — database schema and access rules.
--
-- Paste this whole file into the Supabase SQL editor and run it once.
-- See docs/HOSTING.md for the full setup.
--
-- ============================================================================
-- The two guarantees this file exists to enforce
-- ============================================================================
--
-- 1. ONE ORGANISATION CANNOT SEE ANOTHER'S DATA.
--    Not "the application does not show it" — the database refuses to return
--    the rows. Every table carries org_id and every policy checks membership,
--    so a bug in the client, a crafted API call, or a stolen anon key still
--    cannot read another organisation's assessment of a regulator. The anon key
--    is public by design; RLS is what makes that safe.
--
-- 2. HISTORY IS APPEND-ONLY, IN THE DATABASE.
--    `changes` has SELECT and INSERT policies and deliberately has no UPDATE or
--    DELETE policy at all. With RLS enabled, an operation without a policy is
--    denied. Nobody using the API — including an organisation's own admin — can
--    rewrite or erase a recorded change. SPEC 6.4 stops being a promise the
--    client keeps and becomes one Postgres keeps.
--
-- Read the verification block at the bottom before trusting either claim.

-- ============================================================================
-- Schema
-- ============================================================================
--
-- Shift lives in its own schema, `shift`, not `public`, so it can share one
-- Supabase project (and one set of user accounts) with other tools without
-- their tables colliding. Two consequences:
--
--   * The schema must be listed under Project Settings -> Data API ->
--     Exposed schemas, or the app gets "Invalid schema: shift".
--   * The app asks for it explicitly: createClient(..., { db: { schema: "shift" } }).
--
-- keepalive() stays in `public` because it keeps the whole project awake.

create schema if not exists shift;
grant usage on schema shift to anon, authenticated, service_role;

-- ============================================================================
-- Tables
-- ============================================================================

create table if not exists shift.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text        not null,
  display_name text       not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists shift.organisations (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  created_by uuid        references auth.users(id) on delete set null
);

create table if not exists shift.memberships (
  org_id     uuid not null references shift.organisations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- Invites are links, not emails. The admin copies the link and sends it however
-- they like, which means the pilot needs no SMTP configured to add colleagues.
create table if not exists shift.invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references shift.organisations(id) on delete cascade,
  token       text not null unique,
  role        text not null default 'member' check (role in ('admin', 'member')),
  note        text not null default '',
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);

create table if not exists shift.projects (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references shift.organisations(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  description text not null default '',
  scale_note  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists shift.stakeholders (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references shift.organisations(id) on delete cascade,
  project_id    uuid not null references shift.projects(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  type          text not null default '',
  is_individual boolean not null default false,
  -- SPEC 5: power 0..10; interest -10..+10, negative means opposed.
  power         int  not null check (power between 0 and 10),
  interest      int  not null check (interest between -10 and 10),
  rationale     text not null default '',
  strategy      jsonb not null default '{}'::jsonb,
  -- The first recorded state. Movement is always measured from here, so this is
  -- written once at creation and never touched again.
  baseline      jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  updated_by    uuid references auth.users(id) on delete set null
);

create table if not exists shift.changes (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references shift.organisations(id) on delete cascade,
  project_id     uuid not null references shift.projects(id) on delete cascade,
  stakeholder_id uuid not null references shift.stakeholders(id) on delete cascade,
  at             timestamptz not null default now(),
  by             uuid references auth.users(id) on delete set null,
  by_email       text not null default '',
  power          int  not null,
  interest       int  not null,
  rationale      text not null default '',
  strategy       jsonb not null default '{}'::jsonb,
  note           text not null default '',
  prev_power     int  not null,
  prev_interest  int  not null,
  prev_rationale text not null default '',
  prev_strategy  jsonb not null default '{}'::jsonb,
  -- any of: power, interest, rationale, strategy
  changed_fields text[] not null
);

create index if not exists memberships_user_idx   on shift.memberships (user_id);
create index if not exists projects_org_idx       on shift.projects (org_id);
create index if not exists stakeholders_proj_idx  on shift.stakeholders (project_id);
create index if not exists changes_proj_idx       on shift.changes (project_id);
create index if not exists changes_stakeholder_idx on shift.changes (stakeholder_id, at);
create index if not exists invites_token_idx      on shift.invites (token);

-- ============================================================================
-- Membership lookup
-- ============================================================================
--
-- SECURITY DEFINER, because a policy on `memberships` that itself queries
-- `memberships` recurses infinitely — the classic RLS footgun. Running as the
-- owner bypasses RLS inside the function only.
--
-- `set search_path = ''` and fully-qualified names are mandatory here: without
-- them a caller can put a malicious schema ahead of public on the search path
-- and have this function call their table instead.

create or replace function shift.is_member(org uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from shift.memberships m
    where m.org_id = org and m.user_id = (select auth.uid())
  );
$$;

create or replace function shift.is_admin(org uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from shift.memberships m
    where m.org_id = org and m.user_id = (select auth.uid()) and m.role = 'admin'
  );
$$;

revoke all on function shift.is_member(uuid) from public;
revoke all on function shift.is_admin(uuid) from public;
grant execute on function shift.is_member(uuid) to authenticated;
grant execute on function shift.is_admin(uuid) to authenticated;

-- ============================================================================
-- New users get a profile row automatically
-- ============================================================================

create or replace function shift.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into shift.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function shift.handle_new_user();

-- ============================================================================
-- Creating an organisation, and joining one
-- ============================================================================
--
-- Both are RPCs rather than plain inserts, because each has to write two rows
-- atomically (org + admin membership; invite acceptance + membership) and the
-- second row is one the caller must not be able to write on its own. If clients
-- could insert into `memberships` directly, anyone could add themselves to any
-- organisation — which is the entire security model, undone.

create or replace function shift.create_organisation(org_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'You must be signed in to create an organisation.';
  end if;
  if org_name is null or length(trim(org_name)) = 0 then
    raise exception 'An organisation needs a name.';
  end if;

  insert into shift.organisations (name, created_by)
  values (trim(org_name), uid)
  returning id into new_id;

  insert into shift.memberships (org_id, user_id, role)
  values (new_id, uid, 'admin');

  return new_id;
end;
$$;

create or replace function shift.create_invite(org uuid, invite_role text default 'member', invite_note text default '')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_token text;
begin
  if not shift.is_admin(org) then
    raise exception 'Only an admin of this organisation can invite people.';
  end if;
  if invite_role not in ('admin', 'member') then
    raise exception 'Unknown role.';
  end if;

  new_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into shift.invites (org_id, token, role, note, created_by)
  values (org, new_token, invite_role, coalesce(invite_note, ''), (select auth.uid()));

  return new_token;
end;
$$;

-- Look at an invite before accepting it, without being a member yet. Returns
-- only the organisation's name — never its contents.
create or replace function shift.peek_invite(invite_token text)
returns table (org_name text, org_role text, valid boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv shift.invites;
  org shift.organisations;
begin
  select * into inv from shift.invites i where i.token = invite_token;
  if inv.id is null then
    return query select ''::text, ''::text, false, 'That invite link is not valid.'::text;
    return;
  end if;
  select * into org from shift.organisations o where o.id = inv.org_id;
  if inv.accepted_at is not null then
    return query select org.name, inv.role, false, 'That invite has already been used.'::text;
    return;
  end if;
  if inv.expires_at < now() then
    return query select org.name, inv.role, false, 'That invite has expired.'::text;
    return;
  end if;
  return query select org.name, inv.role, true, ''::text;
end;
$$;

create or replace function shift.accept_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv shift.invites;
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'You must be signed in to accept an invite.';
  end if;

  select * into inv from shift.invites i
    where i.token = invite_token
      and i.accepted_at is null
      and i.expires_at > now()
    for update;

  if inv.id is null then
    raise exception 'That invite link is not valid, has already been used, or has expired.';
  end if;

  insert into shift.memberships (org_id, user_id, role)
  values (inv.org_id, uid, inv.role)
  on conflict (org_id, user_id) do nothing;

  update shift.invites
     set accepted_at = now(), accepted_by = uid
   where id = inv.id;

  return inv.org_id;
end;
$$;

-- Leaving, and removing someone. An organisation must never be left with no
-- admin, or nobody can ever invite anyone again.
create or replace function shift.remove_member(org uuid, member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  admin_count int;
begin
  if member <> uid and not shift.is_admin(org) then
    raise exception 'Only an admin can remove another member.';
  end if;

  select count(*) into admin_count
    from shift.memberships m where m.org_id = org and m.role = 'admin';

  if admin_count <= 1 and exists (
    select 1 from shift.memberships m
     where m.org_id = org and m.user_id = member and m.role = 'admin'
  ) then
    raise exception 'This is the only admin. Make someone else an admin first.';
  end if;

  delete from shift.memberships m where m.org_id = org and m.user_id = member;
end;
$$;

revoke all on function shift.create_organisation(text) from public;
revoke all on function shift.create_invite(uuid, text, text) from public;
revoke all on function shift.accept_invite(text) from public;
revoke all on function shift.remove_member(uuid, uuid) from public;
grant execute on function shift.create_organisation(text) to authenticated;
grant execute on function shift.create_invite(uuid, text, text) to authenticated;
grant execute on function shift.accept_invite(text) to authenticated;
grant execute on function shift.remove_member(uuid, uuid) to authenticated;
-- peek_invite is deliberately callable before joining, so the accept screen can
-- name the organisation. It returns a name and nothing else.
grant execute on function shift.peek_invite(text) to authenticated, anon;

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table shift.profiles      enable row level security;
alter table shift.organisations enable row level security;
alter table shift.memberships   enable row level security;
alter table shift.invites       enable row level security;
alter table shift.projects      enable row level security;
alter table shift.stakeholders  enable row level security;
alter table shift.changes       enable row level security;

-- Re-running this file should not fail on existing policies.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
     where schemaname = 'shift'
       and tablename in ('profiles','organisations','memberships','invites','projects','stakeholders','changes')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- profiles: your own, plus anyone who shares an organisation with you.
create policy profiles_select on shift.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from shift.memberships mine
      join shift.memberships theirs on theirs.org_id = mine.org_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = shift.profiles.id
    )
  );
create policy profiles_update on shift.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- organisations: visible to members. Created only through create_organisation().
create policy organisations_select on shift.organisations for select to authenticated
  using (shift.is_member(id));
create policy organisations_update on shift.organisations for update to authenticated
  using (shift.is_admin(id)) with check (shift.is_admin(id));
create policy organisations_delete on shift.organisations for delete to authenticated
  using (shift.is_admin(id));

-- memberships: readable within your organisations. No INSERT policy — joining
-- happens only via accept_invite(), so nobody can add themselves anywhere.
create policy memberships_select on shift.memberships for select to authenticated
  using (shift.is_member(org_id));
create policy memberships_update on shift.memberships for update to authenticated
  using (shift.is_admin(org_id)) with check (shift.is_admin(org_id));

-- invites: admins manage them. Accepting goes through accept_invite().
create policy invites_select on shift.invites for select to authenticated
  using (shift.is_admin(org_id));
create policy invites_delete on shift.invites for delete to authenticated
  using (shift.is_admin(org_id));

-- The working data. One rule, applied everywhere: you must belong to the org.
create policy projects_select on shift.projects for select to authenticated
  using (shift.is_member(org_id));
create policy projects_insert on shift.projects for insert to authenticated
  with check (shift.is_member(org_id));
create policy projects_update on shift.projects for update to authenticated
  using (shift.is_member(org_id)) with check (shift.is_member(org_id));
create policy projects_delete on shift.projects for delete to authenticated
  using (shift.is_member(org_id));

create policy stakeholders_select on shift.stakeholders for select to authenticated
  using (shift.is_member(org_id));
create policy stakeholders_insert on shift.stakeholders for insert to authenticated
  with check (shift.is_member(org_id));
create policy stakeholders_update on shift.stakeholders for update to authenticated
  using (shift.is_member(org_id)) with check (shift.is_member(org_id));
create policy stakeholders_delete on shift.stakeholders for delete to authenticated
  using (shift.is_member(org_id));

-- changes: SELECT and INSERT only.
--
-- The absence of UPDATE and DELETE policies below is the append-only guarantee.
-- Do not add them. A correction is a new row, exactly as SPEC 5 says.
create policy changes_select on shift.changes for select to authenticated
  using (shift.is_member(org_id));
create policy changes_insert on shift.changes for insert to authenticated
  with check (shift.is_member(org_id) and by = (select auth.uid()));

-- Belt and braces: even a future policy added by mistake cannot rewrite history.
revoke update, delete on shift.changes from authenticated, anon;

-- A change must point at a stakeholder in the same organisation, so a crafted
-- insert cannot file a record into someone else's history.
create or replace function shift.changes_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare s shift.stakeholders;
begin
  select * into s from shift.stakeholders st where st.id = new.stakeholder_id;
  if s.id is null then
    raise exception 'Unknown stakeholder.';
  end if;
  if s.org_id <> new.org_id or s.project_id <> new.project_id then
    raise exception 'That change does not belong to this stakeholder.';
  end if;
  return new;
end;
$$;

drop trigger if exists changes_consistency_trg on shift.changes;
create trigger changes_consistency_trg
  before insert on shift.changes
  for each row execute function shift.changes_consistency();

-- ============================================================================
-- Keep-alive
-- ============================================================================
--
-- A free Supabase project pauses after 7 days with no database activity, and
-- has to be restored by hand from the dashboard. A stakeholder tool is used
-- after meetings — often weeks apart — so that pause would routinely greet an
-- organisation with a dead app.
--
-- .github/workflows/keepalive.yml calls this every few days. It touches
-- Postgres (rather than just the API gateway), which is what the inactivity
-- timer actually measures. It exposes nothing: the current time is not a secret.

create or replace function public.keepalive()
returns timestamptz
language sql
stable
as $$ select now() $$;

grant execute on function public.keepalive() to anon, authenticated;

-- ============================================================================
-- Verify (run these as a signed-in user; both should return zero rows)
-- ============================================================================
--
--   -- 1. No row from an organisation you do not belong to is visible:
--   select count(*) from shift.stakeholders
--    where org_id not in (select org_id from shift.memberships where user_id = auth.uid());
--
--   -- 2. History cannot be rewritten. Both of these must ERROR:
--   update shift.changes set rationale = 'tampered' where id = (select id from shift.changes limit 1);
--   delete from shift.changes where id = (select id from shift.changes limit 1);
--
-- ============================================================================


-- ==========================================================================
-- 0002_behaviour.sql
-- ==========================================================================

-- Shift — the behaviour layer (SPEC v2 §5).
--
-- Run this after 0001_init.sql. Safe to re-run.
--
-- Adds actor triage to stakeholders, depth to projects, and the three tables
-- that carry depths 2 and 3: markers, observations and cycles.
--
-- ============================================================================
-- The guarantee this file adds
-- ============================================================================
--
-- OBSERVATIONS ARE APPEND-ONLY, IN THE DATABASE.
--
-- `observations` gets SELECT and INSERT policies and deliberately no UPDATE or
-- DELETE policy, exactly as `changes` does. An observation is a record of what
-- someone was seen doing on a date. Being able to go back and quietly change it
-- would make the whole behaviour record worthless as evidence — and this record
-- exists precisely so that a score cannot be the only thing vouching for
-- itself. If a past observation was wrong, the correction is a new observation
-- in the next cycle, which is also what Outcome Mapping practice expects.
--
-- Markers themselves ARE editable, because they are design artefacts that the
-- annual review is meant to revise. But a marker with observations against it
-- is retired rather than deleted, so what was being watched stays legible.

-- ============================================================================
-- Existing tables
-- ============================================================================

alter table shift.projects
  add column if not exists depth int not null default 1 check (depth between 1 and 3);

alter table shift.stakeholders
  add column if not exists reach text not null default 'partner'
    check (reach in ('partner', 'target', 'out-of-reach')),
  -- Who can reach an actor we cannot. One hop, for the manual's own instruction
  -- about influencing through an intermediary — deliberately NOT a general
  -- relationship graph (SPEC v2 §12).
  add column if not exists reachable_via uuid[] not null default '{}';

-- ============================================================================
-- New tables
-- ============================================================================

create table if not exists shift.markers (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references shift.organisations(id) on delete cascade,
  project_id     uuid not null references shift.projects(id) on delete cascade,
  stakeholder_id uuid not null references shift.stakeholders(id) on delete cascade,
  -- A gerund phrase naming one observable act. Form is checked in the client,
  -- where it can warn rather than refuse: every rule is a heuristic over free
  -- text and a false positive that blocks would get the check switched off.
  text           text not null check (length(trim(text)) > 0),
  -- null at depth 2 (no ladder); one of the four tiers at depth 3.
  tier           text check (tier is null or tier in ('start', 'like', 'love', 'regression')),
  -- SPEC 6.11 — watch only what you said you would watch.
  watched        boolean not null default true,
  retired        boolean not null default false,
  created_at     timestamptz not null default now(),
  retired_at     timestamptz
);

create table if not exists shift.cycles (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references shift.organisations(id) on delete cascade,
  project_id           uuid not null references shift.projects(id) on delete cascade,
  label                text not null default '',
  opened_at            timestamptz not null default now(),
  closed_at            timestamptz,
  by                   uuid references auth.users(id) on delete set null,
  by_email             text not null default '',
  -- SPEC 6.12 — a cycle cannot close without answering these three.
  went_backwards       text not null default '',
  mattered_for_goal    text not null default '',
  map_changes_proposed text not null default ''
);

create table if not exists shift.observations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references shift.organisations(id) on delete cascade,
  project_id     uuid not null references shift.projects(id) on delete cascade,
  stakeholder_id uuid not null references shift.stakeholders(id) on delete cascade,
  marker_id      uuid not null references shift.markers(id) on delete cascade,
  cycle_id       uuid references shift.cycles(id) on delete set null,
  at             timestamptz not null default now(),
  by             uuid references auth.users(id) on delete set null,
  by_email       text not null default '',
  observed       text not null default 'not-yet'
                   check (observed in ('yes', 'not-yet', 'backwards')),
  narrative      text not null default '',
  evidence       text not null default '',
  contribution   text not null default '',
  -- Outcome Mapping's only partial answer to its own significance gap: an actor
  -- can tick every marker while the goal recedes. Imported from Outcome
  -- Harvesting via Hearn's journal template.
  significance   text not null default ''
);

create index if not exists markers_project_idx      on shift.markers (project_id);
create index if not exists markers_stakeholder_idx  on shift.markers (stakeholder_id);
create index if not exists cycles_project_idx       on shift.cycles (project_id, opened_at desc);
create index if not exists observations_project_idx on shift.observations (project_id);
create index if not exists observations_marker_idx  on shift.observations (marker_id, at desc);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table shift.markers      enable row level security;
alter table shift.cycles       enable row level security;
alter table shift.observations enable row level security;

do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
     where schemaname = 'shift' and tablename in ('markers', 'cycles', 'observations')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- Markers: design artefacts, editable by members of the organisation.
create policy markers_select on shift.markers for select to authenticated
  using (shift.is_member(org_id));
create policy markers_insert on shift.markers for insert to authenticated
  with check (shift.is_member(org_id));
create policy markers_update on shift.markers for update to authenticated
  using (shift.is_member(org_id)) with check (shift.is_member(org_id));
create policy markers_delete on shift.markers for delete to authenticated
  using (shift.is_member(org_id));

-- Cycles: the summary is written while the review is open, so it is updatable
-- until it closes. The findings inside it are not (see below).
create policy cycles_select on shift.cycles for select to authenticated
  using (shift.is_member(org_id));
create policy cycles_insert on shift.cycles for insert to authenticated
  with check (shift.is_member(org_id));
create policy cycles_update on shift.cycles for update to authenticated
  using (shift.is_member(org_id)) with check (shift.is_member(org_id));

-- Observations: SELECT and INSERT only.
--
-- The absence of UPDATE and DELETE below is the append-only guarantee for the
-- behaviour record. Do not add them. A correction is a new observation.
create policy observations_select on shift.observations for select to authenticated
  using (shift.is_member(org_id));
create policy observations_insert on shift.observations for insert to authenticated
  with check (shift.is_member(org_id) and by = (select auth.uid()));

revoke update, delete on shift.observations from authenticated, anon;

-- An observation must belong to the same organisation and stakeholder as the
-- marker it scores, so a crafted insert cannot file a finding into someone
-- else's record.
create or replace function shift.observations_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare m shift.markers;
begin
  select * into m from shift.markers mk where mk.id = new.marker_id;
  if m.id is null then
    raise exception 'Unknown behaviour.';
  end if;
  if m.org_id <> new.org_id or m.project_id <> new.project_id or m.stakeholder_id <> new.stakeholder_id then
    raise exception 'That observation does not belong to this behaviour.';
  end if;
  return new;
end;
$$;

drop trigger if exists observations_consistency_trg on shift.observations;
create trigger observations_consistency_trg
  before insert on shift.observations
  for each row execute function shift.observations_consistency();

-- ============================================================================
-- Verify (run as a signed-in user)
-- ============================================================================
--
--   -- Every new table must report true:
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'shift' and tablename in ('markers','cycles','observations');
--
--   -- The behaviour record cannot be rewritten. Both must ERROR:
--   update shift.observations set narrative = 'tampered' where id = (select id from shift.observations limit 1);
--   delete from shift.observations where id = (select id from shift.observations limit 1);
--
-- ============================================================================


-- ==========================================================================
-- 0003_outcome_map.sql
-- ==========================================================================

-- Shift — the rest of depth 3 (SPEC v2 §7).
--
-- Run after 0002_behaviour.sql. Safe to re-run.
--
-- Adds the parts of a full outcome map that are not the ladder: the vision and
-- mission the map hangs from, the vocabulary the organisation agreed to use for
-- it, the readiness answers recorded when depth 3 was switched on, and the 2x3
-- strategy map per actor.
--
-- No new tables and no new policies. Every column here belongs to a row that
-- already exists and is already governed by the organisation's RLS, so the
-- isolation guarantee from 0001 covers it unchanged.

alter table shift.projects
  -- Deliberately bigger than the organisation. The manual's framing: what the
  -- world looks like if you and everyone else working on this succeeds.
  add column if not exists vision text not null default '',
  add column if not exists mission text not null default '',
  -- The four agreed swaps. The OMLC licenses renaming, and "boundary partner",
  -- "expect to see" and "behaviour change" are all documented as causing
  -- trouble in rooms. Settled once, in the orientation session.
  add column if not exists vocabulary jsonb not null default '{}'::jsonb,
  -- The ten readiness conditions as scored when depth 3 was switched on. Kept
  -- because the answers are worth more later than the refusal would have been —
  -- the tool warns on a disqualifying zero and does not block.
  add column if not exists readiness jsonb;

alter table shift.stakeholders
  -- Rows: strategies aimed at the actor (i) versus at their environment (e).
  -- Columns: causal, persuasive, supportive. Stored as one object because the
  -- useful reading is the shape of the whole grid, not any single cell.
  --
  -- Not versioned with the strategy itself: re-tagging which cell an approach
  -- belongs in is a classification, not a change of tack, and should not open a
  -- new strategy period.
  add column if not exists strategy_map jsonb not null default '{}'::jsonb;

-- ============================================================================
-- Verify
-- ============================================================================
--
--   select column_name from information_schema.columns
--    where table_schema = 'shift' and table_name = 'projects'
--      and column_name in ('vision','mission','vocabulary','readiness','depth');
--
--   select column_name from information_schema.columns
--    where table_schema = 'shift' and table_name = 'stakeholders'
--      and column_name in ('reach','reachable_via','strategy_map');
--
-- ============================================================================


-- ==========================================================================
-- 0004_grants.sql
-- ==========================================================================

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


-- ==========================================================================
-- 0005_move_to_shift_schema.sql
-- ==========================================================================

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


-- ==========================================================================
-- 0006_profiles_for_other_mel_tools.sql
-- ==========================================================================

-- Shift - accounts made from another MEL Barn tool get no Shift profile at
-- sign-up; Shift makes one the first time the account opens Shift.
--
-- MEL Barn accounts are shared across tools. Sign-ups from Bellwether carry
-- raw_user_meta_data.signup_tool = 'bellwether'; the trigger leaves those out.
-- Sign-ups from Shift, the dashboard or older accounts behave as before.
-- The app calls shift.ensure_profile() after sign-in (src/auth.js), so deploy
-- the app first; until this file runs, that call fails quietly and changes nothing.
--
-- Safe to run more than once. signup_tool is set by whoever signs up, so the
-- most anyone can do with it is go without their own Shift profile.

create or replace function shift.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if coalesce(new.raw_user_meta_data ->> 'signup_tool', 'shift') <> 'shift' then
    return new;                                   -- joined from another MEL tool
  end if;
  insert into shift.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

create or replace function shift.ensure_profile()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;
  insert into shift.profiles (id, email, display_name)
  select u.id,
         coalesce(u.email, ''),
         coalesce(u.raw_user_meta_data ->> 'display_name', split_part(coalesce(u.email, ''), '@', 1))
  from auth.users u
  where u.id = auth.uid()
  on conflict (id) do nothing;
end;
$function$;

revoke all on function shift.ensure_profile() from public, anon;
grant execute on function shift.ensure_profile() to authenticated;


-- ============================================================================
-- VERIFICATION — run this in the SQL editor after the above
-- ============================================================================
--
-- IMPORTANT: the Supabase SQL editor connects as the `postgres` role, which
-- BYPASSES Row Level Security. A plain `update shift.changes ...` run here
-- will SUCCEED even though the guarantee is perfectly intact — it is testing
-- the superuser, not the app. Use the checks below instead.

-- ---------------------------------------------------------------------------
-- 1. Row Level Security is on. Ten rows, every one true.
--    A false means that table is readable by anyone holding the public key.
-- ---------------------------------------------------------------------------
--
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'shift'
--      and tablename in ('organisations','memberships','invites','profiles',
--                        'projects','stakeholders','changes',
--                        'markers','observations','cycles')
--    order by tablename;

-- ---------------------------------------------------------------------------
-- 2. History is append-only, checked structurally. This reads the catalogue,
--    so it cannot touch data and cannot give a false pass.
--
--    Expect exactly four rows: SELECT and INSERT for each of changes and
--    observations. Any UPDATE or DELETE row means the guarantee is gone.
-- ---------------------------------------------------------------------------
--
--   select tablename, cmd, policyname from pg_policies
--    where schemaname = 'shift' and tablename in ('changes','observations')
--    order by tablename, cmd;

-- ---------------------------------------------------------------------------
-- 3. And the table grants agree. Expect INSERT and SELECT only, for both
--    tables and both roles. UPDATE or DELETE appearing here is a failure.
-- ---------------------------------------------------------------------------
--
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'shift'
--      and table_name in ('changes','observations')
--      and grantee in ('authenticated','anon')
--    order by table_name, grantee, privilege_type;

-- ---------------------------------------------------------------------------
-- 4. Optional — prove it behaviourally by impersonating a signed-in user.
--    Wrapped in a transaction that always rolls back, so it cannot alter
--    anything even if it unexpectedly succeeds.
--
--    Expect: ERROR: permission denied for table changes
-- ---------------------------------------------------------------------------
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
--     update shift.changes set rationale = 'tampered';
--   rollback;
--
-- ============================================================================
