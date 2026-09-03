/**
 * The project list — the first screen, and the one SPEC 3 puts a stopwatch on:
 * "Time from landing to a usable first map must be under five minutes, with no
 * account." So the blank slate is a single primary action, with the example and
 * the importer beside it, and nothing to sign up for.
 */

import { esc, fmtAgo, plural } from "./dom.js";

export function renderProjects(host, projects, handlers) {
  const list = projects.length
    ? `<div class="projlist">${projects
        .map(
          (p) => `<button class="projrow" data-open="${esc(p.id)}">
            <span>
              <span class="pname">${esc(p.name)}</span>
              ${p.description ? `<span class="pdesc">${esc(p.description)}</span>` : ""}
              <span class="pmeta">${esc(fmtAgo(p.updatedAt || p.createdAt))}</span>
            </span>
            <span class="pgo" aria-hidden="true">→</span>
          </button>`
        )
        .join("")}</div>
      <div class="actions">
        <button class="primary" id="newProject">New map</button>
        <button id="importJson">Import a JSON export…</button>
        <span class="spacer"></span>
        <button class="ghost" id="loadExample">Load the example map</button>
      </div>`
    : `<div class="blank">
        <h2>Start a map</h2>
        <p class="note">Three stages, in order. The third is the one other tools leave out, and it is the
          reason this keeps a history worth reading.</p>
        <ol>
          <li><strong>Map</strong> — who the actors are.</li>
          <li><strong>Analyse</strong> — score each on power and interest, and write the reasoning that produced those scores.</li>
          <li><strong>Strategise</strong> — a named engagement strategy per stakeholder: what change you are trying
              to produce in them, why your approach should work on <em>them</em>, and what you will actually do.</li>
        </ol>
        <div class="actions" style="margin:0">
          <button class="primary" id="newProject" data-autofocus>New map</button>
          <button id="loadExample">Load the example map</button>
          <button id="importJson">Import a JSON export…</button>
        </div>
      </div>`;

  host.innerHTML = `
    <h2 style="margin-top:6px">${projects.length ? plural(projects.length, "map") : "No maps yet"}</h2>
    ${projects.length ? '<p class="note">Each map is stored in this browser, on this machine. Nothing is uploaded.</p>' : ""}
    ${list}

    <footer>
      <p><strong>Why the rationale is compulsory.</strong> A score that moves without its reasoning moving is
        either an error or a silent change of mind, and neither is evidence. Shift will not save a score change
        until the rationale is updated, or you confirm it genuinely has not changed. Both outcomes are recorded.</p>
      <p><strong>Why the strategy is versioned.</strong> Each time you change how you are engaging a stakeholder,
        that starts a new strategy period, and the record shows what the scores did while it was in force. That is
        how you find out whether an approach worked instead of assuming it did — though movement during an
        approach is not proof the approach caused it.</p>
      <p><strong>Where your data lives.</strong> In this browser only. There is no account, no server and no
        copy anywhere else, which is deliberate: this tool holds adverse judgements about named organisations
        and sometimes named people. It also means clearing your browser data destroys it, and a colleague on
        another machine cannot see it. Use <em>Export everything (JSON)</em> to keep a backup and to share.</p>
    </footer>`;

  const on = (id, fn) => {
    const el = host.querySelector("#" + id);
    if (el) el.addEventListener("click", fn);
  };
  on("newProject", handlers.onNew);
  on("loadExample", handlers.onExample);
  on("importJson", handlers.onImport);
  for (const b of host.querySelectorAll("[data-open]")) {
    b.addEventListener("click", () => handlers.onOpen(b.dataset.open));
  }
}
