/**
 * IndexedDB persistence (SPEC 9: local-first, no accounts, nothing leaves the machine).
 *
 * The one rule that shapes this whole file is SPEC 6.4:
 *
 *   "History is append-only and never silently loses an edit. If a write fails,
 *    say so loudly and roll the change back in the UI. A dropped record is worse
 *    than an error, because the user believes the record is being kept."
 *
 * So: the stakeholder update and its history row are written in ONE IndexedDB
 * transaction, and callers do not mutate in-memory state until that transaction
 * reports `complete`. There is nothing to roll back, because nothing is applied
 * until it is durable. Every failure path rejects with a typed error the UI
 * turns into a visible banner.
 *
 * IndexedDB transactions auto-commit when the event loop drains with no pending
 * request, so every request inside a transaction is issued synchronously — never
 * `await` in the middle of one.
 */

export const DB_NAME = "shift";
export const DB_VERSION = 2;

export const STORE_PROJECTS = "projects";
export const STORE_STAKEHOLDERS = "stakeholders";
export const STORE_CHANGES = "changes";
export const STORE_META = "meta";
/* SPEC v2 5 - added at DB_VERSION 2. The contains() guards in
   onupgradeneeded mean a v1 database gains these stores without touching
   anything already in it. */
export const STORE_MARKERS = "markers";
export const STORE_OBSERVATIONS = "observations";
export const STORE_CYCLES = "cycles";

export class StorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "StorageError";
    this.cause = cause;
    this.code = (cause && (cause.name || cause.code)) || "unknown";
  }
}

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new StorageError("This browser has no IndexedDB, so nothing can be saved."));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(new StorageError("Could not open local storage.", e));
      return;
    }
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_STAKEHOLDERS)) {
        const s = db.createObjectStore(STORE_STAKEHOLDERS, { keyPath: "id" });
        s.createIndex("byProject", "projectId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CHANGES)) {
        const c = db.createObjectStore(STORE_CHANGES, { keyPath: "id" });
        c.createIndex("byProject", "projectId", { unique: false });
        c.createIndex("byStakeholder", "stakeholderId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_MARKERS)) {
        const m = db.createObjectStore(STORE_MARKERS, { keyPath: "id" });
        m.createIndex("byProject", "projectId", { unique: false });
        m.createIndex("byStakeholder", "stakeholderId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_OBSERVATIONS)) {
        const o = db.createObjectStore(STORE_OBSERVATIONS, { keyPath: "id" });
        o.createIndex("byProject", "projectId", { unique: false });
        o.createIndex("byMarker", "markerId", { unique: false });
        o.createIndex("byStakeholder", "stakeholderId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CYCLES)) {
        const c = db.createObjectStore(STORE_CYCLES, { keyPath: "id" });
        c.createIndex("byProject", "projectId", { unique: false });
      }
      void ev;
    };
    req.onsuccess = () => {
      const db = req.result;
      // If another tab upgrades the schema, close here rather than block it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(new StorageError(describeOpenFailure(req.error), req.error));
    req.onblocked = () =>
      reject(new StorageError("Another tab has this database open at a different version. Close it and reload."));
  });
  return dbPromise;
}

function describeOpenFailure(err) {
  const name = err && err.name;
  const localFile = typeof location !== "undefined" && location.protocol === "file:";
  if (localFile) {
    return "This page was opened straight from a file on disk, and this browser does not let local files store data. Nothing you enter could be saved. Serve the folder over http instead — any static host or a local server will do.";
  }
  if (name === "SecurityError" || name === "InvalidStateError") {
    return "Local storage is blocked in this browser mode. Private browsing and blocked site data both do this — your work cannot be saved here.";
  }
  return "Could not open local storage" + (name ? ` (${name})` : "") + ".";
}

/* --------------------------------------------------------------- plumbing */

function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Run `work(tx, stores)` and resolve only when the transaction has committed.
 * `work` must be synchronous — issue every request before returning.
 */
async function runTx(storeNames, mode, work, failureMessage) {
  const db = await openDb();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(names, mode);
    } catch (e) {
      reject(new StorageError(failureMessage || "Could not start a write.", e));
      return;
    }
    let result;
    let workError = null;
    const stores = {};
    for (const n of names) stores[n] = tx.objectStore(n);

    tx.oncomplete = () => (workError ? reject(workError) : resolve(result));
    tx.onerror = () => reject(new StorageError(explain(tx.error, failureMessage), tx.error));
    tx.onabort = () => reject(new StorageError(explain(tx.error, failureMessage), tx.error));

    try {
      result = work(stores, tx);
    } catch (e) {
      workError = e instanceof StorageError ? e : new StorageError(failureMessage || "Write failed.", e);
      try {
        tx.abort();
      } catch (_) {
        /* already aborting */
      }
    }
  });
}

function explain(err, fallback) {
  const name = err && err.name;
  if (name === "QuotaExceededError") {
    return "This browser is out of storage space, so the change was NOT saved. Export everything (JSON) now, then free space or remove an old map.";
  }
  if (name === "ConstraintError") {
    return "A record with that id already exists, so the change was NOT saved.";
  }
  if (name === "AbortError") {
    return (fallback || "The write was cancelled") + " — the change was NOT saved.";
  }
  return (fallback || "Write failed") + (name ? ` (${name})` : "") + " — the change was NOT saved.";
}

const getAllFromIndex = (store, indexName, key) => reqAsPromise(store.index(indexName).getAll(key));

/* --------------------------------------------------------------- projects */

export async function listProjects() {
  const db = await openDb();
  const tx = db.transaction(STORE_PROJECTS, "readonly");
  const rows = await reqAsPromise(tx.objectStore(STORE_PROJECTS).getAll());
  return rows.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

export function putProject(project) {
  return runTx(STORE_PROJECTS, "readwrite", (s) => {
    s[STORE_PROJECTS].put(project);
    return project;
  }, "Could not save the map");
}

/** Loads a project with everything it owns. Changes are kept in memory — SPEC 8 says thousands, not millions. */
export async function loadProject(projectId) {
  const db = await openDb();
  const tx = db.transaction(
    [STORE_PROJECTS, STORE_STAKEHOLDERS, STORE_CHANGES, STORE_MARKERS, STORE_OBSERVATIONS, STORE_CYCLES],
    "readonly"
  );
  const project = await reqAsPromise(tx.objectStore(STORE_PROJECTS).get(projectId));
  if (!project) return null;
  const stakeholders = await getAllFromIndex(tx.objectStore(STORE_STAKEHOLDERS), "byProject", projectId);
  const changes = await getAllFromIndex(tx.objectStore(STORE_CHANGES), "byProject", projectId);
  const markers = await getAllFromIndex(tx.objectStore(STORE_MARKERS), "byProject", projectId);
  const observations = await getAllFromIndex(tx.objectStore(STORE_OBSERVATIONS), "byProject", projectId);
  const cycles = await getAllFromIndex(tx.objectStore(STORE_CYCLES), "byProject", projectId);
  return { project, stakeholders, changes, markers, observations, cycles };
}

/** Deleting a map takes its stakeholders and its history with it, atomically. */
export function deleteProject(projectId) {
  return runTx(
    [STORE_PROJECTS, STORE_STAKEHOLDERS, STORE_CHANGES, STORE_MARKERS, STORE_OBSERVATIONS, STORE_CYCLES],
    "readwrite",
    (s) => {
      s[STORE_PROJECTS].delete(projectId);
      deleteByIndex(s[STORE_STAKEHOLDERS], "byProject", projectId);
      deleteByIndex(s[STORE_CHANGES], "byProject", projectId);
      deleteByIndex(s[STORE_MARKERS], "byProject", projectId);
      deleteByIndex(s[STORE_OBSERVATIONS], "byProject", projectId);
      deleteByIndex(s[STORE_CYCLES], "byProject", projectId);
    },
    "Could not delete the map"
  );
}

function deleteByIndex(store, indexName, key) {
  const cursorReq = store.index(indexName).openKeyCursor(IDBKeyRange.only(key));
  cursorReq.onsuccess = () => {
    const cur = cursorReq.result;
    if (!cur) return;
    store.delete(cur.primaryKey);
    cur.continue();
  };
}

/* ----------------------------------------------------------- stakeholders */

export function putStakeholder(stakeholder, projectTouch) {
  return runTx(
    [STORE_STAKEHOLDERS, STORE_PROJECTS],
    "readwrite",
    (s) => {
      s[STORE_STAKEHOLDERS].put(stakeholder);
      if (projectTouch) s[STORE_PROJECTS].put(projectTouch);
      return stakeholder;
    },
    "Could not save the stakeholder"
  );
}

/** Removing a stakeholder removes its history too; SPEC 5 says ids are never reused. */
export function deleteStakeholder(stakeholderId) {
  return runTx(
    [STORE_STAKEHOLDERS, STORE_CHANGES, STORE_MARKERS, STORE_OBSERVATIONS],
    "readwrite",
    (s) => {
      s[STORE_STAKEHOLDERS].delete(stakeholderId);
      deleteByIndex(s[STORE_CHANGES], "byStakeholder", stakeholderId);
      deleteByIndex(s[STORE_MARKERS], "byStakeholder", stakeholderId);
      deleteByIndex(s[STORE_OBSERVATIONS], "byStakeholder", stakeholderId);
    },
    "Could not delete the stakeholder"
  );
}

/* ------------------------------------------------------- the atomic commit */

/**
 * THE important write. The updated stakeholder and its append-only history row
 * go in together or not at all. Callers apply the change to memory only after
 * this resolves (see store.js), so a rejection leaves the UI showing exactly
 * what is on disk.
 */
export function commitChange(stakeholder, change, projectTouch) {
  return runTx(
    [STORE_STAKEHOLDERS, STORE_CHANGES, STORE_PROJECTS],
    "readwrite",
    (s) => {
      s[STORE_STAKEHOLDERS].put(stakeholder);
      s[STORE_CHANGES].add(change); // add, never put: history is append-only
      if (projectTouch) s[STORE_PROJECTS].put(projectTouch);
      return { stakeholder, change };
    },
    "Could not record the change"
  );
}

export async function listChangesForStakeholder(stakeholderId) {
  const db = await openDb();
  const tx = db.transaction(STORE_CHANGES, "readonly");
  return getAllFromIndex(tx.objectStore(STORE_CHANGES), "byStakeholder", stakeholderId);
}

/* ------------------------------------------------------------------ import */

/**
 * Whole-project import (SPEC 7: the JSON export round-trips; it is how a project
 * moves between devices). One transaction, so a half-imported project is not a
 * state the user can reach.
 */
export function importProject({ project, stakeholders, changes, markers = [], observations = [], cycles = [] }) {
  return runTx(
    [STORE_PROJECTS, STORE_STAKEHOLDERS, STORE_CHANGES, STORE_MARKERS, STORE_OBSERVATIONS, STORE_CYCLES],
    "readwrite",
    (s) => {
      s[STORE_PROJECTS].put(project);
      for (const st of stakeholders) s[STORE_STAKEHOLDERS].put(st);
      for (const c of changes) s[STORE_CHANGES].put(c);
      for (const m of markers) s[STORE_MARKERS].put(m);
      for (const o of observations) s[STORE_OBSERVATIONS].put(o);
      for (const c of cycles) s[STORE_CYCLES].put(c);
      return project.id;
    },
    "Could not import the map"
  );
}

/* ------------------------------------------ markers, observations, cycles */

export function putMarker(marker, projectTouch) {
  return runTx(
    [STORE_MARKERS, STORE_PROJECTS],
    "readwrite",
    (s) => {
      s[STORE_MARKERS].put(marker);
      if (projectTouch) s[STORE_PROJECTS].put(projectTouch);
      return marker;
    },
    "Could not save the behaviour"
  );
}

export function putMarkers(markers, projectTouch) {
  return runTx(
    [STORE_MARKERS, STORE_PROJECTS],
    "readwrite",
    (s) => {
      for (const m of markers) s[STORE_MARKERS].put(m);
      if (projectTouch) s[STORE_PROJECTS].put(projectTouch);
      return markers.length;
    },
    "Could not save the behaviours"
  );
}

/**
 * Only ever reached for a marker with no observations - store.js checks first.
 * A marker that has been reviewed is retired rather than deleted, so the record
 * of what was being watched survives (SPEC v2 5).
 */
export function deleteMarker(markerId) {
  return runTx(
    STORE_MARKERS,
    "readwrite",
    (s) => s[STORE_MARKERS].delete(markerId),
    "Could not remove the behaviour"
  );
}

/**
 * One reflection cycle, written whole: the cycle row and every observation it
 * produced, in a single transaction. A half-written cycle would leave a record
 * claiming a review happened with no findings in it.
 *
 * Observations use add(), never put(). They are append-only (SPEC 6.4).
 */
export function commitCycle(cycle, observations, projectTouch) {
  return runTx(
    [STORE_CYCLES, STORE_OBSERVATIONS, STORE_PROJECTS],
    "readwrite",
    (s) => {
      s[STORE_CYCLES].put(cycle);
      for (const o of observations) s[STORE_OBSERVATIONS].add(o);
      if (projectTouch) s[STORE_PROJECTS].put(projectTouch);
      return { cycle, observations };
    },
    "Could not record the review"
  );
}

export function putCycle(cycle) {
  return runTx(STORE_CYCLES, "readwrite", (s) => s[STORE_CYCLES].put(cycle), "Could not save the review");
}

/** Bulk add of new stakeholders, e.g. from a CSV paste. All or nothing. */
export function addStakeholders(stakeholders, projectTouch) {
  return runTx(
    [STORE_STAKEHOLDERS, STORE_PROJECTS],
    "readwrite",
    (s) => {
      for (const st of stakeholders) s[STORE_STAKEHOLDERS].put(st);
      if (projectTouch) s[STORE_PROJECTS].put(projectTouch);
      return stakeholders.length;
    },
    "Could not import the stakeholders"
  );
}

/* -------------------------------------------------------------------- meta */

export async function getMeta(key, fallback = null) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_META, "readonly");
    const row = await reqAsPromise(tx.objectStore(STORE_META).get(key));
    return row ? row.value : fallback;
  } catch (e) {
    return fallback;
  }
}

export async function setMeta(key, value) {
  try {
    await runTx(STORE_META, "readwrite", (s) => s[STORE_META].put({ key, value }));
  } catch (e) {
    /* meta is a convenience (last map opened, theme); never block work on it */
  }
}

/** Rough storage headroom, for the warning in the Data panel. */
export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      return { usage, quota };
    }
  } catch (e) {
    /* not supported */
  }
  return null;
}

/**
 * Ask the browser to make this origin's storage persistent. Without it, some
 * browsers evict IndexedDB under storage pressure — which for a local-first
 * tool means losing the record the user believes is being kept.
 */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (e) {
    /* not supported */
  }
  return false;
}
