-- Shift - maps kept on the server take organisations and public roles, not
-- named people.
--
-- A score for where an identifiable person stands on a political question is
-- special category data under UK GDPR, and the server copy is held by The MEL
-- Barn as the organisation's processor. Bellwether's stakeholder map takes the
-- same line until a data protection adviser says otherwise. Maps kept only in
-- the browser are not affected: they never reach this database.
--
-- The app refuses a stakeholder marked "named individual" before sending it
-- (src/backends/cloud.js). This constraint is the same rule kept by the
-- database, so a crafted request cannot get round the page.
--
-- NOT VALID on purpose: rows already marked as named individuals stay where
-- they are and can still be read, downloaded and deleted. They cannot be
-- changed until they are renamed to a role or an organisation and unmarked,
-- which the app explains on each one.
--
-- The flag is set by the person entering the stakeholder. A name typed with the
-- box unticked is not caught here; the participation agreement makes that the
-- organisation's undertaking.
--
-- Safe to run more than once.

alter table shift.stakeholders drop constraint if exists stakeholders_no_named_people;
alter table shift.stakeholders
  add constraint stakeholders_no_named_people check (not is_individual) not valid;

-- Check after running (expect true, false):
--   select exists (select 1 from pg_constraint where conname = 'stakeholders_no_named_people'),
--          (select convalidated from pg_constraint where conname = 'stakeholders_no_named_people');
