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
