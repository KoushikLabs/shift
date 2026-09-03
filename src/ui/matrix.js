/**
 * The power × interest map.
 *
 * Ported from the skill template's `plot()` (SPEC 9: "The SVG scatter and the
 * period derivation are the fiddly parts and they work. Port, do not reinvent.")
 *
 * What it draws, per SPEC 7:
 *   · three-colour by stance, never inferred from grid position (SPEC 6.5)
 *   · point size = power
 *   · the zero-interest line, drawn and labelled, because the axis is signed
 *   · dotted trails from the baseline to the current position
 *   · labels that de-collide, with leader lines when they have to move
 *
 * Changed from the template: labels are shown for the selected point and for
 * anything that has moved (movement is the thing this tool exists to show), and
 * points are keyboard reachable.
 */

import { stanceOf, stanceVar } from "../domain.js";
import { esc } from "./dom.js";

const W = 900;
const H = 540;
const L = 64;
const R = 26;
const T = 26;
const B = 52;
const PW = W - L - R;
const PH = H - T - B;

const xOf = (interest) => L + ((interest + 10) / 20) * PW;
const yOf = (power) => T + PH - (power / 10) * PH;
const rOf = (power) => 4 + power * 0.62;

export function renderMatrix(svg, stakeholders, selectedId, onSelect) {
  const x0 = xOf(0);
  const y5 = yOf(5);
  let s = "";

  // plot ground
  s += `<rect x="${L}" y="${T}" width="${PW}" height="${PH}" fill="var(--q-tint)"/>`;

  // mid-power guide
  s += `<line x1="${L}" y1="${y5}" x2="${L + PW}" y2="${y5}" stroke="var(--rule-2)" stroke-dasharray="4 4"/>`;
  s += `<text class="qlabel" x="${L + 6}" y="${y5 - 6}">high power</text>`;

  // ticks
  for (let v = -10; v <= 10; v += 5) {
    s += `<text class="tick" x="${xOf(v)}" y="${T + PH + 18}" text-anchor="middle">${v > 0 ? "+" + v : v}</text>`;
  }
  for (let v = 0; v <= 10; v += 5) {
    s += `<text class="tick" x="${L - 9}" y="${yOf(v) + 3}" text-anchor="end">${v}</text>`;
  }

  // the zero-interest line — the thing a standard two-by-two hides
  s += `<line x1="${x0}" y1="${T}" x2="${x0}" y2="${T + PH}" stroke="var(--neutral)" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  s += `<text class="qlabel" x="${x0 - 6}" y="${T + PH - 8}" text-anchor="end" fill="var(--neutral)">opposed</text>`;
  s += `<text class="qlabel" x="${x0 + 6}" y="${T + PH - 8}" fill="var(--neutral)">aligned</text>`;

  // axes
  s += `<line x1="${L}" y1="${T + PH}" x2="${L + PW}" y2="${T + PH}" stroke="var(--rule-2)"/>`;
  s += `<line x1="${L}" y1="${T}" x2="${L}" y2="${T + PH}" stroke="var(--rule-2)"/>`;
  s += `<text class="axlabel" x="${L + PW / 2}" y="${H - 12}" text-anchor="middle">Interest &mdash; negative means opposed &rarr;</text>`;
  s += `<text class="axlabel" transform="rotate(-90 16 ${T + PH / 2})" x="16" y="${T + PH / 2}" text-anchor="middle">Power &rarr;</text>`;

  if (!stakeholders.length) {
    s += `<text class="axlabel" x="${L + PW / 2}" y="${T + PH / 2}" text-anchor="middle" fill="var(--faint)">No stakeholders yet</text>`;
    svg.innerHTML = s;
    return;
  }

  // Draw big points first so small ones stay clickable on top.
  const pts = stakeholders
    .map((d) => ({ d, x: xOf(d.interest), y: yOf(d.power) }))
    .sort((a, b) => b.d.power - a.d.power);

  // trails from baseline
  for (const { d, x, y } of pts) {
    const b = d.baseline;
    if (!b || (b.power === d.power && b.interest === d.interest)) continue;
    const bx = xOf(b.interest);
    const by = yOf(b.power);
    s += `<line class="trail" x1="${bx}" y1="${by}" x2="${x}" y2="${y}" stroke="${stanceVar(stanceOf(d.interest))}"/>`;
    s += `<circle cx="${bx}" cy="${by}" r="2.5" fill="${stanceVar(stanceOf(b.interest))}" opacity=".45"/>`;
  }

  // points
  for (const { d, x, y } of pts) {
    const col = stanceVar(stanceOf(d.interest));
    const r = rOf(d.power);
    const isSel = selectedId === d.id;
    s +=
      `<circle class="dot${isSel ? " sel" : ""}" data-id="${esc(d.id)}" cx="${x}" cy="${y}" r="${r}" ` +
      `fill="${col}" fill-opacity=".62" stroke="${col}" stroke-width="1.5" ` +
      `tabindex="0" role="button" aria-label="${esc(d.name)}, power ${d.power}, interest ${d.interest}">` +
      `<title>${esc(d.name)} — power ${d.power}, interest ${d.interest > 0 ? "+" : ""}${d.interest}</title></circle>`;
  }

  // labels, de-collided
  const boxes = [];
  const fits = (x1, x2, y1, y2) => !boxes.some((b) => x1 < b.x2 && x2 > b.x1 && y1 < b.y2 && y2 > b.y1);

  const labelled = pts
    .filter((p) => {
      const d = p.d;
      const moved = d.baseline && (d.baseline.power !== d.power || d.baseline.interest !== d.interest);
      return d.power >= 7 || Math.abs(d.interest) >= 6 || moved || selectedId === d.id;
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);

  for (const { d, x, y } of labelled) {
    const short = d.name.length > 24 ? d.name.slice(0, 23) + "…" : d.name;
    const w = short.length * 5.0 + 4;
    const r = rOf(d.power);
    const anchor = x > L + PW - (w + 24) ? "end" : "start";
    const lx = anchor === "end" ? x - r - 7 : x + r + 7;
    let ly = y + 3.5;
    let placed = false;
    for (const off of [0, -13, 13, -26, 26, -39, 39, -52, 52]) {
      const ty = ly + off;
      const x1 = anchor === "end" ? lx - w : lx;
      if (fits(x1, x1 + w, ty - 8, ty + 4)) {
        boxes.push({ x1, x2: x1 + w, y1: ty - 8, y2: ty + 4 });
        ly = ty;
        placed = true;
        break;
      }
    }
    if (!placed) continue;
    const leader =
      Math.abs(ly - (y + 3.5)) > 6
        ? `<line x1="${anchor === "end" ? lx + 2 : lx - 2}" y1="${ly - 3}" x2="${x + (anchor === "end" ? -r : r)}" y2="${y}" stroke="var(--rule-2)" stroke-width="1"/>`
        : "";
    const weight = selectedId === d.id ? ' font-weight="700"' : "";
    s += leader + `<text class="dotlabel" x="${lx}" y="${ly}" text-anchor="${anchor}"${weight}>${esc(short)}</text>`;
  }

  svg.innerHTML = s;

  for (const c of svg.querySelectorAll(".dot")) {
    c.addEventListener("click", () => onSelect(c.dataset.id));
    c.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(c.dataset.id);
      }
    });
  }
}
