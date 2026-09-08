/**
 * The hosted backend: Supabase Postgres, scoped to one organisation.
 *
 * Same interface as backends/local.js, so store.js does not know or care which
 * one it is talking to.
 *
 * Two differences from the local backend are worth stating plainly, because
 * they are weaker guarantees and pretending otherwise would be dishonest:
 *
 *   Atomicity. IndexedDB gives a real transaction across object stores, so a
 *   local save either lands whole or not at all. PostgREST has no multi-
 *   statement transaction over separate requests, so `commitChange` writes the
 *   history row FIRST and the stakeholder second. If the second write fails,
 *   the record of what happened survives and the current scores are merely
 *   stale — recoverable by reloading. The reverse order would lose the record
 *   while keeping the number, which is exactly the trade SPEC 6.4 refuses.
 *
 *   Concurrency. Two people editing the same stakeholder is last-write-wins on
 *   the scores (SPEC 12 says simultaneous editing is not a real use case at
 *   this scale). No history is lost either way: both edits append their own
 *   row, so the log shows what each person did and when.
 */

import { explainError, supabase } from "../supabaseClient.js";
import { session } from "../auth.js";
import {
  changeToRow,
  cycleToRow,
  markerToRow,
  observationToRow,
  projectToRow,
  rowToChange,
  rowToCycle,
  rowToMarker,
  rowToObservation,
  rowToProject,
  rowToStakeholder,
  stakeholderToRow,
} from "./rows.js";

export class CloudError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "CloudError";
    this.cause = cause;
  }
}

function orgId() {
  if (!session.orgId) throw new CloudError("No organisation is selected.");
  return session.orgId;
}

function fail(error, fallback) {
  throw new CloudError(explainError(error, fallback), error);
}

/* --------------------------------------------------------------- projects */

export async function listProjects() {
  const { data, error } = await supabase()
    .from("projects")
    .select("*")
    .eq("org_id", orgId())
    .order("updated_at", { ascending: false });
  if (error) fail(error, "Could not load your maps");
  return (data || []).map(rowToProject);
}

export async function loadProject(projectId) {
  const db = supabase();
  const org = orgId();

  const { data: p, error: pe } = await db.from("projects").select("*").eq("id", projectId).maybeSingle();
  if (pe) fail(pe, "Could not open that map");
  if (!p) return null;

  const { data: sh, error: se } = await db
    .from("stakeholders")
    .select("*")
    .eq("project_id", projectId)
    .order("name", { ascending: true });
  if (se) fail(se, "Could not load the stakeholders");

  // SPEC 8 budgets thousands of change rows per project, not millions, so the
  // whole log is fetched once and kept in memory. Paged in case a project runs
  // hot — PostgREST caps a response at 1000 rows by default.
  const changes = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: batch, error: ce } = await db
      .from("changes")
      .select("*")
      .eq("project_id", projectId)
      .order("at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (ce) fail(ce, "Could not load the history");
    changes.push(...(batch || []));
    if (!batch || batch.length < PAGE) break;
  }

  const [mk, ob, cy] = await Promise.all([
    db.from("markers").select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
    db.from("observations").select("*").eq("project_id", projectId).order("at", { ascending: true }),
    db.from("cycles").select("*").eq("project_id", projectId).order("opened_at", { ascending: false }),
  ]);
  // A missing behaviour layer is not a reason to refuse to open the map: a
  // project at depth 1 has none, and an older database may not have the tables.
  if (mk.error && mk.error.code !== "42P01") fail(mk.error, "Could not load the behaviours");

  void org;
  return {
    project: rowToProject(p),
    stakeholders: (sh || []).map(rowToStakeholder),
    changes: changes.map(rowToChange),
    markers: (mk.data || []).map(rowToMarker),
    observations: (ob.data || []).map(rowToObservation),
    cycles: (cy.data || []).map(rowToCycle),
  };
}

export async function putProject(project) {
  const { error } = await supabase().from("projects").upsert(projectToRow(project, orgId()));
  if (error) fail(error, "Could not save the map");
  return project;
}

export async function deleteProject(projectId) {
  // Stakeholders and changes go with it via ON DELETE CASCADE.
  const { error } = await supabase().from("projects").delete().eq("id", projectId);
  if (error) fail(error, "Could not delete the map");
}

/* ----------------------------------------------------------- stakeholders */

export async function putStakeholder(stakeholder, projectTouch) {
  const { error } = await supabase().from("stakeholders").upsert(stakeholderToRow(stakeholder, orgId()));
  if (error) fail(error, "Could not save the stakeholder");
  if (projectTouch) await touch(projectTouch);
  return stakeholder;
}

export async function addStakeholders(list, projectTouch) {
  const org = orgId();
  const rows = list.map((s) => stakeholderToRow(s, org));
  const { error } = await supabase().from("stakeholders").insert(rows);
  if (error) fail(error, "Could not import the stakeholders");
  if (projectTouch) await touch(projectTouch);
  return list.length;
}

export async function deleteStakeholder(stakeholderId) {
  const { error } = await supabase().from("stakeholders").delete().eq("id", stakeholderId);
  if (error) fail(error, "Could not delete the stakeholder");
}

/* ------------------------------------------------------- the atomic commit */

export async function commitChange(stakeholder, change, projectTouch) {
  const org = orgId();
  const db = supabase();
  const user = session.user || {};

  // History first, deliberately. See the note at the top of this file.
  const { error: ce } = await db.from("changes").insert(changeToRow(change, org, user.id, user.email));
  if (ce) fail(ce, "Could not record the change");

  const { error: se } = await db.from("stakeholders").upsert(stakeholderToRow(stakeholder, org));
  if (se) {
    throw new CloudError(
      "The change was recorded in the history, but the current scores failed to update (" +
        explainError(se, "unknown error") +
        "). Reload the page — nothing has been lost.",
      se
    );
  }

  if (projectTouch) await touch(projectTouch);
  return { stakeholder, change };
}

async function touch(project) {
  const { error } = await supabase()
    .from("projects")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", project.id);
  // A failed timestamp bump only affects list ordering. Never surface it as a
  // save failure — that would tell the user their work was lost when it was not.
  void error;
}

/* ------------------------------------------------------------------ import */

export async function importProject({ project, stakeholders, changes, markers = [], observations = [], cycles = [] }) {
  const org = orgId();
  const db = supabase();
  const user = session.user || {};

  const { error: pe } = await db.from("projects").upsert(projectToRow(project, org));
  if (pe) fail(pe, "Could not create the map");

  if (stakeholders.length) {
    const { error: se } = await db.from("stakeholders").upsert(stakeholders.map((s) => stakeholderToRow(s, org)));
    if (se) {
      // Roll back the empty shell rather than leave a map with no stakeholders.
      await db.from("projects").delete().eq("id", project.id);
      fail(se, "Could not import the stakeholders");
    }
  }

  if (changes.length) {
    const CHUNK = 500;
    for (let i = 0; i < changes.length; i += CHUNK) {
      const slice = changes.slice(i, i + CHUNK).map((c) => changeToRow(c, org, user.id, user.email));
      const { error } = await db.from("changes").insert(slice);
      if (error) {
        throw new CloudError(
          "The map and its stakeholders imported, but part of the history did not (" +
            explainError(error, "unknown error") +
            "). Keep your JSON file.",
          error
        );
      }
    }
  }
  if (cycles.length) {
    const { error } = await db.from("cycles").upsert(cycles.map((c) => cycleToRow(c, org, user.id, user.email)));
    if (error) throw new CloudError("The map imported but its review history did not. Keep your JSON file.", error);
  }
  if (markers.length) {
    const { error } = await db.from("markers").upsert(markers.map((m) => markerToRow(m, org)));
    if (error) throw new CloudError("The map imported but its behaviours did not. Keep your JSON file.", error);
  }
  if (observations.length) {
    const CHUNK = 500;
    for (let i = 0; i < observations.length; i += CHUNK) {
      const slice = observations.slice(i, i + CHUNK).map((o) => observationToRow(o, org, user.id, user.email));
      const { error } = await db.from("observations").insert(slice);
      if (error) throw new CloudError("The map imported but part of its observations did not. Keep your JSON file.", error);
    }
  }

  return project.id;
}

/* ------------------------------------------ markers, observations, cycles */

export async function putMarker(marker, projectTouch) {
  const { error } = await supabase().from("markers").upsert(markerToRow(marker, orgId()));
  if (error) fail(error, "Could not save the behaviour");
  if (projectTouch) await touch(projectTouch);
  return marker;
}

export async function putMarkers(markers, projectTouch) {
  const org = orgId();
  const { error } = await supabase().from("markers").upsert(markers.map((m) => markerToRow(m, org)));
  if (error) fail(error, "Could not save the behaviours");
  if (projectTouch) await touch(projectTouch);
  return markers.length;
}

export async function deleteMarker(markerId) {
  const { error } = await supabase().from("markers").delete().eq("id", markerId);
  if (error) fail(error, "Could not remove the behaviour");
}

/**
 * One reflection cycle. Observations go in FIRST, for the same reason
 * commitChange writes history before scores: if the second write fails, the
 * findings survive and only the cycle summary is missing, which is recoverable.
 * The reverse would record that a review happened and lose what it found.
 */
export async function commitCycle(cycle, observations, projectTouch) {
  const org = orgId();
  const db = supabase();
  const user = session.user || {};

  if (observations.length) {
    const rows = observations.map((o) => observationToRow(o, org, user.id, user.email));
    const { error } = await db.from("observations").insert(rows);
    if (error) fail(error, "Could not record the review");
  }

  const { error: ce } = await db.from("cycles").upsert(cycleToRow(cycle, org, user.id, user.email));
  if (ce) {
    throw new CloudError(
      "The observations were recorded, but the review summary failed to save (" +
        explainError(ce, "unknown error") +
        "). Reload the page - nothing has been lost.",
      ce
    );
  }

  if (projectTouch) await touch(projectTouch);
  return { cycle, observations };
}

export async function putCycle(cycle) {
  const user = session.user || {};
  const { error } = await supabase().from("cycles").upsert(cycleToRow(cycle, orgId(), user.id, user.email));
  if (error) fail(error, "Could not save the review");
}

/* -------------------------------------------------------------------- meta */

/**
 * Per-user, per-device preferences (theme, last map opened). These stay local
 * even in cloud mode: which map you had open is a property of your screen, not
 * of the organisation's data, and syncing it would fight between colleagues.
 */
function metaKey(key) {
  // Theme is a property of the person, not the organisation. Everything else
  // (which map was last open) is scoped per org, or switching organisations
  // would try to reopen a map belonging to the previous one.
  return key === "theme" ? "shift-meta-theme" : `shift-meta-${session.orgId || "none"}-${key}`;
}

export async function getMeta(key, fallback = null) {
  try {
    const raw = localStorage.getItem(metaKey(key));
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

export async function setMeta(key, value) {
  try {
    localStorage.setItem(metaKey(key), JSON.stringify(value));
  } catch (e) {
    /* storage blocked; preferences simply do not persist */
  }
}

export async function storageEstimate() {
  return null; // server-side; not the browser's to report
}

export async function requestPersistence() {
  return true; // durability is the database's job in this mode
}

export async function openDb() {
  if (!session.user) throw new CloudError("You are not signed in.");
  if (!session.orgId) throw new CloudError("No organisation is selected.");
}
