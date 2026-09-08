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
