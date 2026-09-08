/**
 * Concatenates the migrations into supabase/setup.sql — one paste instead of
 * three, for a fresh project.
 *
 *   node scripts/build-setup-sql.mjs
 *
 * The migrations stay the source of truth and are still the right thing to run
 * one at a time against a database that already exists. setup.sql exists only
 * so that standing up a NEW project is a single action, because three sequential
 * pastes into a web SQL editor is three chances to run them out of order or stop
 * halfway and leave a database that is half-built and silently wrong.
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const header = `-- Shift — complete database setup.
--
-- GENERATED FILE. Do not edit; edit supabase/migrations/*.sql and run
-- \`npm run sql\`. Generated ${new Date().toISOString().slice(0, 10)} from:
${files.map((f) => `--   supabase/migrations/${f}`).join("\n")}
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
--   2. Recorded history is append-only. \`changes\` and \`observations\` have
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

`;

const body = files
  .map((f) => {
    const sql = readFileSync(join(dir, f), "utf8");
    return `\n-- ${"=".repeat(74)}\n-- ${f}\n-- ${"=".repeat(74)}\n\n${sql.trimEnd()}\n`;
  })
  .join("\n");

const footer = `

-- ============================================================================
-- VERIFICATION — run this in the SQL editor after the above
-- ============================================================================
--
-- IMPORTANT: the Supabase SQL editor connects as the \`postgres\` role, which
-- BYPASSES Row Level Security. A plain \`update public.changes ...\` run here
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
`;

const out = header + body + footer;
writeFileSync(join(root, "supabase", "setup.sql"), out);
console.log(`supabase/setup.sql  ${files.length} migrations  ${(out.length / 1024).toFixed(1)} KB`);
