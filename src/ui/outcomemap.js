/**
 * The rest of depth 3 — SPEC v2 §7.
 *
 *   readinessDialog     the ten conditions, three of them disqualifying
 *   vocabularyDialog    the four agreed word swaps
 *   visionPanel         vision and mission, shown above the map
 *   strategyMapHtml     the 2x3 grid, and what its gaps say
 *   outcomeJournalText  one review, formatted for the meeting
 *
 * The scorecard warns and does not block (SPEC v2 §7). What it does instead is
 * recommend a depth — which turns it from a ceremony into the thing that
 * chooses how much machinery the map should carry.
 */

import {
  DEPTH_LABELS,
  DYER_CHECKS,
  OBSERVED_LABELS,
  READINESS_CONDITIONS,
  READINESS_MAX,
  STRATEGY_CELL_HINTS,
  STRATEGY_COLS,
  STRATEGY_ROWS,
  VOCABULARY_FIELDS,
  VOCABULARY_PROMPTS,
  normalizeStrategyMap,
  normalizeVocabulary,
  readinessVerdict,
  strategyMapGaps,
  tierLabel,
} from "../domain.js";
import { customDialog } from "./modal.js";
import { esc, fmtDate, plural } from "./dom.js";

/* ========================================================= readiness gate */

const VERDICT_TONE = {
  full: "good",
  stripped: "good",
  watch: "warn",
  decline: "bad",
  partial: "quiet",
  unscored: "quiet",
};

/**
 * Resolves to {scores, recommendedDepth} or null if abandoned.
 * @param existing previously recorded scores, if any
 */
export function readinessDialog(existing) {
  return customDialog(
    (dlg, close) => {
      const scores = { ...(existing || {}) };

      const draw = () => {
        const v = readinessVerdict(scores);
        dlg.innerHTML = `<div class="dlg">
          <div class="dlghead">
            <h2>Is this map ready for a full outcome map?</h2>
            <p>Ten conditions, scored 0 for absent, 1 for partial, 2 for present. Three of them are disqualifying
              on their own, whatever the total. The first four are the manual's own, which makes them hard for an
              enthusiast to argue with.</p>
          </div>
          <div class="dlgbody">
            <div class="scorelist">
              ${READINESS_CONDITIONS.map(
                (c, i) => `<div class="scorerow${c.gate ? " gate" : ""}">
                  <span class="sq">${i + 1}. ${esc(c.text)}${c.gate ? '<span class="gatetag">disqualifying</span>' : ""}</span>
                  <span class="sopts">${[0, 1, 2]
                    .map(
                      (n) =>
                        `<button type="button" data-k="${c.key}" data-v="${n}" class="${scores[c.key] === n ? "on" : ""}${
                          c.gate && n === 0 && scores[c.key] === 0 ? " zero" : ""
                        }">${n}</button>`
                    )
                    .join("")}</span>
                </div>`
              ).join("")}
            </div>

            <div class="verdictbox ${VERDICT_TONE[v.verdict]}">
              <div class="vtotal">${v.total}<span>/${READINESS_MAX}</span></div>
              <div class="vtext">
                <strong>${esc(v.headline)}</strong>
                ${v.detail ? `<p>${esc(v.detail)}</p>` : ""}
                ${
                  v.recommendedDepth
                    ? `<p class="vrec">Recommended depth for this map: <strong>${esc(DEPTH_LABELS[v.recommendedDepth])}</strong></p>`
                    : ""
                }
              </div>
            </div>

            <p class="fhint" style="font-style:normal;margin-top:12px">Nothing here blocks you. A tool that refuses
              gets worked around, and the answers are worth more later than the refusal would have been — they are
              saved with the map.</p>
          </div>
          <div class="dlgfoot">
            <span class="status">${v.answered} of ${READINESS_CONDITIONS.length} scored</span>
            <button type="button" id="rSkip">Skip for now</button>
            <button type="button" class="primary" id="rSave">Save and continue</button>
          </div>
        </div>`;

        for (const b of dlg.querySelectorAll("[data-k]")) {
          b.addEventListener("click", () => {
            const k = b.dataset.k;
            const n = Number(b.dataset.v);
            scores[k] = scores[k] === n ? undefined : n;
            if (scores[k] === undefined) delete scores[k];
            draw();
          });
        }
        dlg.querySelector("#rSkip").addEventListener("click", () => close({ scores: null, recommendedDepth: null }));
        dlg.querySelector("#rSave").addEventListener("click", () =>
          close({ scores, recommendedDepth: readinessVerdict(scores).recommendedDepth })
        );
      };

      draw();
    },
    { wide: true }
  );
}

/** A compact readout of a saved scorecard, for the Data panel. */
export function readinessSummaryHtml(readiness) {
  if (!readiness) {
    return `<p class="note">The readiness conditions have not been scored for this map.</p>`;
  }
  const v = readinessVerdict(readiness);
  return `<div class="verdictbox ${VERDICT_TONE[v.verdict]}" style="margin:0">
    <div class="vtotal">${v.total}<span>/${READINESS_MAX}</span></div>
    <div class="vtext"><strong>${esc(v.headline)}</strong>
      ${v.gateFailures.length ? `<p>${esc(v.gateFailures.map((g) => g.text).join(" · "))}</p>` : ""}</div>
  </div>`;
}

/* ============================================================= vocabulary */

/** Resolves to a vocabulary object, or null. */
export function vocabularyDialog(current) {
  const v = normalizeVocabulary(current);
  return customDialog((dlg, close) => {
    dlg.innerHTML = `<div class="dlg">
      <div class="dlghead">
        <h2>The words this map uses</h2>
        <p>Agree these once, in the orientation session, and use them consistently. The Outcome Mapping Learning
          Community explicitly licenses renaming — three of these terms are documented as causing trouble in rooms.</p>
      </div>
      <div class="dlgbody">
        ${VOCABULARY_FIELDS.map((k) => {
          const p = VOCABULARY_PROMPTS[k];
          return `<fieldset>
            <span class="flabel">${esc(p.label)}</span>
            <p class="fhint">${esc(p.hint)}</p>
            <input type="text" id="v-${k}" value="${esc(v[k])}" list="opts-${k}">
            <datalist id="opts-${k}">${p.options.map((o) => `<option value="${esc(o)}"></option>`).join("")}</datalist>
          </fieldset>`;
        }).join("")}
        <div class="caveat">Only these four. Every configurable label is a translation layer through the whole
          interface, and the point is to settle the words rather than to make everything renameable.</div>
      </div>
      <div class="dlgfoot">
        <button type="button" id="vCancel">Cancel</button>
        <button type="button" class="primary" id="vSave">Save</button>
      </div>
    </div>`;

    dlg.querySelector("#vCancel").addEventListener("click", () => close(null));
    dlg.querySelector("#vSave").addEventListener("click", () => {
      const out = {};
      for (const k of VOCABULARY_FIELDS) out[k] = dlg.querySelector("#v-" + k).value.trim();
      close(normalizeVocabulary(out));
    });
  });
}

/* ======================================================== vision & mission */

export function visionPanelHtml(project) {
  const has = String(project.vision || "").trim() || String(project.mission || "").trim();
  if (!has) {
    return `<div class="visionpanel empty">
      <div>
        <span class="vp-lab">Vision and mission</span>
        <p class="note" style="margin:6px 0 0">Not written yet. The vision is what the world looks like if you
          <em>and everyone else working on this</em> succeed — deliberately bigger than your organisation. The
          mission is your lane inside it.</p>
      </div>
      <button class="small" id="editVision">Write them</button>
    </div>`;
  }
  return `<div class="visionpanel">
    <div>
      ${project.vision ? `<span class="vp-lab">Vision</span><p class="vp-text">${esc(project.vision)}</p>` : ""}
      ${project.mission ? `<span class="vp-lab">Mission</span><p class="vp-text">${esc(project.mission)}</p>` : ""}
    </div>
    <button class="small ghost" id="editVision">Edit</button>
  </div>`;
}

/* ========================================================== strategy map */

/**
 * The 2x3 grid. Empty cells are rendered as loudly as filled ones — noticing
 * them is the entire exercise, and a grid that makes gaps look tidy has thrown
 * the point away.
 */
export function strategyMapHtml(map) {
  const m = normalizeStrategyMap(map);
  const gaps = strategyMapGaps(m);

  return `<div class="smap">
    <div class="smap-grid">
      <div class="sm-corner"></div>
      ${STRATEGY_COLS.map((c) => `<div class="sm-col"><b>${esc(c.label)}</b><span>${esc(c.hint)}</span></div>`).join("")}
      ${STRATEGY_ROWS.map(
        (r) => `<div class="sm-row">${esc(r.label)}</div>
          ${r.cells
            .map(
              (cell) => `<label class="sm-cell${m[cell].trim() ? " filled" : " empty"}">
                <textarea data-cell="${cell}" rows="3" placeholder="${esc(STRATEGY_CELL_HINTS[cell])}">${esc(m[cell])}</textarea>
              </label>`
            )
            .join("")}`
      ).join("")}
    </div>
    ${
      gaps.length
        ? `<div class="warnstrip" style="margin-top:12px"><strong>What the gaps say.</strong>
             ${gaps.map((g) => esc(g)).join(" ")}</div>`
        : `<p class="fhint" style="margin-top:10px">The useful part of this grid is the empty cells. A team with
             everything in the top row is working on the actor and nothing around them; a team with only causal
             entries has exactly one tactic.</p>`
    }
  </div>`;
}

/* ================================================= the outcome challenge */

export function dyerChecksHtml() {
  return `<div class="caveat" style="margin-bottom:12px">
    <strong>Read these before drafting, not after.</strong>
    <ol class="tight" style="margin:6px 0 0">${DYER_CHECKS.map((c) => `<li>${esc(c)}</li>`).join("")}</ol>
  </div>`;
}

/* ==================================================== outcome journal text */

/**
 * One review, formatted for the meeting it will be read in.
 *
 * Plain text on purpose. The documented reality of Outcome Mapping tooling is
 * word-processor templates and exercise books; what a partner needs is
 * something they can paste into an agenda, not a format only this app reads.
 */
export function outcomeJournalText({ project, cycle, entries, stakeholderName, markerText }) {
  const L = [];
  const rule = (ch) => ch.repeat(72);

  L.push(project.name);
  L.push("Outcome journal — " + cycle.label);
  L.push(rule("="));
  L.push("");
  if (cycle.closedAt) L.push("Reviewed: " + fmtDate(cycle.closedAt));
  if (cycle.by) L.push("Completed by: " + cycle.by);
  L.push(plural(entries.length, "behaviour") + " reviewed.");
  L.push("");

  const byStakeholder = new Map();
  for (const e of entries) {
    const name = stakeholderName(e.stakeholderId) || "Unknown";
    if (!byStakeholder.has(name)) byStakeholder.set(name, []);
    byStakeholder.get(name).push(e);
  }

  for (const [name, list] of [...byStakeholder.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    L.push(name);
    L.push(rule("-"));
    for (const e of list) {
      L.push("");
      L.push("  " + (markerText(e.markerId) || "(behaviour removed)"));
      L.push("  Status: " + (OBSERVED_LABELS[e.observed] || e.observed));
      if (e.narrative) L.push(wrap("  What changed: ", e.narrative));
      if (e.evidence) L.push(wrap("  Evidence: ", e.evidence));
      if (e.contribution) L.push(wrap("  Our contribution: ", e.contribution));
      if (e.significance) L.push(wrap("  Significance: ", e.significance));
    }
    L.push("");
  }

  L.push(rule("="));
  L.push("Closing the cycle");
  L.push("");
  L.push(wrap("What moved backwards: ", cycle.wentBackwards || "—"));
  L.push(wrap("Did any of it matter for the goal: ", cycle.matteredForGoal || "—"));
  L.push(wrap("What we would now change in the map: ", cycle.mapChangesProposed || "—"));
  L.push("");
  L.push(rule("-"));
  L.push(
    "This record shows whether actors changed while an approach was in force. It does not establish that the"
  );
  L.push(
    "approach caused the change, and it does not measure whether the change mattered beyond the note above."
  );
  return L.join("\n");
}

function wrap(prefix, text, width = 88) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = prefix;
  const indent = " ".repeat(prefix.length - prefix.trimStart().length + 4);
  for (const w of words) {
    if ((line + " " + w).length > width && line.trim() !== prefix.trim()) {
      lines.push(line);
      line = indent + w;
    } else {
      line = line.trim() === prefix.trim() && line.endsWith(" ") ? line + w : line + (line === prefix ? "" : " ") + w;
      if (line === prefix + w) line = prefix + w;
    }
  }
  lines.push(line);
  return lines.join("\n");
}

export { tierLabel };
