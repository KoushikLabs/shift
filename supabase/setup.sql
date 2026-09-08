-- Shift — complete database setup.
--
-- GENERATED FILE. Do not edit; edit supabase/migrations/*.sql and run
-- `npm run sql`. Generated 2026-09-08 from:
--   supabase/migrations/0001_init.sql
--   supabase/migrations/0002_behaviour.sql
--   supabase/migrations/0003_outcome_map.sql
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
-- Tables
-- ============================================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text        not null,
  display_name text       not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.organisations (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  created_by uuid        references auth.users(id) on delete set null
);

create table if not exists public.memberships (
  org_id     uuid not null references public.organisations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- Invites are links, not emails. The admin copies the link and sends it however
-- they like, which means the pilot needs no SMTP configured to add colleagues.
create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations(id) on delete cascade,
  token       text not null unique,
  role        text not null default 'member' check (role in ('admin', 'member')),
  note        text not null default '',
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  description text not null default '',
  scale_note  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.stakeholders (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
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

create table if not exists public.changes (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  stakeholder_id uuid not null references public.stakeholders(id) on delete cascade,
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

create index if not exists memberships_user_idx   on public.memberships (user_id);
create index if not exists projects_org_idx       on public.projects (org_id);
create index if not exists stakeholders_proj_idx  on public.stakeholders (project_id);
create index if not exists changes_proj_idx       on public.changes (project_id);
create index if not exists changes_stakeholder_idx on public.changes (stakeholder_id, at);
create index if not exists invites_token_idx      on public.invites (token);

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

create or replace function public.is_member(org uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = org and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_admin(org uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = org and m.user_id = (select auth.uid()) and m.role = 'admin'
  );
$$;

revoke all on function public.is_member(uuid) from public;
revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;

-- ============================================================================
-- New users get a profile row automatically
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
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
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Creating an organisation, and joining one
-- ============================================================================
--
-- Both are RPCs rather than plain inserts, because each has to write two rows
-- atomically (org + admin membership; invite acceptance + membership) and the
-- second row is one the caller must not be able to write on its own. If clients
-- could insert into `memberships` directly, anyone could add themselves to any
-- organisation — which is the entire security model, undone.

create or replace function public.create_organisation(org_name text)
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

  insert into public.organisations (name, created_by)
  values (trim(org_name), uid)
  returning id into new_id;

  insert into public.memberships (org_id, user_id, role)
  values (new_id, uid, 'admin');

  return new_id;
end;
$$;

create or replace function public.create_invite(org uuid, invite_role text default 'member', invite_note text default '')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_token text;
begin
  if not public.is_admin(org) then
    raise exception 'Only an admin of this organisation can invite people.';
  end if;
  if invite_role not in ('admin', 'member') then
    raise exception 'Unknown role.';
  end if;

  new_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.invites (org_id, token, role, note, created_by)
  values (org, new_token, invite_role, coalesce(invite_note, ''), (select auth.uid()));

  return new_token;
end;
$$;

-- Look at an invite before accepting it, without being a member yet. Returns
-- only the organisation's name — never its contents.
create or replace function public.peek_invite(invite_token text)
returns table (org_name text, org_role text, valid boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invites;
  org public.organisations;
begin
  select * into inv from public.invites i where i.token = invite_token;
  if inv.id is null then
    return query select ''::text, ''::text, false, 'That invite link is not valid.'::text;
    return;
  end if;
  select * into org from public.organisations o where o.id = inv.org_id;
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

create or replace function public.accept_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invites;
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'You must be signed in to accept an invite.';
  end if;

  select * into inv from public.invites i
    where i.token = invite_token
      and i.accepted_at is null
      and i.expires_at > now()
    for update;

  if inv.id is null then
    raise exception 'That invite link is not valid, has already been used, or has expired.';
  end if;

  insert into public.memberships (org_id, user_id, role)
  values (inv.org_id, uid, inv.role)
  on conflict (org_id, user_id) do nothing;

  update public.invites
     set accepted_at = now(), accepted_by = uid
   where id = inv.id;

  return inv.org_id;
end;
$$;

-- Leaving, and removing someone. An organisation must never be left with no
-- admin, or nobody can ever invite anyone again.
create or replace function public.remove_member(org uuid, member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  admin_count int;
begin
  if member <> uid and not public.is_admin(org) then
    raise exception 'Only an admin can remove another member.';
  end if;

  select count(*) into admin_count
    from public.memberships m where m.org_id = org and m.role = 'admin';

  if admin_count <= 1 and exists (
    select 1 from public.memberships m
     where m.org_id = org and m.user_id = member and m.role = 'admin'
  ) then
    raise exception 'This is the only admin. Make someone else an admin first.';
  end if;

  delete from public.memberships m where m.org_id = org and m.user_id = member;
end;
$$;

revoke all on function public.create_organisation(text) from public;
revoke all on function public.create_invite(uuid, text, text) from public;
revoke all on function public.accept_invite(text) from public;
revoke all on function public.remove_member(uuid, uuid) from public;
grant execute on function public.create_organisation(text) to authenticated;
grant execute on function public.create_invite(uuid, text, text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
-- peek_invite is deliberately callable before joining, so the accept screen can
-- name the organisation. It returns a name and nothing else.
grant execute on function public.peek_invite(text) to authenticated, anon;

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.profiles      enable row level security;
alter table public.organisations enable row level security;
alter table public.memberships   enable row level security;
alter table public.invites       enable row level security;
alter table public.projects      enable row level security;
alter table public.stakeholders  enable row level security;
alter table public.changes       enable row level security;

-- Re-running this file should not fail on existing policies.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
     where schemaname = 'public'
       and tablename in ('profiles','organisations','memberships','invites','projects','stakeholders','changes')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- profiles: your own, plus anyone who shares an organisation with you.
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.memberships mine
      join public.memberships theirs on theirs.org_id = mine.org_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = public.profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- organisations: visible to members. Created only through create_organisation().
create policy organisations_select on public.organisations for select to authenticated
  using (public.is_member(id));
create policy organisations_update on public.organisations for update to authenticated
  using (public.is_admin(id)) with check (public.is_admin(id));
create policy organisations_delete on public.organisations for delete to authenticated
  using (public.is_admin(id));

-- memberships: readable within your organisations. No INSERT policy — joining
-- happens only via accept_invite(), so nobody can add themselves anywhere.
create policy memberships_select on public.memberships for select to authenticated
  using (public.is_member(org_id));
create policy memberships_update on public.memberships for update to authenticated
  using (public.is_admin(org_id)) with check (public.is_admin(org_id));

-- invites: admins manage them. Accepting goes through accept_invite().
create policy invites_select on public.invites for select to authenticated
  using (public.is_admin(org_id));
create policy invites_delete on public.invites for delete to authenticated
  using (public.is_admin(org_id));

-- The working data. One rule, applied everywhere: you must belong to the org.
create policy projects_select on public.projects for select to authenticated
  using (public.is_member(org_id));
create policy projects_insert on public.projects for insert to authenticated
  with check (public.is_member(org_id));
create policy projects_update on public.projects for update to authenticated
  using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy projects_delete on public.projects for delete to authenticated
  using (public.is_member(org_id));

create policy stakeholders_select on public.stakeholders for select to authenticated
  using (public.is_member(org_id));
create policy stakeholders_insert on public.stakeholders for insert to authenticated
  with check (public.is_member(org_id));
create policy stakeholders_update on public.stakeholders for update to authenticated
  using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy stakeholders_delete on public.stakeholders for delete to authenticated
  using (public.is_member(org_id));

-- changes: SELECT and INSERT only.
--
-- The absence of UPDATE and DELETE policies below is the append-only guarantee.
-- Do not add them. A correction is a new row, exactly as SPEC 5 says.
create policy changes_select on public.changes for select to authenticated
  using (public.is_member(org_id));
create policy changes_insert on public.changes for insert to authenticated
  with check (public.is_member(org_id) and by = (select auth.uid()));

-- Belt and braces: even a future policy added by mistake cannot rewrite history.
revoke update, delete on public.changes from authenticated, anon;

-- A change must point at a stakeholder in the same organisation, so a crafted
-- insert cannot file a record into someone else's history.
create or replace function public.changes_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare s public.stakeholders;
begin
  select * into s from public.stakeholders st where st.id = new.stakeholder_id;
  if s.id is null then
    raise exception 'Unknown stakeholder.';
  end if;
  if s.org_id <> new.org_id or s.project_id <> new.project_id then
    raise exception 'That change does not belong to this stakeholder.';
  end if;
  return new;
end;
$$;

drop trigger if exists changes_consistency_trg on public.changes;
create trigger changes_consistency_trg
  before insert on public.changes
  for each row execute function public.changes_consistency();

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
--   select count(*) from public.stakeholders
--    where org_id not in (select org_id from public.memberships where user_id = auth.uid());
--
--   -- 2. History cannot be rewritten. Both of these must ERROR:
--   update public.changes set rationale = 'tampered' where id = (select id from public.changes limit 1);
--   delete from public.changes where id = (select id from public.changes limit 1);
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

alter table public.projects
  add column if not exists depth int not null default 1 check (depth between 1 and 3);

alter table public.stakeholders
  add column if not exists reach text not null default 'partner'
    check (reach in ('partner', 'target', 'out-of-reach')),
  -- Who can reach an actor we cannot. One hop, for the manual's own instruction
  -- about influencing through an intermediary — deliberately NOT a general
  -- relationship graph (SPEC v2 §12).
  add column if not exists reachable_via uuid[] not null default '{}';

-- ============================================================================
-- New tables
-- ============================================================================

create table if not exists public.markers (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  stakeholder_id uuid not null references public.stakeholders(id) on delete cascade,
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

create table if not exists public.cycles (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organisations(id) on delete cascade,
  project_id           uuid not null references public.projects(id) on delete cascade,
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

create table if not exists public.observations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  stakeholder_id uuid not null references public.stakeholders(id) on delete cascade,
  marker_id      uuid not null references public.markers(id) on delete cascade,
  cycle_id       uuid references public.cycles(id) on delete set null,
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

create index if not exists markers_project_idx      on public.markers (project_id);
create index if not exists markers_stakeholder_idx  on public.markers (stakeholder_id);
create index if not exists cycles_project_idx       on public.cycles (project_id, opened_at desc);
create index if not exists observations_project_idx on public.observations (project_id);
create index if not exists observations_marker_idx  on public.observations (marker_id, at desc);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.markers      enable row level security;
alter table public.cycles       enable row level security;
alter table public.observations enable row level security;

do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
     where schemaname = 'public' and tablename in ('markers', 'cycles', 'observations')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- Markers: design artefacts, editable by members of the organisation.
create policy markers_select on public.markers for select to authenticated
  using (public.is_member(org_id));
create policy markers_insert on public.markers for insert to authenticated
  with check (public.is_member(org_id));
create policy markers_update on public.markers for update to authenticated
  using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy markers_delete on public.markers for delete to authenticated
  using (public.is_member(org_id));

-- Cycles: the summary is written while the review is open, so it is updatable
-- until it closes. The findings inside it are not (see below).
create policy cycles_select on public.cycles for select to authenticated
  using (public.is_member(org_id));
create policy cycles_insert on public.cycles for insert to authenticated
  with check (public.is_member(org_id));
create policy cycles_update on public.cycles for update to authenticated
  using (public.is_member(org_id)) with check (public.is_member(org_id));

-- Observations: SELECT and INSERT only.
--
-- The absence of UPDATE and DELETE below is the append-only guarantee for the
-- behaviour record. Do not add them. A correction is a new observation.
create policy observations_select on public.observations for select to authenticated
  using (public.is_member(org_id));
create policy observations_insert on public.observations for insert to authenticated
  with check (public.is_member(org_id) and by = (select auth.uid()));

revoke update, delete on public.observations from authenticated, anon;

-- An observation must belong to the same organisation and stakeholder as the
-- marker it scores, so a crafted insert cannot file a finding into someone
-- else's record.
create or replace function public.observations_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare m public.markers;
begin
  select * into m from public.markers mk where mk.id = new.marker_id;
  if m.id is null then
    raise exception 'Unknown behaviour.';
  end if;
  if m.org_id <> new.org_id or m.project_id <> new.project_id or m.stakeholder_id <> new.stakeholder_id then
    raise exception 'That observation does not belong to this behaviour.';
  end if;
  return new;
end;
$$;

drop trigger if exists observations_consistency_trg on public.observations;
create trigger observations_consistency_trg
  before insert on public.observations
  for each row execute function public.observations_consistency();

-- ============================================================================
-- Verify (run as a signed-in user)
-- ============================================================================
--
--   -- Every new table must report true:
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' and tablename in ('markers','cycles','observations');
--
--   -- The behaviour record cannot be rewritten. Both must ERROR:
--   update public.observations set narrative = 'tampered' where id = (select id from public.observations limit 1);
--   delete from public.observations where id = (select id from public.observations limit 1);
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

alter table public.projects
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

alter table public.stakeholders
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
--    where table_schema = 'public' and table_name = 'projects'
--      and column_name in ('vision','mission','vocabulary','readiness','depth');
--
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'stakeholders'
--      and column_name in ('reach','reachable_via','strategy_map');
--
-- ============================================================================


-- ============================================================================
-- VERIFICATION — run this in the SQL editor after the above
-- ============================================================================
--
-- IMPORTANT: the Supabase SQL editor connects as the `postgres` role, which
-- BYPASSES Row Level Security. A plain `update public.changes ...` run here
-- will SUCCEED even though the guarantee is perfectly intact — it is testing
-- the superuser, not the app. Use the checks below instead.

-- ---------------------------------------------------------------------------
-- 1. Row Level Security is on. Ten rows, every one true.
--    A false means that table is readable by anyone holding the public key.
-- ---------------------------------------------------------------------------
--
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public'
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
--    where schemaname = 'public' and tablename in ('changes','observations')
--    order by tablename, cmd;

-- ---------------------------------------------------------------------------
-- 3. And the table grants agree. Expect INSERT and SELECT only, for both
--    tables and both roles. UPDATE or DELETE appearing here is a failure.
-- ---------------------------------------------------------------------------
--
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
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
--     update public.changes set rationale = 'tampered';
--   rollback;
--
-- ============================================================================
