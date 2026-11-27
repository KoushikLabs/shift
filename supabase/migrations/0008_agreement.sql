-- Shift - the participation agreement, accepted once per organisation.
--
-- An organisation that keeps maps on the server is the controller of what it
-- records, and The MEL Barn holds those records as its processor. UK GDPR wants
-- that in writing (Article 28), so an admin accepts the agreement at
-- /agreement.html for the organisation before anyone saves to the server. This
-- follows Bellwether's 06_agreement.sql.
--
-- Change:
--   * shift.organisations gets agreement_version, agreement_accepted_at and
--     agreement_accepted_by (the accepting admin's email). They are deleted
--     with the organisation.
--   * shift.agreement_version() names the version in force: '1'. When the
--     agreement page changes in a way that needs accepting again, change this
--     and AGREEMENT_VERSION in src/auth.js together.
--   * shift.accept_agreement(org, accepted_version): admins only.
--   * Until its organisation has accepted the version in force, a member can
--     still read, download and delete the organisation's maps, but cannot add
--     or change anything. This is done with RESTRICTIVE policies, which narrow
--     the existing ones without replacing them.
--   * Members may now update only an organisation's name directly, so the
--     acceptance columns can be written only through accept_agreement().
--
-- Order: deploy the app first, then run this. The app from before this file
-- does not know why its saves are refused; the app from after it works either
-- side of this file (it treats a missing column as "nothing to accept yet").
-- Existing organisations are asked to accept at their next sign-in.
--
-- Safe to run more than once.

alter table shift.organisations add column if not exists agreement_version text;
alter table shift.organisations add column if not exists agreement_accepted_at timestamptz;
alter table shift.organisations add column if not exists agreement_accepted_by text;

revoke update on shift.organisations from authenticated;
grant update (name) on shift.organisations to authenticated;

create or replace function shift.agreement_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '1'::text $$;

create or replace function shift.agreement_accepted(org uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from shift.organisations o
    where o.id = org and o.agreement_version = shift.agreement_version()
  );
$$;

create or replace function shift.accept_agreement(org uuid, accepted_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;
  if not shift.is_admin(org) then
    raise exception 'An admin of your organisation accepts the participation agreement.';
  end if;
  if accepted_version is distinct from shift.agreement_version() then
    raise exception 'The participation agreement has changed since this page opened. Reload the page and read the current version.';
  end if;

  update shift.organisations o
     set agreement_version = accepted_version,
         agreement_accepted_at = now(),
         agreement_accepted_by = (select coalesce(u.email, '') from auth.users u where u.id = uid)
   where o.id = org and o.agreement_version is distinct from accepted_version;
end;
$$;

revoke all on function shift.agreement_version() from public;
revoke all on function shift.agreement_accepted(uuid) from public;
revoke all on function shift.accept_agreement(uuid, text) from public;
grant execute on function shift.agreement_version() to authenticated;
-- The policies below call agreement_accepted() as the signed-in user.
grant execute on function shift.agreement_accepted(uuid) to authenticated;
grant execute on function shift.accept_agreement(uuid, text) to authenticated;

-- No adding or changing records until the organisation has accepted.
-- Reading and deleting are left alone, so an organisation that does not accept
-- can still download its maps and remove them.
do $$
declare
  t text;
begin
  foreach t in array array['projects', 'stakeholders', 'changes', 'markers', 'cycles', 'observations']
  loop
    execute format('drop policy if exists %I on shift.%I', t || '_agreement_insert', t);
    execute format('drop policy if exists %I on shift.%I', t || '_agreement_update', t);
    execute format(
      'create policy %I on shift.%I as restrictive for insert to authenticated
         with check (shift.agreement_accepted(org_id))', t || '_agreement_insert', t);
    execute format(
      'create policy %I on shift.%I as restrictive for update to authenticated
         using (shift.agreement_accepted(org_id)) with check (shift.agreement_accepted(org_id))',
      t || '_agreement_update', t);
  end loop;
end $$;

-- Check after running (expect true, 12, true, false):
--   select exists (select 1 from information_schema.columns where table_schema = 'shift'
--                   and table_name = 'organisations' and column_name = 'agreement_version'),
--          (select count(*) from pg_policies where schemaname = 'shift' and policyname like '%\_agreement\_%'),
--          has_function_privilege('authenticated', 'shift.accept_agreement(uuid, text)', 'execute'),
--          has_table_privilege('authenticated', 'shift.organisations', 'update');
