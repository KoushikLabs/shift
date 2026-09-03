/**
 * Domain logic. Pure functions only — no DOM, no IndexedDB, no globals.
 *
 * Everything in here is covered by test/domain.test.js. The two parts worth
 * reading carefully are `strategyPeriods` (ported from the skill template, and
 * the reason this tool is worth more than a spreadsheet) and `changedFields`
 * (which decides what gets written to the append-only log).
 *
 * SPEC references are to Stakeholder_Tracker_App_SPEC.md.
 */

/* ------------------------------------------------------------------ scales */

export const POWER_MIN = 0;
export const POWER_MAX = 10;
export const INTEREST_MIN = -10;
export const INTEREST_MAX = 10;

/** SPEC 5: Ally >= +2 · Neutral -1..+1 · Opponent <= -2. The neutral band is load-bearing. */
export const ALLY_THRESHOLD = 2;
export const OPPONENT_THRESHOLD = -2;

export function stanceOf(interest) {
  const i = Number(interest);
  if (i >= ALLY_THRESHOLD) return "ally";
  if (i <= OPPONENT_THRESHOLD) return "oppose";
  return "neutral";
}

export function stanceLabel(stance) {
  return stance === "ally" ? "Ally" : stance === "oppose" ? "Opponent" : "Neutral";
}

/** CSS custom property carrying this stance's colour. SPEC 6.5: stance gets its own colour. */
export function stanceVar(stance) {
  return `var(--${stance === "oppose" ? "oppose" : stance === "ally" ? "ally" : "neutral"})`;
}

export function clampPower(v) {
  return clampInt(v, POWER_MIN, POWER_MAX, 0);
}

export function clampInterest(v) {
  return clampInt(v, INTEREST_MIN, INTEREST_MAX, 0);
}

function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/* -------------------------------------------------------------- strategies */

/** SPEC 5: strategy = {objective, approach, actions, owner, cadence}. */
export const STRATEGY_FIELDS = ["objective", "approach", "actions", "owner", "cadence"];

export const STRATEGY_LABELS = {
  objective: "Objective",
  approach: "Approach",
  actions: "Actions",
  owner: "Owner",
  cadence: "Cadence",
};

/** Prompts explaining what belongs in each field (SPEC 7 MVP: "each with a prompt"). */
export const STRATEGY_HINTS = {
  objective:
    "What change in this stakeholder are you trying to produce? Not what you will do — what should be different about them. The test: could you tell, from outside, whether it had happened?",
  approach:
    "Why should this work on them specifically? The theory, not the activity list. What do they already want, and what does your ask cost them?",
  actions:
    "Concrete next actions, with dates where you have them. “Nothing planned this quarter” is an honest and useful answer.",
  owner: "Who on the team holds this relationship. One name — shared ownership means nobody owns it.",
  cadence: "How often you will engage, and when you next review this.",
};

export function emptyStrategy() {
  return { objective: "", approach: "", actions: "", owner: "", cadence: "" };
}

/** Coerce anything into a full strategy object with all five string fields present. */
export function normalizeStrategy(s) {
  const out = emptyStrategy();
  if (s && typeof s === "object") {
    for (const k of STRATEGY_FIELDS) {
      if (typeof s[k] === "string") out[k] = s[k];
      else if (s[k] != null) out[k] = String(s[k]);
    }
  }
  return out;
}

export function sameStrategy(a, b) {
  const x = normalizeStrategy(a);
  const y = normalizeStrategy(b);
  return STRATEGY_FIELDS.every((k) => x[k].trim() === y[k].trim());
}

/** A strategy "exists" if any one of the five fields has content. SPEC 7: coverage counts this. */
export function hasStrategy(s) {
  const x = normalizeStrategy(s);
  return STRATEGY_FIELDS.some((k) => x[k].trim().length > 0);
}

/**
 * SPEC 6.7: quadrant labels are not a strategy. If the objective is one of the
 * stock outputs of a standard power/interest tool, the strategy is missing.
 */
const QUADRANT_LABEL_PATTERNS = [
  /^\s*monitor\s*$/i,
  /^\s*keep\s+informed\s*$/i,
  /^\s*keep\s+satisfied\s*$/i,
  /^\s*manage\s+closely\s*$/i,
  /^\s*engage\s*$/i,
  /^\s*consult\s*$/i,
  /^\s*inform\s*$/i,
  /^\s*watch\s*$/i,
  /^\s*minimal\s+effort\s*$/i,
  /^\s*show\s+consideration\s*$/i,
  /^\s*keep\s+onside\s*$/i,
  /^\s*maintain\s+(the\s+)?relationship\s*$/i,
  /^\s*build\s+(a\s+)?relationship\s*$/i,
  /^\s*stay\s+in\s+touch\s*$/i,
];

export function looksLikeQuadrantLabel(text) {
  const t = String(text == null ? "" : text).trim();
  if (!t) return false;
  // Only flag terse entries. A long objective that happens to contain "monitor"
  // is fine; "Monitor" on its own is the failure mode this catches.
  if (t.split(/\s+/).length > 4) return false;
  return QUADRANT_LABEL_PATTERNS.some((re) => re.test(t));
}

/* ------------------------------------------------------- named individuals */

/**
 * SPEC 10: warn where a stakeholder is a person rather than an organisation.
 * This is a *suggestion* that pre-ticks a checkbox the user controls — never a
 * silent classification. Organisational keywords veto it, because "Ministry of
 * Fisheries" must not be treated as personal data and "Dr Amara Okoye" must.
 */
const ORG_KEYWORDS =
  /\b(ltd|limited|inc|llc|plc|gmbh|bv|nv|sa|pty|co|corp|company|group|holdings|trust|foundation|fund|institute|institution|university|college|school|academy|hospital|clinic|laboratory|lab|labs|centre|center|council|committee|commission|board|bureau|agency|authority|department|ministry|directorate|division|office|secretariat|association|federation|union|society|network|alliance|coalition|forum|chamber|guild|party|assembly|parliament|senate|congress|court|tribunal|inspectorate|regulator|ombudsman|service|services|systems|solutions|partners|partnership|consulting|consultancy|media|press|news|times|post|journal|review|farms?|farming|poultry|dairy|meat|abattoir|slaughterhouse|feed|agri\w*|veterinary|vets?|welfare|animals?|charity|ngo|cic|trade|industry|producers?|growers?|breeders?|cooperative|co-?op)\b/i;

const PERSON_TITLE = /^(mr|mrs|ms|miss|mx|dr|prof|professor|sir|dame|lord|lady|rev|hon|senator|rep|cllr|councillor)\.?\s+/i;

export function looksLikeIndividual(name) {
  const n = String(name == null ? "" : name).trim();
  if (!n) return false;
  if (PERSON_TITLE.test(n)) return true;
  if (ORG_KEYWORDS.test(n)) return false;
  if (/[0-9&@/]|\b(the|of|for|and)\b/i.test(n)) return false;
  // Two or three capitalised words, no org signal: probably a person.
  const words = n.split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  return words.every((w) => /^[A-Z][\p{L}'’-]+$/u.test(w));
}

/* ------------------------------------------------------------------ change */

/** SPEC 8: changedFields[] — any of power, interest, rationale, strategy. */
export function changedFields(prev, next) {
  const out = [];
  if (Number(prev.power) !== Number(next.power)) out.push("power");
  if (Number(prev.interest) !== Number(next.interest)) out.push("interest");
  if (String(prev.rationale || "").trim() !== String(next.rationale || "").trim()) out.push("rationale");
  if (!sameStrategy(prev.strategy, next.strategy)) out.push("strategy");
  return out;
}

/**
 * SPEC 6.1: a score cannot move without its rationale being addressed.
 *
 * Returns what the UI needs to enforce the gate. `blocked` true means saving is
 * refused. `acknowledgeable` true means the tick-box escape hatch applies —
 * "the reasoning has not changed, this corrects an earlier scoring error".
 */
export function rationaleGate({ scoreMoved, rationaleMoved, acknowledged, rationaleText }) {
  const hasText = String(rationaleText == null ? "" : rationaleText).trim().length > 0;
  const needsAttention = Boolean(scoreMoved) && !rationaleMoved;
  const satisfied = !needsAttention || Boolean(acknowledged);
  return {
    needsAttention,
    acknowledgeable: needsAttention,
    blocked: !satisfied || !hasText,
    missingRationale: !hasText,
  };
}

/* ------------------------------------------------- strategy periods (SPEC 5) */

/**
 * Derived, never stored. Walk the change log ascending; each change touching
 * strategy closes the current period and opens a new one. Each period pairs a
 * strategy with the score movement recorded while it was in force.
 *
 * Ported from the skill template's `periods()`, which is the fiddly part that
 * already works (SPEC 9: port, do not reinvent).
 *
 * Convention worth knowing: when one save changes BOTH a score and the strategy,
 * the score movement is attributed to the NEW period, not the old one. The
 * closing period ends at `prevPower/prevInterest` — the scores as they stood
 * immediately before the new strategy took effect. Attributing a movement to an
 * approach that was replaced in the same keystroke would overclaim.
 *
 * @param {{power:number,interest:number,strategy:object,at?:string}} baseline
 * @param {{power:number,interest:number}} current
 * @param {Array<object>} changes  Change rows, any order.
 * @returns {Array<object>} periods, newest first, empty strategies dropped.
 */
export function strategyPeriods(baseline, current, changes) {
  const base = {
    power: Number(baseline.power),
    interest: Number(baseline.interest),
    strategy: normalizeStrategy(baseline.strategy),
    at: baseline.at || null,
  };
  const asc = sortChangesAscending(changes);

  const out = [];
  let open = { strategy: base.strategy, from: base.at, power0: base.power, interest0: base.interest };

  for (const h of asc) {
    if (!Array.isArray(h.changedFields) || !h.changedFields.includes("strategy")) continue;
    out.push({
      strategy: open.strategy,
      from: open.from,
      to: h.at,
      power0: open.power0,
      interest0: open.interest0,
      power1: Number(h.prevPower),
      interest1: Number(h.prevInterest),
    });
    open = {
      strategy: normalizeStrategy(h.strategy),
      from: h.at,
      power0: Number(h.power),
      interest0: Number(h.interest),
    };
  }

  out.push({
    strategy: open.strategy,
    from: open.from,
    to: null,
    power0: open.power0,
    interest0: open.interest0,
    power1: Number(current.power),
    interest1: Number(current.interest),
  });

  return out
    .filter((p) => hasStrategy(p.strategy))
    .map((p) => ({
      ...p,
      deltaPower: p.power1 - p.power0,
      deltaInterest: p.interest1 - p.interest0,
      open: p.to === null,
    }))
    .reverse();
}

/** Stable ascending sort by `at`, falling back to insertion order for ties. */
export function sortChangesAscending(changes) {
  return (changes || [])
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => {
      const at = String(a.c.at || "");
      const bt = String(b.c.at || "");
      if (at < bt) return -1;
      if (at > bt) return 1;
      return a.idx - b.idx;
    })
    .map((x) => x.c);
}

export function sortChangesDescending(changes) {
  return sortChangesAscending(changes).reverse();
}

/* --------------------------------------------------------------- movement */

/**
 * SPEC 7: movement view — everyone who has moved, direction and magnitude,
 * sorted by size of shift. Magnitude is the L1 distance in score space; the
 * two axes measure different things, so summing their absolute movement is the
 * honest aggregate and `direction` is deliberately reported from interest only,
 * since that is the axis that carries alignment.
 */
export function movementOf(stakeholder) {
  const b = stakeholder.baseline || {};
  const deltaPower = Number(stakeholder.power) - Number(b.power);
  const deltaInterest = Number(stakeholder.interest) - Number(b.interest);
  return {
    deltaPower,
    deltaInterest,
    magnitude: Math.abs(deltaPower) + Math.abs(deltaInterest),
    moved: deltaPower !== 0 || deltaInterest !== 0,
    direction: deltaInterest > 0 ? "toward" : deltaInterest < 0 ? "away" : "level",
    stanceChanged: stanceOf(b.interest) !== stanceOf(stakeholder.interest),
  };
}

export function rankByMovement(stakeholders) {
  return stakeholders
    .map((s) => ({ stakeholder: s, movement: movementOf(s) }))
    .filter((x) => x.movement.moved)
    .sort(
      (a, b) =>
        b.movement.magnitude - a.movement.magnitude ||
        Math.abs(b.movement.deltaInterest) - Math.abs(a.movement.deltaInterest) ||
        String(a.stakeholder.name).localeCompare(String(b.stakeholder.name))
    );
}

/* --------------------------------------------------------------- coverage */

/**
 * SPEC 7: coverage — how many stakeholders have no strategy, visible on the
 * dashboard and not buried. Extended to the other gaps the spec names as
 * failure modes, so one panel answers "what is wrong with this map".
 */
export function coverage(stakeholders) {
  const list = stakeholders || [];
  const noStrategy = list.filter((s) => !hasStrategy(s.strategy));
  const noRationale = list.filter((s) => !String(s.rationale || "").trim());
  const quadrantLabel = list.filter((s) => looksLikeQuadrantLabel(normalizeStrategy(s.strategy).objective));
  const noOwner = list.filter((s) => hasStrategy(s.strategy) && !normalizeStrategy(s.strategy).owner.trim());
  const neutralUnknown = list.filter((s) => stanceOf(s.interest) === "neutral");
  const opponentsNoStrategy = list.filter((s) => stanceOf(s.interest) === "oppose" && !hasStrategy(s.strategy));
  const namedIndividuals = list.filter((s) => s.isIndividual);
  return {
    total: list.length,
    withStrategy: list.length - noStrategy.length,
    noStrategy,
    noRationale,
    quadrantLabel,
    noOwner,
    neutralUnknown,
    opponentsNoStrategy,
    namedIndividuals,
  };
}

export function stanceCounts(stakeholders) {
  const c = { ally: 0, neutral: 0, oppose: 0 };
  for (const s of stakeholders || []) c[stanceOf(s.interest)]++;
  return c;
}

/* ------------------------------------------------------------------- misc */

/**
 * SPEC 5: stakeholder id is stable and never reused; history keys off it.
 * crypto.randomUUID where available, with a deterministic-enough fallback for
 * environments that lack it (older Safari, non-secure contexts, node <19).
 */
export function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (c && typeof c.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return "id-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

export function nowISO() {
  return new Date().toISOString();
}

/** Build a fresh stakeholder, capturing its own baseline. SPEC 5: baseline = first recorded state. */
export function makeStakeholder(projectId, fields = {}) {
  const at = fields.createdAt || nowISO();
  const power = clampPower(fields.power ?? 5);
  const interest = clampInterest(fields.interest ?? 0);
  const rationale = String(fields.rationale || "");
  const strategy = normalizeStrategy(fields.strategy);
  return {
    id: fields.id || newId(),
    projectId,
    name: String(fields.name || "").trim(),
    type: String(fields.type || "").trim(),
    isIndividual: Boolean(fields.isIndividual),
    power,
    interest,
    rationale,
    strategy,
    baseline: { power, interest, rationale, strategy: { ...strategy }, at },
    createdAt: at,
    updatedAt: null,
    updatedBy: fields.updatedBy || "",
  };
}

export function makeProject(fields = {}) {
  const at = fields.createdAt || nowISO();
  return {
    id: fields.id || newId(),
    name: String(fields.name || "Untitled map").trim() || "Untitled map",
    description: String(fields.description || ""),
    scaleNote: String(fields.scaleNote || ""),
    createdAt: at,
    updatedAt: fields.updatedAt || at,
  };
}

/* ------------------------------------------------- scale bands (scoring.md) */

/**
 * The band descriptions from the skill's references/scoring.md. Shown live
 * beside each slider so the conventions are enforced at the point of scoring
 * rather than in a document nobody opens.
 */
export function powerBand(v) {
  const n = Number(v);
  if (n >= 9) return "Can stop or compel this directly — statutory authority, a court, a regulator with closure powers.";
  if (n >= 7) return "Materially shapes outcomes but cannot decide alone — a licensing body, a large industry association, a funder.";
  if (n >= 5) return "Real influence through others — an advisory statutory body, a national NGO, a large employer.";
  if (n >= 3) return "Local or narrow influence — a small NGO, a technical institution, a district office.";
  return "Negligible influence on this project.";
}

export function interestBand(v) {
  const n = Number(v);
  if (n >= 7) return "Actively wants this outcome; would help if asked.";
  if (n >= 3) return "Broadly supportive, or supportive on adjacent grounds.";
  if (n >= -2) return "Genuinely neutral, indifferent, or position unknown — score unknowns here and say so.";
  if (n >= -6) return "Would resist, or has structural reasons to prefer the status quo.";
  return "Actively organised against it.";
}

/* ------------------------------------------------------------- app identity */

/** SPEC 11.5 flags the name as a placeholder — it is isolated here so it is a one-line change. */
export const APP_NAME = "Shift";
export const APP_VERSION = "0.1.0";
