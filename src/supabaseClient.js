/**
 * The Supabase connection.
 *
 * `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are baked in at build time.
 * Both are public values and it is correct that they ship in the bundle — the
 * anon key grants nothing on its own. Every table has Row Level Security, so
 * what that key can read is decided by Postgres from the signed-in user's
 * membership, not by the key itself. See supabase/migrations/0001_init.sql.
 *
 * If they are absent the app still runs: cloud mode is simply unavailable and
 * the no-account local mode carries on as before. That matters for anyone who
 * forks this and wants the offline tool without standing up a backend.
 */

import { createClient } from "@supabase/supabase-js";

const URL_ = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const KEY_ = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

let client = null;
let configError = null;

if (URL_ && KEY_) {
  try {
    client = createClient(URL_, KEY_, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The invite links this app hands out are its own (?invite=…), not
        // Supabase's, so there is no auth fragment to pick out of the URL.
        detectSessionInUrl: true,
        flowType: "pkce",
        storageKey: "shift-auth",
      },
      global: { headers: { "x-application-name": "shift" } },
    });
  } catch (e) {
    configError = e && e.message ? e.message : "Could not reach the hosted service.";
  }
}

/** True when this build was given a backend to talk to. */
export function cloudConfigured() {
  return client !== null;
}

export function cloudConfigError() {
  return configError;
}

export function supabase() {
  if (!client) throw new Error("This copy of Shift was built without a hosted backend.");
  return client;
}

export const SUPABASE_URL = URL_;

/**
 * Turn a Supabase/Postgres error into something a person can act on.
 * Postgres error codes leak through the API and are meaningless to a user, but
 * a few of them mean something specific here and are worth translating.
 */
export function explainError(error, fallback = "Something went wrong.") {
  if (!error) return fallback;
  const code = error.code || "";
  const msg = String(error.message || "");

  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || code === "ERR_NETWORK") {
    return "Could not reach the server. Check your connection — nothing was saved.";
  }
  // 42501 = insufficient privilege. Against `changes` this is the append-only
  // rule doing its job, which is worth saying out loud rather than hiding.
  if (code === "42501" || msg.includes("row-level security")) {
    return "The database refused that change. Recorded history cannot be edited or deleted — a correction is a new entry.";
  }
  if (code === "23505") return "That already exists.";
  if (code === "23503") return "That refers to something which no longer exists. Reload and try again.";
  if (code === "PGRST301" || msg.includes("JWT")) return "Your session expired. Sign in again — nothing was saved.";
  if (msg.toLowerCase().includes("email not confirmed")) {
    return "Confirm your email address first — check your inbox for the link.";
  }
  if (msg.toLowerCase().includes("invalid login credentials")) {
    return "That email and password do not match an account.";
  }
  if (msg.toLowerCase().includes("user already registered")) {
    return "There is already an account with that email. Sign in instead.";
  }
  if (msg.toLowerCase().includes("rate limit") || code === "429") {
    return "Too many attempts just now. Wait a minute and try again.";
  }
  return msg || fallback;
}
