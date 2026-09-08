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
-- VERIFICATION — run this after the above, and read the output
-- ============================================================================
--
-- Paste the two queries below as a second statement. Both must come back the
-- way the comments say, or something is wrong and you should stop.

-- 1. Every table must report rowsecurity = true. A false here means that table
--    is readable by anyone holding the public anon key.
--
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public'
--      and tablename in ('organisations','memberships','invites','profiles',
--                        'projects','stakeholders','changes',
--                        'markers','observations','cycles')
--    order by tablename;

-- 2. History must be un-rewritable. Each of these must FAIL with a permission
--    error. If any succeeds, the append-only guarantee is not in place.
--
--   update public.changes set rationale = 'tampered';
--   delete from public.changes;
--   update public.observations set narrative = 'tampered';
--   delete from public.observations;
--
-- ============================================================================
`;

const out = header + body + footer;
writeFileSync(join(root, "supabase", "setup.sql"), out);
console.log(`supabase/setup.sql  ${files.length} migrations  ${(out.length / 1024).toFixed(1)} KB`);
