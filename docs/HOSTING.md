# Setting up hosted mode

Shift runs in two modes:

- **Local** — no account, everything in the visitor's browser. Works with no setup at all.
- **Hosted** — people sign in, and each organisation's maps live in a shared database that only its
  members can reach.

This document sets up the second. It takes about twenty minutes. Until you finish it, the deployed app
simply runs in local mode and says so.

---

## Before you start: what changes when you host

Today you have no custody of anyone's data. Once you run a database, **you become a data processor for
every organisation using Shift**, including their written assessments of named individuals. That is normal
and manageable, but it is a real change:

- Someone with access to your Supabase dashboard can read any organisation's maps. That is unavoidable
  with a hosted database — be deliberate about who has that access, and turn on 2FA.
- Under UK/EU GDPR you will want a processing agreement with each organisation. Supabase provides a DPA
  for you to sign as *their* customer; you then offer one to your partners.
- **Choose an EU region when you create the project if any partner is European. The region cannot be
  changed afterwards** — moving means a new project and a manual data migration.

If that is more than you want to take on, the local mode plus JSON export already lets an organisation
keep a full longitudinal record on its own machine, with you holding nothing.

---

## 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project.
2. **Region:** pick the one closest to your partners — `eu-west-1` (Ireland) or `eu-central-1` (Frankfurt)
   for Europe. This is permanent.
3. **Database password:** generate a strong one and put it in your password manager. You will rarely need
   it, and there is no way to recover it later.
4. Free plan is fine to begin with.

## 2. Create the tables and the access rules

1. In the Supabase dashboard, open **SQL Editor → New query**.
2. Paste the entire contents of **[`supabase/setup.sql`](../supabase/setup.sql)** and run it.

That one file is all three migrations concatenated, and it is idempotent — running it twice changes nothing.
Use the individual files in `supabase/migrations/` only when applying a change to a database that already
exists.

It creates ten tables, twenty-eight Row Level Security policies and eleven functions: the isolation that keeps
one organisation'''s data unreadable to another, and the append-only guarantee on `changes` and `observations`.

### Check it actually worked

Run these as a second query. **Both must come back the way this says, or stop.**

```sql
select tablename, rowsecurity from pg_tables
 where schemaname = '''public'''
   and tablename in ('''organisations''','''memberships''','''invites''','''profiles''',
                     '''projects''','''stakeholders''','''changes''',
                     '''markers''','''observations''','''cycles''')
 order by tablename;
```

Ten rows, every one showing `rowsecurity = true`. A false means that table is readable by anyone holding the
public key.

Then confirm history cannot be rewritten. **Each of these must FAIL** with a permission error:

```sql
update public.changes set rationale = '''tampered''';
delete from public.changes;
update public.observations set narrative = '''tampered''';
delete from public.observations;
```

If any of them succeeds, the append-only guarantee is not in place and the behaviour record cannot be trusted
as evidence.

## 3. Configure authentication

**Authentication → URL Configuration**

- **Site URL:** `https://koushiklabs.github.io/shift/`
- **Redirect URLs:** add `https://koushiklabs.github.io/shift/**` and, for local development,
  `http://localhost:5173/**`

**Authentication → Providers → Email**

- Leave **Confirm email** on for real use. It stops someone signing up with an address they do not own.
- While you are testing alone, you may turn it off to skip the inbox round trip. Turn it back on before
  inviting anyone.

**Email delivery.** Supabase's built-in mail is heavily rate-limited and not meant for production — a
handful of messages an hour. Before onboarding real organisations, set a custom SMTP under
**Project Settings → Authentication → SMTP Settings**. [Resend](https://resend.com) and
[Postmark](https://postmarkapp.com) both have free tiers that are ample here.

> Note that **invites do not need email at all.** Shift generates an invite *link* that the admin copies and
> sends however they like. Only sign-up confirmation and password resets need SMTP.

## 4. Point the app at the project

Get the values from **Project Settings → API**:

- **Project URL** — e.g. `https://abcdefgh.supabase.co`
- **anon / public key** — the long `eyJ…` string

Both are public values. The anon key is designed to ship in a web page; Row Level Security is what makes
that safe. Do not use the **service_role** key anywhere near this app — that one bypasses every policy.

In GitHub, at **Settings → Secrets and variables → Actions**:

| Where | Name | Value |
|---|---|---|
| **Variables** tab | `SUPABASE_URL` | your project URL |
| **Secrets** tab | `SUPABASE_ANON_KEY` | your anon key |

Then re-run the **Deploy** workflow (Actions → Deploy → Run workflow). The next build picks them up and the
deployed app grows a **Sign in** button.

For local development, create a `.env.local` file — it is gitignored:

```
VITE_SUPABASE_URL=https://abcdefgh.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

## 5. Stop the project pausing

A free Supabase project **pauses after 7 days with no database activity** and has to be restored by hand
from the dashboard. Shift is used after meetings, often weeks apart, so this would be hit constantly.

`.github/workflows/keepalive.yml` runs twice a week and calls a trivial function to reset that timer. It
starts working as soon as you set the two values above. Delete the workflow if you move to a paid plan.

## 6. Try it end to end

1. Open the deployed app. It should show **Sign in** in the top right.
2. Create an account, then create an organisation.
3. If you already had maps in that browser, it offers to copy them across. Accept, and check the history
   survived — open a stakeholder and look at **Full history**.
4. **Team → Create an invite link.** Open it in a private window, sign up as a second user, and confirm the
   maps appear.
5. **The one that matters:** in a private window, create a *second* organisation with a different account.
   It must see none of the first organisation's maps.

---

## Free tier limits, and what happens past them

| | Free | Pro ($25/mo) |
|---|---|---|
| Database | 500 MB | 8 GB |
| Monthly active users | 50,000 | 100,000 |
| Pauses when idle | After 7 days | Never |
| Backups | None | Daily, 7-day retention |

500 MB is a very large number of stakeholder maps — the text is small and there are no attachments. You
will hit the *pause* long before the *size*, which is what the keep-alive is for.

**Move to Pro when you have real organisations relying on it**, mainly for the daily backups. Free has
none, so until then your recovery plan is the JSON export.

## Backups

Until you are on a paid plan, there is no automatic backup. Two things to do:

- Tell each organisation to use **Data → Download JSON** periodically. That file restores completely.
- For your own copy, `pg_dump` the database from **Project Settings → Database → Connection string**:

  ```bash
  pg_dump "postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres" > shift-backup.sql
  ```

## If you later charge for this

Supabase does not do billing. You would add a payment provider and a `subscriptions` table keyed by
organisation, then gate access in the policies. Nothing in the current schema blocks that — organisations
are already the unit that would be billed. Worth doing only once organisations are asking to pay, not
before.

## Troubleshooting

**"Sign in" does not appear.** The build had no Supabase values. Check the Actions variables and secrets are
named exactly `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then re-run Deploy.

**"Could not reach the server."** The project is probably paused. Open the Supabase dashboard and restore
it, then check the keep-alive workflow is running.

**Sign-up says the email was sent but nothing arrives.** You are hitting the built-in mail rate limit.
Configure SMTP (step 3).

**"The database refused that change."** Working as designed — that message appears when something tries to
edit or delete recorded history. Corrections are new entries.

**Infinite recursion detected in policy.** A policy on `memberships` is querying `memberships` directly
instead of going through `is_member()`. Re-run the migration.
