-- Checks 0008_agreement.sql as the real app roles.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
reset role;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'alice@alpha.org'),
  ('00000000-0000-0000-0000-0000000000a2', 'bob@alpha.org'),
  ('00000000-0000-0000-0000-0000000000b1', 'carol@beta.org');

-- An organisation from before the agreement, with a map already in it.
insert into shift.organisations (id, name) values ('00000000-0000-0000-0000-00000000000a', 'Alpha');
insert into shift.memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'member');
insert into shift.projects (id, org_id, name) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', 'Old map');
insert into shift.stakeholders (id, org_id, project_id, name, power, interest, baseline) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-0000000000f1', 'The regulator', 5, 0, '{}');

create function pg_temp.refused(sql text) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when insufficient_privilege or raise_exception then
  return true;
end $$;

-- Bob, a member, before anyone has accepted.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from shift.stakeholders;
  if n <> 1 then raise exception 'a member lost sight of existing maps before acceptance'; end if;
  if (select agreement_version from shift.organisations) is not null then raise exception 'accepted too early'; end if;
  if not pg_temp.refused($q$insert into shift.projects (org_id, name) values ('00000000-0000-0000-0000-00000000000a', 'New')$q$)
    then raise exception 'a map was added before acceptance'; end if;
  if not pg_temp.refused($q$insert into shift.stakeholders (org_id, project_id, name, power, interest, baseline) values
      ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f1', 'A ministry', 5, 0, '{}')$q$)
    then raise exception 'a stakeholder was added before acceptance'; end if;
  update shift.stakeholders set power = 9;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'a stakeholder was changed before acceptance'; end if;
  if not pg_temp.refused($q$insert into shift.changes (org_id, project_id, stakeholder_id, by, power, interest, prev_power, prev_interest, changed_fields)
      values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f1',
              '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', 6, 0, 5, 0, '{power}')$q$)
    then raise exception 'history was added before acceptance'; end if;
  if not pg_temp.refused($q$select shift.accept_agreement('00000000-0000-0000-0000-00000000000a', '1')$q$)
    then raise exception 'a member accepted the agreement'; end if;
end $$;
reset role;

-- Carol, from another organisation, cannot accept for Alpha.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
set role authenticated;
do $$ begin
  if not pg_temp.refused($q$select shift.accept_agreement('00000000-0000-0000-0000-00000000000a', '1')$q$)
    then raise exception 'an outsider accepted the agreement'; end if;
end $$;
reset role;

-- Signed out: no reach at all.
set request.jwt.claim.sub = '';
set role anon;
do $$ begin
  if not pg_temp.refused($q$select shift.accept_agreement('00000000-0000-0000-0000-00000000000a', '1')$q$)
    then raise exception 'anon reached accept_agreement'; end if;
end $$;
reset role;

-- Alice, the admin.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
set role authenticated;
do $$
declare n int; o shift.organisations;
begin
  if not pg_temp.refused($q$update shift.organisations set agreement_version = '1'$q$)
    then raise exception 'an admin wrote the acceptance columns directly'; end if;
  if not pg_temp.refused($q$select shift.accept_agreement('00000000-0000-0000-0000-00000000000a', '0')$q$)
    then raise exception 'a stale version was accepted'; end if;
  update shift.organisations set name = 'Alpha Alliance';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'an admin can no longer rename the organisation'; end if;

  perform shift.accept_agreement('00000000-0000-0000-0000-00000000000a', '1');
  select * into o from shift.organisations;
  if o.agreement_version <> '1' or o.agreement_accepted_by <> 'alice@alpha.org' or o.agreement_accepted_at is null
    then raise exception 'acceptance was not recorded'; end if;
  -- Accepting again changes nothing.
  perform shift.accept_agreement('00000000-0000-0000-0000-00000000000a', '1');
  if (select agreement_accepted_at from shift.organisations) <> o.agreement_accepted_at
    then raise exception 'a second acceptance overwrote the first'; end if;
end $$;
reset role;

-- Bob can work again.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
set role authenticated;
do $$
declare n int;
begin
  insert into shift.projects (org_id, name) values ('00000000-0000-0000-0000-00000000000a', 'New');
  update shift.stakeholders set power = 9;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'a member cannot save after acceptance'; end if;
  insert into shift.changes (org_id, project_id, stakeholder_id, by, power, interest, prev_power, prev_interest, changed_fields)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f1',
            '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', 9, 0, 5, 0, '{power}');
end $$;
reset role;

-- A new organisation starts unaccepted, and its creator accepts.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
set role authenticated;
do $$
declare org uuid;
begin
  org := shift.create_organisation('Beta');
  if not pg_temp.refused(format($q$insert into shift.projects (org_id, name) values (%L, 'First')$q$, org))
    then raise exception 'a new organisation saved before accepting'; end if;
  perform shift.accept_agreement(org, '1');
  insert into shift.projects (org_id, name) values (org, 'First');
  -- Still no sight of Alpha.
  if (select count(*) from shift.projects) <> 1 then raise exception 'organisations can see each other'; end if;
end $$;
reset role;
\echo agreement: ok
