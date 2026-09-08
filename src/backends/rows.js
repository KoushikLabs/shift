/**
 * Translation between the domain objects the app works in and the Postgres rows
 * Supabase stores.
 *
 * Pure functions, no client, no network — because this is where the bugs live.
 * Every field renamed between camelCase and snake_case is a chance to silently
 * drop a rationale or lose a baseline, and a dropped baseline means movement is
 * measured from the wrong place forever. test/rows.test.js covers the round
 * trip in both directions.
 */

import {
  clampInterest,
  clampPower,
  emptyStrategy,
  newId,
  normalizeDepth,
  normalizeReach,
  normalizeStrategy,
  normalizeTier,
  OBSERVED_VALUES,
} from "../domain.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Postgres `uuid` columns reject anything else, including our old fallback ids. */
export function isUuid(v) {
  return typeof v === "string" && UUID_RE.test(v);
}

const str = (v) => (v == null ? "" : String(v));
const iso = (v) => (v ? new Date(v).toISOString() : null);

/* --------------------------------------------------------------- projects */

export function projectToRow(project, orgId) {
  return {
    id: project.id,
    org_id: orgId,
    name: str(project.name),
    description: str(project.description),
    scale_note: str(project.scaleNote),
    depth: normalizeDepth(project.depth),
    created_at: iso(project.createdAt) || new Date().toISOString(),
    updated_at: iso(project.updatedAt) || new Date().toISOString(),
  };
}

export function rowToProject(row) {
  return {
    id: row.id,
    name: str(row.name),
    description: str(row.description),
    scaleNote: str(row.scale_note),
    depth: normalizeDepth(row.depth),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/* ----------------------------------------------------------- stakeholders */

export function stakeholderToRow(s, orgId) {
  const strategy = normalizeStrategy(s.strategy);
  const b = s.baseline || {};
  return {
    id: s.id,
    org_id: orgId,
    project_id: s.projectId,
    name: str(s.name),
    type: str(s.type),
    is_individual: Boolean(s.isIndividual),
    reach: normalizeReach(s.reach),
    reachable_via: Array.isArray(s.reachableVia) ? s.reachableVia.filter(Boolean) : [],
    power: clampPower(s.power),
    interest: clampInterest(s.interest),
    rationale: str(s.rationale),
    strategy,
    baseline: {
      power: clampPower(b.power ?? s.power),
      interest: clampInterest(b.interest ?? s.interest),
      rationale: str(b.rationale ?? s.rationale),
      strategy: normalizeStrategy(b.strategy ?? strategy),
      at: iso(b.at) || iso(s.createdAt) || new Date().toISOString(),
    },
    created_at: iso(s.createdAt) || new Date().toISOString(),
    updated_at: iso(s.updatedAt),
    updated_by: s.updatedBy || null,
  };
}

export function rowToStakeholder(row) {
  const b = row.baseline || {};
  return {
    id: row.id,
    projectId: row.project_id,
    name: str(row.name),
    type: str(row.type),
    isIndividual: Boolean(row.is_individual),
    reach: normalizeReach(row.reach),
    reachableVia: Array.isArray(row.reachable_via) ? row.reachable_via : [],
    power: clampPower(row.power),
    interest: clampInterest(row.interest),
    rationale: str(row.rationale),
    strategy: normalizeStrategy(row.strategy),
    baseline: {
      power: clampPower(b.power),
      interest: clampInterest(b.interest),
      rationale: str(b.rationale),
      strategy: normalizeStrategy(b.strategy),
      at: iso(b.at),
    },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by || "",
  };
}

/* ---------------------------------------------------------------- changes */

export function changeToRow(c, orgId, userId, userEmail) {
  return {
    id: c.id,
    org_id: orgId,
    project_id: c.projectId,
    stakeholder_id: c.stakeholderId,
    at: iso(c.at) || new Date().toISOString(),
    // The insert policy requires `by = auth.uid()`, so this is not a field the
    // caller gets to choose — attribution cannot be forged.
    by: userId || null,
    by_email: str(userEmail || c.by),
    power: clampPower(c.power),
    interest: clampInterest(c.interest),
    rationale: str(c.rationale),
    strategy: normalizeStrategy(c.strategy),
    note: str(c.note),
    prev_power: clampPower(c.prevPower),
    prev_interest: clampInterest(c.prevInterest),
    prev_rationale: str(c.prevRationale),
    prev_strategy: normalizeStrategy(c.prevStrategy),
    changed_fields: Array.isArray(c.changedFields) ? c.changedFields : [],
  };
}

export function rowToChange(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    stakeholderId: row.stakeholder_id,
    at: iso(row.at),
    // The UI shows `by` as a person; an email is the most useful thing we have.
    by: str(row.by_email),
    byUserId: row.by || null,
    power: clampPower(row.power),
    interest: clampInterest(row.interest),
    rationale: str(row.rationale),
    strategy: normalizeStrategy(row.strategy),
    note: str(row.note),
    prevPower: clampPower(row.prev_power),
    prevInterest: clampInterest(row.prev_interest),
    prevRationale: str(row.prev_rationale),
    prevStrategy: normalizeStrategy(row.prev_strategy),
    changedFields: Array.isArray(row.changed_fields) ? row.changed_fields : [],
  };
}

/* -------------------------------------------- markers, observations, cycles */

export function markerToRow(m, orgId) {
  return {
    id: m.id,
    org_id: orgId,
    project_id: m.projectId,
    stakeholder_id: m.stakeholderId,
    text: str(m.text),
    tier: normalizeTier(m.tier),
    watched: Boolean(m.watched),
    retired: Boolean(m.retired),
    created_at: iso(m.createdAt) || new Date().toISOString(),
    retired_at: iso(m.retiredAt),
  };
}

export function rowToMarker(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    stakeholderId: row.stakeholder_id,
    text: str(row.text),
    tier: normalizeTier(row.tier),
    watched: Boolean(row.watched),
    retired: Boolean(row.retired),
    createdAt: iso(row.created_at),
    retiredAt: iso(row.retired_at),
  };
}

export function observationToRow(o, orgId, userId, userEmail) {
  return {
    id: o.id,
    org_id: orgId,
    project_id: o.projectId,
    stakeholder_id: o.stakeholderId,
    marker_id: o.markerId,
    cycle_id: o.cycleId || null,
    at: iso(o.at) || new Date().toISOString(),
    // Attribution is stamped from the session, never taken from the payload:
    // the insert policy requires by = auth.uid(), so it cannot be forged.
    by: userId || null,
    by_email: str(userEmail || o.by),
    observed: OBSERVED_VALUES.includes(o.observed) ? o.observed : "not-yet",
    narrative: str(o.narrative),
    evidence: str(o.evidence),
    contribution: str(o.contribution),
    significance: str(o.significance),
  };
}

export function rowToObservation(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    stakeholderId: row.stakeholder_id,
    markerId: row.marker_id,
    cycleId: row.cycle_id || null,
    at: iso(row.at),
    by: str(row.by_email),
    byUserId: row.by || null,
    observed: OBSERVED_VALUES.includes(row.observed) ? row.observed : "not-yet",
    narrative: str(row.narrative),
    evidence: str(row.evidence),
    contribution: str(row.contribution),
    significance: str(row.significance),
  };
}

export function cycleToRow(c, orgId, userId, userEmail) {
  return {
    id: c.id,
    org_id: orgId,
    project_id: c.projectId,
    label: str(c.label),
    opened_at: iso(c.openedAt) || new Date().toISOString(),
    closed_at: iso(c.closedAt),
    by: userId || null,
    by_email: str(userEmail || c.by),
    went_backwards: str(c.wentBackwards),
    mattered_for_goal: str(c.matteredForGoal),
    map_changes_proposed: str(c.mapChangesProposed),
  };
}

export function rowToCycle(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    label: str(row.label),
    openedAt: iso(row.opened_at),
    closedAt: iso(row.closed_at),
    by: str(row.by_email),
    wentBackwards: str(row.went_backwards),
    matteredForGoal: str(row.mattered_for_goal),
    mapChangesProposed: str(row.map_changes_proposed),
  };
}

/* --------------------------------------------------------------- migration */

/**
 * Re-key a whole project so every id is a valid Postgres uuid, preserving the
 * links between projects, stakeholders and their history.
 *
 * Local maps made in an old browser can carry ids from the `newId()` fallback
 * ("id-k3j…"), which a uuid column rejects. Rather than fail the migration
 * halfway — leaving an organisation with half a map and no history — everything
 * is renumbered up front, together.
 *
 * @returns {{project, stakeholders, changes, remapped:number}}
 */
export function ensureUuids({ project, stakeholders, changes, markers = [], observations = [], cycles = [] }) {
  const map = new Map();
  let remapped = 0;
  const idFor = (old) => {
    if (!map.has(old)) {
      if (isUuid(old)) map.set(old, old);
      else {
        map.set(old, newId());
        remapped++;
      }
    }
    return map.get(old);
  };

  const nextProject = { ...project, id: idFor(project.id) };
  const nextStakeholders = stakeholders.map((s) => ({ ...s, id: idFor(s.id), projectId: nextProject.id }));
  const nextChanges = changes
    // A history row whose stakeholder is gone would violate the foreign key and
    // abort the import; drop it rather than lose the whole map.
    .filter((c) => map.has(c.stakeholderId) || stakeholders.some((s) => s.id === c.stakeholderId))
    .map((c) => ({
      ...c,
      id: idFor(c.id),
      projectId: nextProject.id,
      stakeholderId: idFor(c.stakeholderId),
    }));

  const nextCycles = cycles.map((c) => ({ ...c, id: idFor(c.id), projectId: nextProject.id }));
  const knownMarkers = new Set(markers.map((m) => m.id));
  const nextMarkers = markers
    .filter((m) => map.has(m.stakeholderId) || stakeholders.some((s) => s.id === m.stakeholderId))
    .map((m) => ({ ...m, id: idFor(m.id), projectId: nextProject.id, stakeholderId: idFor(m.stakeholderId) }));
  const nextObservations = observations
    .filter((o) => knownMarkers.has(o.markerId))
    .map((o) => ({
      ...o,
      id: idFor(o.id),
      projectId: nextProject.id,
      stakeholderId: idFor(o.stakeholderId),
      markerId: idFor(o.markerId),
      cycleId: o.cycleId ? idFor(o.cycleId) : null,
    }));

  return {
    project: nextProject,
    stakeholders: nextStakeholders,
    changes: nextChanges,
    markers: nextMarkers,
    observations: nextObservations,
    cycles: nextCycles,
    remapped,
  };
}

export { emptyStrategy };
