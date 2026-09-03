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

import { clampInterest, clampPower, emptyStrategy, newId, normalizeStrategy } from "../domain.js";

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
export function ensureUuids({ project, stakeholders, changes }) {
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

  return { project: nextProject, stakeholders: nextStakeholders, changes: nextChanges, remapped };
}

export { emptyStrategy };
