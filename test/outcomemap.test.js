import { describe, it, expect, afterEach } from "vitest";
import {
  READINESS_CONDITIONS,
  READINESS_MAX,
  readinessVerdict,
  DEPTH_MAP,
  DEPTH_WATCH,
  DEPTH_OUTCOME,
  VOCABULARY_DEFAULTS,
  normalizeVocabulary,
  setActiveVocabulary,
  resetVocabulary,
  vocabulary,
  reachLabel,
  tierLabel,
  outcomeChallengeWarnings,
  DYER_CHECKS,
  STRATEGY_CELLS,
  emptyStrategyMap,
  normalizeStrategyMap,
  hasStrategyMap,
  strategyMapGaps,
  makeProject,
  makeStakeholder,
} from "../src/domain.js";

afterEach(() => resetVocabulary());

/* ----------------------------------------------------- readiness scorecard */

const score = (v, overrides = {}) => {
  const s = {};
  for (const c of READINESS_CONDITIONS) s[c.key] = v;
  return { ...s, ...overrides };
};

describe("readiness scorecard", () => {
  it("has ten conditions, three of them disqualifying", () => {
    expect(READINESS_CONDITIONS).toHaveLength(10);
    expect(READINESS_CONDITIONS.filter((c) => c.gate)).toHaveLength(3);
    expect(READINESS_MAX).toBe(20);
  });

  it("says nothing until something is scored", () => {
    expect(readinessVerdict({}).verdict).toBe("unscored");
    expect(readinessVerdict({}).recommendedDepth).toBe(null);
  });

  it("waits for all ten before recommending", () => {
    const v = readinessVerdict({ strategy: 2, purpose: 2 });
    expect(v.verdict).toBe("partial");
    expect(v.answered).toBe(2);
    expect(v.recommendedDepth).toBe(null);
  });

  it("treats a zero on any gate as disqualifying, whatever the total", () => {
    // 18 of 20 — an excellent score — but the funder has not been asked.
    const v = readinessVerdict(score(2, { funder: 0 }));
    expect(v.total).toBe(18);
    expect(v.verdict).toBe("decline");
    expect(v.gateFailures.map((g) => g.key)).toEqual(["funder"]);
    expect(v.recommendedDepth).toBe(DEPTH_WATCH);
  });

  it("names every gate that failed", () => {
    const v = readinessVerdict(score(2, { funder: 0, person: 0 }));
    expect(v.gateFailures.map((g) => g.key).sort()).toEqual(["funder", "person"]);
    expect(v.detail).toMatch(/funder/i);
    expect(v.detail).toMatch(/day per quarter/i);
  });

  it("does not disqualify on a gate scored 1", () => {
    expect(readinessVerdict(score(2, { funder: 1 })).verdict).not.toBe("decline");
  });

  it("recommends the full outcome map at 16 and above", () => {
    const v = readinessVerdict(score(2));
    expect(v.total).toBe(20);
    expect(v.verdict).toBe("full");
    expect(v.recommendedDepth).toBe(DEPTH_OUTCOME);
  });

  it("recommends a stripped outcome map between 11 and 15", () => {
    const v = readinessVerdict(score(1, { strategy: 2, purpose: 2, actors: 2 }));
    expect(v.total).toBe(13);
    expect(v.verdict).toBe("stripped");
    expect(v.recommendedDepth).toBe(DEPTH_OUTCOME);
    expect(v.detail).toMatch(/three boundary partners at most/i);
  });

  it("recommends Watch between 6 and 10", () => {
    const v = readinessVerdict(score(1));
    expect(v.total).toBe(10);
    expect(v.verdict).toBe("watch");
    expect(v.recommendedDepth).toBe(DEPTH_WATCH);
  });

  it("recommends the plain map below 6", () => {
    // Gates all scored 1 so nothing is disqualifying, everything else 0: total 3.
    const v = readinessVerdict(score(0, { funder: 1, person: 1, behaviour: 1 }));
    expect(v.total).toBe(3);
    expect(v.gateFailures).toHaveLength(0);
    expect(v.verdict).toBe("decline");
    expect(v.recommendedDepth).toBe(DEPTH_MAP);
  });

  it("recommends a depth rather than only passing judgement", () => {
    // The scorecard earns its place by choosing how much machinery to carry.
    for (const s of [score(2), score(1), score(0), score(2, { funder: 0 })]) {
      expect([DEPTH_MAP, DEPTH_WATCH, DEPTH_OUTCOME]).toContain(readinessVerdict(s).recommendedDepth);
    }
  });
});

/* --------------------------------------------------------- vocabulary swaps */

describe("vocabulary", () => {
  it("defaults to the standard Outcome Mapping terms", () => {
    expect(normalizeVocabulary(null)).toEqual(VOCABULARY_DEFAULTS);
    expect(reachLabel("partner")).toBe("Boundary partner");
    expect(tierLabel("start")).toBe("Start to see");
  });

  it("applies a map's swaps to the triage and the first rung", () => {
    setActiveVocabulary({ partner: "Key actor", target: "Duty-bearer", startTier: "Expect to see" });
    expect(reachLabel("partner")).toBe("Key actor");
    expect(reachLabel("target")).toBe("Duty-bearer");
    expect(tierLabel("start")).toBe("Expect to see");
  });

  it("leaves the rungs it does not own alone", () => {
    setActiveVocabulary({ startTier: "Expect to see" });
    expect(tierLabel("like")).toBe("Like to see");
    expect(tierLabel("love")).toBe("Love to see");
    expect(tierLabel("regression")).toBe("Hope not to see");
  });

  it("ignores blank and non-string overrides rather than blanking a label", () => {
    setActiveVocabulary({ partner: "   ", target: 42, startTier: null });
    expect(vocabulary().partner).toBe("Boundary partner");
    expect(vocabulary().target).toBe("Pressure target");
    expect(vocabulary().startTier).toBe("Start to see");
  });

  it("resets cleanly between maps", () => {
    setActiveVocabulary({ partner: "Key actor" });
    resetVocabulary();
    expect(reachLabel("partner")).toBe("Boundary partner");
  });

  it("is stored on the project", () => {
    const p = makeProject({ name: "m", vocabulary: { partner: "Change agent" } });
    expect(p.vocabulary.partner).toBe("Change agent");
    expect(p.vocabulary.startTier).toBe("Start to see");
    expect(makeProject({ name: "m" }).vocabulary).toEqual(VOCABULARY_DEFAULTS);
  });
});

/* ------------------------------------------------------- outcome challenge */

describe("outcome challenge checks", () => {
  const good =
    "Suppliers to committed companies treat cage-free conversion as a planned commercial transition rather than " +
    "a customer imposition: they publish conversion timelines, invest ahead of demand, share technical learning " +
    "with other producers in their market, engage constructively with welfare auditing, and tell their buyers " +
    "when a stated deadline is not achievable early enough for it to be renegotiated rather than quietly missed.";

  it("passes the worked example from the brief", () => {
    expect(outcomeChallengeWarnings(good)).toEqual([]);
  });

  it("flags a one-line objective as too short", () => {
    expect(outcomeChallengeWarnings("Get the board to change the consent form.").map((w) => w.code)).toContain("short");
  });

  it("flags the results-based-management register", () => {
    const w = outcomeChallengeWarnings(
      "Government officials acknowledge the importance of improved welfare and apply minimum standards, " +
        "with increased awareness across the department and adequate resourcing for inspection visits each year."
    );
    expect(w.map((x) => x.code)).toContain("vague");
  });

  it("flags a challenge written as our delivery rather than their behaviour", () => {
    const w = outcomeChallengeWarnings(
      "We will build a relationship with the pollution board and engage regularly with the ministry so that our " +
        "casework is taken seriously by the officials we meet during the coming year of the programme."
    );
    expect(w.map((x) => x.code)).toContain("our-delivery");
  });

  it("stays quiet on empty input", () => {
    expect(outcomeChallengeWarnings("")).toEqual([]);
    expect(outcomeChallengeWarnings(null)).toEqual([]);
  });

  it("keeps all four of Dyer's checks, including the one it cannot test", () => {
    expect(DYER_CHECKS).toHaveLength(4);
    expect(DYER_CHECKS[0]).toMatch(/bundled/i);
  });
});

/* ------------------------------------------------------------ strategy map */

describe("strategy map", () => {
  it("has six cells and starts empty", () => {
    expect(STRATEGY_CELLS).toHaveLength(6);
    expect(hasStrategyMap(emptyStrategyMap())).toBe(false);
    expect(normalizeStrategyMap(null)).toEqual(emptyStrategyMap());
  });

  it("sits on the stakeholder", () => {
    const s = makeStakeholder("p", { name: "x", strategyMap: { i1: "Fund the training" } });
    expect(s.strategyMap.i1).toBe("Fund the training");
    expect(s.strategyMap.e3).toBe("");
  });

  it("says nothing about a map nobody has started", () => {
    expect(strategyMapGaps(emptyStrategyMap())).toEqual([]);
  });

  it("calls out a team working only on the actor", () => {
    const gaps = strategyMapGaps({ i1: "training", i2: "peer data", i3: "introductions" });
    expect(gaps.join(" ")).toMatch(/nothing at their environment/i);
  });

  it("calls out a team with exactly one tactic", () => {
    const gaps = strategyMapGaps({ i1: "training", e1: "litigation" });
    expect(gaps.join(" ")).toMatch(/exactly one tactic/i);
  });

  it("notes when nothing is causal", () => {
    const gaps = strategyMapGaps({ i2: "peer data", e3: "coalition" });
    expect(gaps.join(" ")).toMatch(/Nothing causal/i);
  });

  it("counts the empty cells when the shape is otherwise fine", () => {
    const gaps = strategyMapGaps({ i1: "training", i2: "peer data", e2: "brief the buyers", e3: "association" });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatch(/2 of the six cells are empty/);
  });

  it("says nothing about a fully populated grid", () => {
    const full = {};
    for (const c of STRATEGY_CELLS) full[c] = "something";
    expect(strategyMapGaps(full)).toEqual([]);
  });

  it("treats whitespace as empty", () => {
    expect(hasStrategyMap({ i1: "   " })).toBe(false);
  });
});
