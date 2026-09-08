# Shift

**A stakeholder tracker that records whether anyone actually moved.**

Most stakeholder maps are a snapshot: a two-by-two drawn in a workshop, exported to a slide, never opened
again. They record where you think people stand. They do not record whether anyone moved, when, what you
were doing at the time, or why you think it mattered.

Shift versions three things together — **the score**, **the reasoning behind it**, and **the engagement
strategy in force**. When a stakeholder moves, you can see what you were doing while they moved.

It runs entirely in your browser. No account, no server, no data leaving the machine.

> `Shift` is a working title. It is defined in one place (`APP_NAME` in `src/domain.js`) so renaming it is a
> one-line change.

---

## Use it

**→ [koushiklabs.github.io/shift](https://koushiklabs.github.io/shift/)**

There are two ways to run it, and the app always shows which one you are in.

**Without an account.** Open the link and start a map. Everything stays in your browser, on your machine —
no server, nothing uploaded, nobody else can see it. Good for trying it out, and genuinely usable
indefinitely. The catch: clearing your browser data deletes it, colleagues cannot see it, and it is not on
your other laptop. Use *Data → Download JSON* as your backup.

**Signed in.** Your organisation gets its own private storage. Maps are shared with everyone you invite and
with nobody else — enforced by the database, not just by the page — and they follow you to any device. This
needs the hosted backend to be set up; see [docs/HOSTING.md](docs/HOSTING.md).

If you start without an account and sign in later, Shift offers to copy your existing maps into your
organisation, history and all. It copies rather than moves, so the browser originals stay put.

**To install it as an app:** open the link in Chrome or Edge and click **Install app** in the top-right.
Safari 17+ on macOS: **File → Add to Dock**. You get an icon in your Start menu or Dock, its own window, and
offline use in local mode.

## The three stages

1. **Map** — who the actors are.
2. **Analyse** — score each on power and interest, and write the reasoning that produced those scores.
3. **Strategise** — a named engagement strategy per stakeholder: what change you are trying to produce in
   them, why your approach should work on *them*, what you will actually do, who owns it, how often.

The third stage is the one other tools omit, and it is what makes the history worth keeping. Without it you
can see that someone moved but have no record of what you were doing at the time.

## The scales

| | Range | Meaning |
|---|---|---|
| **Power** | 0 to 10 | Magnitude of influence over whether this succeeds, *in either direction*. An opponent with a veto scores high. |
| **Interest** | −10 to +10 | Alignment. **Negative means opposed.** Magnitude is strength of position. |

Stance is derived from interest and coloured separately: **Ally** ≥ +2 · **Neutral** −1 to +1 ·
**Opponent** ≤ −2.

The neutral band is load-bearing. "We have not established a position" is a real and extremely common state,
it is where engagement usually pays off most, and a standard power/interest formula hides it by splitting at
a single midpoint.

## What the tool insists on

These are the reasons it exists rather than a spreadsheet.

- **A score cannot move without its rationale being addressed.** Change a score and saving is blocked until
  you either edit the rationale or explicitly tick *"the reasoning has not changed — this corrects an earlier
  scoring error."* Both outcomes are recorded, and the second shows up in the history as a correction.
- **Strategy is versioned, and each version is measured.** Changing any strategy field closes the current
  period and opens a new one. *Strategy & effect* shows each period against the score movement across it.
- **The effect view does not overclaim.** It shows whether someone moved *while* an approach was in force. It
  does not establish causation, and the UI says so where it is displayed.
- **History is append-only.** A correction is a new row. A failed write is reported loudly and applies
  nothing, rather than being dropped silently.
- **Unknown is scored as neutral, and the tool prompts for it.** Inflating the interest of actors nobody has
  spoken to is the commonest failure this instrument exists to expose.
- **Quadrant labels are not a strategy.** Type "monitor" or "keep informed" into an objective and it is
  flagged, in the editor and in the coverage panel.

## Depth

Each map carries one of three depths, set in its settings and changeable at any time.

| | | |
|---|---|---|
| **1 · Map** | Score actors on power and interest, say why, name an engagement strategy. | Default |
| **2 · Watch** | Also record two to four observable behaviours per actor and review them each quarter. | Opt in |
| **3 · Outcome map** | The four-tier Outcome Mapping ladder — start / like / love / hope-not-to-see. | Opt in |

Depths 2 and 3 share one record: a progress marker is a Watch behaviour with a tier, so moving between them
sorts what already exists rather than asking for it again, and accumulated observations carry forward.

**Why depth 2 exists.** An organisation that cannot keep two behaviours per actor under review for two quarters
will not keep a fifteen-rung ladder under review for three years. Finding that out costs half a day instead of a
failed engagement.

## Judgement beside observation

The reason the two methods are worth joining. Shift records a **judgement** — someone decided this actor sits at
interest +8, and wrote down why. A progress marker records an **observation** — this actor was seen publishing a
dated timeline. Neither method holds both, so neither can notice when they disagree:

> Interest +2 → +10. Ladder: 1 of 4 behaviours observed.
> **Your score has moved further than the behaviour has.**

That lands on the failure each method is known for: the score inflation stakeholder mapping is prone to, and
Outcome Mapping's own significance gap. It establishes nothing about causation and says so wherever it appears.

Markers never replace the score and no score is derived from them. Collapsing the two readings into one number
deletes the instrument.

## The views

- **Map** — power × interest scatter, three-colour by stance, point size by power, zero-interest line drawn,
  dotted trails from each baseline. Labels de-collide with leader lines. Click a point or a row to open the
  four-tab detail editor.
- **Movement** — everyone who has moved, direction and magnitude, largest shift first, each paired with the
  strategy that was in force.
- **Behaviour** *(depth 2+)* — every actor with behaviours recorded, each showing what was judged beside what
  was observed, and the way into a review cycle.
- **Coverage** — what is wrong with this map: who has no strategy, which opponents have none, which
  objectives are quadrant labels, who has no rationale, who is neutral or unknown, which entries are named
  individuals, which strategies have no owner or have gone four months untouched. At depth 2+ it also flags
  behaviours that moved backwards, boundary partners with none recorded, ladders nobody has reviewed, and
  markers that will not score cleanly.
- **Data** — exports, imports, map settings, and an honest account of where your data lives.

## Getting your data in and out

| | |
|---|---|
| **CSV in** | Paste rows from Excel or Sheets, or pick a file. Columns are auto-mapped and always shown for correction. Comma, semicolon and tab are all recognised, as are quoted fields, embedded newlines and `+6` / `−6`. |
| **JSON in** | A Shift export, restored with history intact. Also reads an *Export everything* dump from the [`stakeholder-matrix`](#origin) Claude skill, so a map started there can be brought across. |
| **CSV out** | One row per stakeholder: scores, stance, rationale, all five strategy fields, baseline and movement columns. |
| **JSON out** | Everything, including the full append-only history and the derived strategy periods. Round-trips cleanly — this is how a map moves between devices and people. |
| **PNG out** | The map at 2× with a caption. |

## Running it

Requires Node 18+ to develop. **Nothing is required to use it** — the build is a single self-contained HTML
file.

```bash
npm install
npm run dev      # dev server with hot reload
npm test         # 149 unit tests: domain, behaviour layer, import/export, row mapping, service worker
npm run build    # -> dist/ : one HTML file plus icons, manifest, service worker
```

### If the project lives in a cloud-synced folder

`npm install` fails inside Google Drive, Dropbox and OneDrive folders. The sync client locks files while npm
is writing thousands of small ones, and the install dies with `EBADF` or `ENOTEMPTY` — sometimes after
reporting success. Google Drive's virtual filesystem will not accept a `node_modules` junction either.

Copy the project to a local disk to develop, and keep the synced copy as the source of record:

```bash
robocopy "D:\path\to\synced\project" "%LOCALAPPDATA%\shift-dev\app" /E /XD node_modules dist
```

None of this affects *using* the tool. `dist/index.html` needs no toolchain at all.

### Hosted mode

See **[docs/HOSTING.md](docs/HOSTING.md)** for the full setup: creating the Supabase project, running the
migration, configuring auth, and the keep-alive that stops a free project pausing after seven days. Without
it the app runs perfectly well in local mode and says so.

### Deploying your own copy

Any organisation can run its own instance; nothing links back to anyone else's.

**GitHub Pages** (what the hosted copy uses). Fork the repo, then in *Settings → Pages* set
**Source: GitHub Actions**. Every push to `main` runs the tests, builds, checks the bundle makes no external
requests, and publishes. Nothing else to configure.

**Any static host.** `npm run build` produces a `dist/` folder — one HTML file plus the icons, manifest and
service worker. Upload it anywhere that serves files over http: an intranet, S3, Netlify, a SharePoint site,
a spare corner of an existing web server.

**Minimal install.** `dist/index.html` alone is the entire application. Drop that one file on a web server
and it works; you lose only offline support and the Install button, both of which come from the extra files
sitting beside it.

> **It must be served over `http`/`https`, not opened as a `file://` document.** Browsers do not let local
> files use IndexedDB, so opening it straight off disk means nothing can be saved. The app detects this and
> says so plainly rather than letting you type a record it cannot keep. Locally: `npx serve dist`.

### Choosing a URL — decide before anyone uses it

Browser storage is bound to the **origin** (scheme + host + port). Maps created on
`koushiklabs.github.io` are invisible from `shift.example.org`, and moving the app between the two strands
every user's data behind a manual export and re-import. Nobody is warned; the maps simply are not there.

So pick the final URL before you share the link. To use your own domain:

1. Add a `CNAME` file to `public/` containing just the hostname, e.g. `shift.example.org`.
2. At your DNS provider, add a `CNAME` record for that hostname pointing at `<user>.github.io`.
   (For an apex domain, use `A` records to GitHub's four Pages IPs instead.)
3. In *Settings → Pages*, enter the custom domain and tick **Enforce HTTPS**.

A custom domain is the more durable choice: if you ever move off GitHub Pages, the origin comes with you
and nobody loses their maps.

## Privacy

This tool stores adverse judgements about named organisations and sometimes named individuals. That shapes
the architecture, not just the policy.

**Without an account**, the guarantee is absolute: everything is in your browser's own IndexedDB. No
backend, no account, no telemetry, no analytics. The built page loads no fonts, scripts, styles or images
from anywhere — CI fails the build if it does, so you can trust it rather than take my word:
`grep -o 'https\?://' dist/index.html` returns only XML namespace URIs.

**Signed in**, your organisation's data is on the host's server. What protects it there:

- **Row Level Security on every table.** One organisation cannot read another's rows — Postgres refuses,
  regardless of what the client code does. A bug in this app, or a crafted API call, cannot cross that line.
- **History is append-only in the database.** `changes` has no UPDATE or DELETE policy, so nobody — not
  even an organisation's own admin — can rewrite or erase a recorded change. SPEC 6.4 stops being a promise
  the client keeps and becomes one Postgres keeps.
- **Attribution cannot be forged.** The insert policy requires `by = auth.uid()`, so a change is always
  recorded against whoever actually made it.
- Whoever runs the database *can* read it from their dashboard. That is inherent to hosting, and
  [docs/HOSTING.md](docs/HOSTING.md) says so plainly rather than pretending otherwise.

**Named individuals are flagged** in both modes. Where a stakeholder looks like a person rather than an
organisation, the editor surfaces a note about data-protection obligations — under UK/EU GDPR and
comparable regimes a written adverse assessment of an identifiable person is personal data, and they have a
right of access to it. The UI nudges toward mapping roles and institutions instead.

**Export is complete and easy** in both modes. Users who can leave will trust the tool.

## Architecture

```
src/
  domain.js          pure logic — scales, stance, the rationale gate, strategy periods, coverage
  store.js           app state and actions; nothing hits memory before it is durable
  auth.js            accounts, organisations, members, invite links
  supabaseClient.js  connection and human-readable error translation
  backends/
    index.js         which storage mode is live
    local.js         IndexedDB; the atomic stakeholder+history commit
    cloud.js         Supabase Postgres, scoped to one organisation
    rows.js          domain <-> database row mapping (pure, heavily tested)
  example.js         the demo map (entirely fictional)
  io/
    csv.js           RFC-4180-ish parser, column guessing, export with formula-injection guards
    json.js          full-fidelity export; readers for Shift and stakeholder-matrix dumps
    png.js           SVG → PNG, baking CSS custom properties into the serialised copy
    download.js      file downloads and clipboard
  ui/
    app.js           shell, routing, wiring
    matrix.js        the scatter, with label de-collision
    editor.js        the four-tab detail editor and the staleness gate
    mapview.js       tiles and the sortable table
    movement.js  coverage.js  data.js  projects.js
    modal.js         dialogs   importwizard.js  the CSV mapping wizard
    account.js       sign-in, organisations, members, invites, migration
    behaviour.js     markers, the judged/observed instrument, the reflection cycle
  pwa.js             service-worker registration and the install prompt
public/              copied to dist as-is
  manifest.webmanifest   sw.js   icon-*.png
scripts/
  make-icons.mjs     generates the PNG icons with zlib and no dependencies
supabase/
  migrations/0001_init.sql        tables, RLS policies, membership functions
  migrations/0002_behaviour.sql   triage, depth, markers, observations, cycles
docs/
  HOSTING.md         setting up the hosted backend
test/
  domain.test.js 38  markers.test.js 33  io.test.js 39
  rows.test.js 30    sw.test.js 9                        (149 total)
```

Two rules worth knowing before changing anything:

**The atomic commit.** `db.commitChange` writes the updated stakeholder and its history row in one
IndexedDB transaction, and `store.commit` does not touch in-memory state until that transaction reports
`complete`. There is nothing to roll back on failure because nothing was applied. Keep it that way.

**Observations are append-only, like changes.** `observations` has no UPDATE or DELETE policy, for the same
reason `changes` has none: a behaviour record that can be quietly rewritten is worthless as the thing that
checks a score. A correction is a new observation in the next cycle, which is also what Outcome Mapping
practice expects.

**Isolation is the database's job, not the client's.** In hosted mode, never filter by organisation in
JavaScript and consider it done. Every table carries `org_id` and every policy checks membership, so the
app can be wrong without leaking. Keep it that way: no new table without RLS, and no UPDATE or DELETE
policy on `changes`, ever.

**The editor owns its DOM while dirty.** `app.js` will not re-render the detail editor while `state.dirty`
is true. A re-render under a typing user swallows the rationale they were halfway through writing.

### One deliberate non-obvious choice

`src/ui/modal.js` never uses the `<dialog>` `close` event and never uses `<form method="dialog">`, which are
the obvious ways to write it. In at least one embedded Chromium, `dialog.close()` sets `open` to false and
sets `returnValue` but never dispatches `close` — so a modal layer built on that event resolves its promise
never. The user clicks "Import 3 stakeholders", the dialog vanishes, and nothing happens, with no error. All
dialog resolution is therefore explicit. Please do not "simplify" it back.

## Origin

Generalised from the `stakeholder-matrix` Claude Code skill, which does this job for people running Claude
Code. The SVG scatter with its label de-collision, and the strategy-period derivation, are ported from that
skill's template rather than rewritten — they were the fiddly parts and they already worked.

The conventions the UI enforces (scoring bands, what belongs in a rationale, what a real engagement strategy
contains, why opponents need one too) come from that skill's `references/scoring.md` and
`references/strategy.md`.

## Status and scope

The MVP described in `Stakeholder_Tracker_App_SPEC.md` §7, plus the hosted sync and accounts the spec
places in Phase 2. Deliberately **not** built:

- No cross-organisation sharing or pooled directory, ever. Each organisation's data is entirely its own.
  It sounds valuable and it is out of scope permanently — see the spec's §10 for why.
- No real-time collaborative editing. Two people editing one stakeholder simultaneously is not a real use
  case at this scale, and pretending otherwise buys a lot of complexity for nothing.
- No billing. Organisations are already the unit that would be charged, so nothing blocks adding it — but
  not before anyone asks to pay.
- Not a CRM, not project management, not a network graph of relationships *between* stakeholders.
- Not an assessment engine. The tool does not tell you what a score should be. It records what you decided
  and holds you to explaining it.

### Known limits

- **Renaming is not versioned.** Per the spec's data model, `changedFields` covers power, interest, rationale
  and strategy only, so editing a stakeholder's name or type does not create a history entry. The rename
  dialog says so.
- **Deleting a stakeholder deletes its history.** It is the one irreversible action. The confirmation
  suggests scoring power to 0 with an explanation instead, which keeps the record.
- **PNG text uses a system font stack**, since an SVG rasterised through an `<img>` cannot load page fonts.
- **Hosted mode requires a connection.** Offline works in local mode only. The Supabase client has no
  offline cache, and a sync layer with conflict resolution is a much larger piece of work than it looks.
- **Concurrent edits are last-write-wins** on the scores. No history is lost either way — both edits append
  their own entry — but two people editing one stakeholder at the same moment will see one set of numbers
  win. SPEC 12 judges that not to be a real use case at this scale.
- **A hosted save is two writes, not one transaction.** PostgREST cannot span a transaction across
  requests, so `commitChange` writes the history row first and the current scores second. If the second
  fails, the record survives and the scores are stale — recoverable by reloading. The local backend has a
  real IndexedDB transaction and does not have this caveat.
- **Offline support needs a secure context.** Service workers require `https` or `localhost`; on a plain-http
  LAN address the app runs normally but without offline caching or the Install button.
- **All of a project's history is held in memory** while it is open. The spec's budget is thousands of change
  rows per project, not millions; that is comfortable, but it is not a warehouse.

## Licence

MIT. See [LICENSE](LICENSE).

A tool one organisation controls is fragile, and the addressable market does not support a commercial
product — so take it, fork it, rename it.
