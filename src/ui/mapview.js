/**
 * The Map view: dashboard tiles, the scatter, and the stakeholder table.
 *
 * The tiles are ported from the skill template, with coverage promoted to a
 * clickable tile (SPEC 7: "Coverage — how many stakeholders have no strategy set
 * — visible on the dashboard, not buried").
 */

import {
  boundaryPartners,
  BOUNDARY_PARTNER_CEILING,
  coverage,
  hasStrategy,
  movementOf,
  reachLabel,
  stanceCounts,
  stanceLabel,
  stanceOf,
  stanceVar,
} from "../domain.js";
import { esc, signed, truncate } from "./dom.js";

/** SPEC v2 §7 — Outcome Mapping breaks down above seven boundary partners. */
export function boundaryPartnerWarning(stakeholders) {
  const bps = boundaryPartners(stakeholders);
  if (bps.length <= BOUNDARY_PARTNER_CEILING) return "";
  return `<div class="warnstrip"><strong>${bps.length} boundary partners.</strong> Outcome Mapping breaks down above
    ${BOUNDARY_PARTNER_CEILING} — strategy maps become unworkable and the monitoring load stops being sustainable.
    Consider consolidating similar actors into groups rather than dropping them, and record what you cut and why.</div>`;
}

export function renderTiles(host, stakeholders, onJump) {
  const c = stanceCounts(stakeholders);
  const cov = coverage(stakeholders);
  const moved = stakeholders.filter((s) => movementOf(s).moved).length;
  const missing = cov.noStrategy.length;

  host.innerHTML = `
    <div class="tile"><div class="n" style="color:var(--ally)">${c.ally}</div>
      <div class="l">Allies</div><div class="bar" style="background:var(--ally)"></div></div>
    <div class="tile"><div class="n" style="color:var(--neutral)">${c.neutral}</div>
      <div class="l">Neutral &mdash; or position unknown</div><div class="bar" style="background:var(--neutral)"></div></div>
    <div class="tile"><div class="n" style="color:var(--oppose)">${c.oppose}</div>
      <div class="l">Opponents</div><div class="bar" style="background:var(--oppose)"></div></div>
    <button class="tile" data-jump="coverage" title="See who is missing a strategy">
      <div class="n"${missing ? ' style="color:var(--neutral)"' : ""}>${cov.withStrategy}<span style="font-size:.9rem;color:var(--muted)">/${cov.total}</span></div>
      <div class="l">${missing ? `Have a strategy &mdash; ${missing} missing` : "Have an engagement strategy"}</div>
      <div class="bar" style="background:var(--${missing ? "neutral" : "ally"})"></div></button>
    <button class="tile" data-jump="movement" title="See who has moved">
      <div class="n">${moved}</div><div class="l">Moved since start</div>
      <div class="bar" style="background:var(--rule-2)"></div></button>`;

  for (const b of host.querySelectorAll("[data-jump]")) {
    b.addEventListener("click", () => onJump(b.dataset.jump));
  }
}

/* ------------------------------------------------------------------ table */

const COLUMNS = [
  { key: "name", label: "Stakeholder", sortable: true },
  { key: "type", label: "Type", sortable: true },
  { key: "power", label: "Power", sortable: true, num: true },
  { key: "dpower", label: "Δ", sortable: true, num: true },
  { key: "interest", label: "Interest", sortable: true, num: true },
  { key: "dinterest", label: "Δ", sortable: true, num: true },
  { key: "stance", label: "Stance", sortable: true },
  { key: "objective", label: "Engagement objective", sortable: false },
];

export function renderTable(host, stakeholders, opts) {
  const { selectedId, sort, movementOnly, onSelect, onSort } = opts;

  let rows = stakeholders.slice();
  if (movementOnly) rows = rows.filter((s) => movementOf(s).moved);
  rows.sort(comparator(sort));

  const head = COLUMNS.map((c) => {
    if (!c.sortable) return `<th>${c.label}</th>`;
    const active = sort.key === c.key;
    const arrow = active ? `<span class="arrow">${sort.dir === "asc" ? "▲" : "▼"}</span>` : "";
    return `<th class="sortable" data-sort="${c.key}" aria-sort="${active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}">${c.label} ${arrow}</th>`;
  }).join("");

  const bodyRows = rows.length
    ? rows
        .map((d) => {
          const m = movementOf(d);
          const st = stanceOf(d.interest);
          const obj = (d.strategy.objective || "").trim();
          const firstStrategyBit = obj || Object.values(d.strategy).find((v) => v.trim()) || "";
          return `<tr class="${selectedId === d.id ? "sel" : ""}" data-id="${esc(d.id)}" tabindex="0">
            <td class="name"><i class="stance" style="background:${stanceVar(st)}"></i>${esc(d.name)}${
              d.isIndividual ? '<span class="person" title="Named individual — personal data">person</span>' : ""
            }<span class="reach ${d.reach === "target" ? "pt" : d.reach === "out-of-reach" ? "oor" : "bp"}" title="${esc(reachLabel(d.reach))}">${esc(
              d.reach === "target" ? "target" : d.reach === "out-of-reach" ? "out of reach" : "partner"
            )}</span></td>
            <td class="typ">${esc(d.type || "")}</td>
            <td class="num">${d.power}</td><td>${delta(m.deltaPower)}</td>
            <td class="num">${signed(d.interest)}</td><td>${delta(m.deltaInterest)}</td>
            <td style="color:${stanceVar(st)};font-weight:600">${stanceLabel(st)}</td>
            <td style="max-width:340px;font-size:.83rem;color:${firstStrategyBit ? "var(--ink-2)" : "var(--faint)"}">${
              firstStrategyBit ? esc(truncate(firstStrategyBit, 110)) : "<em>no strategy set</em>"
            }</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="${COLUMNS.length}" class="empty">${
        movementOnly ? "Nothing has moved yet." : "No stakeholders yet. Add one, or paste a spreadsheet."
      }</td></tr>`;

  host.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${bodyRows}</tbody></table>`;

  for (const th of host.querySelectorAll("th[data-sort]")) {
    th.addEventListener("click", () => onSort(th.dataset.sort));
  }
  for (const tr of host.querySelectorAll("tr[data-id]")) {
    tr.addEventListener("click", () => onSelect(tr.dataset.id));
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(tr.dataset.id);
      }
    });
  }
}

function delta(n) {
  if (!n) return `<span class="delta flat">·</span>`;
  return `<span class="delta ${n > 0 ? "up" : "down"}">${signed(n)}</span>`;
}

function comparator(sort) {
  const dir = sort.dir === "asc" ? 1 : -1;
  const value = (s) => {
    const m = movementOf(s);
    switch (sort.key) {
      case "type":
        return String(s.type || "").toLowerCase();
      case "power":
        return s.power;
      case "interest":
        return s.interest;
      case "dpower":
        return m.deltaPower;
      case "dinterest":
        return m.deltaInterest;
      case "stance":
        // Opponent → neutral → ally reads as a spectrum, which sorts more
        // usefully than the alphabetical order of the labels.
        return { oppose: 0, neutral: 1, ally: 2 }[stanceOf(s.interest)];
      case "strategy":
        return hasStrategy(s.strategy) ? 1 : 0;
      default:
        return String(s.name || "").toLowerCase();
    }
  };
  return (a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return String(a.name).localeCompare(String(b.name));
  };
}
