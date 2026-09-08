/**
 * Application shell and wiring.
 *
 * Rendering rule that matters: the shell is rebuilt only when the route changes
 * (list ⇄ project). Everything else is patched in place, and the detail editor
 * is left completely alone while `state.dirty` is true. A full re-render under
 * a typing user would swallow the rationale they were halfway through writing,
 * which is precisely the kind of silent loss SPEC 6.4 is about.
 */

import * as store from "../store.js";
import { state } from "../store.js";
import {
  APP_NAME,
  APP_VERSION,
  DEPTH_BLURB,
  DEPTH_LABELS,
  DEPTH_MAP,
  DEPTH_OUTCOME,
  DEPTH_WATCH,
  REACH_HINTS,
  REACH_LABELS,
  REACH_VALUES,
  coverage,
  hasStrategy,
  looksLikeIndividual,
  makeStakeholder,
  interestBand,
  normalizeDepth,
  powerBand,
  reachLabel,
  stanceLabel,
} from "../domain.js";
import { buildExampleProject } from "../example.js";
import { backend } from "../backends/index.js";
import { renderMatrix } from "./matrix.js";
import { renderTiles, renderTable, boundaryPartnerWarning } from "./mapview.js";
import { renderLadders, renderMarkers, reflectionDialog } from "./behaviour.js";
import {
  outcomeJournalText,
  readinessDialog,
  readinessSummaryHtml,
  visionPanelHtml,
  vocabularyDialog,
} from "./outcomemap.js";
import { renderEditor } from "./editor.js";
import { renderMovement } from "./movement.js";
import { renderCoverage } from "./coverage.js";
import { renderData } from "./data.js";
import { renderProjects } from "./projects.js";
import { alertDialog, choiceDialog, confirmDialog, formDialog } from "./modal.js";
import { csvImportDialog } from "./importwizard.js";
import { buildExport, applyImportMode, describeImport, parseImport, ImportError } from "../io/json.js";
import { toCsv } from "../io/csv.js";
import { downloadBlob, downloadText, copyText, readFile, slug, stamp } from "../io/download.js";
import { svgToPngBlob, themeColours } from "../io/png.js";
import { esc, plural } from "./dom.js";
import { canInstall, isInstalled, promptInstall } from "../pwa.js";
import * as auth from "../auth.js";
import { CLOUD, LOCAL } from "../backends/index.js";
import {
  createOrganisationDialog,
  handleInviteLink,
  membersDialog,
  noOrganisationScreen,
  offerMigration,
  signInDialog,
} from "./account.js";

let root = null;
let shellKey = "";
let lastEditorKey = "";
let sort = { key: "power", dir: "desc" };
let noticeTimer = null;

export function mount(el) {
  root = el;
  store.subscribe(render);
  window.addEventListener("beforeunload", (e) => {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.selectedId && !document.querySelector("dialog[open]")) {
      closeEditor();
    }
  });
  render();
}

/* ------------------------------------------------------------------ render */

function render() {
  if (!root) return;
  // Signed in but belonging to no organisation is its own screen: dropping such
  // a user into local mode would silently store their work somewhere other than
  // where they just asked for it to go.
  const needsOrg = auth.signedIn() && !auth.session.orgId;
  const key = state.fatal
    ? "fatal"
    : !state.ready
      ? "loading"
      : needsOrg
        ? "noorg"
        : state.project
          ? "project:" + state.project.id
          : "list";
  if (key !== shellKey) {
    shellKey = key;
    lastEditorKey = "";
    root.innerHTML =
      key === "fatal"
        ? fatalShell()
        : key === "loading"
          ? loadingShell()
          : key === "noorg"
            ? orgShell()
            : key === "list"
              ? listShell()
              : projectShell();
    wireShell();
  }
  if (key === "list") renderList();
  else if (key === "noorg") renderNoOrg();
  else if (key.startsWith("project:")) renderProject();
  renderAccountBar();
  paintBanner();
}

function loadingShell() {
  return `<header class="app"><p class="eyebrow">${APP_NAME}</p><h1>Loading…</h1></header>`;
}

function fatalShell() {
  // Refusing to run is the right behaviour here. A tool whose entire promise is
  // "the record is being kept" must not accept typing it cannot store (SPEC 6.4).
  return `<header class="app"><p class="eyebrow">${APP_NAME}</p><h1>This browser cannot store your work</h1></header>
    <div class="banner err"><span>${esc(state.fatal || "")}</span></div>
    <p class="note">Shift keeps everything in this browser's own database. There is no server and no account,
      so there is nowhere else for your work to go — which is the point, but it means the app will not let you
      start typing a record it cannot actually keep.</p>
    <h2>What usually fixes it</h2>
    <ul class="note">
      <li><strong>Opened from a file on disk?</strong> Most browsers block storage for local files. Put the
        folder behind any static web server, or host <code>index.html</code> somewhere internal, and open it
        over <code>http</code> or <code>https</code>.</li>
      <li><strong>Private or incognito window?</strong> Open it in a normal window.</li>
      <li><strong>Site data blocked?</strong> Allow cookies and site data for this address, then reload.</li>
    </ul>`;
}

function orgShell() {
  return `
  <header class="app">
    <div class="topline">
      <div>
        <p class="eyebrow">Stakeholder analysis · scores, strategy and movement</p>
        <h1>${APP_NAME}</h1>
      </div>
      <div class="headtools">
        <span id="accountSlot"></span>
        <div class="themetoggle" id="themeToggle"></div>
      </div>
    </div>
    <div class="banner" id="banner" hidden></div>
  </header>
  <div id="orgBody"></div>`;
}

function renderNoOrg() {
  const host = root.querySelector("#orgBody");
  host.innerHTML = noOrganisationScreen();
  host.querySelector("#createOrg").addEventListener("click", async () => {
    const res = await createOrganisationDialog();
    if (!res.ok && res.message) return store.notify(res.message, "error");
    if (res.ok) {
      await store.reconcileMode();
      await maybeMigrate();
    }
  });
  host.querySelector("#signOutEmpty").addEventListener("click", doSignOut);
}

function listShell() {
  return `
  <header class="app">
    <div class="topline">
      <div>
        <p class="eyebrow">Stakeholder analysis · scores, strategy and movement</p>
        <h1>${APP_NAME} <span class="mark">— who moved, and what you were doing</span></h1>
      </div>
      <div class="headtools">
        <span id="accountSlot"></span>
        <span id="installSlot"></span>
        <div class="themetoggle" id="themeToggle"></div>
      </div>
    </div>
    <p class="sub">Score the actors you are trying to move on <strong>power</strong> and <strong>interest</strong>,
      write the reasoning behind each number, and name the engagement strategy you are running on each one.
      All three are versioned together, so when someone shifts you can see what you were doing at the time.</p>
    <div class="banner" id="banner" hidden></div>
  </header>
  <div id="listBody"></div>`;
}

function projectShell() {
  return `
  <header class="app">
    <div class="crumb"><button id="backToList">← All maps</button></div>
    <div class="topline">
      <div>
        <h1 id="projTitle"></h1>
        <p class="sub" id="projSub"></p>
      </div>
      <div class="headtools">
        <span id="accountSlot"></span>
        <span id="installSlot"></span>
        <div class="themetoggle" id="themeToggle"></div>
      </div>
    </div>
    <div class="banner" id="banner" hidden></div>
    <div class="tiles" id="tiles"></div>
  </header>

  <nav class="viewnav" id="viewnav" role="tablist"></nav>

  <section id="view-map">
    <div id="visionHost"></div>
    <h2>The map</h2>
    <p class="note">Colour is stance — allies, neutrals and opponents are distinguished explicitly, not inferred
      from grid position. The dashed vertical line is zero interest. A dotted trail shows movement from where a
      stakeholder started. Click a point to open it.</p>
    <div class="plotwrap">
      <svg class="matrix" id="plot" viewBox="0 0 900 540" role="img" aria-label="Power versus interest matrix"></svg>
      <div class="legend">
        <span><i class="sw" style="background:var(--ally)"></i> Ally — interest ≥ +2</span>
        <span><i class="sw" style="background:var(--neutral)"></i> Neutral — −1 to +1</span>
        <span><i class="sw" style="background:var(--oppose)"></i> Opponent — interest ≤ −2</span>
        <span>Point size = power · dotted trail = movement from baseline</span>
      </div>
    </div>

    <div class="actions">
      <button class="primary" id="addOne">Add a stakeholder</button>
      <button id="addCsv">Paste a spreadsheet…</button>
      <button id="mvToggle">Show movement only</button>
      <span class="spacer"></span>
      <button id="pngBtn">Download PNG</button>
    </div>

    <div id="bpWarn"></div>
    <div id="editor"></div>

    <h2>All stakeholders</h2>
    <p class="note">Click a row to open it. Δ columns show movement from the starting position. Click a heading to sort.</p>
    <div class="tablewrap" id="tablewrap"></div>
  </section>

  <section id="view-behaviour" hidden></section>
  <section id="view-movement" hidden></section>
  <section id="view-coverage" hidden></section>
  <section id="view-data" hidden></section>

  <footer>
    <p><strong>Movement is not attribution.</strong> The effect view shows whether a stakeholder moved <em>while</em>
      an approach was in force. It does not establish that the approach caused it. Treat it as the evidence that
      prompts the question, not the answer.</p>
    <p id="storageFootnote"></p>
  </footer>`;
}

function wireShell() {
  const on = (id, fn) => {
    const el = root.querySelector("#" + id);
    if (el) el.addEventListener("click", fn);
  };
  on("backToList", async () => {
    if (!(await confirmDiscard())) return;
    store.closeProject();
  });
  on("addOne", addStakeholderDialog);
  on("addCsv", importCsv);
  on("pngBtn", exportPng);
  on("mvToggle", () => store.setMovementOnly(!state.movementOnly));
  renderThemeToggle();
  refreshInstallButton();
}

/**
 * Offer installation only when the browser has actually said it is possible.
 * Exported so src/pwa.js can call it when `beforeinstallprompt` arrives, which
 * is usually a moment after first paint.
 */
export function refreshInstallButton() {
  if (!root) return;
  const slot = root.querySelector("#installSlot");
  if (!slot) return;
  if (!canInstall() || isInstalled()) {
    slot.innerHTML = "";
    return;
  }
  slot.innerHTML = `<button class="small" id="installBtn" title="Install Shift as an app — it gets its own window and works offline">Install app</button>`;
  slot.querySelector("#installBtn").addEventListener("click", async () => {
    const outcome = await promptInstall();
    refreshInstallButton();
    if (outcome === "accepted") {
      store.notify("Installed. Shift now has its own window and works offline — your maps stay in this browser profile.", "good");
    }
  });
}

/**
 * The account bar, and the mode indicator beside it.
 *
 * The chip is not decoration. Someone typing an adverse assessment of a named
 * regulator must be able to tell at a glance whether it is going into their
 * organisation's shared database or staying in this browser.
 */
function renderAccountBar() {
  const slot = root.querySelector("#accountSlot");
  if (!slot) return;

  if (!state.cloudAvailable) {
    slot.innerHTML = `<span class="chip" title="This build has no hosted backend configured, so everything stays in this browser.">This browser only</span>`;
    return;
  }

  if (!auth.signedIn()) {
    slot.innerHTML =
      `<span class="chip warn" title="Not signed in — maps are stored in this browser and nobody else can see them.">This browser only</span>` +
      `<button class="small" id="signInBtn">Sign in</button>`;
    slot.querySelector("#signInBtn").addEventListener("click", doSignIn);
    return;
  }

  const orgs = auth.session.orgs;
  const active = auth.activeOrg();
  const picker =
    orgs.length > 1
      ? `<select id="orgPick" style="width:auto" title="Switch organisation">${orgs
          .map((o) => `<option value="${esc(o.id)}" ${o.id === auth.session.orgId ? "selected" : ""}>${esc(o.name)}</option>`)
          .join("")}</select>`
      : `<span class="chip" style="color:var(--ally);border-color:var(--ally)" title="Maps are stored in this organisation and visible to its members.">${esc(active ? active.name : "")}</span>`;

  slot.innerHTML = `${picker}
    <button class="small" id="teamBtn" title="Members and invites">Team</button>
    <button class="ghost small" id="signOutBtn" title="${esc(auth.session.user.email)}">Sign out</button>`;

  const pick = slot.querySelector("#orgPick");
  if (pick)
    pick.addEventListener("change", async () => {
      if (!(await confirmDiscard())) {
        pick.value = auth.session.orgId;
        return;
      }
      auth.setActiveOrg(pick.value);
      await store.reconcileMode();
    });
  slot.querySelector("#teamBtn").addEventListener("click", async () => {
    const o = auth.activeOrg();
    if (!o) return;
    await membersDialog(o.id, o.name);
    await store.reconcileMode();
  });
  slot.querySelector("#signOutBtn").addEventListener("click", doSignOut);
}

async function doSignIn() {
  if (!(await confirmDiscard())) return;
  const ok = await signInDialog("signin");
  if (!ok) return;
  await store.reconcileMode();
  if (auth.signedIn() && !auth.session.orgId) return; // the no-org screen takes over
  await maybeMigrate();
}

async function doSignOut() {
  if (!(await confirmDiscard())) return;
  const ok = await confirmDialog({
    title: "Sign out?",
    body: `<p class="note">Your organisation's maps stay on the server. Any maps stored only in this
      browser remain here and will be available again next time.</p>`,
    confirmLabel: "Sign out",
  });
  if (!ok) return;
  await auth.signOut();
  await store.reconcileMode();
  store.notify("Signed out. You are back to maps stored in this browser only.", "info");
}

/** Offer to copy browser-held maps into the organisation, once per session. */
let migrationOffered = false;
async function maybeMigrate() {
  if (migrationOffered) return;
  const org = auth.activeOrg();
  if (!org) return;
  migrationOffered = true;
  const res = await offerMigration(org.name, (payload) => backend().importProject(payload));
  if (res.moved > 0) {
    await store.reconcileMode();
    store.notify(`Copied ${plural(res.moved, "map")} into ${org.name}. The browser copies are still here too.`, "good");
  }
}

function renderThemeToggle() {
  const host = root.querySelector("#themeToggle");
  if (!host) return;
  const opts = [
    ["light", "Light"],
    ["dark", "Dark"],
    ["system", "Auto"],
  ];
  host.innerHTML = opts
    .map(([v, l]) => `<button data-theme-set="${v}" class="${state.theme === v ? "on" : ""}">${l}</button>`)
    .join("");
  for (const b of host.querySelectorAll("[data-theme-set]")) {
    b.addEventListener("click", () => store.setTheme(b.dataset.themeSet));
  }
}

/* -------------------------------------------------------------------- list */

function renderList() {
  renderThemeToggle();
  renderProjects(
    root.querySelector("#listBody"),
    state.projects,
    { onNew: newProjectDialog, onOpen: (id) => store.openProject(id), onExample: loadExample, onImport: importJson },
    {
      mode: state.mode,
      orgName: auth.activeOrg() ? auth.activeOrg().name : null,
      cloudAvailable: state.cloudAvailable,
    }
  );
}

/* ----------------------------------------------------------------- project */

function renderProject() {
  const p = state.project;
  const list = state.stakeholders;
  renderThemeToggle();

  root.querySelector("#projTitle").textContent = p.name;
  const sub = root.querySelector("#projSub");
  const cov = coverage(list);
  sub.innerHTML =
    (p.description ? esc(p.description) + " " : "") +
    `<strong>${plural(list.length, "stakeholder")}</strong>` +
    (list.length ? `, ${cov.withStrategy} with an engagement strategy.` : ".") +
    (p.scaleNote ? ` <span style="color:var(--muted)">${esc(p.scaleNote)}</span>` : "");

  renderTiles(root.querySelector("#tiles"), list, (view) => store.setView(view));
  renderViewNav();

  const foot = root.querySelector("#storageFootnote");
  if (foot) {
    const org = auth.activeOrg();
    foot.innerHTML =
      state.mode === CLOUD
        ? `<strong>Stored in ${esc(org ? org.name : "your organisation")}.</strong> Visible to everyone in that
           organisation and to nobody else. Recorded history is append-only in the database — it cannot be
           edited or deleted, by anyone.`
        : `<strong>Stored in this browser only.</strong> No account, no server, nothing uploaded. That also
           means clearing site data destroys it. Export from the <em>Data</em> tab regularly.`;
  }

  const show = (id, on) => {
    const el = root.querySelector(id);
    if (el) el.hidden = !on;
  };
  show("#view-map", state.view === "map");
  show("#view-behaviour", state.view === "behaviour");
  show("#view-movement", state.view === "movement");
  show("#view-coverage", state.view === "coverage");
  show("#view-data", state.view === "data");

  // The map stays in the DOM whatever view is active, so PNG export works from
  // anywhere and the SVG does not have to be re-laid-out on every tab change.
  renderMatrix(root.querySelector("#plot"), list, state.selectedId, selectStakeholder);
  renderTable(root.querySelector("#tablewrap"), list, {
    selectedId: state.selectedId,
    sort,
    movementOnly: state.movementOnly,
    onSelect: selectStakeholder,
    onSort: (key) => {
      sort = sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "type" ? "asc" : "desc" };
      store.emit();
    },
  });
  const mv = root.querySelector("#mvToggle");
  if (mv) mv.textContent = state.movementOnly ? "Show all" : "Show movement only";

  const bpw = root.querySelector("#bpWarn");
  if (bpw) bpw.innerHTML = normalizeDepth(p.depth) >= DEPTH_OUTCOME ? boundaryPartnerWarning(list) : "";

  const vh = root.querySelector("#visionHost");
  if (vh) {
    vh.innerHTML = normalizeDepth(p.depth) >= DEPTH_OUTCOME ? visionPanelHtml(p) : "";
    const ev = vh.querySelector("#editVision");
    if (ev) ev.addEventListener("click", visionDialog);
  }

  renderDetail();

  if (state.view === "behaviour") {
    renderLadders(root.querySelector("#view-behaviour"), {
      stakeholders: list,
      depth: normalizeDepth(p.depth),
      markersFor: store.markersFor,
      observationsForStakeholder: store.observationsForStakeholder,
      cycles: state.cycles,
      onSelect: selectAndOpenBehaviour,
      onReflect: runReflection,
    });
  }
  if (state.view === "movement") {
    renderMovement(root.querySelector("#view-movement"), list, store.changesFor, selectAndOpenMap);
  }
  if (state.view === "coverage") {
    renderCoverage(root.querySelector("#view-coverage"), list, store.changesFor, selectAndOpenMap, {
      depth: normalizeDepth(p.depth),
      markersFor: store.markersFor,
      observationsForStakeholder: store.observationsForStakeholder,
    });
  }
  if (state.view === "data") {
    renderData(root.querySelector("#view-data"), {
      project: p,
      stakeholders: list,
      changeCount: store.allChanges().length,
      mode: state.mode,
      orgName: auth.activeOrg() ? auth.activeOrg().name : null,
      onExportJson: exportJson,
      onCopyJson: copyJson,
      onExportCsv: exportCsv,
      onExportPng: exportPng,
      onImportCsv: importCsv,
      onImportJson: importJson,
      onEditProject: editProjectDialog,
      onDeleteProject: deleteProjectDialog,
      depthExtras:
        normalizeDepth(p.depth) >= DEPTH_OUTCOME
          ? {
              readinessHtml: readinessSummaryHtml(p.readiness),
              onReadiness: async () => {
                const res = await readinessDialog(state.project.readiness);
                if (res && res.scores) {
                  await store.updateProject({ readiness: res.scores });
                  store.notify("Readiness recorded with the map.", "good");
                }
              },
              onVocabulary: async () => {
                const v = await vocabularyDialog(state.project.vocabulary);
                if (v) {
                  await store.updateProject({ vocabulary: v });
                  store.notify("Vocabulary saved. It applies wherever those terms appear.", "good");
                }
              },
              onVision: visionDialog,
              onJournal: exportJournal,
            }
          : null,
    });
  }
}

function renderViewNav() {
  const nav = root.querySelector("#viewnav");
  const list = state.stakeholders;
  const cov = coverage(list);
  const movedCount = list.filter((s) => s.baseline && (s.baseline.power !== s.power || s.baseline.interest !== s.interest)).length;
  const gaps = cov.noStrategy.length + cov.quadrantLabel.length + cov.noRationale.length;

  const depth = normalizeDepth(state.project.depth);
  const items = [["map", "Map", list.length]];
  if (depth >= DEPTH_WATCH) {
    const observedNow = list.reduce((n, s) => n + store.liveMarkersFor(s.id).length, 0);
    items.push(["behaviour", "Behaviour", observedNow]);
  }
  items.push(["movement", "Movement", movedCount], ["coverage", "Coverage", gaps], ["data", "Data", null]);
  nav.innerHTML = items
    .map(
      ([v, label, count]) =>
        `<button data-view="${v}" role="tab" aria-selected="${state.view === v}" class="${state.view === v ? "on" : ""}">${label}${
          count == null ? "" : `<span class="count">${count}</span>`
        }</button>`
    )
    .join("");
  for (const b of nav.querySelectorAll("[data-view]")) {
    b.addEventListener("click", async () => {
      if (!(await confirmDiscard())) return;
      store.setView(b.dataset.view);
    });
  }
}

/* ------------------------------------------------------------------ detail */

function renderDetail() {
  const host = root.querySelector("#editor");
  if (!host) return;
  const d = store.selected();
  if (!d) {
    if (host.innerHTML) host.innerHTML = "";
    lastEditorKey = "";
    return;
  }
  const key = [
    d.id,
    state.detailTab,
    d.updatedAt || "",
    d.power,
    d.interest,
    d.name,
    d.reach,
    (store.changesFor(d.id) || []).length,
    store.markersFor(d.id).length,
    store.observationsForStakeholder(d.id).length,
  ].join("|");
  if (state.dirty && key === lastEditorKey) return; // never clobber live typing
  lastEditorKey = key;

  const depth = normalizeDepth(state.project.depth);
  renderEditor(host, {
    stakeholder: d,
    changes: store.changesFor(d.id),
    depth,
    markers: store.markersFor(d.id),
    reachableNames: (d.reachableVia || [])
      .map((id) => (state.stakeholders.find((x) => x.id === id) || {}).name)
      .filter(Boolean),
    onMarkers: (bodyHost) => renderMarkerPane(bodyHost, d),
    onStrategyMap: (map) => store.updateStrategyMap(d.id, map),
    tab: state.detailTab,
    onTab: (t) => {
      store.setDirty(false);
      lastEditorKey = "";
      store.setDetailTab(t);
    },
    onDirty: (v) => store.setDirty(v),
    onSave: async (next, note) => {
      const res = await store.commit(d.id, next, note);
      if (res.ok && !res.noop) store.notify("Change recorded.", "good");
      return res;
    },
    onClose: closeEditor,
    onDelete: () => deleteStakeholderDialog(d),
    onIdentity: () => identityDialog(d),
  });
}

/** Wires the Behaviour tab inside the stakeholder editor. */
function renderMarkerPane(host, d) {
  const rerender = () => {
    lastEditorKey = "";
    renderDetail();
  };
  renderMarkers(host, {
    stakeholder: d,
    markers: store.markersFor(d.id),
    observations: store.observationsForStakeholder(d.id),
    depth: normalizeDepth(state.project.depth),
    onAdd: async (fields) => {
      const res = await store.addMarker(d.id, fields);
      if (!res.ok && res.message) store.notify(res.message, "error");
      rerender();
    },
    onUpdate: async (id, fields) => {
      await store.updateMarker(id, fields);
      rerender();
    },
    onToggleWatch: async (id, watched) => {
      await store.setMarkerWatched(id, watched);
      rerender();
    },
    onRetire: async (id) => {
      await store.retireMarker(id);
      rerender();
    },
    onRestore: async (id) => {
      await store.restoreMarker(id);
      rerender();
    },
    onDelete: async (id) => {
      const res = await store.deleteMarker(id);
      if (!res.ok && res.message) store.notify(res.message, "error");
      rerender();
    },
  });
}

async function runReflection() {
  if (!(await confirmDiscard())) return;
  const result = await reflectionDialog({
    stakeholders: state.stakeholders,
    markersFor: store.markersFor,
    observationsForStakeholder: store.observationsForStakeholder,
    cycles: state.cycles,
  });
  if (!result) return;
  const res = await store.commitCycle(result.cycle, result.entries);
  if (res.ok) {
    store.notify(
      `${result.cycle.label} recorded — ${plural(res.count, "behaviour")} reviewed. Each entry is append-only; a correction is a new review.`,
      "good"
    );
  } else if (res.message) {
    store.notify(res.message, "error");
  }
}

async function selectAndOpenBehaviour(id) {
  if (!(await confirmDiscard())) return;
  store.setDirty(false);
  lastEditorKey = "";
  store.state.view = "map";
  store.state.detailTab = "behaviour";
  store.select(id, { force: true });
  requestAnimationFrame(() => {
    const card = root.querySelector("#editorCard");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

async function selectStakeholder(id) {
  if (!(await confirmDiscard())) return;
  store.setDirty(false);
  lastEditorKey = "";
  store.select(id, { force: true });
  const card = root.querySelector("#editorCard");
  if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function selectAndOpenMap(id) {
  if (!(await confirmDiscard())) return;
  store.setDirty(false);
  lastEditorKey = "";
  store.state.view = "map";
  store.select(id, { force: true });
  requestAnimationFrame(() => {
    const card = root.querySelector("#editorCard");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function closeEditor() {
  store.setDirty(false);
  lastEditorKey = "";
  store.select(null, { force: true });
}

async function confirmDiscard() {
  if (!state.dirty) return true;
  const ok = await confirmDialog({
    title: "Discard unsaved changes?",
    body: `<p class="note">You have edits in the open stakeholder that have not been recorded. Leaving now
      discards them — nothing has been written to the history.</p>`,
    confirmLabel: "Discard them",
    danger: true,
  });
  if (ok) store.setDirty(false);
  return ok;
}

/* ------------------------------------------------------------------ banner */

function paintBanner() {
  const b = root.querySelector("#banner");
  if (!b) return;
  const n = state.notice;
  if (!n) {
    b.hidden = true;
    b.innerHTML = "";
    return;
  }
  b.hidden = false;
  b.className = "banner" + (n.kind === "error" ? " err" : n.kind === "good" ? " good" : "");
  b.innerHTML = `<span>${esc(n.text)}</span><button class="small" id="dismissNotice">Dismiss</button>`;
  b.querySelector("#dismissNotice").addEventListener("click", () => store.clearNotice());

  clearTimeout(noticeTimer);
  // Errors stay until dismissed — SPEC 6.4 wants failures said loudly, not flashed.
  if (n.kind !== "error") noticeTimer = setTimeout(() => store.clearNotice(), 5000);
}

/* ----------------------------------------------------------------- actions */

async function newProjectDialog() {
  const v = await formDialog({
    title: "New map",
    intro: "One map is one question — a campaign, a jurisdiction, a piece of legislation. Keep the scope tight enough that the same actors matter throughout.",
    submitLabel: "Create map",
    fields: [
      { key: "name", label: "Name", required: true, placeholder: "e.g. Poultry welfare standards — national" },
      {
        key: "description",
        label: "What is this map for",
        type: "textarea",
        rows: 2,
        hint: "One sentence. It appears under the title and in exports.",
      },
      {
        key: "scaleNote",
        label: "Scoring convention",
        type: "textarea",
        rows: 2,
        hint: "What power and interest mean for THIS map. Writing it down now stops the scores drifting later.",
        value: "Power 0–10 over whether this succeeds. Interest −10 to +10 on this specific objective, not on the issue generally.",
      },
      {
        key: "depth",
        label: "How much measurement machinery?",
        type: "select",
        value: String(DEPTH_MAP),
        hint: DEPTH_BLURB[DEPTH_MAP],
        options: [DEPTH_MAP, DEPTH_WATCH, DEPTH_OUTCOME].map((d) => ({
          value: String(d),
          label: DEPTH_LABELS[d],
        })),
      },
    ],
    onInput: (v, dlg) => {
      const f = dlg.querySelector("#f-depth");
      if (!f) return;
      const hint = f.closest("fieldset").querySelector(".fhint");
      if (hint) hint.textContent = DEPTH_BLURB[normalizeDepth(v.depth)];
    },
  });
  if (!v) return;
  await store.createProject({ ...v, depth: normalizeDepth(v.depth) });
}

async function editProjectDialog() {
  const p = state.project;
  const v = await formDialog({
    title: "Map details",
    submitLabel: "Save",
    fields: [
      { key: "name", label: "Name", required: true, value: p.name },
      { key: "description", label: "What is this map for", type: "textarea", rows: 2, value: p.description },
      { key: "scaleNote", label: "Scoring convention", type: "textarea", rows: 2, value: p.scaleNote },
      {
        key: "depth",
        label: "How much measurement machinery?",
        type: "select",
        value: String(normalizeDepth(p.depth)),
        hint: DEPTH_BLURB[normalizeDepth(p.depth)],
        options: [DEPTH_MAP, DEPTH_WATCH, DEPTH_OUTCOME].map((d) => ({ value: String(d), label: DEPTH_LABELS[d] })),
      },
    ],
    onInput: (v, dlg) => {
      const f = dlg.querySelector("#f-depth");
      if (!f) return;
      const hint = f.closest("fieldset").querySelector(".fhint");
      if (hint) hint.textContent = DEPTH_BLURB[normalizeDepth(v.depth)];
    },
  });
  if (!v) return;
  const nextDepth = normalizeDepth(v.depth);
  const wasDepth = normalizeDepth(p.depth);
  await store.updateProject({ ...v, depth: nextDepth });

  // Raising a map to a full outcome map is the moment to ask whether this
  // organisation can sustain one. It warns loudly; it never blocks.
  if (nextDepth === DEPTH_OUTCOME && wasDepth < DEPTH_OUTCOME) {
    const res = await readinessDialog(state.project.readiness);
    if (res && res.scores) {
      await store.updateProject({ readiness: res.scores });
      if (res.recommendedDepth && res.recommendedDepth < DEPTH_OUTCOME) {
        store.notify(
          "Scorecard saved. It recommends " +
            DEPTH_LABELS[res.recommendedDepth] +
            " rather than a full outcome map. The map is still set to Outcome map — that is your call to keep or change.",
          "error"
        );
      } else {
        store.notify("Readiness recorded with the map.", "good");
      }
    }
  }
}

async function visionDialog() {
  const p = state.project;
  const v = await formDialog({
    title: "Vision and mission",
    intro:
      "Not what you plan to do. What the world looks like if you and everyone else working on this succeeds — it should be bigger than you, which is the point.",
    submitLabel: "Save",
    fields: [
      {
        key: "vision",
        label: "Vision",
        type: "textarea",
        rows: 5,
        value: p.vision,
        hint: "The change in the world, beyond this organisation. Imagine it granted, then describe what an ordinary Tuesday looks like.",
      },
      {
        key: "mission",
        label: "Mission",
        type: "textarea",
        rows: 4,
        value: p.mission,
        hint: "Your lane inside that vision. The territory, not the activity list.",
      },
    ],
  });
  if (!v) return;
  await store.updateProject(v);
}

/** One review, as plain text for the meeting it will be read in. */
async function exportJournal() {
  const cycles = state.cycles;
  if (!cycles.length) {
    return alertDialog({
      title: "No reviews yet",
      body: `<p class="note">Run a reflection cycle from the <strong>Behaviour</strong> tab first. The journal is
        the record that cycle produces.</p>`,
    });
  }
  const pick =
    cycles.length === 1
      ? { cycle: cycles[0].id }
      : await formDialog({
          title: "Which review?",
          submitLabel: "Download",
          fields: [
            {
              key: "cycle",
              label: "Review",
              type: "select",
              value: cycles[0].id,
              options: cycles.map((c) => ({ value: c.id, label: c.label })),
            },
          ],
        });
  if (!pick) return;

  const cycle = cycles.find((c) => c.id === pick.cycle);
  if (!cycle) return;
  const entries = store.allObservations().filter((o) => o.cycleId === cycle.id);
  const names = new Map(state.stakeholders.map((s) => [s.id, s.name]));
  const markers = new Map(store.allMarkers().map((m) => [m.id, m.text]));

  const text = outcomeJournalText({
    project: state.project,
    cycle,
    entries,
    stakeholderName: (id) => names.get(id),
    markerText: (id) => markers.get(id),
  });
  const name = `${slug(state.project.name)}-journal-${slug(cycle.label)}.txt`;
  downloadText(text, name, "text/plain;charset=utf-8");
  store.notify(`Saved ${name}.`, "good");
}

async function deleteProjectDialog() {
  const p = state.project;
  const n = state.stakeholders.length;
  const c = store.allChanges().length;
  const ok = await confirmDialog({
    title: `Delete “${p.name}”?`,
    body: `<p class="note">This removes ${plural(n, "stakeholder")} and ${plural(c, "recorded change")} permanently.
      There is no copy on a server and no undo.</p>
      <p class="note"><strong>Export first if you might want it back.</strong></p>`,
    confirmLabel: "Delete permanently",
    danger: true,
  });
  if (!ok) return;
  await store.deleteProject(p.id);
  store.notify("Map deleted.", "info");
}

async function addStakeholderDialog() {
  const v = await formDialog({
    title: "Add a stakeholder",
    intro:
      "Score what you know. An actor nobody has spoken to should be scored neutral with the rationale saying so — that is honest, and it is the entry most likely to move later.",
    submitLabel: "Add",
    fields: [
      { key: "name", label: "Name", required: true, placeholder: "The specific body or role — not “local NGOs”" },
      {
        key: "type",
        label: "Type",
        placeholder: "Regulator · Ministry · Industry body · Civil society · Academic · Funder …",
        hint: "Free text — use your own vocabulary.",
      },
      {
        key: "reach",
        label: "What kind of relationship is this?",
        type: "select",
        value: "partner",
        hint: "Separate from whether they agree with you. A supplier you speak to weekly and score −6 is still a partner.",
        options: REACH_VALUES.map((v) => ({ value: v, label: REACH_LABELS[v] })),
      },
      { key: "power", label: "Power — 0 to 10", type: "range", min: 0, max: 10, value: 5 },
      { key: "interest", label: "Interest — −10 to +10 · negative means opposed", type: "range", min: -10, max: 10, value: 0 },
      {
        key: "rationale",
        label: "Rationale",
        type: "textarea",
        rows: 3,
        hint: "What evidence produced these numbers, and why they are not higher or lower.",
        placeholder: "e.g. No contact yet — assumed neutral. Included because they are the only body that can license the sites.",
      },
      {
        key: "isIndividual",
        type: "checkbox",
        label: "This is a named individual, not an organisation",
        hint: "Flags it for the data-protection obligations that attach to a written assessment of an identifiable person.",
      },
    ],
    onInput: (v, dlg) => {
      const bp = dlg.querySelector("#f-power-band");
      const bi = dlg.querySelector("#f-interest-band");
      if (bp) bp.textContent = powerBand(v.power);
      if (bi) bi.textContent = interestBand(v.interest);
      const reachHint = dlg.querySelector("#f-reach");
      if (reachHint) {
        const holder = reachHint.closest("fieldset").querySelector(".fhint");
        if (holder) holder.textContent = REACH_HINTS[v.reach] || "";
      }
      const chk = dlg.querySelector("#f-isIndividual");
      // Suggest the flag once, from the name — but never override the user.
      if (chk && !chk.dataset.touched && looksLikeIndividual(v.name)) chk.checked = true;
      if (chk && !chk.dataset.bound) {
        chk.dataset.bound = "1";
        chk.addEventListener("change", () => (chk.dataset.touched = "1"));
      }
    },
  });
  if (!v) return;
  const res = await store.addStakeholder(v);
  if (!res.ok && res.message) store.notify(res.message, "error");
}

async function identityDialog(d) {
  const others = state.stakeholders.filter((x) => x.id !== d.id);
  const v = await formDialog({
    title: "Rename stakeholder",
    intro:
      "Name, type and triage are not versioned — only power, interest, rationale and strategy are. Changing them does not create a history entry.",
    submitLabel: "Save",
    fields: [
      { key: "name", label: "Name", required: true, value: d.name },
      { key: "type", label: "Type", value: d.type },
      {
        key: "reach",
        label: "What kind of relationship is this?",
        type: "select",
        value: d.reach || "partner",
        hint: REACH_HINTS[d.reach || "partner"],
        options: REACH_VALUES.map((r) => ({ value: r, label: REACH_LABELS[r] })),
      },
      ...(others.length
        ? [
            {
              key: "reachableVia",
              label: "Who can reach them",
              type: "select",
              value: (d.reachableVia || [])[0] || "",
              hint: "Only used when they are out of reach. The manual's instruction is to work out who you can influence who will in turn influence them.",
              options: [{ value: "", label: "— nobody recorded —" }, ...others.map((o) => ({ value: o.id, label: o.name }))],
            },
          ]
        : []),
      { key: "isIndividual", type: "checkbox", label: "This is a named individual, not an organisation", value: d.isIndividual },
    ],
  });
  if (!v) return;
  if (v.reachableVia !== undefined) v.reachableVia = v.reachableVia ? [v.reachableVia] : [];
  lastEditorKey = "";
  const res = await store.updateStakeholderIdentity(d.id, v);
  if (!res.ok && res.message) store.notify(res.message, "error");
}

async function deleteStakeholderDialog(d) {
  const n = (store.changesFor(d.id) || []).length;
  const ok = await confirmDialog({
    title: `Delete “${d.name}”?`,
    body: `<p class="note">This removes the stakeholder and ${plural(n, "recorded change")} of history.
      History is append-only precisely so that a record cannot quietly vanish, so this is the one
      irreversible thing in the app. If you only want them off the map, consider scoring their power to 0
      and saying why in the rationale — that keeps the record.</p>`,
    confirmLabel: "Delete permanently",
    danger: true,
  });
  if (!ok) return;
  lastEditorKey = "";
  await store.deleteStakeholder(d.id);
  store.notify(`“${d.name}” deleted.`, "info");
}

/* ------------------------------------------------------------------ import */

async function importCsv() {
  const records = await csvImportDialog();
  if (!records || !records.length) return;
  const res = await store.addStakeholdersBulk(records);
  if (res.ok) store.notify(`Imported ${plural(res.count, "stakeholder")}.`, "good");
  else if (res.message) store.notify(res.message, "error");
}

async function importJson() {
  const text = await pickJsonText();
  if (text == null) return;

  let parsed;
  try {
    parsed = parseImport(text);
  } catch (e) {
    await alertDialog({
      title: "That file could not be read",
      body: `<p class="note">${esc(e instanceof ImportError ? e.message : "Unexpected error reading that file.")}</p>`,
    });
    return;
  }

  const info = describeImport(parsed);
  const clash = state.projects.some((p) => p.id === parsed.project.id);

  const summary = `<div class="kv" style="margin-bottom:12px">
        <div><span>Source</span><span>${info.source === "shift" ? "Shift export" : "stakeholder-matrix skill"}</span></div>
        <div><span>Stakeholders</span><span>${info.stakeholders}</span></div>
        <div><span>With a strategy</span><span>${info.withStrategy}</span></div>
        <div><span>History entries</span><span>${info.changes}</span></div>
      </div>
      <p class="note">Nothing is uploaded. The file is read in your browser.</p>`;

  let payload;
  if (clash) {
    // Three real outcomes, so three buttons. Escape means cancel, nothing else.
    const choice = await choiceDialog({
      title: `You already have “${info.projectName}”`,
      body:
        summary +
        `<p class="warnline" style="display:block"><strong>A map with this identity is already stored.</strong>
         Replacing overwrites it, including its recorded history — that history cannot be recovered afterwards.
         Importing as a copy keeps both, and gives the copy fresh identifiers.</p>`,
      options: [
        { key: "cancel", label: "Cancel", cancel: true },
        { key: "replace", label: "Replace the existing map", danger: true },
        { key: "copy", label: "Import as a copy", primary: true },
      ],
    });
    if (!choice) return;
    payload = applyImportMode(parsed, choice);
  } else {
    const ok = await confirmDialog({
      title: `Import “${info.projectName}”?`,
      body: summary,
      confirmLabel: "Import",
    });
    if (!ok) return;
    payload = applyImportMode(parsed, "replace");
  }

  try {
    await backend().importProject(payload);
  } catch (e) {
    store.notify(e.message || "The import failed and nothing was saved.", "error");
    return;
  }
  await store.refreshAfterImport(payload.project.id);
  store.notify(`Imported ${plural(payload.stakeholders.length, "stakeholder")} with ${plural(payload.changes.length, "history entry", "history entries")}.`, "good");
}

function pickJsonText() {
  return new Promise((resolve) => {
    formDialog({
      title: "Import a JSON export",
      intro: "Choose a file, or paste the JSON. Reads a Shift export or a stakeholder-matrix “Export everything” dump.",
      submitLabel: "Read it",
      fields: [{ key: "text", label: "JSON", type: "textarea", rows: 8, placeholder: '{ "format": "shift.project", … }' }],
      extraHtml: `<div class="actions tight">
        <input type="file" id="jsonFile" accept=".json,application/json" class="sr-only">
        <button type="button" id="jsonPick">Choose a file…</button>
        <span class="status" id="jsonName"></span></div>`,
      onInput: (_v, dlg) => {
        const pick = dlg.querySelector("#jsonPick");
        if (pick && !pick.dataset.bound) {
          pick.dataset.bound = "1";
          pick.addEventListener("click", () => dlg.querySelector("#jsonFile").click());
          dlg.querySelector("#jsonFile").addEventListener("change", async (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            dlg.querySelector("#f-text").value = await readFile(f);
            dlg.querySelector("#jsonName").textContent = f.name;
          });
        }
      },
    }).then((v) => resolve(v ? v.text : null));
  });
}

async function loadExample() {
  const payload = buildExampleProject();
  try {
    await backend().importProject(payload);
  } catch (e) {
    store.notify(e.message || "Could not create the example map.", "error");
    return;
  }
  await store.refreshAfterImport(payload.project.id);
  store.notify("Example map loaded. Everything in it is invented — delete it whenever you like.", "info");
}

/* ------------------------------------------------------------------ export */

function exportPayload() {
  return buildExport({
    project: state.project,
    stakeholders: state.stakeholders,
    changesFor: store.changesFor,
    markers: store.allMarkers(),
    observations: store.allObservations(),
    cycles: state.cycles,
    appVersion: APP_VERSION,
  });
}

function exportJson() {
  const name = `${slug(state.project.name)}-${stamp()}.json`;
  downloadText(JSON.stringify(exportPayload(), null, 2), name, "application/json");
  store.notify(`Saved ${name}.`, "good");
}

async function copyJson() {
  const ok = await copyText(JSON.stringify(exportPayload(), null, 2));
  store.notify(ok ? "Full export copied to the clipboard." : "Could not reach the clipboard — use Download instead.", ok ? "good" : "error");
}

function exportCsv() {
  const name = `${slug(state.project.name)}-${stamp()}.csv`;
  downloadText(toCsv(state.stakeholders, { stanceLabelOf: (i) => stanceLabel(stanceOfSafe(i)) }), name, "text/csv;charset=utf-8");
  store.notify(`Saved ${name}.`, "good");
}

function stanceOfSafe(i) {
  return i >= 2 ? "ally" : i <= -2 ? "oppose" : "neutral";
}

async function exportPng() {
  const svg = root.querySelector("#plot");
  if (!svg) return;
  try {
    const colours = themeColours();
    const blob = await svgToPngBlob(svg, {
      scale: 2,
      background: colours.background,
      ink: colours.ink,
      muted: colours.muted,
      rule: colours.rule,
      title: state.project.name,
      subtitle: `${plural(state.stakeholders.length, "stakeholder")} · power × interest · exported ${new Date().toLocaleDateString()} · movement shown as dotted trails from baseline`,
    });
    downloadBlob(blob, `${slug(state.project.name)}-map-${stamp()}.png`);
    store.notify("Map saved as a PNG.", "good");
  } catch (e) {
    store.notify(e.message || "Could not render the PNG in this browser.", "error");
  }
}

export { hasStrategy, makeStakeholder };
