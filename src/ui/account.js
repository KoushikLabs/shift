/**
 * Accounts, organisations, members and invites — the UI layer.
 *
 * The design rule here: the user should always be able to tell where the map
 * they are looking at is stored. A tool holding adverse judgements about named
 * bodies must never leave someone unsure whether they just typed into a private
 * browser database or their organisation's shared one. Hence the persistent
 * mode indicator in the header and the explicit wording on every screen below.
 */

import * as auth from "../auth.js";
import { local } from "../backends/index.js";
import { ensureUuids } from "../backends/rows.js";
import { customDialog, confirmDialog, alertDialog, formDialog } from "./modal.js";
import { esc, fmtDate, plural } from "./dom.js";

/* ------------------------------------------------------------- sign in/up */

/**
 * @param {"signin"|"signup"} startOn
 * @returns {Promise<boolean>} true if the user ended up signed in.
 */
export function signInDialog(startOn = "signin") {
  return customDialog((dlg, close) => {
    let tab = startOn;
    let busy = false;

    const draw = () => {
      dlg.innerHTML = `<div class="dlg">
        <div class="dlghead">
          <h2>${tab === "signin" ? "Sign in" : "Create an account"}</h2>
          <p>Your organisation's maps are stored on the server and are visible only to people you invite.</p>
        </div>
        <div class="dlgbody">
          <div class="tabs" style="margin-bottom:16px">
            <button type="button" data-tab="signin" class="${tab === "signin" ? "on" : ""}">Sign in</button>
            <button type="button" data-tab="signup" class="${tab === "signup" ? "on" : ""}">Create an account</button>
          </div>
          ${
            tab === "signup"
              ? `<fieldset><span class="flabel">Your name</span>
                   <p class="fhint">Shown to colleagues in your organisation, and against changes you record.</p>
                   <input type="text" id="a-name" autocomplete="name"></fieldset>`
              : ""
          }
          <fieldset><span class="flabel">Email</span>
            <input type="text" id="a-email" autocomplete="username" inputmode="email" data-autofocus></fieldset>
          <fieldset><span class="flabel">Password</span>
            ${tab === "signup" ? '<p class="fhint">At least 8 characters.</p>' : ""}
            <input type="password" id="a-pass" autocomplete="${tab === "signup" ? "new-password" : "current-password"}"></fieldset>
          ${
            tab === "signin"
              ? `<div class="actions tight"><button type="button" class="ghost small" id="a-forgot">Forgot your password?</button></div>`
              : `<div class="caveat" style="margin-top:14px">By creating an account you are choosing to store your
                   stakeholder assessments on the server rather than only in this browser. You can export
                   everything at any time, and delete your organisation whenever you like.</div>`
          }
          <p class="warnline" id="a-error" hidden></p>
        </div>
        <div class="dlgfoot">
          <span class="status" id="a-status"></span>
          <button type="button" id="a-cancel">Cancel</button>
          <button type="button" class="primary" id="a-go">${tab === "signin" ? "Sign in" : "Create account"}</button>
        </div>
      </div>`;

      for (const b of dlg.querySelectorAll("[data-tab]")) {
        b.addEventListener("click", () => {
          tab = b.dataset.tab;
          draw();
        });
      }
      dlg.querySelector("#a-cancel").addEventListener("click", () => close(false));
      dlg.querySelector("#a-go").addEventListener("click", submit);
      const forgot = dlg.querySelector("#a-forgot");
      if (forgot) forgot.addEventListener("click", resetPassword);
      dlg.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !busy) {
          e.preventDefault();
          submit();
        }
      });
      const f = dlg.querySelector("[data-autofocus]");
      if (f) f.focus();
    };

    const showError = (msg) => {
      const el = dlg.querySelector("#a-error");
      el.hidden = false;
      el.innerHTML = `<strong>${esc(msg)}</strong>`;
      dlg.querySelector("#a-status").textContent = "";
    };

    async function submit() {
      if (busy) return;
      const email = dlg.querySelector("#a-email").value.trim();
      const pass = dlg.querySelector("#a-pass").value;
      const name = tab === "signup" ? dlg.querySelector("#a-name").value.trim() : "";
      if (!email || !pass) return showError("Enter your email and password.");
      if (tab === "signup" && pass.length < 8) return showError("Use a password of at least 8 characters.");

      busy = true;
      dlg.querySelector("#a-error").hidden = true;
      dlg.querySelector("#a-status").textContent = tab === "signin" ? "signing in…" : "creating…";

      const res = tab === "signin" ? await auth.signIn(email, pass) : await auth.signUp(email, pass, name);
      busy = false;

      if (!res.ok) return showError(res.message);
      if (res.needsConfirmation) {
        close(false);
        await alertDialog({
          title: "Check your email",
          body: `<p class="note">We sent a confirmation link to <strong>${esc(email)}</strong>.
            Click it, then come back and sign in.</p>
            <p class="note">Nothing is stored against your account until you confirm.</p>`,
        });
        return;
      }
      close(true);
    }

    async function resetPassword() {
      const email = dlg.querySelector("#a-email").value.trim();
      if (!email) return showError("Enter your email address first, then choose 'Forgot your password'.");
      const res = await auth.sendPasswordReset(email);
      if (!res.ok) return showError(res.message);
      dlg.querySelector("#a-status").textContent = "reset link sent";
    }

    draw();
  });
}

/* ---------------------------------------------------------- organisations */

export async function createOrganisationDialog() {
  const v = await formDialog({
    title: "Create your organisation",
    intro:
      "Everyone you invite to this organisation can see and edit all of its maps. Nobody outside it can see anything.",
    submitLabel: "Create organisation",
    fields: [
      {
        key: "name",
        label: "Organisation name",
        required: true,
        placeholder: "e.g. Coastal Animal Welfare Alliance",
      },
    ],
  });
  if (!v) return { ok: false };
  const res = await auth.createOrganisation(v.name);
  return res;
}

/** Shown when a signed-in user belongs to no organisation yet. */
export function noOrganisationScreen() {
  return `<div class="blank">
    <h2>You are signed in, but not in an organisation yet</h2>
    <p class="note">Maps belong to an organisation, not to a person. Create one for your team, or ask a
      colleague who already has one to send you an invite link.</p>
    <div class="actions" style="margin:0">
      <button class="primary" id="createOrg" data-autofocus>Create an organisation</button>
      <button class="ghost" id="signOutEmpty">Sign out</button>
    </div>
  </div>`;
}

/* -------------------------------------------------- members and invites */

export function membersDialog(orgId, orgName) {
  return customDialog(
    (dlg, close) => {
      let members = [];
      let invites = [];
      let msg = "";

      const isAdmin = auth.isAdminOfActiveOrg();

      async function load() {
        const m = await auth.listMembers(orgId);
        members = m.members;
        if (isAdmin) {
          const i = await auth.listInvites(orgId);
          invites = i.invites.filter((x) => !x.accepted_at && new Date(x.expires_at) > new Date());
        }
        draw();
      }

      function draw() {
        dlg.innerHTML = `<div class="dlg">
          <div class="dlghead">
            <h2>${esc(orgName)}</h2>
            <p>Everyone listed here can see and edit every map in this organisation.</p>
          </div>
          <div class="dlgbody">
            <h3 style="margin-top:0">${plural(members.length, "member")}</h3>
            <div class="tablewrap"><table class="maptable"><tbody>
              ${members
                .map(
                  (m) => `<tr>
                    <td style="font-weight:600">${esc(m.name || m.email)}${m.isYou ? ' <span class="chip">you</span>' : ""}
                      <div style="font-weight:400;color:var(--muted);font-size:.8rem">${esc(m.email)}</div></td>
                    <td class="typ">${esc(m.role)}</td>
                    <td style="text-align:right">${
                      isAdmin && !m.isYou
                        ? `<button type="button" class="small" data-role="${esc(m.userId)}" data-next="${m.role === "admin" ? "member" : "admin"}">Make ${m.role === "admin" ? "member" : "admin"}</button>
                           <button type="button" class="small danger" data-remove="${esc(m.userId)}">Remove</button>`
                        : m.isYou
                          ? `<button type="button" class="small" data-leave="1">Leave</button>`
                          : ""
                    }</td>
                  </tr>`
                )
                .join("")}
            </tbody></table></div>

            ${
              isAdmin
                ? `<h3>Invite a colleague</h3>
                   <p class="note tight">This creates a link. Send it to them however you normally would —
                     email, Slack, a message. Anyone holding the link can join this organisation, so treat it
                     like a password. It expires in 14 days.</p>
                   <div class="actions tight">
                     <button type="button" class="primary" id="mkInvite">Create an invite link</button>
                     <select id="inviteRole" style="width:auto">
                       <option value="member">as a member</option>
                       <option value="admin">as an admin</option>
                     </select>
                   </div>
                   <div id="inviteOut"></div>
                   ${
                     invites.length
                       ? `<h3>Unused invite links</h3>
                          <div class="kv">${invites
                            .map(
                              (i) =>
                                `<div><span>${esc(i.role)} · expires ${esc(fmtDate(i.expires_at))}</span>
                                 <span><button type="button" class="small" data-copy="${esc(i.token)}">Copy link</button>
                                 <button type="button" class="small danger" data-revoke="${esc(i.id)}">Revoke</button></span></div>`
                            )
                            .join("")}</div>`
                       : ""
                   }`
                : `<p class="note">Only an admin of this organisation can invite people.</p>`
            }
            ${msg ? `<p class="warnline" style="display:block">${esc(msg)}</p>` : ""}
          </div>
          <div class="dlgfoot"><button type="button" class="primary" id="mDone">Done</button></div>
        </div>`;

        dlg.querySelector("#mDone").addEventListener("click", () => close(true));

        const mk = dlg.querySelector("#mkInvite");
        if (mk)
          mk.addEventListener("click", async () => {
            const role = dlg.querySelector("#inviteRole").value;
            mk.disabled = true;
            const res = await auth.createInvite(orgId, role);
            mk.disabled = false;
            if (!res.ok) {
              msg = res.message;
              return draw();
            }
            const out = dlg.querySelector("#inviteOut");
            out.innerHTML = `<fieldset style="margin-top:10px">
              <span class="flabel">Invite link — copy it now</span>
              <textarea rows="2" id="inviteLink" readonly>${esc(res.url)}</textarea>
              <div class="actions tight"><button type="button" class="small" id="copyInvite">Copy to clipboard</button></div>
            </fieldset>`;
            const ta = out.querySelector("#inviteLink");
            ta.focus();
            ta.select();
            out.querySelector("#copyInvite").addEventListener("click", async () => {
              const { copyText } = await import("../io/download.js");
              const ok = await copyText(res.url);
              out.querySelector("#copyInvite").textContent = ok ? "Copied" : "Select and copy manually";
            });
            load();
          });

        for (const b of dlg.querySelectorAll("[data-copy]")) {
          b.addEventListener("click", async () => {
            const { copyText } = await import("../io/download.js");
            const ok = await copyText(auth.inviteUrl(b.dataset.copy));
            b.textContent = ok ? "Copied" : "Could not copy";
          });
        }
        for (const b of dlg.querySelectorAll("[data-revoke]")) {
          b.addEventListener("click", async () => {
            await auth.revokeInvite(b.dataset.revoke);
            load();
          });
        }
        for (const b of dlg.querySelectorAll("[data-role]")) {
          b.addEventListener("click", async () => {
            const res = await auth.setMemberRole(orgId, b.dataset.role, b.dataset.next);
            if (!res.ok) msg = res.message;
            load();
          });
        }
        for (const b of dlg.querySelectorAll("[data-remove]")) {
          b.addEventListener("click", async () => {
            const res = await auth.removeMember(orgId, b.dataset.remove);
            if (!res.ok) msg = res.message;
            load();
          });
        }
        const leave = dlg.querySelector("[data-leave]");
        if (leave)
          leave.addEventListener("click", async () => {
            close(true);
            const ok = await confirmDialog({
              title: `Leave ${esc(orgName)}?`,
              body: `<p class="note">You will lose access to its maps. The maps themselves stay with the
                organisation — leaving does not delete anything.</p>`,
              confirmLabel: "Leave",
              danger: true,
            });
            if (ok && auth.session.user) await auth.removeMember(orgId, auth.session.user.id);
          });
      }

      dlg.innerHTML = `<div class="dlg"><div class="dlgbody"><p class="empty">Loading…</p></div></div>`;
      load();
    },
    { wide: true }
  );
}

/* ----------------------------------------------------------- invite links */

/**
 * Handle a `?invite=…` link. Returns true if the user joined an organisation.
 * Must be safe to call when signed out — that is the common case, since the
 * link usually arrives before the person has an account.
 */
export async function handleInviteLink(token) {
  const peek = await auth.peekInvite(token);

  if (!peek.ok) {
    auth.clearInviteFromUrl();
    await alertDialog({
      title: "That invite cannot be used",
      body: `<p class="note">${esc(peek.message || "The link is not valid.")}</p>
        <p class="note">Ask whoever sent it to create a new one.</p>`,
    });
    return false;
  }

  if (!auth.signedIn()) {
    const go = await confirmDialog({
      title: `Join ${esc(peek.orgName)}?`,
      body: `<p class="note">You have been invited to join <strong>${esc(peek.orgName)}</strong> on Shift
          as ${esc(peek.role === "admin" ? "an admin" : "a member")}.</p>
        <p class="note">Sign in or create an account first — the invite will be applied straight afterwards.</p>`,
      confirmLabel: "Sign in or create an account",
    });
    if (!go) return false;
    const signed = await signInDialog("signup");
    if (!signed) return false;
  }

  const res = await auth.acceptInvite(token);
  auth.clearInviteFromUrl();
  if (!res.ok) {
    await alertDialog({ title: "Could not join", body: `<p class="note">${esc(res.message)}</p>` });
    return false;
  }
  return true;
}

/* ------------------------------------------------ local -> cloud migration */

/**
 * Offer to copy maps held in this browser into the signed-in organisation.
 *
 * Copies rather than moves, and says so. If the upload half-fails, the original
 * is still sitting in the browser where the user left it — losing a year of
 * stakeholder history to a flaky connection during a migration would be the
 * worst possible failure for this particular tool.
 */
export async function offerMigration(orgName, onImport) {
  let localProjects = [];
  try {
    await local.openDb();
    localProjects = await local.listProjects();
  } catch (e) {
    return { ok: true, moved: 0 };
  }
  if (!localProjects.length) return { ok: true, moved: 0 };

  const chosen = await customDialog((dlg, close) => {
    dlg.innerHTML = `<div class="dlg">
      <div class="dlghead">
        <h2>Move your existing maps into ${esc(orgName)}?</h2>
        <p>You have ${plural(localProjects.length, "map")} stored in this browser from before you signed in.</p>
      </div>
      <div class="dlgbody">
        <p class="note">Copying them uploads their full history — every score, rationale and strategy period —
          to your organisation, where your colleagues can see them. The browser copies are left exactly as
          they are, so nothing is at risk if the upload fails.</p>
        ${localProjects
          .map(
            (p, i) => `<label class="ack"><input type="checkbox" data-p="${esc(p.id)}" ${i === 0 ? "checked" : "checked"}>
            <span><strong>${esc(p.name)}</strong>${p.description ? `<br><span class="fhint" style="font-style:normal">${esc(p.description)}</span>` : ""}</span></label>`
          )
          .join("")}
        <div class="caveat" style="margin-top:14px">Anything you copy becomes visible to everyone in
          ${esc(orgName)}. If a map holds assessments that should not be shared with colleagues, leave it
          unticked — it stays private to this browser.</div>
        <p class="warnline" id="migErr" hidden></p>
      </div>
      <div class="dlgfoot">
        <span class="status" id="migStatus"></span>
        <button type="button" id="migSkip">Not now</button>
        <button type="button" class="primary" id="migGo">Copy selected</button>
      </div>
    </div>`;

    dlg.querySelector("#migSkip").addEventListener("click", () => close(null));
    dlg.querySelector("#migGo").addEventListener("click", async () => {
      const ids = [...dlg.querySelectorAll("[data-p]")].filter((c) => c.checked).map((c) => c.dataset.p);
      if (!ids.length) return close(null);

      const go = dlg.querySelector("#migGo");
      const status = dlg.querySelector("#migStatus");
      go.disabled = true;
      let done = 0;
      const failures = [];

      for (const id of ids) {
        status.textContent = `copying ${done + 1} of ${ids.length}…`;
        try {
          const loaded = await local.loadProject(id);
          if (!loaded) continue;
          const payload = ensureUuids({
            project: loaded.project,
            stakeholders: loaded.stakeholders,
            changes: loaded.changes,
          });
          await onImport(payload);
          done++;
        } catch (e) {
          failures.push(`${id}: ${e.message || "failed"}`);
        }
      }

      if (failures.length) {
        const err = dlg.querySelector("#migErr");
        err.hidden = false;
        err.innerHTML = `<strong>${failures.length} of ${ids.length} could not be copied.</strong>
          Your browser copies are untouched — try again, or export them as JSON and import them manually.`;
        go.disabled = false;
        status.textContent = "";
        return;
      }
      close(done);
    });
  });

  return { ok: true, moved: chosen || 0 };
}
