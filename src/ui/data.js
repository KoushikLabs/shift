/**
 * The Data view: export, import, project settings, storage health.
 *
 * SPEC 10: "Export must be complete and easy. Users who can leave will trust
 * the tool." So the exports are first, above the fold, and the JSON one is a
 * full-fidelity dump rather than a summary.
 *
 * The storage card exists because local-first has one honest failure mode —
 * clearing site data destroys everything — and a tool that hides that is
 * lying to the user about what it guarantees.
 */

import { local } from "../backends/index.js";
import { esc, fmtDateTime, plural } from "./dom.js";

export function renderData(host, ctx) {
  const { project, stakeholders, changeCount } = ctx;

  host.innerHTML = `
  <h2>Export</h2>
  <p class="note">Everything happens in your browser. No file leaves this machine unless you send it yourself.</p>
  <div class="datagrid">
    <div class="datacard">
      <h3>JSON — everything</h3>
      <p>The full record: every stakeholder, every score, every rationale, the complete append-only history
         and the derived strategy periods. This is the file that moves a map between devices and people,
         and it re-imports cleanly.</p>
      <div class="actions" style="margin:0"><button class="primary" id="expJson">Download JSON</button>
        <button id="copyJson">Copy to clipboard</button></div>
    </div>
    <div class="datacard">
      <h3>CSV — current state</h3>
      <p>One row per stakeholder with scores, stance, rationale and all five strategy fields, plus baseline
         and movement columns. For a spreadsheet or a report annexe. History is not included — use JSON for that.</p>
      <div class="actions" style="margin:0"><button id="expCsv">Download CSV</button></div>
    </div>
    <div class="datacard">
      <h3>PNG — the map</h3>
      <p>The scatter as it currently stands, at twice screen resolution, with a caption naming the map and
         the date. For a slide or a report.</p>
      <div class="actions" style="margin:0"><button id="expPng">Download PNG</button></div>
    </div>
  </div>

  <h2>Import</h2>
  <div class="datagrid">
    <div class="datacard">
      <h3>Add stakeholders from a spreadsheet</h3>
      <p>Open an Excel file (.xlsx) or a CSV, or paste rows straight from a sheet, then map the columns.
         Adds to this map; it does not replace anything.</p>
      <div class="actions" style="margin:0"><button id="impCsv">Import a spreadsheet…</button></div>
    </div>
    <div class="datacard">
      <h3>Load a JSON export</h3>
      <p>Restores a Shift export, with its history intact. Also reads an “Export everything” dump from the
         stakeholder-matrix Claude skill, so a map started there can be brought in.</p>
      <div class="actions" style="margin:0"><button id="impJson">Import JSON…</button></div>
    </div>
  </div>

  <h2>This map</h2>
  <div class="datagrid">
    <div class="datacard">
      <h3>Settings</h3>
      <div class="kv" style="margin-bottom:12px">
        <div><span>Name</span><span>${esc(project.name)}</span></div>
        <div><span>Stakeholders</span><span>${stakeholders.length}</span></div>
        <div><span>Recorded changes</span><span>${changeCount}</span></div>
        <div><span>Created</span><span>${esc(fmtDateTime(project.createdAt))}</span></div>
        <div><span>Last touched</span><span>${esc(fmtDateTime(project.updatedAt))}</span></div>
      </div>
      ${project.description ? `<p style="color:var(--ink-2)">${esc(project.description)}</p>` : ""}
      ${project.scaleNote ? `<p class="fhint" style="font-style:normal">Scoring convention: ${esc(project.scaleNote)}</p>` : ""}
      <div class="actions" style="margin:0"><button id="editProject">Edit details…</button></div>
    </div>

    <div class="datacard">
      <h3>Where this is stored</h3>
      <p id="storageBody">Checking…</p>
      <div class="kv" id="storageKv"></div>
      <div class="actions" style="margin:10px 0 0"><button id="expJson2">Download a backup now</button></div>
    </div>

    ${
      ctx.depthExtras
        ? `<div class="datacard">
             <h3>Outcome map</h3>
             <p>Readiness, the words this map uses, and the journal each review produces.</p>
             ${ctx.depthExtras.readinessHtml}
             <div class="actions" style="margin:12px 0 0">
               <button id="omReadiness">Score readiness…</button>
               <button id="omVocab">Vocabulary…</button>
               <button id="omVision">Vision &amp; mission…</button>
             </div>
             <div class="actions tight"><button id="omJournal">Download an outcome journal</button></div>
           </div>`
        : ""
    }

    <div class="datacard">
      <h3>Delete this map</h3>
      <p>Removes the map, its ${plural(stakeholders.length, "stakeholder")} and all
         ${plural(changeCount, "recorded change")}. This cannot be undone. Export first.</p>
      <div class="actions" style="margin:0"><button class="danger" id="delProject">Delete “${esc(project.name)}”…</button></div>
    </div>
  </div>`;

  const on = (id, fn) => {
    const el = host.querySelector("#" + id);
    if (el) el.addEventListener("click", fn);
  };
  on("expJson", ctx.onExportJson);
  on("expJson2", ctx.onExportJson);
  on("copyJson", ctx.onCopyJson);
  on("expCsv", ctx.onExportCsv);
  on("expPng", ctx.onExportPng);
  on("impCsv", ctx.onImportCsv);
  on("impJson", ctx.onImportJson);
  on("editProject", ctx.onEditProject);
  on("delProject", ctx.onDeleteProject);
  if (ctx.depthExtras) {
    on("omReadiness", ctx.depthExtras.onReadiness);
    on("omVocab", ctx.depthExtras.onVocabulary);
    on("omVision", ctx.depthExtras.onVision);
    on("omJournal", ctx.depthExtras.onJournal);
  }

  describeStorage(host, ctx);
}

async function describeStorage(host, ctx) {
  const body = host.querySelector("#storageBody");
  const kv = host.querySelector("#storageKv");
  if (!body) return;

  if (ctx.mode === "cloud") {
    body.innerHTML = `On the server, in <strong>${esc(ctx.orgName || "your organisation")}</strong>'s own area of the
      database. Everyone you have invited to that organisation can see and edit these maps; nobody outside it
      can. Access is enforced by the database itself, not just by this page.
      <br><br>Recorded history is <strong>append-only at the database level</strong> — a change can be corrected
      with a new entry, but no one, including an admin, can edit or delete what was already recorded.`;
    const rows = [
      ["Stored", "Server (per organisation)"],
      ["Visible to", ctx.memberCount != null ? `${ctx.memberCount} member${ctx.memberCount === 1 ? "" : "s"}` : "members of this organisation"],
      ["History", "Append-only, enforced by Postgres"],
      ["Offline", "Not available while signed in"],
    ];
    kv.innerHTML = rows.map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("");
    return;
  }

  let persisted = false;
  try {
    persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  } catch (e) {
    persisted = false;
  }

  body.innerHTML =
    "In this browser's own database, on this machine. Not on a server, and not visible to colleagues. " +
    (persisted
      ? "The browser has granted <strong>persistent</strong> storage, so it will not be evicted to reclaim space."
      : "The browser has <strong>not</strong> granted persistent storage, so it may be evicted under storage pressure. Installing Shift as an app usually fixes that.") +
    " It is lost if you clear site data, use a different browser, or lose the machine. <strong>Export regularly.</strong>";

  const est = await local.storageEstimate();
  const rows = [
    ["Stored", "This browser only"],
    ["Persistent", persisted ? "granted" : "not granted"],
  ];
  if (est && est.usage != null) {
    rows.push(["Used by this site", fmtBytes(est.usage)]);
    if (est.quota) rows.push(["Browser allowance", fmtBytes(est.quota)]);
  }
  kv.innerHTML = rows.map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("");
}

function fmtBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}
