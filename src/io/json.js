/**
 * Full-fidelity JSON export and import.
 *
 * SPEC 7:  "JSON of everything including history and derived periods" and
 *          "Import: the JSON export, round-trip clean. This is how a project
 *           moves between devices and people in the MVP."
 * SPEC 10: "Export must be complete and easy. Users who can leave will trust
 *           the tool."
 *
 * Two readers are supported:
 *   1. This app's own export (`format: "shift.project"`).
 *   2. The stakeholder-matrix skill's "Export everything (JSON)" dump, so an
 *      organisation already using the Claude skill can move its history in
 *      rather than start again. SPEC 13 expects the skill to be tested first.
 */

import {
  STRATEGY_FIELDS,
  clampInterest,
  clampPower,
  emptyStrategy,
  looksLikeIndividual,
  makeProject,
  newId,
  normalizeStrategy,
  normalizeStrategyMap,
  nowISO,
  strategyPeriods,
} from "../domain.js";

export const FORMAT = "shift.project";
export const FORMAT_VERSION = 1;

/* ----------------------------------------------------------------- export */

export function buildExport({
  project,
  stakeholders,
  changesFor,
  markers = [],
  observations = [],
  cycles = [],
  appVersion,
}) {
  const byStakeholder = {};
  const allChanges = [];
  for (const s of stakeholders) {
    const list = (changesFor(s.id) || []).slice();
    allChanges.push(...list);
    byStakeholder[s.id] = strategyPeriods(s.baseline, s, list);
  }
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    app: "Shift",
    appVersion: appVersion || null,
    exportedAt: nowISO(),
    // A reader that only wants the numbers should not have to reimplement the
    // derivation; a reader that wants to re-import ignores this block.
    note:
      "`derived` is computed from `changes` at read time and is not authoritative. Re-importing this file uses project, stakeholders and changes only.",
    project,
    stakeholders,
    changes: allChanges.sort((a, b) => String(a.at).localeCompare(String(b.at))),
    // SPEC 10 — the export must be complete. A behaviour record that did not
    // survive an export would make the ladder unmovable between machines and
    // silently lose the only evidence that is not self-assessment.
    markers,
    observations: observations.slice().sort((a, b) => String(a.at).localeCompare(String(b.at))),
    cycles,
    derived: { strategyPeriods: byStakeholder },
  };
}

/* ----------------------------------------------------------------- import */

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImportError";
  }
}

/**
 * Parse either supported shape into `{project, stakeholders, changes, source}`.
 * Throws ImportError with a message meant for a human, not a console.
 */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(String(text));
  } catch (e) {
    throw new ImportError("That is not valid JSON. Paste the whole file, including the opening and closing braces.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ImportError("That JSON is not a map export — the top level should be an object.");
  }
  if (data.format === FORMAT || (data.project && Array.isArray(data.stakeholders))) {
    return readNativeExport(data);
  }
  if (data.stakeholders && typeof data.stakeholders === "object") {
    return readSkillExport(data);
  }
  throw new ImportError(
    "That JSON does not look like a Shift export or a stakeholder-matrix export. It has no `stakeholders`."
  );
}

function readNativeExport(data) {
  const project = makeProject({
    id: str(data.project?.id) || newId(),
    name: str(data.project?.name) || "Imported map",
    description: str(data.project?.description),
    scaleNote: str(data.project?.scaleNote),
    depth: data.project?.depth,
    vision: str(data.project?.vision),
    mission: str(data.project?.mission),
    vocabulary: data.project?.vocabulary,
    readiness: data.project?.readiness,
    createdAt: str(data.project?.createdAt) || nowISO(),
    updatedAt: str(data.project?.updatedAt) || nowISO(),
  });

  const stakeholders = (data.stakeholders || []).map((raw, i) => coerceStakeholder(raw, project.id, i));
  const known = new Set(stakeholders.map((s) => s.id));

  const changes = (Array.isArray(data.changes) ? data.changes : [])
    .map((raw) => coerceChange(raw, project.id))
    .filter((c) => c && known.has(c.stakeholderId));

  if (!stakeholders.length) throw new ImportError("That export contains no stakeholders.");

  const markers = (Array.isArray(data.markers) ? data.markers : [])
    .map((raw) => coerceMarker(raw, project.id))
    .filter((m) => m && known.has(m.stakeholderId));
  const knownMarkers = new Set(markers.map((m) => m.id));
  const cycles = (Array.isArray(data.cycles) ? data.cycles : [])
    .map((raw) => coerceCycle(raw, project.id))
    .filter(Boolean);
  const observations = (Array.isArray(data.observations) ? data.observations : [])
    .map((raw) => coerceObservation(raw, project.id))
    .filter((o) => o && knownMarkers.has(o.markerId));

  return { project, stakeholders, changes, markers, observations, cycles, source: "shift" };
}

/**
 * The skill template's dump:
 *   { project:"…", stakeholders:{ id: { name, type, baseline:{p,i,r,s},
 *     current:{p,i,r,s}, history:[{at,p,i,r,s,note,prevP,prevI,prevR,prevS,changed}] } } }
 */
function readSkillExport(data) {
  const project = makeProject({
    name: str(data.project) || "Imported from stakeholder-matrix",
    description: "Imported from a stakeholder-matrix skill export.",
  });

  const stakeholders = [];
  const changes = [];

  for (const [id, raw] of Object.entries(data.stakeholders)) {
    if (!raw || typeof raw !== "object") continue;
    const base = raw.baseline || {};
    const cur = raw.current || base;
    const createdAt = firstTimestamp(raw.history) || project.createdAt;

    const baselineStrategy = normalizeStrategy(base.s);
    stakeholders.push({
      id: str(id) || newId(),
      projectId: project.id,
      name: str(raw.name) || str(id),
      type: str(raw.type),
      isIndividual: looksLikeIndividual(str(raw.name) || str(id)),
      power: clampPower(num(cur.p, 5)),
      interest: clampInterest(num(cur.i, 0)),
      rationale: str(cur.r),
      strategy: normalizeStrategy(cur.s),
      baseline: {
        power: clampPower(num(base.p, 5)),
        interest: clampInterest(num(base.i, 0)),
        rationale: str(base.r),
        strategy: baselineStrategy,
        at: createdAt,
      },
      createdAt,
      updatedAt: lastTimestamp(raw.history),
      updatedBy: "",
    });

    for (const h of Array.isArray(raw.history) ? raw.history : []) {
      if (!h || typeof h !== "object") continue;
      changes.push({
        id: newId(),
        projectId: project.id,
        stakeholderId: str(id),
        at: str(h.at) || nowISO(),
        by: str(h.by),
        power: clampPower(num(h.p, 0)),
        interest: clampInterest(num(h.i, 0)),
        rationale: str(h.r),
        strategy: normalizeStrategy(h.s),
        note: str(h.note),
        prevPower: clampPower(num(h.prevP, 0)),
        prevInterest: clampInterest(num(h.prevI, 0)),
        prevRationale: str(h.prevR),
        prevStrategy: normalizeStrategy(h.prevS),
        changedFields: normalizeChangedFields(h.changed),
      });
    }
  }

  if (!stakeholders.length) throw new ImportError("That skill export contains no stakeholders.");
  // The skill has no behaviour layer, so a map imported from it starts at depth 1.
  return { project, stakeholders, changes, markers: [], observations: [], cycles: [], source: "stakeholder-matrix" };
}

/**
 * The skill template lists history newest-first, so scan rather than assume an
 * order. The earliest entry is the closest thing that export has to a creation
 * date — the baseline necessarily existed at or before it.
 */
function firstTimestamp(history) {
  if (!Array.isArray(history) || !history.length) return null;
  let min = null;
  for (const h of history) {
    const at = h && str(h.at);
    if (!at) continue;
    if (min === null || at < min) min = at;
  }
  return min;
}

function lastTimestamp(history) {
  if (!Array.isArray(history) || !history.length) return null;
  let max = null;
  for (const h of history) {
    const at = h && str(h.at);
    if (!at) continue;
    if (max === null || at > max) max = at;
  }
  return max;
}

/* --------------------------------------------------------------- coercion */

function coerceStakeholder(raw, projectId, i) {
  if (!raw || typeof raw !== "object") throw new ImportError(`Stakeholder ${i + 1} is not an object.`);
  const name = str(raw.name);
  if (!name) throw new ImportError(`Stakeholder ${i + 1} has no name.`);
  const power = clampPower(num(raw.power, 5));
  const interest = clampInterest(num(raw.interest, 0));
  const rationale = str(raw.rationale);
  const strategy = normalizeStrategy(raw.strategy);
  const b = raw.baseline || {};
  const createdAt = str(raw.createdAt) || str(b.at) || nowISO();
  return {
    id: str(raw.id) || newId(),
    projectId,
    name,
    type: str(raw.type),
    isIndividual: Boolean(raw.isIndividual),
    reach: raw.reach,
    reachableVia: Array.isArray(raw.reachableVia) ? raw.reachableVia.map(str).filter(Boolean) : [],
    strategyMap: raw.strategyMap,
    power,
    interest,
    rationale,
    strategy,
    strategyMap: normalizeStrategyMap(raw.strategyMap),
    baseline: {
      power: clampPower(num(b.power, power)),
      interest: clampInterest(num(b.interest, interest)),
      rationale: str(b.rationale ?? rationale),
      strategy: normalizeStrategy(b.strategy ?? strategy),
      at: str(b.at) || createdAt,
    },
    createdAt,
    updatedAt: str(raw.updatedAt) || null,
    updatedBy: str(raw.updatedBy),
  };
}

function coerceChange(raw, projectId) {
  if (!raw || typeof raw !== "object") return null;
  const stakeholderId = str(raw.stakeholderId);
  if (!stakeholderId) return null;
  return {
    id: str(raw.id) || newId(),
    projectId,
    stakeholderId,
    at: str(raw.at) || nowISO(),
    by: str(raw.by),
    power: clampPower(num(raw.power, 0)),
    interest: clampInterest(num(raw.interest, 0)),
    rationale: str(raw.rationale),
    strategy: normalizeStrategy(raw.strategy),
    note: str(raw.note),
    prevPower: clampPower(num(raw.prevPower, 0)),
    prevInterest: clampInterest(num(raw.prevInterest, 0)),
    prevRationale: str(raw.prevRationale),
    prevStrategy: normalizeStrategy(raw.prevStrategy),
    changedFields: normalizeChangedFields(raw.changedFields ?? raw.changed),
  };
}

function coerceMarker(raw, projectId) {
  if (!raw || typeof raw !== "object") return null;
  const stakeholderId = str(raw.stakeholderId);
  const text = str(raw.text).trim();
  if (!stakeholderId || !text) return null;
  return {
    id: str(raw.id) || newId(),
    projectId,
    stakeholderId,
    text,
    tier: VALID_TIERS.has(str(raw.tier)) ? str(raw.tier) : null,
    watched: raw.watched === undefined ? true : Boolean(raw.watched),
    retired: Boolean(raw.retired),
    createdAt: str(raw.createdAt) || nowISO(),
    retiredAt: str(raw.retiredAt) || null,
  };
}

function coerceObservation(raw, projectId) {
  if (!raw || typeof raw !== "object") return null;
  const markerId = str(raw.markerId);
  if (!markerId) return null;
  return {
    id: str(raw.id) || newId(),
    projectId,
    stakeholderId: str(raw.stakeholderId),
    markerId,
    cycleId: str(raw.cycleId) || null,
    at: str(raw.at) || nowISO(),
    by: str(raw.by),
    observed: VALID_OBSERVED.has(str(raw.observed)) ? str(raw.observed) : "not-yet",
    narrative: str(raw.narrative),
    evidence: str(raw.evidence),
    contribution: str(raw.contribution),
    significance: str(raw.significance),
  };
}

function coerceCycle(raw, projectId) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: str(raw.id) || newId(),
    projectId,
    label: str(raw.label),
    openedAt: str(raw.openedAt) || nowISO(),
    closedAt: str(raw.closedAt) || null,
    by: str(raw.by),
    wentBackwards: str(raw.wentBackwards),
    matteredForGoal: str(raw.matteredForGoal),
    mapChangesProposed: str(raw.mapChangesProposed),
  };
}

const VALID_TIERS = new Set(["start", "like", "love", "regression"]);
const VALID_OBSERVED = new Set(["yes", "not-yet", "backwards"]);
const VALID_CHANGED = new Set(["power", "interest", "rationale", "strategy"]);
function normalizeChangedFields(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter((x) => VALID_CHANGED.has(x));
}

const str = (v) => (v == null ? "" : String(v));
const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/* ------------------------------------------------------- collision handling */

/**
 * Decide how an import lands.
 *
 * `mode: "replace"` keeps every id, so re-importing a file you exported earlier
 * restores it in place — the round-trip SPEC 7 asks for.
 *
 * `mode: "copy"` re-keys everything. Stakeholder ids are remapped consistently
 * so history still points at the right actor; SPEC 5's "never reused" holds
 * because the copy's ids are new, not recycled.
 */
export function applyImportMode({ project, stakeholders, changes, markers = [], observations = [], cycles = [] }, mode) {
  if (mode !== "copy") return { project, stakeholders, changes, markers, observations, cycles };

  const projectId = newId();
  const idMap = new Map();
  for (const s of stakeholders) idMap.set(s.id, newId());

  const markerMap = new Map();
  for (const m of markers) markerMap.set(m.id, newId());
  const cycleMap = new Map();
  for (const c of cycles) cycleMap.set(c.id, newId());

  return {
    project: { ...project, id: projectId, name: dedupeName(project.name), createdAt: nowISO(), updatedAt: nowISO() },
    stakeholders: stakeholders.map((s) => ({
      ...s,
      id: idMap.get(s.id),
      projectId,
      // Same reason as ensureUuids: a triage link is a stakeholder id and must
      // be re-keyed with everything else.
      reachableVia: (Array.isArray(s.reachableVia) ? s.reachableVia : [])
        .map((v) => idMap.get(v))
        .filter(Boolean),
    })),
    changes: changes.map((c) => ({
      ...c,
      id: newId(),
      projectId,
      stakeholderId: idMap.get(c.stakeholderId) || c.stakeholderId,
    })),
    markers: markers.map((m) => ({
      ...m,
      id: markerMap.get(m.id),
      projectId,
      stakeholderId: idMap.get(m.stakeholderId) || m.stakeholderId,
    })),
    observations: observations.map((o) => ({
      ...o,
      id: newId(),
      projectId,
      stakeholderId: idMap.get(o.stakeholderId) || o.stakeholderId,
      markerId: markerMap.get(o.markerId) || o.markerId,
      cycleId: o.cycleId ? cycleMap.get(o.cycleId) || null : null,
    })),
    cycles: cycles.map((c) => ({ ...c, id: cycleMap.get(c.id), projectId })),
  };
}

function dedupeName(name) {
  return /\(copy\)\s*$/i.test(name) ? name : `${name} (copy)`;
}

/* --------------------------------------------------------------- summarise */

/** A short human description of what an import will do, shown before it runs. */
export function describeImport(parsed) {
  const changes = parsed.changes.length;
  const markers = (parsed.markers || []).length;
  const observations = (parsed.observations || []).length;
  const withStrategy = parsed.stakeholders.filter((s) =>
    STRATEGY_FIELDS.some((k) => (normalizeStrategy(s.strategy)[k] || "").trim())
  ).length;
  return {
    projectName: parsed.project.name,
    stakeholders: parsed.stakeholders.length,
    changes,
    markers,
    observations,
    withStrategy,
    source: parsed.source,
    earliest: changes ? parsed.changes.map((c) => c.at).sort()[0] : null,
  };
}

export { emptyStrategy };
