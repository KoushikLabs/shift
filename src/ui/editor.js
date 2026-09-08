/**
 * The four-tab stakeholder detail editor.
 *
 * Ported and extended from the skill template. The four tabs are SPEC 7's
 * "Detail" row: scores & reasoning · engagement strategy · strategy & effect ·
 * full history.
 *
 * Two non-negotiables live in this file:
 *   SPEC 6.1 — a score cannot move without its rationale being addressed.
 *              `refresh()` computes the gate on every keystroke; `save` stays
 *              disabled until it is satisfied. Both outcomes (edited rationale,
 *              or ticked acknowledgement) end up in the history, the second as
 *              a rationale that did not change beside a score that did.
 *   SPEC 6.3 — the effect view must not overclaim. The caveat is rendered
 *              inside the panel, not tucked into a footnote.
 *
 * The editor owns its DOM while the user is typing. app.js will not re-render
 * it while `state.dirty` is true, so nothing swallows half-typed input.
 */

import {
  STRATEGY_FIELDS,
  STRATEGY_HINTS,
  STRATEGY_LABELS,
  emptyStrategy,
  hasStrategy,
  interestBand,
  looksLikeIndividual,
  looksLikeQuadrantLabel,
  normalizeStrategy,
  powerBand,
  rationaleGate,
  sameStrategy,
  sortChangesDescending,
  stanceLabel,
  stanceOf,
  stanceVar,
  strategyPeriods,
} from "../domain.js";
import { esc, fmtDate, fmtDateTime, signed } from "./dom.js";
import { DEPTH_OUTCOME, DEPTH_WATCH, outcomeChallengeWarnings, reachLabel } from "../domain.js";
import { dyerChecksHtml, strategyMapHtml } from "./outcomemap.js";
import { renderMarkers } from "./behaviour.js";

/**
 * @param {HTMLElement} host
 * @param {object} ctx  {stakeholder, changes, tab, onTab, onSave, onDirty, onDelete, onIdentity, onClose}
 */
export function renderEditor(host, ctx) {
  const d = ctx.stakeholder;
  if (!d) {
    host.innerHTML = "";
    return;
  }
  const tab = ctx.tab || "score";
  const b = d.baseline || { power: d.power, interest: d.interest, strategy: emptyStrategy() };
  const st = stanceOf(d.interest);
  const strategyMissing = !hasStrategy(d.strategy);

  host.innerHTML = `
  <div class="editor ${st}" id="editorCard">
    <div class="ehead">
      <div>
        <h3>${esc(d.name)}${d.isIndividual ? '<span class="person" title="Named individual">person</span>' : ""}</h3>
        <div class="emeta">${esc(d.type || "no type")} ·
          <span class="reach ${d.reach === "target" ? "pt" : d.reach === "out-of-reach" ? "oor" : "bp"}">${esc(reachLabel(d.reach))}</span> ·
          <span style="color:${stanceVar(st)};font-weight:700">${stanceLabel(st)}</span>
          · started at power ${b.power}, interest ${signed(b.interest)}
          ${d.updatedAt ? " · last changed " + fmtDate(d.updatedAt) : " · never changed"}</div>
      </div>
      <div class="actions" style="margin:0">
        <button class="ghost small" id="edEdit">Rename…</button>
        <button class="ghost small" id="edClose" aria-label="Close">Close</button>
      </div>
    </div>

    <div class="tabs" role="tablist">
      <button data-tab="score" role="tab" aria-selected="${tab === "score"}" class="${tab === "score" ? "on" : ""}">Scores &amp; reasoning</button>
      <button data-tab="strategy" role="tab" aria-selected="${tab === "strategy"}" class="${tab === "strategy" ? "on" : ""}">Engagement strategy${strategyMissing ? ' <span class="dot-warn" title="No strategy set">•</span>' : ""}</button>
      ${
        ctx.depth >= DEPTH_WATCH
          ? `<button data-tab="behaviour" role="tab" aria-selected="${tab === "behaviour"}" class="${tab === "behaviour" ? "on" : ""}">Behaviour${
              ctx.markers && ctx.markers.filter((m) => !m.retired).length
                ? ` <span class="count">${ctx.markers.filter((m) => !m.retired).length}</span>`
                : ""
            }</button>`
          : ""
      }
      <button data-tab="effect" role="tab" aria-selected="${tab === "effect"}" class="${tab === "effect" ? "on" : ""}">Strategy &amp; effect</button>
      <button data-tab="hist" role="tab" aria-selected="${tab === "hist"}" class="${tab === "hist" ? "on" : ""}">Full history</button>
    </div>

    <div class="pane" id="p-score" ${tab !== "score" ? "hidden" : ""}>
      <div class="sliders">
        <div class="sl">
          <label for="sp">Power &mdash; 0 to 10</label>
          <div class="row"><input type="range" id="sp" min="0" max="10" step="1" value="${d.power}"><span class="v" id="vp">${d.power}</span></div>
          <div class="scaleband" id="bandP"></div>
        </div>
        <div class="sl">
          <label for="si">Interest &mdash; &minus;10 to +10 &middot; negative means opposed</label>
          <div class="row"><input type="range" id="si" min="-10" max="10" step="1" value="${d.interest}"><span class="v" id="vi">${signed(d.interest)}</span></div>
          <div class="scaleband" id="bandI"></div>
        </div>
      </div>
      ${
        d.reach === "out-of-reach"
          ? `<p class="warnline" style="display:block;margin-bottom:14px"><strong>Out of reach.</strong>
               ${
                 (d.reachableVia || []).length
                   ? "Reachable through " + esc((ctx.reachableNames || []).join(", ")) + ". Those are the actors you actually engage."
                   : "Nobody is recorded as able to reach them. Name who can — the manual&rsquo;s own instruction is to work out who you <em>can</em> influence who will in turn influence them."
               }</p>`
          : ""
      }
      <fieldset>
        <span class="flabel">Rationale</span>
        <p class="fhint">What evidence produced these scores, and why they are not higher or lower. Not what the score means — what made you choose it.</p>
        <textarea id="rat" rows="4" placeholder="e.g. Closure powers under the Water and Air Acts, and demonstrably used them — 13 farms closed in one district drive. Interest +6 rather than higher because the action was on pollution grounds, not welfare.">${esc(d.rationale || "")}</textarea>
        <p class="stalemsg" id="stale" hidden>You changed a score. Update the rationale to say what happened, or confirm below that the reasoning has not changed.</p>
        <label class="ack" id="acklbl" hidden><input type="checkbox" id="ack"> <span>The reasoning has not changed &mdash; this corrects an earlier scoring error.</span></label>
        <p class="warnline" id="warnUnknown" hidden><strong>Scored neutral.</strong> If this is because nobody has spoken to them yet, say so in the rationale. An honest “no contact yet — assumed neutral” is the single most common thing that later moves.</p>
        <p class="warnline" id="warnPerson" hidden></p>
      </fieldset>
    </div>

    <div class="pane" id="p-strategy" ${tab !== "strategy" ? "hidden" : ""}>
      ${ctx.depth >= DEPTH_OUTCOME ? dyerChecksHtml() : ""}
      ${st === "oppose" && strategyMissing ? `<p class="warnline" style="margin-bottom:14px" >
        <strong>Opponents get a strategy too.</strong> This is the commonest gap. “Do not approach first; monitor filings; respond only through formal process” is a strategy — it says what you will and will not do, and what would change it. “Monitor” is not.</p>` : ""}
      ${STRATEGY_FIELDS.map(
        (k) => `<fieldset>
          <span class="flabel">${
            k === "objective" && ctx.depth >= DEPTH_OUTCOME ? "Outcome challenge" : STRATEGY_LABELS[k]
          }</span>
          <p class="fhint">${esc(
            k === "objective" && ctx.depth >= DEPTH_OUTCOME
              ? "How this actor would behave if you succeeded beyond expectation. Six to eight lines describing a change in THEM — their behaviour, relationships, activities or actions — never your delivery."
              : STRATEGY_HINTS[k]
          )}</p>
          ${
            k === "owner" || k === "cadence"
              ? `<input type="text" id="s-${k}" value="${esc(d.strategy[k] || "")}">`
              : `<textarea id="s-${k}" rows="${
                  k === "objective" ? (ctx.depth >= DEPTH_OUTCOME ? 6 : 2) : 3
                }">${esc(d.strategy[k] || "")}</textarea>`
          }
          ${k === "objective" && ctx.depth >= DEPTH_OUTCOME ? '<div id="challengeWarn"></div>' : ""}
          ${k === "objective" ? '<p class="warnline" id="warnQuadrant" hidden><strong>That is a quadrant label, not a strategy.</strong> “Monitor”, “keep informed” and the rest describe an intensity of attention. They are derived from the two scores, so they carry no information the scores do not already carry. Say what should be <em>different</em> about this stakeholder.</p>' : ""}
        </fieldset>`
      ).join("")}
      <p class="fhint">Changing any of these starts a new strategy period. Use the note field below for events <em>within</em> the current approach — a meeting, a call, a filing. Over-versioning fragments the periods and makes the effect view useless.</p>

      ${
        ctx.depth >= DEPTH_OUTCOME
          ? `<h4 style="margin-top:24px">Strategy map</h4>
             <p class="fhint">How each approach works: on the actor, or on what surrounds them. Saved as you type —
               this is a classification of the approach, not a change of tack, so it does not open a new strategy period.</p>
             <div id="smapHost">${strategyMapHtml(d.strategyMap)}</div>`
          : ""
      }
    </div>

    <div class="pane" id="p-behaviour" ${tab !== "behaviour" ? "hidden" : ""}><div id="bbody"></div></div>

    <div class="pane" id="p-effect" ${tab !== "effect" ? "hidden" : ""}>
      <div id="ebody"></div>
    </div>

    <div class="pane" id="p-hist" ${tab !== "hist" ? "hidden" : ""}>
      <div class="hist" id="hbody"></div>
    </div>

    <fieldset style="margin-top:14px">
      <span class="flabel">What happened &mdash; note for the record</span>
      <textarea id="note" rows="2" placeholder="e.g. Met the Regional Officer; they asked for the register in writing."></textarea>
    </fieldset>
    <div class="actions">
      <button class="primary" id="save" disabled>Save change</button>
      <button id="revert">Revert</button>
      <span class="status" id="estatus"></span>
      <span class="spacer"></span>
      <button class="danger small" id="edDelete">Delete stakeholder</button>
    </div>
  </div>`;

  /* ------------------------------------------------------------- wiring */

  const q = (sel) => host.querySelector(sel);
  const sp = q("#sp");
  const si = q("#si");
  const rat = q("#rat");
  const ack = q("#ack");
  const acklbl = q("#acklbl");
  const stale = q("#stale");
  const save = q("#save");
  const estatus = q("#estatus");

  const origRationale = d.rationale || "";
  const origStrategy = normalizeStrategy(d.strategy);

  const readStrategy = () => {
    const o = emptyStrategy();
    for (const k of STRATEGY_FIELDS) {
      const el = q("#s-" + k);
      o[k] = el ? el.value : d.strategy[k] || "";
    }
    return o;
  };

  function refresh() {
    const np = Number(sp.value);
    const ni = Number(si.value);
    const nr = rat.value.trim();
    const ns = readStrategy();

    q("#vp").textContent = np;
    q("#vi").textContent = signed(ni);
    q("#bandP").textContent = powerBand(np);
    q("#bandI").textContent = interestBand(ni);
    si.className = ni <= -2 ? "neg" : ni >= 2 ? "" : "neu";

    const scoreMoved = np !== d.power || ni !== d.interest;
    const rationaleMoved = nr !== origRationale.trim();
    const strategyMoved = !sameStrategy(origStrategy, ns);

    const gate = rationaleGate({
      scoreMoved,
      rationaleMoved,
      acknowledged: ack && ack.checked,
      rationaleText: nr,
    });

    stale.hidden = !gate.needsAttention;
    acklbl.hidden = !gate.acknowledgeable;
    rat.classList.toggle("stale", gate.needsAttention && !(ack && ack.checked));

    // SPEC 6.6 — prompt for the unknown-as-neutral case rather than waiting.
    const wu = q("#warnUnknown");
    if (wu) wu.hidden = !(stanceOf(ni) === "neutral" && nr.length > 0 && !/unknown|no contact|not (yet )?(spoken|met|approached)|assumed neutral|no basis|haven'?t/i.test(nr));

    // SPEC 10 — data-protection nudge for named individuals.
    const wp = q("#warnPerson");
    if (wp) {
      const flagged = d.isIndividual || looksLikeIndividual(d.name);
      wp.hidden = !flagged;
      if (flagged) {
        wp.innerHTML =
          "<strong>This looks like a named individual.</strong> A written adverse assessment of an identifiable person is personal data under the UK/EU GDPR and comparable regimes, and they have a right of access to it. Prefer mapping the <em>role</em> or the <em>institution</em> where you can — “Regional Officer, Karnal” rather than a name.";
      }
    }

    // SPEC 6.7 — quadrant labels are not a strategy.
    const wq = q("#warnQuadrant");
    if (wq) wq.hidden = !looksLikeQuadrantLabel(ns.objective);

    // SPEC v2 §7 — at depth 3 the objective IS the outcome challenge, and
    // Dyer's three testable checks apply to it.
    const cw = q("#challengeWarn");
    if (cw) {
      const cws = outcomeChallengeWarnings(ns.objective);
      cw.innerHTML = cws.map((w) => `<p class="warnline" style="display:block">${esc(w.message)}</p>`).join("");
    }

    const anyChange = scoreMoved || rationaleMoved || strategyMoved;
    save.disabled = !anyChange || gate.blocked;
    if (ctx.onDirty) ctx.onDirty(anyChange);

    if (gate.missingRationale && anyChange) estatus.textContent = "a rationale is required";
    else if (estatus.textContent === "a rationale is required") estatus.textContent = "";
  }

  for (const el of [sp, si]) el.addEventListener("input", refresh);
  rat.addEventListener("input", refresh);
  for (const k of STRATEGY_FIELDS) {
    const el = q("#s-" + k);
    if (el) el.addEventListener("input", refresh);
  }
  host.addEventListener("change", (e) => {
    if (e.target && e.target.id === "ack") refresh();
  });

  for (const bt of host.querySelectorAll(".tabs button")) {
    bt.addEventListener("click", () => ctx.onTab(bt.dataset.tab));
  }

  save.addEventListener("click", async () => {
    save.disabled = true;
    estatus.className = "status";
    estatus.textContent = "saving…";
    const res = await ctx.onSave(
      {
        power: Number(sp.value),
        interest: Number(si.value),
        rationale: rat.value.trim(),
        strategy: readStrategy(),
      },
      q("#note").value.trim()
    );
    if (res && res.ok) {
      estatus.className = "status good";
      estatus.textContent = res.noop ? "nothing to save" : "saved";
    } else {
      estatus.className = "status err";
      estatus.textContent = "NOT saved";
      save.disabled = false;
    }
  });

  const smapHost = q("#smapHost");
  if (smapHost && ctx.onStrategyMap) {
    let timer = null;
    smapHost.addEventListener("input", (e) => {
      const cell = e.target.closest("[data-cell]");
      if (!cell) return;
      cell.closest(".sm-cell").className = "sm-cell " + (cell.value.trim() ? "filled" : "empty");
      clearTimeout(timer);
      // Saves on its own rather than through the Save button: this is a
      // classification of the approach, not part of the versioned change.
      timer = setTimeout(() => {
        const map = {};
        for (const t of smapHost.querySelectorAll("[data-cell]")) map[t.dataset.cell] = t.value;
        ctx.onStrategyMap(map);
      }, 700);
    });
  }

  q("#revert").addEventListener("click", () => {
    if (ctx.onDirty) ctx.onDirty(false);
    ctx.onTab(tab); // forces a clean re-render from stored state
  });
  q("#edClose").addEventListener("click", () => ctx.onClose());
  q("#edDelete").addEventListener("click", () => ctx.onDelete());
  q("#edEdit").addEventListener("click", () => ctx.onIdentity());

  refresh();

  if (tab === "behaviour" && ctx.onMarkers) ctx.onMarkers(q("#bbody"));
  if (tab === "effect") renderEffect(q("#ebody"), d, ctx.changes);
  if (tab === "hist") renderHistory(q("#hbody"), d, ctx.changes);
}

/* ------------------------------------------------- strategy & effect (6.2) */

function renderEffect(host, d, changes) {
  const periods = strategyPeriods(d.baseline, d, changes);

  const caveat = `<div class="caveat"><strong>What this shows and what it does not.</strong>
    Each block pairs an engagement strategy with the score movement recorded <em>while it was in force</em>.
    It does not establish that the approach caused the movement — other things happen in the world, and
    stakeholders move for reasons that have nothing to do with you. This is the evidence that prompts the
    question, not the answer.</div>`;

  if (!periods.length) {
    host.innerHTML =
      caveat +
      `<p class="empty">No engagement strategy recorded yet. Set one on the <em>Engagement strategy</em> tab — the effect of each strategy is measured from the moment you save it.</p>`;
    return;
  }

  host.innerHTML =
    caveat +
    periods
      .map((p) => {
        const dp = p.deltaPower;
        const di = p.deltaInterest;
        const total = dp + di;
        const cls = total > 0 ? "gain" : total < 0 ? "loss" : "none";
        const move =
          !dp && !di
            ? "no movement"
            : [dp ? `power ${signed(dp)}` : "", di ? `interest ${signed(di)}` : ""].filter(Boolean).join(" · ");
        const s = p.strategy;
        return `<div class="period ${cls}">
          <div class="phead">
            <span>${p.from ? fmtDate(p.from) : "from the start"} → ${p.to ? fmtDate(p.to) : "now"}${p.open ? '<span class="plive">in force</span>' : ""}</span>
            <span class="pmove ${cls}">${move}</span>
          </div>
          ${s.objective ? `<div class="pobj">${esc(s.objective)}</div>` : ""}
          ${s.approach ? `<div class="pbody">${esc(s.approach)}</div>` : ""}
          ${s.actions ? `<div class="pbody" style="margin-top:4px;color:var(--muted)">${esc(s.actions)}</div>` : ""}
          ${
            s.owner || s.cadence
              ? `<div class="pbody" style="margin-top:5px;color:var(--faint);font-size:.79rem">${esc([s.owner, s.cadence].filter(Boolean).join(" · "))}</div>`
              : ""
          }
          <div class="pbody" style="margin-top:6px;color:var(--faint);font-size:.76rem;font-family:var(--font-mono)">
            power ${p.power0} → ${p.power1} · interest ${signed(p.interest0)} → ${signed(p.interest1)}</div>
        </div>`;
      })
      .join("");
}

/* ------------------------------------------------------ full history (6.4) */

function renderHistory(host, d, changes) {
  const entries = sortChangesDescending(changes);
  const b = d.baseline || {};

  const baselineRow = `<div class="hbaseline">
    <strong>Baseline</strong> — ${b.at ? fmtDate(b.at) : "at creation"} · power ${b.power}, interest ${signed(b.interest)}.
    Movement is always measured from here.
    ${b.rationale ? `<div class="hrat">${esc(b.rationale)}</div>` : ""}
  </div>`;

  if (!entries.length) {
    host.innerHTML =
      `<p class="empty">No changes recorded yet. The starting scores are the baseline.</p>` + baselineRow;
    return;
  }

  host.innerHTML =
    entries
      .map((h) => {
        const bits = [];
        if (h.changedFields.includes("power")) bits.push(`power <span class="hchange">${h.prevPower} → ${h.power}</span>`);
        if (h.changedFields.includes("interest"))
          bits.push(`interest <span class="hchange">${signed(h.prevInterest)} → ${signed(h.interest)}</span>`);
        if (h.changedFields.includes("rationale")) bits.push("rationale updated");
        if (h.changedFields.includes("strategy")) bits.push('<span class="hchange">strategy changed</span>');

        const scoreOnly =
          (h.changedFields.includes("power") || h.changedFields.includes("interest")) &&
          !h.changedFields.includes("rationale");

        const ns = normalizeStrategy(h.strategy);
        return `<div class="hentry">
          <div class="hhead"><span title="${esc(fmtDateTime(h.at))}">${fmtDate(h.at)}</span><span>${bits.join(" · ")}</span></div>
          ${h.note ? `<div class="hnote">${esc(h.note)}</div>` : ""}
          ${scoreOnly ? `<div class="hnote" style="color:var(--neutral)">Recorded as a correction — the reasoning was confirmed unchanged.</div>` : ""}
          <div class="hrat">${esc(h.rationale)}</div>
          ${h.changedFields.includes("strategy") && ns.objective ? `<div class="hstrat"><strong>New objective:</strong> ${esc(ns.objective)}</div>` : ""}
        </div>`;
      })
      .join("") + baselineRow;
}
