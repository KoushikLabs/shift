-- Checks 0009_no_named_people.sql. Runs after agreement.sql and uses its rows.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
reset role;

-- A row from before the rule, marked as a named individual. The owner role can
-- only put it there by lifting the constraint, as the live rows predate it.
alter table shift.stakeholders drop constraint stakeholders_no_named_people;
insert into shift.stakeholders (id, org_id, project_id, name, power, interest, baseline, is_individual) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-0000000000f1', 'Dr Example Person', 5, 0, '{}', true);
\ir ../migrations/0009_no_named_people.sql

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
set role authenticated;
do $$
declare n int; refused boolean;
begin
  -- New named individuals are refused, by insert and by upsert.
  begin
    insert into shift.stakeholders (org_id, project_id, name, power, interest, baseline, is_individual) values
      ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f1', 'Ms New Person', 5, 0, '{}', true);
    raise exception 'a named individual was saved';
  exception when check_violation then null; end;
  begin
    update shift.stakeholders set is_individual = true where id = '00000000-0000-0000-0000-0000000000e1';
    raise exception 'a stakeholder was turned into a named individual';
  exception when check_violation then null; end;

  -- The old row is still readable, and cannot be changed while marked.
  select count(*) into n from shift.stakeholders where is_individual;
  if n <> 1 then raise exception 'the existing named individual disappeared'; end if;
  begin
    update shift.stakeholders set power = 7 where id = '00000000-0000-0000-0000-0000000000e2';
    raise exception 'a marked row was changed';
  exception when check_violation then null; end;

  -- Renamed to a role and unmarked, it saves.
  update shift.stakeholders set name = 'The regional officer', is_individual = false, power = 7
   where id = '00000000-0000-0000-0000-0000000000e2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'renaming to a role did not save'; end if;

  -- Organisations and roles are unaffected.
  insert into shift.stakeholders (org_id, project_id, name, power, interest, baseline) values
    ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f1', 'The farming minister', 8, -2, '{}');
end $$;
reset role;

-- A marked row can still be deleted.
alter table shift.stakeholders drop constraint stakeholders_no_named_people;
insert into shift.stakeholders (id, org_id, project_id, name, power, interest, baseline, is_individual) values
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-0000000000f1', 'Dr Other Person', 5, 0, '{}', true);
\ir ../migrations/0009_no_named_people.sql
set role authenticated;
do $$
declare n int;
begin
  delete from shift.stakeholders where id = '00000000-0000-0000-0000-0000000000e3';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'a marked row could not be deleted'; end if;
end $$;
reset role;
\echo named people: ok
