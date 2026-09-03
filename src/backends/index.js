/**
 * Which storage backend is live.
 *
 * Both modes are first-class (SPEC 3 wants a usable map in five minutes with no
 * account; the hosted mode wants login-gated per-organisation storage), so
 * store.js goes through `backend()` and never imports either one directly.
 *
 *   "local"  IndexedDB in this browser. No account. Nothing leaves the machine.
 *   "cloud"  Supabase Postgres, scoped to the signed-in user's organisation.
 */

import * as local from "./local.js";
import * as cloud from "./cloud.js";

export const LOCAL = "local";
export const CLOUD = "cloud";

let mode = LOCAL;

export function setBackendMode(next) {
  if (next !== LOCAL && next !== CLOUD) throw new Error("Unknown storage mode: " + next);
  mode = next;
}

export function backendMode() {
  return mode;
}

export function backend() {
  return mode === CLOUD ? cloud : local;
}

export { local, cloud };
