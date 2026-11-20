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
