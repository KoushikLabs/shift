/**
 * Application state and the actions that mutate it.
 *
 * The contract with the UI: nothing in here changes in-memory state until the
 * corresponding IndexedDB transaction has committed (SPEC 6.4). Every action
 * returns `{ok:true}` or `{ok:false, message}` and never throws at the caller.
 */

import * as db from "./db.js";
import {
  changedFields,
  makeProject,
  makeStakeholder,
  newId,
  normalizeStrategy,
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
  try {
    await db.openDb();
  } catch (e) {
    state.fatal = e.message;
    state.ready = true;
    emit();
    return;
  }
  // Best-effort: ask the browser not to evict us. Silent if unsupported.
  db.requestPersistence();

  state.theme = (await db.getMeta("theme", "system")) || "system";
  applyTheme(state.theme);

  state.projects = await db.listProjects();
  const last = await db.getMeta("lastProjectId", null);
  state.ready = true;
  if (last && state.projects.some((p) => p.id === last)) {
    await openProject(last);
  } else {
    emit();
  }
}

export function setTheme(theme) {
  state.theme = theme;
  applyTheme(theme);
  db.setMeta("theme", theme);
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
    await db.putProject(project);
  } catch (e) {
    return fail(e);
  }
  state.projects = await db.listProjects();
  await openProject(project.id);
  return { ok: true, id: project.id };
}

export async function openProject(id) {
  try {
    const loaded = await db.loadProject(id);
    if (!loaded) {
      state.projects = await db.listProjects();
      notify("That map no longer exists.", "error");
      return { ok: false };
    }
    state.project = loaded.project;
    state.stakeholders = loaded.stakeholders.sort(byName);
    state.changes = indexChanges(loaded.changes);
    state.selectedId = null;
    state.detailTab = "score";
    state.view = "map";
    state.dirty = false;
    state.movementOnly = false;
    db.setMeta("lastProjectId", id);
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
  state.selectedId = null;
  state.dirty = false;
  state.projects = await db.listProjects();
  db.setMeta("lastProjectId", null);
  emit();
}

export async function updateProject(fields) {
  if (!state.project) return { ok: false };
  const next = { ...state.project, ...fields, updatedAt: nowISO() };
  try {
    await db.putProject(next);
  } catch (e) {
    return fail(e);
  }
  state.project = next;
  state.projects = await db.listProjects();
  emit();
  return { ok: true };
}

export async function deleteProject(id) {
  try {
    await db.deleteProject(id);
  } catch (e) {
    return fail(e);
  }
  if (state.project && state.project.id === id) {
    state.project = null;
    state.stakeholders = [];
    state.changes = new Map();
    state.selectedId = null;
    db.setMeta("lastProjectId", null);
  }
  state.projects = await db.listProjects();
  emit();
  return { ok: true };
}

/* ------------------------------------------------------------ stakeholders */

export async function addStakeholder(fields) {
  if (!state.project) return { ok: false };
  const s = makeStakeholder(state.project.id, fields);
  if (!s.name) return { ok: false, message: "A stakeholder needs a name." };
  try {
    await db.putStakeholder(s, touchProject());
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
    await db.addStakeholders(made, touchProject());
  } catch (e) {
    return fail(e);
  }
  state.stakeholders = [...state.stakeholders, ...made].sort(byName);
  for (const s of made) state.changes.set(s.id, []);
  bumpProject();
  emit();
  return { ok: true, count: made.length };
}

/** Identity fields only. SPEC 8 versions power/interest/rationale/strategy — not the name. */
export async function updateStakeholderIdentity(id, { name, type, isIndividual }) {
  const s = state.stakeholders.find((x) => x.id === id);
  if (!s) return { ok: false };
  const next = {
    ...s,
    name: name != null ? String(name).trim() : s.name,
    type: type != null ? String(type).trim() : s.type,
    isIndividual: isIndividual != null ? Boolean(isIndividual) : s.isIndividual,
  };
  if (!next.name) return { ok: false, message: "A stakeholder needs a name." };
  try {
    await db.putStakeholder(next, touchProject());
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
    await db.deleteStakeholder(id);
  } catch (e) {
    return fail(e);
  }
  state.stakeholders = state.stakeholders.filter((x) => x.id !== id);
  state.changes.delete(id);
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
    await db.commitChange(updated, change, touchProject());
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
  state.projects = await db.listProjects();
  if (projectId) await openProject(projectId);
  else emit();
}
