/**
 * Application state and the actions that mutate it.
 *
 * The contract with the UI: nothing in here changes in-memory state until the
 * corresponding IndexedDB transaction has committed (SPEC 6.4). Every action
 * returns `{ok:true}` or `{ok:false, message}` and never throws at the caller.
 */

import { backend, backendMode, setBackendMode, LOCAL, CLOUD } from "./backends/index.js";
import { initAuth, onAuthChange, session as auth } from "./auth.js";
import { cloudConfigured } from "./supabaseClient.js";
import {
  changedFields,
  makeCycle,
  makeMarker,
  makeObservation,
  makeProject,
  makeStakeholder,
  newId,
  normalizeDepth,
  normalizeReach,
  normalizeStrategy,
  normalizeStrategyMap,
  setActiveVocabulary,
  nowISO,
  clampPower,
  clampInterest,
  sortChangesDescending,
} from "./domain.js";

const listeners = new Set();

export const state = {
  ready: false,
  /** Fatal storage problem — the app is unusable and must say so. */
  fatal: null,
  /** Transient message shown in the banner: {text, kind:"info"|"error"|"good"}. */
  notice: null,

  projects: [],
  project: null,
  stakeholders: [],
  /** stakeholderId -> Change[] (unsorted; sort at read time). */
  changes: new Map(),
  /** stakeholderId -> Marker[] */
  markers: new Map(),
  /** markerId -> Observation[] */
  observations: new Map(),
  /** Cycle[], newest first. */
  cycles: [],

  /** id of the open stakeholder, or null. */
  selectedId: null,
  /** which tab of the detail editor: score | strategy | effect | history */
  detailTab: "score",
  /** which top-level panel: map | movement | coverage | data */
  view: "map",
  /** the editor has unsaved input */
  dirty: false,
  /** table filter */
  movementOnly: false,
  theme: "system",
  /** "local" (this browser only) or "cloud" (signed in, per organisation). */
  mode: LOCAL,
  /** true once the auth layer has settled, so the UI does not flash a signed-out state. */
  authReady: false,
  cloudAvailable: false,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit() {
  for (const fn of listeners) fn(state);
}

export function notify(text, kind = "info") {
  state.notice = text ? { text, kind } : null;
  emit();
}

export function clearNotice() {
  if (state.notice) {
    state.notice = null;
    emit();
  }
}

/* --------------------------------------------------------------- lifecycle */

export async function init() {
  state.cloudAvailable = cloudConfigured();

  // Auth first: it decides which backend we are about to open.
  await initAuth();
  state.authReady = true;
  onAuthChange(() => {
    void reconcileMode();
  });

  state.theme = (await safeMeta("theme", "system")) || "system";
  applyTheme(state.theme);

  await reconcileMode({ initial: true });
}

/**
 * Point the app at the right backend for the current auth state, and reload.
 *
 * Signed in with an organisation selected -> cloud. Anything else -> local.
 * Called on startup and whenever sign-in, sign-out or an org switch happens.
 */
export async function reconcileMode({ initial = false } = {}) {
  const wanted = auth.user && auth.orgId ? CLOUD : LOCAL;
  const changed = wanted !== backendMode();
  setBackendMode(wanted);
  state.mode = wanted;

  if (changed || initial) {
    state.project = null;
    state.stakeholders = [];
    state.changes = new Map();
    clearBehaviour();
    state.selectedId = null;
    state.dirty = false;
  }

  if (wanted === LOCAL) {
    try {
      await backend().openDb();
      state.fatal = null;
    } catch (e) {
      // Only fatal for local mode; cloud mode does not need IndexedDB at all.
      state.fatal = e.message;
      state.ready = true;
      emit();
      return;
    }
    backend().requestPersistence();
  } else {
    state.fatal = null;
  }

  try {
    state.projects = await backend().listProjects();
  } catch (e) {
    state.projects = [];
    notify(e.message || "Could not load your maps.", "error");
  }

  const last = await safeMeta("lastProjectId", null);
  state.ready = true;

  if (last && state.projects.some((p) => p.id === last)) {
    await openProject(last);
  } else {
    emit();
  }
}

async function safeMeta(key, fallback) {
  try {
    return await backend().getMeta(key, fallback);
  } catch (e) {
    return fallback;
  }
}

export function setTheme(theme) {
  state.theme = theme;
  applyTheme(theme);
  backend().setMeta("theme", theme);
  emit();
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/* ---------------------------------------------------------------- projects */

export async function createProject(fields) {
  const project = makeProject(fields);
  try {
    await backend().putProject(project);
  } catch (e) {
    return fail(e);
  }
  state.projects = await backend().listProjects();
  await openProject(project.id);
  return { ok: true, id: project.id };
}

export async function openProject(id) {
  try {
    const loaded = await backend().loadProject(id);
    if (!loaded) {
      state.projects = await backend().listProjects();
      notify("That map no longer exists.", "error");
      return { ok: false };
    }
    state.project = loaded.project;
    // The map's agreed words, applied to every label that offers a swap.
    setActiveVocabulary(loaded.project.vocabulary);
    state.stakeholders = loaded.stakeholders.sort(byName);
    state.changes = indexChanges(loaded.changes);
    state.markers = indexBy(loaded.markers, "stakeholderId");
    state.observations = indexBy(loaded.observations, "markerId");
    state.cycles = (loaded.cycles || []).slice().sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)));
    state.selectedId = null;
    state.detailTab = "score";
    state.view = "map";
    state.dirty = false;
    state.movementOnly = false;
    backend().setMeta("lastProjectId", id);
    emit();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function closeProject() {
  state.project = null;
  state.stakeholders = [];
  state.changes = new Map();
  clearBehaviour();
  state.selectedId = null;
  state.dirty = false;
  state.projects = await backend().listProjects();
  backend().setMeta("lastProjectId", null);
  emit();
}

export async function updateProject(fields) {
  if (!state.project) return { ok: false };
  const next = { ...state.project, ...fields, updatedAt: nowISO() };
  try {
    await backend().putProject(next);
  } catch (e) {
    return fail(e);
  }
  state.project = next;
  setActiveVocabulary(next.vocabulary);
  state.projects = await backend().listProjects();
  emit();
  return { ok: true };
}

export async function deleteProject(id) {
  try {
    await backend().deleteProject(id);
  } catch (e) {
    return fail(e);
  }
  if (state.project && state.project.id === id) {
    state.project = null;
    state.stakeholders = [];
    state.changes = new Map();
    clearBehaviour();
    state.selectedId = null;
    backend().setMeta("lastProjectId", null);
  }
  state.projects = await backend().listProjects();
  emit();
  return { ok: true };
}

/* ------------------------------------------------------------ stakeholders */

export async function addStakeholder(fields) {
  if (!state.project) return { ok: false };
  const s = makeStakeholder(state.project.id, fields);
  if (!s.name) return { ok: false, message: "A stakeholder needs a name." };
  try {
    await backend().putStakeholder(s, touchProject());
  } catch (e) {
    return fail(e);
  }
  state.stakeholders = [...state.stakeholders, s].sort(byName);
  state.changes.set(s.id, []);
  state.selectedId = s.id;
  state.detailTab = "score";
  state.view = "map";
  bumpProject();
  emit();
  return { ok: true, id: s.id };
}

export async function addStakeholdersBulk(list) {
  if (!state.project) return { ok: false };
  const made = list.map((f) => makeStakeholder(state.project.id, f)).filter((s) => s.name);
  if (!made.length) return { ok: false, message: "Nothing to import — no rows had a name." };
  try {
    await backend().addStakeholders(made, touchProject());
  } catch (e) {
    return fail(e);
  }
  state.stakeholders = [...state.stakeholders, ...made].sort(byName);
  for (const s of made) state.changes.set(s.id, []);
  bumpProject();
  emit();
  return { ok: true, count: made.length };
}

/**
 * The 2x3 strategy map. Deliberately NOT part of commit(): re-tagging which
 * cell an approach belongs in is a classification, not a change of tack, and
 * versioning it would fragment the strategy periods for no gain.
 */
export async function updateStrategyMap(id, map) {
  const s = state.stakeholders.find((x) => x.id === id);
  if (!s) return { ok: false };
  const next = { ...s, strategyMap: normalizeStrategyMap(map) };
  try {
    await backend().putStakeholder(next, touchProject());
  } catch (e) {
    return fail(e);
  }
  replaceStakeholder(next);
  bumpProject();
  emit();
  return { ok: true };
}

/** Identity fields only. SPEC 8 versions power/interest/rationale/strategy — not the name. */
export async function updateStakeholderIdentity(id, { name, type, isIndividual, reach, reachableVia }) {
  const s = state.stakeholders.find((x) => x.id === id);
  if (!s) return { ok: false };
  const next = {
    ...s,
    name: name != null ? String(name).trim() : s.name,
    type: type != null ? String(type).trim() : s.type,
    isIndividual: isIndividual != null ? Boolean(isIndividual) : s.isIndividual,
    // SPEC v2 §5. Triage is identity, not score: it says what kind of
    // relationship this is, so it is not versioned in the change log.
    reach: reach != null ? normalizeReach(reach) : normalizeReach(s.reach),
    reachableVia: reachableVia != null ? reachableVia.filter(Boolean) : s.reachableVia || [],
  };
  if (!next.name) return { ok: false, message: "A stakeholder needs a name." };
  try {
    await backend().putStakeholder(next, touchProject());
  } catch (e) {
    return fail(e);
  }
  replaceStakeholder(next);
  bumpProject();
  emit();
  return { ok: true };
}

export async function deleteStakeholder(id) {
  try {
    await backend().deleteStakeholder(id);
  } catch (e) {
    return fail(e);
  }
  state.stakeholders = state.stakeholders.filter((x) => x.id !== id);
  state.changes.delete(id);
  for (const m of state.markers.get(id) || []) state.observations.delete(m.id);
  state.markers.delete(id);
  if (state.selectedId === id) {
    state.selectedId = null;
    state.dirty = false;
  }
  bumpProject();
  emit();
  return { ok: true };
}

/* ---------------------------------------------------------------- the save */

/**
 * Record a change to scores, rationale or strategy.
 *
 * Writes the updated stakeholder and its append-only history row in one
 * transaction, and only then updates memory. If the write fails the caller gets
 * `{ok:false, message}` and the UI still shows what is actually stored.
 */
export async function commit(id, next, note = "") {
  const s = state.stakeholders.find((x) => x.id === id);
  if (!s) return { ok: false, message: "That stakeholder is no longer open." };

  const prev = {
    power: s.power,
    interest: s.interest,
    rationale: s.rationale || "",
    strategy: normalizeStrategy(s.strategy),
  };
  const proposed = {
    power: clampPower(next.power),
    interest: clampInterest(next.interest),
    rationale: String(next.rationale == null ? "" : next.rationale).trim(),
    strategy: normalizeStrategy(next.strategy),
  };

  const fields = changedFields(prev, proposed);
  if (!fields.length) {
    state.dirty = false;
    emit();
    return { ok: true, noop: true };
  }

  const at = nowISO();
  const change = {
    id: newId(),
    projectId: s.projectId,
    stakeholderId: s.id,
    at,
    by: "",
    power: proposed.power,
    interest: proposed.interest,
    rationale: proposed.rationale,
    strategy: proposed.strategy,
    note: String(note || "").trim(),
    prevPower: prev.power,
    prevInterest: prev.interest,
    prevRationale: prev.rationale,
    prevStrategy: prev.strategy,
    changedFields: fields,
  };
  const updated = { ...s, ...proposed, updatedAt: at };

  try {
    await backend().commitChange(updated, change, touchProject());
  } catch (e) {
    // Nothing was applied to memory, so there is nothing to undo — but say so loudly.
    return fail(e);
  }

  replaceStakeholder(updated);
  const list = state.changes.get(s.id) || [];
  state.changes.set(s.id, [...list, change]);
  state.dirty = false;
  bumpProject();
  emit();
  return { ok: true, change };
}

/* ------------------------------------------- SPEC v2 §5 — behaviour layer */

export async function setDepth(depth) {
  return updateProject({ depth: normalizeDepth(depth) });
}

export async function addMarker(stakeholderId, fields) {
  if (!state.project) return { ok: false };
  const m = makeMarker(state.project.id, stakeholderId, fields);
  if (!m.text) return { ok: false, message: "A behaviour needs some text." };
  try {
    await backend().putMarker(m, touchProject());
  } catch (e) {
    return fail(e);
  }
  state.markers.set(stakeholderId, [...(state.markers.get(stakeholderId) || []), m]);
  bumpProject();
  emit();
  return { ok: true, marker: m };
}

export async function updateMarker(markerId, fields) {
  const m = findMarker(markerId);
  if (!m) return { ok: false };
  const next = { ...m, ...fields };
  if (fields.text != null) next.text = String(fields.text).trim();
  if (!next.text) return { ok: false, message: "A behaviour needs some text." };
  try {
    await backend().putMarker(next, touchProject());
  } catch (e) {
    return fail(e);
  }
  replaceMarker(next);
  bumpProject();
  emit();
  return { ok: true };
}

/**
 * Retire rather than delete, once a marker has been observed.
 *
 * Deleting it would erase the fact that this was something the organisation
 * said it was watching, and orphan the observations that scored it. The annual
 * review is expected to retire markers that turned out not to be useful; that
 * is a normal act, and the record should show it happened.
 */
export async function retireMarker(markerId) {
  const m = findMarker(markerId);
  if (!m) return { ok: false };
  return updateMarker(markerId, { retired: true, retiredAt: nowISO(), watched: false });
}

export async function restoreMarker(markerId) {
  return updateMarker(markerId, { retired: false, retiredAt: null });
}

/** Only safe when nothing has ever been recorded against it. */
export async function deleteMarker(markerId) {
  const m = findMarker(markerId);
  if (!m) return { ok: false };
  if ((state.observations.get(markerId) || []).length) {
    return { ok: false, message: "This behaviour has been reviewed, so it is retired rather than deleted." };
  }
  try {
    await backend().deleteMarker(markerId);
  } catch (e) {
    return fail(e);
  }
  const list = (state.markers.get(m.stakeholderId) || []).filter((x) => x.id !== markerId);
  state.markers.set(m.stakeholderId, list);
  bumpProject();
  emit();
  return { ok: true };
}

export async function setMarkerWatched(markerId, watched) {
  return updateMarker(markerId, { watched: Boolean(watched) });
}

/**
 * Record one reflection cycle: the summary and every observation it produced,
 * written together. Nothing reaches memory until the backend confirms.
 *
 * `entries` is [{markerId, observed, narrative, evidence, contribution, significance}].
 */
export async function commitCycle(cycleFields, entries) {
  if (!state.project) return { ok: false };
  const cycle = makeCycle(state.project.id, { ...cycleFields, closedAt: nowISO() });

  const observations = [];
  for (const e of entries || []) {
    const m = findMarker(e.markerId);
    if (!m) continue;
    observations.push(makeObservation(state.project.id, m.stakeholderId, m.id, cycle.id, e));
  }
  if (!observations.length) return { ok: false, message: "Nothing was reviewed, so there is nothing to record." };

  try {
    await backend().commitCycle(cycle, observations, touchProject());
  } catch (e) {
    return fail(e);
  }

  for (const o of observations) {
    state.observations.set(o.markerId, [...(state.observations.get(o.markerId) || []), o]);
  }
  state.cycles = [cycle, ...state.cycles];
  bumpProject();
  emit();
  return { ok: true, cycle, count: observations.length };
}

export function markersFor(stakeholderId) {
  return state.markers.get(stakeholderId) || [];
}

export function liveMarkersFor(stakeholderId) {
  return markersFor(stakeholderId).filter((m) => !m.retired);
}

export function observationsFor(markerId) {
  return state.observations.get(markerId) || [];
}

/** Every observation belonging to one stakeholder, across all its markers. */
export function observationsForStakeholder(stakeholderId) {
  const out = [];
  for (const m of markersFor(stakeholderId)) out.push(...observationsFor(m.id));
  return out;
}

export function allMarkers() {
  const out = [];
  for (const list of state.markers.values()) out.push(...list);
  return out;
}

export function allObservations() {
  const out = [];
  for (const list of state.observations.values()) out.push(...list);
  return out;
}

function findMarker(markerId) {
  for (const list of state.markers.values()) {
    const hit = list.find((m) => m.id === markerId);
    if (hit) return hit;
  }
  return null;
}

function replaceMarker(next) {
  const list = (state.markers.get(next.stakeholderId) || []).map((m) => (m.id === next.id ? next : m));
  state.markers.set(next.stakeholderId, list);
}

function clearBehaviour() {
  state.markers = new Map();
  state.observations = new Map();
  state.cycles = [];
}

function indexBy(rows, key) {
  const m = new Map();
  for (const r of rows || []) {
    const list = m.get(r[key]);
    if (list) list.push(r);
    else m.set(r[key], [r]);
  }
  return m;
}

/* ---------------------------------------------------------------- selection */

export function select(id, { force = false } = {}) {
  if (state.dirty && !force) return false;
  state.selectedId = id;
  state.dirty = false;
  if (id) state.detailTab = state.detailTab || "score";
  emit();
  return true;
}

export function setDetailTab(tab) {
  state.detailTab = tab;
  emit();
}

export function setView(view) {
  state.view = view;
  emit();
}

export function setDirty(v) {
  const next = Boolean(v);
  if (state.dirty !== next) {
    state.dirty = next;
    // Deliberately no emit(): the editor owns its own DOM while dirty, and a
    // re-render here would throw away what the user is typing.
  }
}

export function setMovementOnly(v) {
  state.movementOnly = Boolean(v);
  emit();
}

/* ---------------------------------------------------------------- accessors */

export function selected() {
  return state.stakeholders.find((x) => x.id === state.selectedId) || null;
}

export function changesFor(id) {
  return state.changes.get(id) || [];
}

export function historyFor(id) {
  return sortChangesDescending(changesFor(id));
}

export function allChanges() {
  const out = [];
  for (const list of state.changes.values()) out.push(...list);
  return out;
}

/* ------------------------------------------------------------------ helpers */

function byName(a, b) {
  return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });
}

function indexChanges(changes) {
  const m = new Map();
  for (const c of changes) {
    const list = m.get(c.stakeholderId);
    if (list) list.push(c);
    else m.set(c.stakeholderId, [c]);
  }
  return m;
}

function replaceStakeholder(next) {
  state.stakeholders = state.stakeholders.map((x) => (x.id === next.id ? next : x)).sort(byName);
}

/** The project row carries `updatedAt` so the project list can sort by recency. */
function touchProject() {
  if (!state.project) return null;
  return { ...state.project, updatedAt: nowISO() };
}

function bumpProject() {
  if (state.project) state.project = { ...state.project, updatedAt: nowISO() };
}

function fail(e) {
  const message = e && e.message ? e.message : "Something went wrong and the change was NOT saved.";
  notify(message, "error");
  return { ok: false, message };
}

/** Used by the JSON importer, which writes straight to the database. */
export async function refreshAfterImport(projectId) {
  state.projects = await backend().listProjects();
  if (projectId) await openProject(projectId);
  else emit();
}
