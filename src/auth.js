/**
 * Accounts, organisations and membership.
 *
 * Everything that changes who-can-see-what goes through a Postgres function
 * (`create_organisation`, `create_invite`, `accept_invite`, `remove_member`)
 * rather than a direct insert. There is deliberately no INSERT policy on
 * `memberships`: if clients could write that table, anyone could add themselves
 * to any organisation and the whole isolation model would be decorative.
 */

import { cloudConfigured, explainError, supabase } from "./supabaseClient.js";

const listeners = new Set();

export const session = {
  user: null, // {id, email}
  orgs: [], // [{id, name, role}]
  orgId: null, // the active organisation
  loading: true,
};

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(session);
}

export function signedIn() {
  return Boolean(session.user);
}

export function activeOrg() {
  return session.orgs.find((o) => o.id === session.orgId) || null;
}

export function isAdminOfActiveOrg() {
  const o = activeOrg();
  return Boolean(o && o.role === "admin");
}

const LAST_ORG_KEY = "shift-last-org";

/* --------------------------------------------------------------- lifecycle */

export async function initAuth() {
  if (!cloudConfigured()) {
    session.loading = false;
    emit();
    return;
  }
  try {
    const { data } = await supabase().auth.getSession();
    await adoptSession(data ? data.session : null);
  } catch (e) {
    session.user = null;
  }
  session.loading = false;
  emit();

  supabase().auth.onAuthStateChange(async (event, s) => {
    // TOKEN_REFRESHED fires often and changes nothing the UI cares about.
    if (event === "TOKEN_REFRESHED") return;
    await adoptSession(s);
    emit();
  });
}

async function adoptSession(s) {
  if (!s || !s.user) {
    session.user = null;
    session.orgs = [];
    session.orgId = null;
    return;
  }
  session.user = { id: s.user.id, email: s.user.email || "" };
  await refreshOrgs();
}

export async function refreshOrgs() {
  if (!session.user) {
    session.orgs = [];
    session.orgId = null;
    return;
  }
  const { data, error } = await supabase()
    .from("memberships")
    .select("role, organisations ( id, name )")
    .order("created_at", { ascending: true });

  if (error) {
    session.orgs = [];
    return;
  }
  session.orgs = (data || [])
    .filter((r) => r.organisations)
    .map((r) => ({ id: r.organisations.id, name: r.organisations.name, role: r.role }));

  let remembered = null;
  try {
    remembered = localStorage.getItem(LAST_ORG_KEY);
  } catch (e) {
    /* storage blocked */
  }
  if (session.orgId && session.orgs.some((o) => o.id === session.orgId)) return;
  const pick = session.orgs.find((o) => o.id === remembered) || session.orgs[0] || null;
  session.orgId = pick ? pick.id : null;
}

export function setActiveOrg(id) {
  if (!session.orgs.some((o) => o.id === id)) return false;
  session.orgId = id;
  try {
    localStorage.setItem(LAST_ORG_KEY, id);
  } catch (e) {
    /* storage blocked */
  }
  emit();
  return true;
}

/* ------------------------------------------------------------------ sign in */

export async function signUp(email, password, displayName) {
  try {
    const { data, error } = await supabase().auth.signUp({
      email: String(email).trim(),
      password,
      options: { data: { display_name: String(displayName || "").trim() } },
    });
    if (error) return { ok: false, message: explainError(error) };
    // With email confirmation on, there is no session yet and the user must
    // click a link. Saying so beats a screen that looks like it did nothing.
    const needsConfirmation = !data.session;
    return { ok: true, needsConfirmation };
  } catch (e) {
    return { ok: false, message: explainError(e) };
  }
}

export async function signIn(email, password) {
  try {
    const { error } = await supabase().auth.signInWithPassword({
      email: String(email).trim(),
      password,
    });
    if (error) return { ok: false, message: explainError(error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: explainError(e) };
  }
}

export async function sendPasswordReset(email) {
  try {
    const { error } = await supabase().auth.resetPasswordForEmail(String(email).trim(), {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) return { ok: false, message: explainError(error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: explainError(e) };
  }
}

export async function updatePassword(password) {
  try {
    const { error } = await supabase().auth.updateUser({ password });
    if (error) return { ok: false, message: explainError(error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: explainError(e) };
  }
}

export async function signOut() {
  try {
    await supabase().auth.signOut();
  } catch (e) {
    /* clearing local state below matters more than the network call */
  }
  session.user = null;
  session.orgs = [];
  session.orgId = null;
  emit();
}

/* ------------------------------------------------------------ organisations */

export async function createOrganisation(name) {
  try {
    const { data, error } = await supabase().rpc("create_organisation", { org_name: name });
    if (error) return { ok: false, message: explainError(error, "Could not create the organisation.") };
    await refreshOrgs();
    session.orgId = data;
    try {
      localStorage.setItem(LAST_ORG_KEY, data);
    } catch (e) {
      /* storage blocked */
    }
    emit();
    return { ok: true, id: data };
  } catch (e) {
    return { ok: false, message: explainError(e) };
  }
}

export async function renameOrganisation(id, name) {
  try {
    const { error } = await supabase().from("organisations").update({ name: String(name).trim() }).eq("id", id);
    if (error) return { ok: false, message: explainError(error) };
    await refreshOrgs();
    emit();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: explainError(e) };
  }
}

export async function listMembers(orgId) {
  try {
    const { data, error } = await supabase()
      .from("memberships")
      .select("user_id, role, created_at, profiles ( email, display_name )")
      .eq("org_id", orgId);
    if (error) return { ok: false, message: explainError(error), members: [] };
    return {
      ok: true,
      members: (data || []).map((r) => ({
        userId: r.user_id,
        role: r.role,
        joinedAt: r.created_at,
        email: r.profiles ? r.profiles.email : "",
        name: r.profiles ? r.profiles.display_name : "",
        isYou: session.user && r.user_id === session.user.id,
      })),
    };
  } catch (e) {
    return { ok: false, message: explainError(e), members: [] };
  }
}

export async function removeMember(orgId, userId) {
  try {
    const { error } = await supabase().rpc("remove_member", { org: orgId, member: userId });
    if (error) return { ok: false, message: explainError(error) };
    await refreshOrgs();
    emit();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: explainError(e) };
  }
}

export async function setMemberRole(orgId, userId, role) {
  try {
    const { error } = await supabase().from("memberships").update({ role }).eq("org_id", orgId).eq("user_id", userId);
    if (error) return { ok: false, message: explainError(error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: explainError(e) };
  }
}

/* ----------------------------------------------------------------- invites */

/** Returns a link the admin sends themselves — no SMTP needed to add a colleague. */
export async function createInvite(orgId, role = "member", note = "") {
  try {
    const { data, error } = await supabase().rpc("create_invite", {
      org: orgId,
      invite_role: role,
      invite_note: note,
    });
    if (error) return { ok: false, message: explainError(error, "Could not create an invite.") };
    return { ok: true, token: data, url: inviteUrl(data) };
  } catch (e) {
    return { ok: false, message: explainError(e) };
  }
}

export function inviteUrl(token) {
  const base = window.location.origin + window.location.pathname;
  return `${base}?invite=${encodeURIComponent(token)}`;
}

export async function listInvites(orgId) {
  try {
    const { data, error } = await supabase()
      .from("invites")
      .select("id, token, role, note, created_at, expires_at, accepted_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    if (error) return { ok: false, invites: [] };
    return { ok: true, invites: data || [] };
  } catch (e) {
    return { ok: false, invites: [] };
  }
}

export async function revokeInvite(id) {
  try {
    const { error } = await supabase().from("invites").delete().eq("id", id);
    if (error) return { ok: false, message: explainError(error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: explainError(e) };
  }
}

/** Name the organisation before someone commits to joining it. */
export async function peekInvite(token) {
  try {
    const { data, error } = await supabase().rpc("peek_invite", { invite_token: token });
    if (error) return { ok: false, message: explainError(error) };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false, message: "That invite link is not valid." };
    return { ok: Boolean(row.valid), orgName: row.org_name, role: row.org_role, message: row.reason };
  } catch (e) {
    return { ok: false, message: explainError(e) };
  }
}

export async function acceptInvite(token) {
  try {
    const { data, error } = await supabase().rpc("accept_invite", { invite_token: token });
    if (error) return { ok: false, message: explainError(error, "Could not accept that invite.") };
    await refreshOrgs();
    setActiveOrg(data);
    return { ok: true, orgId: data };
  } catch (e) {
    return { ok: false, message: explainError(e) };
  }
}

/** Read `?invite=` out of the URL and clear it so a refresh does not re-run it. */
export function pendingInviteToken() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("invite");
  } catch (e) {
    return null;
  }
}

export function clearInviteFromUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", url.toString());
  } catch (e) {
    /* history API unavailable */
  }
}
