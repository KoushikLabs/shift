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
    // SPEC v2 §5 — actor triage. Defaults to partner: most entries on a map are
    // actors the organisation actually deals with, and calling something a
    // pressure target should be a decision, not a default.
    reach: normalizeReach(fields.reach),
    reachableVia: Array.isArray(fields.reachableVia) ? fields.reachableVia.filter(Boolean) : [],
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
    // SPEC v2 §4 — how much measurement machinery this map carries.
    depth: normalizeDepth(fields.depth),
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

/* ==========================================================================
   SPEC v2 §5 — actor triage
   ==========================================================================
   Whether an actor is one you work with, one you are pushing on, or one you
   cannot currently reach. Outcome Mapping's own sort, and the thing its manual
   asserts rather than derives.

   REACH IS ORTHOGONAL TO STANCE. A supplier scored -6 that you speak to weekly
   is a boundary partner; a friendly ministry you cannot get a meeting with is
   out of reach. Collapsing the two axes is the commonest way this gets built
   wrong, so they stay separate fields with separate colours throughout.
*/

export const REACH_VALUES = ["partner", "target", "out-of-reach"];

export const REACH_LABELS = {
  partner: "Boundary partner",
  target: "Pressure target",
  "out-of-reach": "Out of reach",
};

export const REACH_HINTS = {
  partner:
    "You interact with them directly and can anticipate opportunities for influence. Progress markers belong here.",
  target:
    "You are applying pressure rather than working together. Score them honestly — the negative half of the interest scale exists for exactly this.",
  "out-of-reach":
    "No working relationship. Name who can reach them instead; those are the actors you actually engage.",
};

export function normalizeReach(v) {
  return REACH_VALUES.includes(v) ? v : "partner";
}

export function reachLabel(v) {
  return REACH_LABELS[normalizeReach(v)];
}

/** SPEC v2 §7: warn above seven boundary partners. */
export const BOUNDARY_PARTNER_CEILING = 7;

export function boundaryPartners(stakeholders) {
  return (stakeholders || []).filter((s) => normalizeReach(s.reach) === "partner");
}

/* ==========================================================================
   SPEC v2 §4 — depth
   ==========================================================================
   How much measurement machinery this map carries. Distinct from the three
   STAGES (map / analyse / strategise), which apply at every depth.
*/

export const DEPTH_MAP = 1;
export const DEPTH_WATCH = 2;
export const DEPTH_OUTCOME = 3;

export const DEPTH_LABELS = { 1: "Map", 2: "Watch", 3: "Outcome map" };

export const DEPTH_BLURB = {
  1: "Score actors on power and interest, say why, and name an engagement strategy.",
  2: "Also record two to four observable behaviours per actor, and review them each quarter.",
  3: "The full Outcome Mapping method: vision, outcome challenges, the four-tier ladder and a reflection cycle.",
};

export function normalizeDepth(v) {
  const n = Number(v);
  return n === DEPTH_WATCH || n === DEPTH_OUTCOME ? n : DEPTH_MAP;
}

/* ==========================================================================
   SPEC v2 §5 — progress markers
   ==========================================================================
   One observable behaviour of one stakeholder. At depth 2 a marker has no tier;
   at depth 3 it is sorted into the ladder. Same record either way, which is
   what makes promotion between depths lossless.
*/

export const MARKER_TIERS = ["start", "like", "love", "regression"];

export const TIER_LABELS = {
  start: "Start to see",
  like: "Like to see",
  love: "Love to see",
  regression: "Hope not to see",
};

export const TIER_HINTS = {
  start: "The earliest response to your inputs — not their current baseline. Three or four.",
  like: "Active engagement. Six to eight. Draft these last; the real sequence emerges during monitoring.",
  love: "What profound influence looks like. Three or four. Write these first — they fall out of the outcome challenge.",
  regression: "Backsliding. Two or three. SPEC 6.13 makes these required, not optional.",
};

/** Depth weighting for the ladder. Regression is counted separately, never weighted. */
export const TIER_WEIGHT = { start: 1, like: 2, love: 3, regression: 0 };

export function normalizeTier(v) {
  return MARKER_TIERS.includes(v) ? v : null;
}

export const OBSERVED_VALUES = ["yes", "not-yet", "backwards"];

export const OBSERVED_LABELS = {
  yes: "Observed",
  "not-yet": "Not yet",
  backwards: "Moved backwards",
};

/**
 * SPEC v2 §6.9 — a marker is an observable act, not an opinion.
 *
 * These are warnings and none of them blocks a save. Every rule is a heuristic
 * over free text: "lobbying for better welfare standards" trips the qualifier
 * check on a word sitting in the object rather than the measurement, and no
 * gerund test survives contact with real English. A check that blocks on a
 * false positive gets switched off within a week; one that warns loudly and is
 * counted in Coverage keeps its teeth without lying about what it knows.
 */
const BANNED_QUALIFIERS = [
  "increasingly", "increased", "increase", "more", "better", "best",
  "decreasing", "decreased", "improved", "improving", "enhanced",
  "strengthened", "greater", "fewer", "less", "higher", "lower",
  "effectively", "successfully", "appropriate", "adequate",
  "significant", "significantly", "regularly", "properly",
];

export function markerWarnings(text) {
  const t = String(text == null ? "" : text).trim();
  const out = [];
  if (!t) return out;

  const words = t.split(/\s+/);
  const first = words[0].toLowerCase().replace(/[^a-z]/g, "");

  if (first && !first.endsWith("ing")) {
    out.push({
      code: "not-gerund",
      message: 'Start with a gerund — "publishing", "convening", "reallocating". This starts with "' + words[0] + '".',
    });
  }

  const found = BANNED_QUALIFIERS.filter((q) => new RegExp("\\b" + q + "\\b", "i").test(t));
  if (found.length) {
    out.push({
      code: "qualifier",
      message:
        "Contains " + found.map((f) => '"' + f + '"').join(", ") +
        ". Qualifiers make a marker unscoreable — the record captures whether it happened, so a comparative has nowhere to go.",
    });
  }

  if (words.length > 6 && /\band\b|\bor\b/i.test(t)) {
    out.push({
      code: "two-acts",
      message: "This may describe more than one act. One observable act per marker, or it cannot be scored cleanly.",
    });
  }

  if (words.length > 20) {
    out.push({ code: "long", message: "Long for a marker. Aim for one short observable act." });
  }

  return out;
}

export function makeMarker(projectId, stakeholderId, fields = {}) {
  const at = fields.createdAt || nowISO();
  return {
    id: fields.id || newId(),
    projectId,
    stakeholderId,
    text: String(fields.text || "").trim(),
    tier: normalizeTier(fields.tier),
    // SPEC 6.11 — watch only what you said you would watch.
    watched: fields.watched === undefined ? true : Boolean(fields.watched),
    retired: Boolean(fields.retired),
    createdAt: at,
    retiredAt: fields.retiredAt || null,
  };
}

export function makeObservation(projectId, stakeholderId, markerId, cycleId, fields = {}) {
  return {
    id: fields.id || newId(),
    projectId,
    stakeholderId,
    markerId,
    cycleId: cycleId || null,
    at: fields.at || nowISO(),
    by: fields.by || "",
    observed: OBSERVED_VALUES.includes(fields.observed) ? fields.observed : "not-yet",
    narrative: String(fields.narrative || ""),
    evidence: String(fields.evidence || ""),
    contribution: String(fields.contribution || ""),
    significance: String(fields.significance || ""),
  };
}

export function makeCycle(projectId, fields = {}) {
  return {
    id: fields.id || newId(),
    projectId,
    label: String(fields.label || defaultCycleLabel()),
    openedAt: fields.openedAt || nowISO(),
    closedAt: fields.closedAt || null,
    by: fields.by || "",
    wentBackwards: String(fields.wentBackwards || ""),
    matteredForGoal: String(fields.matteredForGoal || ""),
    mapChangesProposed: String(fields.mapChangesProposed || ""),
  };
}

export function defaultCycleLabel(d = new Date()) {
  return "Q" + (Math.floor(d.getMonth() / 3) + 1) + " " + d.getFullYear();
}

/* --------------------------------------------------------- ladder readout */

/** The most recent observation for each marker, keyed by marker id. */
export function latestObservations(observations) {
  const byMarker = new Map();
  for (const o of observations || []) {
    const prev = byMarker.get(o.markerId);
    if (!prev || String(o.at) > String(prev.at)) byMarker.set(o.markerId, o);
  }
  return byMarker;
}

/**
 * Ladder state for one stakeholder.
 *
 * SPEC 6.10 — the tiers are depth of change, not a timeline. Nothing here
 * returns an ordering, a date sequence or a "next step", and nothing built on
 * it may imply one.
 */
export function ladderState(markers, observations) {
  const live = (markers || []).filter((m) => !m.retired);
  const latest = latestObservations(observations);

  const tiers = {};
  for (const t of MARKER_TIERS) tiers[t] = { total: 0, observed: 0, backwards: 0 };
  const untiered = { total: 0, observed: 0, backwards: 0 };

  let weightTotal = 0;
  let weightObserved = 0;
  let regressionSeen = 0;
  let anyObservation = false;

  for (const m of live) {
    const o = latest.get(m.id);
    const bucket = m.tier ? tiers[m.tier] : untiered;
    bucket.total++;
    if (o) anyObservation = true;
    if (o && o.observed === "yes") bucket.observed++;
    if (o && o.observed === "backwards") bucket.backwards++;

    if (m.tier === "regression") {
      // A regression marker being SEEN is the bad outcome, so it counts toward
      // regression rather than toward progress.
      if (o && o.observed === "yes") regressionSeen++;
      continue;
    }
    // Untiered markers (depth 2) weigh 1 — there is no ladder, so no depth.
    const w = m.tier ? TIER_WEIGHT[m.tier] : 1;
    weightTotal += w;
    if (o && o.observed === "yes") weightObserved += w;
    if (o && o.observed === "backwards") regressionSeen++;
  }

  return {
    markers: live.length,
    watched: live.filter((m) => m.watched).length,
    tiers,
    untiered,
    regressionSeen,
    anyObservation,
    /** 0..1, weighted by depth of tier. Regression markers excluded. */
    progress: weightTotal ? weightObserved / weightTotal : 0,
    observedCount: MARKER_TIERS.reduce((n, t) => n + tiers[t].observed, 0) + untiered.observed,
  };
}

/* --------------------------------------- SPEC 6.8 — the instrument itself */

/** Enough evidence before the tool says anything at all. */
export const INSTRUMENT_MIN_MARKERS = 3;
/** How far the two readings may diverge before it is worth remarking on. */
export const INSTRUMENT_GAP = 0.35;

/**
 * SPEC v2 §6.8 — judgement beside observation.
 *
 * Shift records what someone decided. Markers record what the actor was seen
 * doing. Neither method holds both, so neither can notice when they disagree.
 * This does exactly one thing: report that they do.
 *
 * `judged` is how far interest has travelled toward the top of the scale as a
 * fraction of the room available from the baseline — so a move from +6 to +8
 * counts for what it cost rather than for how small it looks.
 *
 * IT ESTABLISHES NOTHING ABOUT CAUSATION, and every caller must say so where it
 * is displayed. Two readings disagreeing is a prompt to look, not a finding.
 */
export function judgedVsObserved(stakeholder, markers, observations) {
  const ladder = ladderState(markers, observations);
  const base = stakeholder.baseline || {};
  const deltaInterest = Number(stakeholder.interest) - Number(base.interest);
  const deltaPower = Number(stakeholder.power) - Number(base.power);

  const room = INTEREST_MAX - Number(base.interest);
  const judged = room > 0 ? Math.max(0, Math.min(1, deltaInterest / room)) : 0;

  const result = {
    ladder,
    deltaInterest,
    deltaPower,
    judged,
    observed: ladder.progress,
    gap: judged - ladder.progress,
    verdict: "insufficient",
    message: "",
  };

  // Backsliding outranks everything. It is the thing OM practitioners almost
  // never record and the thing this movement most needs to see (SPEC 6.13).
  if (ladder.regressionSeen > 0) {
    result.verdict = "regressing";
    result.message =
      ladder.regressionSeen === 1
        ? "One behaviour has moved backwards. Whatever else the scores say, that is the thing to look at."
        : ladder.regressionSeen + " behaviours have moved backwards. Whatever else the scores say, that is the thing to look at.";
    return result;
  }

  if (ladder.markers < INSTRUMENT_MIN_MARKERS || !ladder.anyObservation) {
    result.message =
      ladder.markers < INSTRUMENT_MIN_MARKERS
        ? "Add at least " + INSTRUMENT_MIN_MARKERS + " behaviours to compare the score against what has actually been seen."
        : "No behaviour has been reviewed yet. Run a reflection cycle to compare the score against what has been seen.";
    return result;
  }

  if (result.gap > INSTRUMENT_GAP) {
    result.verdict = "ahead";
    result.message =
      "Your score has moved further than the behaviour has. Either the score is running ahead of the evidence, or there is evidence nobody has recorded.";
  } else if (result.gap < -INSTRUMENT_GAP) {
    result.verdict = "behind";
    result.message =
      "They are doing the things and the score has not caught up. Either the map is stale, or these behaviours matter less to the goal than the ladder assumes.";
  } else {
    result.verdict = "corroborated";
    result.message =
      "Judgement and observation agree. Two independent readings saying the same thing is the state worth reporting.";
  }
  return result;
}
