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

No account, no sign-up, no download. Open it and start a map.

**To install it as an app:** open that link in Chrome or Edge and click **Install app** in the top-right
(or the install icon in the address bar). Safari 17+ on macOS: **File → Add to Dock**. You get an icon in
your Start menu or Dock, its own window, and it keeps working with no internet connection.

**Where your data goes: nowhere.** Everything you type stays in your own browser's storage on your own
machine. There is no server to send it to. Nobody — including whoever published this — can see your maps.

Two consequences you need to know before you rely on it:

- **Clearing your browser data deletes your maps.** So does using a different browser, a different
  computer, or a private window. Use *Data → Download JSON* regularly. That file is the backup.
- **Your colleagues cannot see your maps.** Sharing means sending them the JSON export, which they import
  on their machine. Shared editing is deliberately not built (see [Status and scope](#status-and-scope)).

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

## The views

- **Map** — power × interest scatter, three-colour by stance, point size by power, zero-interest line drawn,
  dotted trails from each baseline. Labels de-collide with leader lines. Click a point or a row to open the
  four-tab detail editor.
- **Movement** — everyone who has moved, direction and magnitude, largest shift first, each paired with the
  strategy that was in force.
- **Coverage** — what is wrong with this map: who has no strategy, which opponents have none, which
  objectives are quadrant labels, who has no rationale, who is neutral or unknown, which entries are named
  individuals, which strategies have no owner or have gone four months untouched.
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
npm test         # 80 unit tests: domain, import/export, service worker
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

- **Private by architecture.** Everything is in your browser's own IndexedDB. There is no backend, no
  account, no telemetry, and no analytics.
- **Zero network requests.** The built page loads no fonts, scripts, styles or images from anywhere. It uses
  system font stacks specifically so it never has to phone out. You can verify this: `grep -o 'https\?://'
  dist/index.html` returns only XML namespace URIs.
- **Named individuals are flagged.** Where a stakeholder looks like a person rather than an organisation, the
  editor surfaces a note about data-protection obligations — under the UK/EU GDPR and comparable regimes a
  written adverse assessment of an identifiable person is personal data, and they have a right of access to
  it. The UI nudges toward mapping roles and institutions instead.
- **Export is complete and easy.** Users who can leave will trust the tool.

The corollary, stated plainly in the app: clearing your browser data destroys your maps, and a colleague on
another machine cannot see them. Export regularly.

## Architecture

```
src/
  domain.js          pure logic — scales, stance, the rationale gate, strategy periods, coverage
  db.js              IndexedDB; the atomic stakeholder+history commit
  store.js           app state and actions; nothing hits memory before it is durable
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
  pwa.js             service-worker registration and the install prompt
public/              copied to dist as-is
  manifest.webmanifest   sw.js   icon-*.png
scripts/
  make-icons.mjs     generates the PNG icons with zlib and no dependencies
test/
  domain.test.js  38   io.test.js  33   sw.test.js  9      (80 total)
```

Two rules worth knowing before changing anything:

**The atomic commit.** `db.commitChange` writes the updated stakeholder and its history row in one
IndexedDB transaction, and `store.commit` does not touch in-memory state until that transaction reports
`complete`. There is nothing to roll back on failure because nothing was applied. Keep it that way.

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

This is the MVP described in `Stakeholder_Tracker_App_SPEC.md` §7. Deliberately **not** built:

- No hosted sync, accounts, or shared editing (spec Phase 2 — and §11.3 says ask five organisations first).
- No cross-organisation sharing or pooled directory, ever. See the spec's §10.
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
- **Offline support needs a secure context.** Service workers require `https` or `localhost`; on a plain-http
  LAN address the app runs normally but without offline caching or the Install button.
- **All of a project's history is held in memory** while it is open. The spec's budget is thousands of change
  rows per project, not millions; that is comfortable, but it is not a warehouse.

## Licence

MIT. See [LICENSE](LICENSE).

A tool one organisation controls is fragile, and the addressable market does not support a commercial
product — so take it, fork it, rename it.
