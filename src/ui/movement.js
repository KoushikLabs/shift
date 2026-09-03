/**
 * The Movement view (SPEC 7 MVP): everyone who has moved, direction and
 * magnitude, sorted by size of shift.
 *
 * Each row also names the strategy that was in force while the movement was
 * recorded — that pairing is the whole argument for the product, and burying it
 * one click deep in a per-stakeholder tab would waste it. SPEC 6.3's caveat
 * appears at the top, because "who moved" is exactly the screen where someone
 * is tempted to claim credit.
 */

import { rankByMovement, sortChangesAscending, stanceLabel, stanceOf, stanceVar, strategyPeriods } from "../domain.js";
import { esc, fmtDate, plural, signed, truncate } from "./dom.js";

export function renderMovement(host, stakeholders, changesFor, onSelect) {
  const ranked = rankByMovement(stakeholders);

  const intro = `<h2>What has moved</h2>
    <p class="note">Everyone whose score has changed since their baseline, largest shift first.
    Movement is measured on both axes; the badge shows the interest direction, because that is the axis
    that carries alignment.</p>
    <div class="caveat"><strong>Movement is not attribution.</strong> A stakeholder who moved while an
    approach was in force did not necessarily move <em>because</em> of it. Use this to decide what to
    look into, not what to claim.</div>`;

  if (!stakeholders.length) {
    host.innerHTML = intro + `<p class="empty">No stakeholders yet.</p>`;
    return;
  }
  if (!ranked.length) {
    host.innerHTML =
      intro +
      `<p class="empty">Nobody has moved yet. Scores change here only when you record them — the baseline is
       whatever each stakeholder was first scored at.</p>`;
    return;
  }

  const rows = ranked
    .map(({ stakeholder: s, movement: m }) => {
      const st = stanceOf(s.interest);
      const changes = changesFor(s.id) || [];
      const periods = strategyPeriods(s.baseline, s, changes);
      const live = periods.find((p) => p.open) || periods[0];
      const dirClass = m.deltaInterest > 0 ? "up" : m.deltaInterest < 0 ? "down" : "flat";
      const lastMove = lastScoreChange(changes);

      return `<div class="moverow" data-id="${esc(s.id)}" tabindex="0" role="button">
        <div>
          <div class="mname"><i class="stance" style="background:${stanceVar(st)}"></i>${esc(s.name)}
            ${s.isIndividual ? '<span class="person">person</span>' : ""}</div>
          <div class="mwhy">
            power ${s.baseline.power} → ${s.power} · interest ${signed(s.baseline.interest)} → ${signed(s.interest)}
            ${m.stanceChanged ? ` · crossed from <strong>${stanceLabel(stanceOf(s.baseline.interest))}</strong> to <strong style="color:${stanceVar(st)}">${stanceLabel(st)}</strong>` : ""}
            ${lastMove ? ` · last recorded ${fmtDate(lastMove.at)}` : ""}
          </div>
          ${
            live && live.strategy.objective
              ? `<div class="mstrat"><strong>Strategy in force:</strong> ${esc(truncate(live.strategy.objective, 150))}
                 ${live.strategy.owner ? `<span style="color:var(--faint)"> · ${esc(live.strategy.owner)}</span>` : ""}</div>`
              : `<div class="mstrat" style="color:var(--faint)"><em>They moved with no engagement strategy recorded. Either something external moved them, or the record is incomplete — both are worth knowing.</em></div>`
          }
          ${
            lastMove && lastMove.note
              ? `<div class="mwhy" style="margin-top:4px;font-style:italic">“${esc(truncate(lastMove.note, 160))}”</div>`
              : ""
          }
        </div>
        <div class="mnums">
          <span class="mbig ${dirClass}">${signed(m.deltaInterest)}</span>
          <span style="color:var(--muted)">interest</span><br>
          <span class="${m.deltaPower > 0 ? "up" : m.deltaPower < 0 ? "down" : "flat"}">${signed(m.deltaPower)} power</span>
          <span class="stancemove" style="color:var(--${m.direction === "toward" ? "ally" : m.direction === "away" ? "oppose" : "faint"})">
            ${m.direction === "toward" ? "toward you" : m.direction === "away" ? "away from you" : "power only"}
          </span>
        </div>
      </div>`;
    })
    .join("");

  const stillCount = stakeholders.length - ranked.length;
  host.innerHTML =
    intro +
    `<div class="movelist">${rows}</div>` +
    `<p class="note" style="margin-top:12px">${plural(ranked.length, "stakeholder has", "stakeholders have")} moved.
      ${stillCount ? `${plural(stillCount, "has", "have")} not — check the ones you have been engaging longest.` : ""}</p>`;

  for (const row of host.querySelectorAll(".moverow[data-id]")) {
    row.addEventListener("click", () => onSelect(row.dataset.id));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(row.dataset.id);
      }
    });
  }
}

function lastScoreChange(changes) {
  const asc = sortChangesAscending(changes);
  for (let i = asc.length - 1; i >= 0; i--) {
    const c = asc[i];
    if (c.changedFields.includes("power") || c.changedFields.includes("interest")) return c;
  }
  return null;
}
