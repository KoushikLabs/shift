/**
 * The behaviour layer — SPEC v2 §7, depths 2 and 3.
 *
 * Three surfaces live here:
 *
 *   renderInstrument   the judged/observed comparison (SPEC 6.8) — the one
 *                      reading neither stakeholder mapping nor Outcome Mapping
 *                      can produce on its own
 *   renderMarkers      the per-stakeholder marker list and editor
 *   renderLadders      the project-wide view, and the way into a review
 *   reflectionDialog   one guided reflection cycle (SPEC 6.12)
 *
 * Two rules the code here exists to hold:
 *
 *   The tiers are DEPTH, NOT TIME (SPEC 6.10). Nothing sorts markers by date,
 *   charts them over time, or calls anything a "next step". A love-to-see may
 *   be observed in month three.
 *
 *   Nothing claims causation (SPEC 6.3). The instrument reports that two
 *   readings disagree. That is a prompt to look, and the caveat saying so is
 *   rendered with it rather than tucked into a footnote.
 */

import {
  DEPTH_OUTCOME,
  MARKER_TIERS,
  OBSERVED_LABELS,
  TIER_HINTS,
  TIER_LABELS,
  defaultCycleLabel,
  judgedVsObserved,
  ladderState,
  latestObservations,
  markerWarnings,
  reachLabel,
  stanceOf,
  stanceVar,
} from "../domain.js";
import { customDialog, confirmDialog } from "./modal.js";
import { esc, fmtDate, plural, signed } from "./dom.js";

/* ============================================================ the instrument */

const VERDICT_TONE = {
  ahead: "warn",
  behind: "warn",
  regressing: "bad",
  corroborated: "good",
  insufficient: "quiet",
};

/**
 * Judgement beside observation. Renders nothing without a ladder, because with
 * no markers there is only one reading and nothing to compare it against.
 */
export function instrumentHtml(stakeholder, markers, observations) {
  const r = judgedVsObserved(stakeholder, markers, observations);
  const tone = VERDICT_TONE[r.verdict] || "quiet";
  const l = r.ladder;

  const tiers = MARKER_TIERS.filter((t) => l.tiers[t].total > 0)
    .map(
      (t) =>
        `<span>${esc(TIER_LABELS[t].toLowerCase())} <b>${l.tiers[t].observed}/${l.tiers[t].total}</b></span>`
    )
    .join("");
  const untiered = l.untiered.total
    ? `<span>observed <b>${l.untiered.observed}/${l.untiered.total}</b></span>`
    : "";

  const pips = [];
  for (const t of MARKER_TIERS) {
    if (t === "regression") continue;
    for (let i = 0; i < l.tiers[t].total; i++) pips.push(i < l.tiers[t].observed);
  }
  for (let i = 0; i < l.untiered.total; i++) pips.push(i < l.untiered.observed);

  return `<div class="instrument ${tone}">
    <div class="inst-grid">
      <div class="inst-cell">
        <div class="inst-lab judged">Judged — what we think</div>
        <div class="inst-big">${signed(stakeholder.baseline ? stakeholder.baseline.interest : 0)} &rarr; ${signed(stakeholder.interest)}</div>
        <div class="inst-note">Interest${r.deltaPower ? `, and power ${signed(r.deltaPower)}` : ""}. Measured against the room there was to move.</div>
      </div>
      <div class="inst-cell">
        <div class="inst-lab observed">Observed — what they did</div>
        <div class="pips">${pips.map((on) => `<i class="pip${on ? " on" : ""}"></i>`).join("") || '<span class="empty">no behaviours yet</span>'}</div>
        <div class="tierline">${tiers}${untiered}${
          l.tiers.regression.observed ? `<span class="bad">backsliding <b>${l.tiers.regression.observed}</b></span>` : ""
        }</div>
      </div>
    </div>
    ${
      r.message
        ? `<div class="inst-verdict"><span class="mark">${tone === "good" ? "&#10003;" : tone === "bad" ? "&#9660;" : "&#9650;"}</span>
             <p>${esc(r.message)}</p></div>`
        : ""
    }
    ${
      r.verdict !== "insufficient"
        ? `<p class="inst-caveat">This says two readings disagree, not that anything caused anything. Treat it as a prompt to look.</p>`
        : ""
    }
  </div>`;
}

/* ============================================================ marker editor */

/**
 * @param ctx {stakeholder, markers, observations, depth, onAdd, onUpdate,
 *             onRetire, onRestore, onDelete, onToggleWatch}
 */
export function renderMarkers(host, ctx) {
  const { stakeholder, markers, depth } = ctx;
  const live = markers.filter((m) => !m.retired);
  const retired = markers.filter((m) => m.retired);
  const latest = latestObservations(ctx.observations);
  const isLadder = depth >= DEPTH_OUTCOME;

  const groups = isLadder
    ? MARKER_TIERS.map((t) => ({ tier: t, items: live.filter((m) => m.tier === t) }))
    : [{ tier: null, items: live }];

  const untieredAtDepth3 = isLadder ? live.filter((m) => !m.tier) : [];

  host.innerHTML = `
    ${instrumentHtml(stakeholder, markers, ctx.observations)}

    <div class="caveat" style="margin:18px 0 14px">
      <strong>${isLadder ? "The rungs are depth of change, not a timeline." : "Two to four observable behaviours is enough."}</strong>
      ${
        isLadder
          ? "A “love to see” behaviour can be observed in month three. Nothing here is ordered by time, and nothing should be read as a sequence."
          : "Write what you would actually <em>see</em> them doing. If you cannot picture observing it, it is an opinion, not a behaviour."
      }
    </div>

    ${groups
      .map(({ tier, items }) => {
        if (isLadder && !items.length && tier !== "regression") return tierShell(tier, items, latest, ctx);
        if (isLadder) return tierShell(tier, items, latest, ctx);
        return `<div class="mklist">${items.map((m) => markerRow(m, latest.get(m.id), ctx)).join("") || '<p class="empty">No behaviours yet.</p>'}</div>`;
      })
      .join("")}

    ${
      untieredAtDepth3.length
        ? `<div class="warnstrip" style="margin-top:14px"><strong>${plural(untieredAtDepth3.length, "behaviour")} not yet sorted into a rung.</strong>
             They came from Watch. Give each one a tier so it counts toward the ladder.</div>`
        : ""
    }

    <fieldset style="margin-top:18px">
      <span class="flabel">Add a behaviour</span>
      <p class="fhint">A gerund phrase naming one observable act — “publishing a dated conversion timeline”. The test: would two people reading this years apart score it the same way?</p>
      <input type="text" id="mkNew" placeholder="publishing a dated conversion timeline">
      ${
        isLadder
          ? `<div class="actions tight"><select id="mkTier" style="width:auto">${MARKER_TIERS.map(
              (t) => `<option value="${t}">${esc(TIER_LABELS[t])}</option>`
            ).join("")}</select><button class="primary" id="mkAdd" disabled>Add</button></div>`
          : `<div class="actions tight"><button class="primary" id="mkAdd" disabled>Add</button></div>`
      }
      <div id="mkWarn"></div>
    </fieldset>

    ${
      retired.length
        ? `<details class="retired"><summary>${plural(retired.length, "retired behaviour")}</summary>
             ${retired.map((m) => markerRow(m, latest.get(m.id), ctx)).join("")}
             <p class="fhint">Retired rather than deleted, so the record still shows what was being watched and when that stopped.</p>
           </details>`
        : ""
    }`;

  const input = host.querySelector("#mkNew");
  const addBtn = host.querySelector("#mkAdd");
  const warn = host.querySelector("#mkWarn");

  const refresh = () => {
    const text = input.value.trim();
    addBtn.disabled = !text;
    const ws = markerWarnings(text);
    warn.innerHTML = ws.length
      ? ws.map((w) => `<p class="warnline" style="display:block">${esc(w.message)}</p>`).join("")
      : "";
  };
  input.addEventListener("input", refresh);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      e.preventDefault();
      addBtn.click();
    }
  });
  addBtn.addEventListener("click", () => {
    const tierSel = host.querySelector("#mkTier");
    ctx.onAdd({ text: input.value.trim(), tier: tierSel ? tierSel.value : null });
  });

  for (const b of host.querySelectorAll("[data-watch]")) {
    b.addEventListener("click", () => ctx.onToggleWatch(b.dataset.watch, b.dataset.next === "1"));
  }
  for (const b of host.querySelectorAll("[data-retire]")) {
    b.addEventListener("click", () => ctx.onRetire(b.dataset.retire));
  }
  for (const b of host.querySelectorAll("[data-restore]")) {
    b.addEventListener("click", () => ctx.onRestore(b.dataset.restore));
  }
  for (const b of host.querySelectorAll("[data-del]")) {
    b.addEventListener("click", () => ctx.onDelete(b.dataset.del));
  }
  for (const sel of host.querySelectorAll("select[data-tier-of]")) {
    sel.addEventListener("change", () => ctx.onUpdate(sel.dataset.tierOf, { tier: sel.value }));
  }
  refresh();
}

function tierShell(tier, items, latest, ctx) {
  return `<div class="rung t-${tier}">
    <div class="rung-head">
      <span class="rung-name">${esc(TIER_LABELS[tier])}</span>
      <span class="rung-hint">${esc(TIER_HINTS[tier])}</span>
    </div>
    <div class="mklist">${
      items.map((m) => markerRow(m, latest.get(m.id), ctx)).join("") ||
      (tier === "regression"
        ? `<p class="warnline" style="display:block;margin:6px 0">
             <strong>No backsliding behaviours.</strong> Standard Outcome Mapping has no vocabulary for regression and
             practitioners almost never write one. In a movement with eighteen withdrawn chicken commitments, that is
             a gap rather than a clean bill of health.</p>`
        : '<p class="empty" style="margin:6px 0">None yet.</p>')
    }</div>
  </div>`;
}

function markerRow(m, obs, ctx) {
  const state = obs ? obs.observed : null;
  const ws = markerWarnings(m.text);
  const isLadder = ctx.depth >= DEPTH_OUTCOME;
  return `<div class="mkrow${m.retired ? " off" : ""}">
    <span class="mkbox ${state === "yes" ? "on" : state === "backwards" ? "neg" : ""}" title="${esc(state ? OBSERVED_LABELS[state] : "Not reviewed yet")}">${
      state === "yes" ? "&#10003;" : state === "backwards" ? "&#8595;" : ""
    }</span>
    <span class="mktext">${esc(m.text)}
      ${obs ? `<span class="mkwhen">${esc(OBSERVED_LABELS[state])} · ${esc(fmtDate(obs.at))}</span>` : ""}
      ${ws.length ? `<span class="mkwarn" title="${esc(ws.map((w) => w.message).join(" "))}">form</span>` : ""}
      ${!m.watched && !m.retired ? '<span class="chip">not watched</span>' : ""}
    </span>
    <span class="mkacts">
      ${
        isLadder && !m.retired
          ? `<select data-tier-of="${esc(m.id)}" class="tiny">${MARKER_TIERS.map(
              (t) => `<option value="${t}" ${m.tier === t ? "selected" : ""}>${esc(TIER_LABELS[t])}</option>`
            ).join("")}</select>`
          : ""
      }
      ${
        m.retired
          ? `<button class="small ghost" data-restore="${esc(m.id)}">Restore</button>`
          : `<button class="small ghost" data-watch="${esc(m.id)}" data-next="${m.watched ? "0" : "1"}">${m.watched ? "Stop watching" : "Watch"}</button>
             ${
               obs
                 ? `<button class="small ghost" data-retire="${esc(m.id)}">Retire</button>`
                 : `<button class="small ghost" data-del="${esc(m.id)}">Remove</button>`
             }`
      }
    </span>
  </div>`;
}

/* ============================================================ ladders view */

/**
 * @param ctx {stakeholders, depth, markersFor, observationsForStakeholder,
 *             cycles, onSelect, onReflect}
 */
export function renderLadders(host, ctx) {
  const withMarkers = ctx.stakeholders
    .map((s) => ({ s, markers: ctx.markersFor(s.id).filter((m) => !m.retired) }))
    .filter((x) => x.markers.length);

  const watched = withMarkers.reduce((n, x) => n + x.markers.filter((m) => m.watched).length, 0);
  const lastCycle = ctx.cycles[0];

  const intro = `<h2>Behaviour</h2>
    <p class="note">What each actor was actually seen doing, beside what you judged. Reviewed on a cycle —
      quarterly is the usual rhythm, hung on a meeting that already exists rather than a new one.</p>`;

  if (!withMarkers.length) {
    host.innerHTML =
      intro +
      `<div class="blank">
        <h2 style="margin-top:0">No behaviours recorded yet</h2>
        <p class="note">Open a stakeholder and use the <strong>Behaviour</strong> tab to write two to four things you
          would expect to <em>see</em> them doing. Keep it to the actors you actually work with — a pressure target
          you never speak to has no observable relationship to record.</p>
        <p class="note">If a team cannot keep this up for two quarters, it will not sustain a full outcome map either,
          and this is a much cheaper way to find that out.</p>
      </div>`;
    return;
  }

  host.innerHTML =
    intro +
    `<div class="actions" style="margin-bottom:16px">
      <button class="primary" id="startCycle">${lastCycle ? "Start a new review" : "Run the first review"}</button>
      <span class="status">${watched ? plural(watched, "behaviour") + " being watched" : "nothing is being watched"}</span>
      <span class="spacer"></span>
      ${lastCycle ? `<span class="status">last review ${esc(lastCycle.label)} · ${esc(fmtDate(lastCycle.closedAt || lastCycle.openedAt))}</span>` : ""}
    </div>

    <div class="ladderlist">
      ${withMarkers
        .map(({ s, markers }) => {
          const obs = ctx.observationsForStakeholder(s.id);
          const l = ladderState(markers, obs);
          const r = judgedVsObserved(s, markers, obs);
          const tone = VERDICT_TONE[r.verdict] || "quiet";
          return `<button class="ladderrow ${tone}" data-id="${esc(s.id)}">
            <span class="lr-main">
              <span class="lr-name"><i class="stance" style="background:${stanceVar(stanceOf(s.interest))}"></i>${esc(s.name)}
                <span class="reach ${reachClass(s.reach)}">${esc(reachLabel(s.reach))}</span></span>
              <span class="lr-msg">${esc(r.message || "")}</span>
            </span>
            <span class="lr-nums">
              <span class="lr-count">${l.observedCount}<span>/${l.markers}</span></span>
              <span class="lr-sub">seen · interest ${signed(s.interest)}</span>
            </span>
          </button>`;
        })
        .join("")}
    </div>

    ${
      ctx.cycles.length
        ? `<h2>Reviews</h2>
           <div class="kv">${ctx.cycles
             .slice(0, 8)
             .map(
               (c) =>
                 `<div><span>${esc(c.label)} · ${esc(fmtDate(c.closedAt || c.openedAt))}</span><span>${esc(
                   c.matteredForGoal ? "significance recorded" : "no significance noted"
                 )}</span></div>`
             )
             .join("")}</div>`
        : ""
    }`;

  host.querySelector("#startCycle").addEventListener("click", ctx.onReflect);
  for (const b of host.querySelectorAll(".ladderrow[data-id]")) {
    b.addEventListener("click", () => ctx.onSelect(b.dataset.id));
  }
}

function reachClass(reach) {
  return reach === "target" ? "pt" : reach === "out-of-reach" ? "oor" : "bp";
}

/* ========================================================= reflection cycle */

/**
 * One guided pass through the behaviours being watched.
 *
 * Walks only `watched` markers (SPEC 6.11 — the documented failure is agreeing
 * to monitor selectively and then monitoring everything), and refuses to close
 * without the three questions that make it a review rather than a checklist
 * (SPEC 6.12).
 *
 * Resolves to {cycle, entries} or null.
 */
export function reflectionDialog({ stakeholders, markersFor, observationsForStakeholder, cycles }) {
  const items = [];
  for (const s of stakeholders) {
    for (const m of markersFor(s.id)) {
      if (m.retired || !m.watched) continue;
      items.push({ stakeholder: s, marker: m });
    }
  }

  if (!items.length) {
    return confirmDialog({
      title: "Nothing is being watched",
      body: `<p class="note">A review walks the behaviours marked as watched this cycle. None are.</p>
        <p class="note">Open a stakeholder's <strong>Behaviour</strong> tab and set which ones you are actually
          reviewing — deciding that deliberately is the point, and monitoring everything is the documented way
          this practice collapses.</p>`,
      confirmLabel: "Close",
      cancelLabel: "Close",
    }).then(() => null);
  }

  return customDialog(
    (dlg, close) => {
      let i = 0;
      const entries = new Map();
      const closing = { label: defaultCycleLabel(), wentBackwards: "", matteredForGoal: "", mapChangesProposed: "" };
      let stage = "walk";

      const draw = () => {
        stage === "walk" ? drawItem() : drawClose();
      };

      function drawItem() {
        const { stakeholder, marker } = items[i];
        const prior = observationsForStakeholder(stakeholder.id)
          .filter((o) => o.markerId === marker.id)
          .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
        const e = entries.get(marker.id) || {
          markerId: marker.id,
          observed: "not-yet",
          narrative: "",
          evidence: "",
          contribution: "",
          significance: "",
        };

        dlg.innerHTML = `<div class="dlg">
          <div class="dlghead">
            <h2>Review · ${esc(closing.label)}</h2>
            <p>Behaviour ${i + 1} of ${items.length} · ${esc(stakeholder.name)}</p>
          </div>
          <div class="dlgbody">
            <div class="revmarker">${esc(marker.text)}</div>
            ${
              prior
                ? `<p class="fhint" style="font-style:normal">Last review: <strong>${esc(OBSERVED_LABELS[prior.observed])}</strong>, ${esc(fmtDate(prior.at))}. ${esc(prior.narrative.slice(0, 140))}</p>`
                : `<p class="fhint" style="font-style:normal">Not reviewed before.</p>`
            }

            <fieldset>
              <span class="flabel">Since the last review</span>
              <div class="segs" id="segs">
                ${["yes", "not-yet", "backwards"]
                  .map(
                    (v) =>
                      `<button type="button" data-obs="${v}" class="${e.observed === v ? "on " + v : ""}">${esc(OBSERVED_LABELS[v])}</button>`
                  )
                  .join("")}
              </div>
            </fieldset>

            <fieldset><span class="flabel">What changed</span>
              <p class="fhint">Five to ten lines. Their behaviour, not your activities.</p>
              <textarea id="rNarr" rows="3">${esc(e.narrative)}</textarea></fieldset>

            <fieldset><span class="flabel">Evidence</span>
              <p class="fhint">What you are relying on — a meeting note, a publication, a filing.</p>
              <textarea id="rEvid" rows="2">${esc(e.evidence)}</textarea></fieldset>

            <fieldset><span class="flabel">Our contribution</span>
              <p class="fhint">What you did that may bear on it. Not a claim that you caused it.</p>
              <textarea id="rContrib" rows="2">${esc(e.contribution)}</textarea></fieldset>

            <fieldset><span class="flabel">Significance for the goal</span>
              <p class="fhint">Did this matter? An actor can tick every behaviour while the goal recedes — this field is the only
                thing that catches it, and it is a partial answer at best.</p>
              <textarea id="rSig" rows="2">${esc(e.significance)}</textarea></fieldset>
          </div>
          <div class="dlgfoot">
            <span class="status">${entries.size} of ${items.length} recorded</span>
            <button type="button" id="rAbandon">Abandon</button>
            <button type="button" id="rPrev" ${i === 0 ? "disabled" : ""}>Back</button>
            <button type="button" class="primary" id="rNext">${i === items.length - 1 ? "Finish" : "Next"}</button>
          </div>
        </div>`;

        const capture = () => {
          const next = {
            markerId: marker.id,
            observed: dlg.querySelector(".segs .on") ? dlg.querySelector(".segs .on").dataset.obs : "not-yet",
            narrative: dlg.querySelector("#rNarr").value.trim(),
            evidence: dlg.querySelector("#rEvid").value.trim(),
            contribution: dlg.querySelector("#rContrib").value.trim(),
            significance: dlg.querySelector("#rSig").value.trim(),
          };
          // Only record a marker that was actually engaged with. A dialog full of
          // untouched "not yet" rows is not a review and should not look like one.
          const touched =
            next.observed !== "not-yet" || next.narrative || next.evidence || next.contribution || next.significance;
          if (touched) entries.set(marker.id, next);
          else entries.delete(marker.id);
        };

        for (const b of dlg.querySelectorAll("[data-obs]")) {
          b.addEventListener("click", () => {
            for (const x of dlg.querySelectorAll("[data-obs]")) x.className = "";
            b.className = "on " + b.dataset.obs;
          });
        }
        dlg.querySelector("#rAbandon").addEventListener("click", () => close(null));
        dlg.querySelector("#rPrev").addEventListener("click", () => {
          capture();
          i = Math.max(0, i - 1);
          draw();
        });
        dlg.querySelector("#rNext").addEventListener("click", () => {
          capture();
          if (i === items.length - 1) stage = "close";
          else i++;
          draw();
        });
      }

      function drawClose() {
        dlg.innerHTML = `<div class="dlg">
          <div class="dlghead">
            <h2>Close the review</h2>
            <p>${plural(entries.size, "behaviour")} recorded of ${items.length} watched.</p>
          </div>
          <div class="dlgbody">
            <fieldset><span class="flabel">Name this review</span>
              <input type="text" id="cLabel" value="${esc(closing.label)}"></fieldset>

            <div class="caveat" style="margin:4px 0 16px"><strong>Three questions the standard protocol leaves out.</strong>
              They are what make this a review rather than a checklist, which is the documented way the practice dies.</div>

            <fieldset><span class="flabel">What moved backwards?</span>
              <p class="fhint">Practitioners almost never record this. Write “nothing” if nothing did — that is an answer.</p>
              <textarea id="cBack" rows="2">${esc(closing.wentBackwards)}</textarea></fieldset>

            <fieldset><span class="flabel">Did any of this matter for the goal?</span>
              <p class="fhint">Or did partners tick behaviours while the goal receded?</p>
              <textarea id="cMattered" rows="2">${esc(closing.matteredForGoal)}</textarea></fieldset>

            <fieldset><span class="flabel">What would we now change in the map itself?</span>
              <p class="fhint">Behaviours to retire, actors to re-triage, scores that look wrong next to what you just recorded.</p>
              <textarea id="cChanges" rows="2">${esc(closing.mapChangesProposed)}</textarea></fieldset>

            <p class="warnline" id="cWarn" hidden></p>
          </div>
          <div class="dlgfoot">
            <span class="status"></span>
            <button type="button" id="cBackBtn">Back to behaviours</button>
            <button type="button" class="primary" id="cDone">Record the review</button>
          </div>
        </div>`;

        const read = () => ({
          label: dlg.querySelector("#cLabel").value.trim() || defaultCycleLabel(),
          wentBackwards: dlg.querySelector("#cBack").value.trim(),
          matteredForGoal: dlg.querySelector("#cMattered").value.trim(),
          mapChangesProposed: dlg.querySelector("#cChanges").value.trim(),
        });

        dlg.querySelector("#cBackBtn").addEventListener("click", () => {
          Object.assign(closing, read());
          stage = "walk";
          i = items.length - 1;
          draw();
        });

        dlg.querySelector("#cDone").addEventListener("click", () => {
          const c = read();
          const warn = dlg.querySelector("#cWarn");
          if (!entries.size) {
            warn.hidden = false;
            warn.innerHTML = "<strong>Nothing was recorded.</strong> Go back and score at least one behaviour.";
            return;
          }
          // SPEC 6.12 — the three questions are the review. Not optional.
          if (!c.wentBackwards || !c.matteredForGoal || !c.mapChangesProposed) {
            warn.hidden = false;
            warn.innerHTML =
              "<strong>All three questions need an answer.</strong> “Nothing” and “no change” are perfectly good answers — " +
              "leaving them blank is what turns this back into a checklist.";
            return;
          }
          close({ cycle: c, entries: [...entries.values()] });
        });
      }

      draw();
    },
    { wide: true }
  );
}
