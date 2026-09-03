/**
 * The Coverage view.
 *
 * SPEC 7 asks for one number — how many stakeholders have no strategy. This
 * panel answers the wider question that number is a proxy for: what is wrong
 * with this map? Each card corresponds to a failure mode the spec names.
 *
 *   no strategy            SPEC 7, and the reason stage 3 exists at all
 *   opponents with none    strategy.md: "the commonest gap"
 *   quadrant labels        SPEC 6.7
 *   no rationale           SPEC 6.1 — a score with no reasoning is not evidence
 *   neutral / unknown      SPEC 6.6 — the tool should prompt for these
 *   named individuals      SPEC 10 — data-protection obligations
 *   no owner               strategy.md: "shared ownership means nobody owns it"
 *   never reviewed         a strategy set once and never revisited
 */

import { coverage, hasStrategy, movementOf, normalizeStrategy } from "../domain.js";
import { esc, fmtAgo, plural } from "./dom.js";

export function renderCoverage(host, stakeholders, changesFor, onSelect) {
  if (!stakeholders.length) {
    host.innerHTML = `<h2>Coverage</h2><p class="empty">No stakeholders yet.</p>`;
    return;
  }

  const cov = coverage(stakeholders);
  const neverTouched = stakeholders.filter((s) => (changesFor(s.id) || []).length === 0);
  const staleStrategy = stakeholders.filter((s) => {
    if (!hasStrategy(s.strategy)) return false;
    const last = lastStrategyChange(changesFor(s.id) || []);
    const at = last ? last.at : s.baseline && s.baseline.at;
    if (!at) return false;
    return Date.now() - new Date(at).getTime() > 120 * 86400000; // four months
  });

  const cards = [
    card({
      tone: cov.noStrategy.length ? "bad" : "ok",
      count: cov.noStrategy.length,
      title: "No engagement strategy",
      body: "A score without a strategy is a grid for a slide deck. These are the entries where nobody has written down what change they are trying to produce.",
      list: cov.noStrategy,
    }),
    card({
      tone: cov.opponentsNoStrategy.length ? "bad" : "ok",
      count: cov.opponentsNoStrategy.length,
      title: "Opponents with no strategy",
      body: "The commonest gap. There is almost always a real posture worth writing down — what you will avoid doing, what their position rests on, whether the aim is to move them or simply to know what they are doing.",
      list: cov.opponentsNoStrategy,
    }),
    card({
      tone: cov.quadrantLabel.length ? "warn" : "ok",
      count: cov.quadrantLabel.length,
      title: "Objective is a quadrant label",
      body: "“Monitor”, “keep informed” and the rest are derived mechanically from the two scores, so they carry no information the scores do not already carry. These need a real objective.",
      list: cov.quadrantLabel,
    }),
    card({
      tone: cov.noRationale.length ? "bad" : "ok",
      count: cov.noRationale.length,
      title: "No rationale",
      body: "A number with no reasoning behind it cannot be checked later, and cannot be argued with now.",
      list: cov.noRationale,
    }),
    card({
      tone: "warn",
      count: cov.neutralUnknown.length,
      title: "Neutral — or position unknown",
      body: "Scored between −1 and +1. This is honest and it is where engagement usually pays off most. Check that each one says in its rationale whether it is genuine indifference or simply nobody having spoken to them.",
      list: cov.neutralUnknown,
    }),
    card({
      tone: cov.namedIndividuals.length ? "warn" : "ok",
      count: cov.namedIndividuals.length,
      title: "Named individuals",
      body: "A written adverse assessment of an identifiable person is personal data under the GDPR and comparable regimes, with real obligations attached including their right of access. Prefer mapping the role or the institution.",
      list: cov.namedIndividuals,
    }),
    card({
      tone: cov.noOwner.length ? "warn" : "ok",
      count: cov.noOwner.length,
      title: "Strategy with no owner",
      body: "Shared ownership means nobody owns it. One name per stakeholder.",
      list: cov.noOwner,
    }),
    card({
      tone: staleStrategy.length ? "warn" : "ok",
      count: staleStrategy.length,
      title: "Strategy untouched for four months",
      body: "Not necessarily wrong — a long stable approach is fine, and repeated strategy churn is worse. But these are the ones to look at when you review.",
      list: staleStrategy,
      suffix: (s) => {
        const last = lastStrategyChange(changesFor(s.id) || []);
        return fmtAgo(last ? last.at : s.baseline && s.baseline.at);
      },
    }),
    card({
      tone: "ok",
      count: neverTouched.length,
      title: "Never updated since being added",
      body: "Still sitting at their baseline with no recorded change of any kind. If you have been engaging them, the record does not show it.",
      list: neverTouched,
    }),
  ];

  const done = cov.total - cov.noStrategy.length;
  host.innerHTML =
    `<h2>Coverage and gaps</h2>
     <p class="note">${done} of ${cov.total} ${plural(cov.total, "stakeholder", "stakeholders").replace(/^\d+\s/, "")}
     ${done === 1 ? "has" : "have"} an engagement strategy. Everything below is a prompt, not a rule —
     but each one is a failure mode this tool exists to expose.</p>
     <div class="gapgrid">${cards.join("")}</div>`;

  for (const b of host.querySelectorAll("button[data-id]")) {
    b.addEventListener("click", () => onSelect(b.dataset.id));
  }
}

function card({ tone, count, title, body, list, suffix }) {
  const items = list.length
    ? `<ul>${list
        .slice(0, 12)
        .map(
          (s) =>
            `<li><button data-id="${esc(s.id)}">${esc(s.name)}</button>${
              suffix ? `<span style="color:var(--faint);float:right;font-family:var(--font-mono);font-size:.76rem">${esc(suffix(s))}</span>` : ""
            }</li>`
        )
        .join("")}${list.length > 12 ? `<li class="empty">…and ${list.length - 12} more</li>` : ""}</ul>`
    : `<p class="empty" style="margin:0">None.</p>`;
  return `<div class="gapcard ${count ? tone : "ok"}">
    <h3><span class="c" ${count ? `style="color:var(--${tone === "bad" ? "oppose" : tone === "warn" ? "neutral" : "ally"})"` : ""}>${count}</span> ${esc(title)}</h3>
    <p>${esc(body)}</p>
    ${items}
  </div>`;
}

function lastStrategyChange(changes) {
  let latest = null;
  for (const c of changes) {
    if (!c.changedFields.includes("strategy")) continue;
    if (!latest || String(c.at) > String(latest.at)) latest = c;
  }
  return latest;
}

export { movementOf, normalizeStrategy };
