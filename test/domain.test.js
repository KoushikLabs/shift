import { describe, it, expect } from "vitest";
import {
  stanceOf,
  stanceLabel,
  clampPower,
  clampInterest,
  normalizeStrategy,
  sameStrategy,
  hasStrategy,
  looksLikeQuadrantLabel,
  looksLikeIndividual,
  changedFields,
  rationaleGate,
  strategyPeriods,
  sortChangesAscending,
  movementOf,
  rankByMovement,
  coverage,
  stanceCounts,
  makeStakeholder,
  emptyStrategy,
} from "../src/domain.js";

const S = (o) => ({ ...emptyStrategy(), ...o });

describe("stance (SPEC 5)", () => {
  it("splits ally / neutral / opponent at +2 and -2", () => {
    expect(stanceOf(10)).toBe("ally");
    expect(stanceOf(2)).toBe("ally");
    expect(stanceOf(1)).toBe("neutral");
    expect(stanceOf(0)).toBe("neutral");
    expect(stanceOf(-1)).toBe("neutral");
    expect(stanceOf(-2)).toBe("oppose");
    expect(stanceOf(-10)).toBe("oppose");
  });

  it("keeps a real neutral band rather than splitting at a midpoint", () => {
    // The whole point of SPEC 5: "position unknown" must not be forced into
    // ally or opponent. Three interest values sit in the band.
    const band = [-1, 0, 1].map(stanceOf);
    expect(band).toEqual(["neutral", "neutral", "neutral"]);
  });

  it("labels stances for display", () => {
    expect(stanceLabel("ally")).toBe("Ally");
    expect(stanceLabel("neutral")).toBe("Neutral");
    expect(stanceLabel("oppose")).toBe("Opponent");
  });
});

describe("score clamping", () => {
  it("holds power to 0..10 and interest to -10..+10", () => {
    expect(clampPower(99)).toBe(10);
    expect(clampPower(-4)).toBe(0);
    expect(clampPower(7.4)).toBe(7);
    expect(clampInterest(99)).toBe(10);
    expect(clampInterest(-99)).toBe(-10);
    expect(clampInterest("−3")).toBe(0); // U+2212 is not a JS minus; falls back
    expect(clampInterest("-3")).toBe(-3);
    expect(clampInterest("nonsense")).toBe(0);
  });
});

describe("strategies", () => {
  it("normalises partial and junk input to five string fields", () => {
    expect(normalizeStrategy(null)).toEqual(S());
    expect(normalizeStrategy({ objective: "x" })).toEqual(S({ objective: "x" }));
    expect(normalizeStrategy({ owner: 42 })).toEqual(S({ owner: "42" }));
  });

  it("compares on trimmed content", () => {
    expect(sameStrategy({ objective: "a" }, { objective: " a " })).toBe(true);
    expect(sameStrategy({ objective: "a" }, { objective: "b" })).toBe(false);
    expect(sameStrategy(null, {})).toBe(true);
  });

  it("counts a strategy as present if any one field has content", () => {
    expect(hasStrategy(null)).toBe(false);
    expect(hasStrategy(S())).toBe(false);
    expect(hasStrategy(S({ owner: "  " }))).toBe(false);
    expect(hasStrategy(S({ owner: "Nimisha" }))).toBe(true);
  });
});

describe("quadrant labels are not a strategy (SPEC 6.7)", () => {
  it("flags the stock outputs of a standard power/interest tool", () => {
    for (const t of ["monitor", "Monitor", "keep informed", "Manage Closely", "keep satisfied", "minimal effort"]) {
      expect(looksLikeQuadrantLabel(t), t).toBe(true);
    }
  });

  it("does not flag a real objective that happens to contain the word", () => {
    expect(
      looksLikeQuadrantLabel("Monitor their filings and respond only through formal process")
    ).toBe(false);
    expect(
      looksLikeQuadrantLabel("Get the board to specify manure-removal frequency in poultry consents")
    ).toBe(false);
  });

  it("ignores empty input", () => {
    expect(looksLikeQuadrantLabel("")).toBe(false);
    expect(looksLikeQuadrantLabel(null)).toBe(false);
  });
});

describe("named individual detection (SPEC 10)", () => {
  it("suggests person for titled and plain personal names", () => {
    expect(looksLikeIndividual("Dr Amara Okoye")).toBe(true);
    expect(looksLikeIndividual("Amara Okoye")).toBe(true);
    expect(looksLikeIndividual("Jean-Luc Bertrand")).toBe(true);
  });

  it("does not flag organisations", () => {
    for (const n of [
      "Ministry of Fisheries",
      "National Poultry Federation",
      "Karnal Pollution Control Board",
      "Greenfield Farms Ltd",
      "Riverside University",
      "The Humane Society",
    ]) {
      expect(looksLikeIndividual(n), n).toBe(false);
    }
  });

  it("stays quiet on ambiguous single words", () => {
    expect(looksLikeIndividual("Defra")).toBe(false);
    expect(looksLikeIndividual("")).toBe(false);
  });
});

describe("changedFields (SPEC 8)", () => {
  const prev = { power: 5, interest: 0, rationale: "a", strategy: S({ objective: "o" }) };

  it("returns nothing when nothing changed", () => {
    expect(changedFields(prev, { ...prev })).toEqual([]);
  });

  it("detects each field independently", () => {
    expect(changedFields(prev, { ...prev, power: 6 })).toEqual(["power"]);
    expect(changedFields(prev, { ...prev, interest: -3 })).toEqual(["interest"]);
    expect(changedFields(prev, { ...prev, rationale: "b" })).toEqual(["rationale"]);
    expect(changedFields(prev, { ...prev, strategy: S({ objective: "z" }) })).toEqual(["strategy"]);
  });

  it("ignores whitespace-only rationale edits", () => {
    expect(changedFields(prev, { ...prev, rationale: " a " })).toEqual([]);
  });

  it("reports several at once, in model order", () => {
    expect(
      changedFields(prev, { power: 9, interest: 4, rationale: "b", strategy: S({ owner: "Sam" }) })
    ).toEqual(["power", "interest", "rationale", "strategy"]);
  });
});

describe("the rationale gate (SPEC 6.1)", () => {
  it("blocks a score move when the rationale has not been touched", () => {
    const g = rationaleGate({ scoreMoved: true, rationaleMoved: false, acknowledged: false, rationaleText: "old" });
    expect(g.needsAttention).toBe(true);
    expect(g.blocked).toBe(true);
  });

  it("unblocks when the rationale is edited", () => {
    const g = rationaleGate({ scoreMoved: true, rationaleMoved: true, acknowledged: false, rationaleText: "new" });
    expect(g.needsAttention).toBe(false);
    expect(g.blocked).toBe(false);
  });

  it("unblocks when the correction box is ticked", () => {
    const g = rationaleGate({ scoreMoved: true, rationaleMoved: false, acknowledged: true, rationaleText: "old" });
    expect(g.needsAttention).toBe(true); // still shown as needing attention
    expect(g.blocked).toBe(false); // but saving is allowed
  });

  it("never allows an empty rationale", () => {
    expect(rationaleGate({ scoreMoved: false, rationaleMoved: true, acknowledged: false, rationaleText: "  " }).blocked).toBe(true);
    expect(rationaleGate({ scoreMoved: true, rationaleMoved: false, acknowledged: true, rationaleText: "" }).blocked).toBe(true);
  });

  it("does not fire when only the strategy changed", () => {
    const g = rationaleGate({ scoreMoved: false, rationaleMoved: false, acknowledged: false, rationaleText: "old" });
    expect(g.needsAttention).toBe(false);
    expect(g.blocked).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */

describe("strategy periods (SPEC 5, derived not stored)", () => {
  const baseline = { power: 4, interest: 0, strategy: S({ objective: "First approach" }), at: "2026-01-01T00:00:00Z" };

  const change = (o) => ({
    at: o.at,
    power: o.power,
    interest: o.interest,
    rationale: o.rationale || "r",
    strategy: normalizeStrategy(o.strategy),
    prevPower: o.prevPower,
    prevInterest: o.prevInterest,
    prevRationale: o.prevRationale || "r",
    prevStrategy: normalizeStrategy(o.prevStrategy),
    changedFields: o.changedFields,
    note: o.note || "",
  });

  it("returns one open period when nothing has changed", () => {
    const p = strategyPeriods(baseline, { power: 4, interest: 0 }, []);
    expect(p).toHaveLength(1);
    expect(p[0].open).toBe(true);
    expect(p[0].strategy.objective).toBe("First approach");
    expect(p[0].deltaPower).toBe(0);
    expect(p[0].deltaInterest).toBe(0);
  });

  it("attributes score movement to the period that was in force", () => {
    // Interest moves 0 -> +3 with no strategy change. The open period owns it.
    const changes = [
      change({ at: "2026-02-01T00:00:00Z", power: 4, interest: 3, prevPower: 4, prevInterest: 0, strategy: baseline.strategy, prevStrategy: baseline.strategy, changedFields: ["interest", "rationale"] }),
    ];
    const p = strategyPeriods(baseline, { power: 4, interest: 3 }, changes);
    expect(p).toHaveLength(1);
    expect(p[0].deltaInterest).toBe(3);
  });

  it("closes a period and opens a new one when strategy changes", () => {
    const changes = [
      change({ at: "2026-02-01T00:00:00Z", power: 4, interest: 3, prevPower: 4, prevInterest: 0, strategy: baseline.strategy, prevStrategy: baseline.strategy, changedFields: ["interest"] }),
      change({ at: "2026-03-01T00:00:00Z", power: 4, interest: 3, prevPower: 4, prevInterest: 3, strategy: S({ objective: "Second approach" }), prevStrategy: baseline.strategy, changedFields: ["strategy"] }),
      change({ at: "2026-04-01T00:00:00Z", power: 6, interest: 5, prevPower: 4, prevInterest: 3, strategy: S({ objective: "Second approach" }), prevStrategy: S({ objective: "Second approach" }), changedFields: ["power", "interest"] }),
    ];
    const p = strategyPeriods(baseline, { power: 6, interest: 5 }, changes);
    expect(p).toHaveLength(2);

    // newest first
    expect(p[0].strategy.objective).toBe("Second approach");
    expect(p[0].open).toBe(true);
    expect(p[0].deltaPower).toBe(2);
    expect(p[0].deltaInterest).toBe(2);

    expect(p[1].strategy.objective).toBe("First approach");
    expect(p[1].open).toBe(false);
    expect(p[1].to).toBe("2026-03-01T00:00:00Z");
    expect(p[1].deltaInterest).toBe(3);
  });

  it("gives a simultaneous score+strategy change to the NEW period, never the old one", () => {
    // This is the anti-overclaim convention (SPEC 6.3). One save moves interest
    // 0 -> +6 and swaps the strategy. The retiring approach must not be credited.
    const changes = [
      change({
        at: "2026-05-01T00:00:00Z",
        power: 4,
        interest: 6,
        prevPower: 4,
        prevInterest: 0,
        strategy: S({ objective: "Second approach" }),
        prevStrategy: baseline.strategy,
        changedFields: ["interest", "strategy"],
      }),
    ];
    const p = strategyPeriods(baseline, { power: 4, interest: 6 }, changes);
    expect(p).toHaveLength(2);
    const [current, retired] = p;
    expect(retired.strategy.objective).toBe("First approach");
    expect(retired.deltaInterest).toBe(0); // gets no credit
    expect(current.strategy.objective).toBe("Second approach");
    expect(current.deltaInterest).toBe(0); // and starts from +6, so it has not earned it either
    expect(current.interest0).toBe(6);
  });

  it("drops periods whose strategy was entirely empty", () => {
    const emptyBase = { power: 4, interest: 0, strategy: S(), at: "2026-01-01T00:00:00Z" };
    const changes = [
      change({ at: "2026-02-01T00:00:00Z", power: 4, interest: 2, prevPower: 4, prevInterest: 0, strategy: S({ objective: "Now we have one" }), prevStrategy: S(), changedFields: ["interest", "strategy"] }),
    ];
    const p = strategyPeriods(emptyBase, { power: 4, interest: 2 }, changes);
    expect(p).toHaveLength(1);
    expect(p[0].strategy.objective).toBe("Now we have one");
  });

  it("is insensitive to the order changes arrive in", () => {
    const mk = () => [
      change({ at: "2026-03-01T00:00:00Z", power: 4, interest: 3, prevPower: 4, prevInterest: 3, strategy: S({ objective: "B" }), prevStrategy: baseline.strategy, changedFields: ["strategy"] }),
      change({ at: "2026-02-01T00:00:00Z", power: 4, interest: 3, prevPower: 4, prevInterest: 0, strategy: baseline.strategy, prevStrategy: baseline.strategy, changedFields: ["interest"] }),
      change({ at: "2026-04-01T00:00:00Z", power: 4, interest: 7, prevPower: 4, prevInterest: 3, strategy: S({ objective: "B" }), prevStrategy: S({ objective: "B" }), changedFields: ["interest"] }),
    ];
    const shuffled = strategyPeriods(baseline, { power: 4, interest: 7 }, mk());
    const sorted = strategyPeriods(baseline, { power: 4, interest: 7 }, sortChangesAscending(mk()));
    expect(shuffled).toEqual(sorted);
    expect(shuffled).toHaveLength(2);
    expect(shuffled[0].deltaInterest).toBe(4);
    expect(shuffled[1].deltaInterest).toBe(3);
  });

  it("handles many strategy changes with no movement — the churn pattern", () => {
    const changes = ["2026-02-01", "2026-03-01", "2026-04-01"].map((d, n) =>
      change({
        at: d + "T00:00:00Z",
        power: 4,
        interest: 0,
        prevPower: 4,
        prevInterest: 0,
        strategy: S({ objective: "Approach " + (n + 2) }),
        prevStrategy: S({ objective: "Approach " + (n + 1) }),
        changedFields: ["strategy"],
      })
    );
    const p = strategyPeriods(baseline, { power: 4, interest: 0 }, changes);
    expect(p).toHaveLength(4);
    expect(p.every((x) => x.deltaPower === 0 && x.deltaInterest === 0)).toBe(true);
  });
});

/* ------------------------------------------------------------------------- */

describe("movement (SPEC 7)", () => {
  const mk = (name, from, to) =>
    makeStakeholder("p", { name, power: from[0], interest: from[1] }) &&
    (() => {
      const s = makeStakeholder("p", { name, power: from[0], interest: from[1] });
      s.power = to[0];
      s.interest = to[1];
      return s;
    })();

  it("measures from baseline in both directions", () => {
    const s = mk("A", [4, 0], [6, -3]);
    const m = movementOf(s);
    expect(m.deltaPower).toBe(2);
    expect(m.deltaInterest).toBe(-3);
    expect(m.magnitude).toBe(5);
    expect(m.direction).toBe("away");
    expect(m.stanceChanged).toBe(true); // neutral -> opponent
  });

  it("reports no movement when nothing moved", () => {
    const m = movementOf(mk("A", [4, 0], [4, 0]));
    expect(m.moved).toBe(false);
    expect(m.direction).toBe("level");
  });

  it("ranks by size of shift, largest first", () => {
    const list = [mk("small", [4, 0], [4, 1]), mk("big", [2, -8], [8, 4]), mk("still", [5, 5], [5, 5])];
    const ranked = rankByMovement(list);
    expect(ranked.map((r) => r.stakeholder.name)).toEqual(["big", "small"]);
    expect(ranked[0].movement.magnitude).toBe(18);
  });
});

describe("coverage (SPEC 7 + 6.6 + 6.7)", () => {
  it("counts the gaps the spec says must be visible", () => {
    const a = makeStakeholder("p", { name: "Ally Org", power: 5, interest: 6, rationale: "r", strategy: S({ objective: "Real objective here", owner: "Sam" }) });
    const b = makeStakeholder("p", { name: "No Strategy Board", power: 8, interest: -5, rationale: "r" });
    const c = makeStakeholder("p", { name: "Lazy Council", power: 3, interest: 0, rationale: "", strategy: S({ objective: "monitor" }) });

    const cov = coverage([a, b, c]);
    expect(cov.total).toBe(3);
    expect(cov.withStrategy).toBe(2);
    expect(cov.noStrategy.map((x) => x.name)).toEqual(["No Strategy Board"]);
    expect(cov.noRationale.map((x) => x.name)).toEqual(["Lazy Council"]);
    expect(cov.quadrantLabel.map((x) => x.name)).toEqual(["Lazy Council"]);
    expect(cov.noOwner.map((x) => x.name)).toEqual(["Lazy Council"]);
    expect(cov.opponentsNoStrategy.map((x) => x.name)).toEqual(["No Strategy Board"]);
    expect(cov.neutralUnknown.map((x) => x.name)).toEqual(["Lazy Council"]);
  });

  it("counts stances", () => {
    const mk = (i) => makeStakeholder("p", { name: "x", interest: i });
    expect(stanceCounts([mk(5), mk(0), mk(-5), mk(-2), mk(2)])).toEqual({ ally: 2, neutral: 1, oppose: 2 });
  });
});

describe("makeStakeholder", () => {
  it("captures its own baseline as the first recorded state (SPEC 5)", () => {
    const s = makeStakeholder("proj", { name: "X", power: 7, interest: -4, rationale: "because" });
    expect(s.baseline).toEqual({
      power: 7,
      interest: -4,
      rationale: "because",
      strategy: emptyStrategy(),
      at: s.createdAt,
    });
    expect(s.updatedAt).toBe(null);
  });

  it("defaults an unscored actor to neutral, not positive (SPEC 6.6)", () => {
    const s = makeStakeholder("proj", { name: "Unknown Body" });
    expect(s.interest).toBe(0);
    expect(stanceOf(s.interest)).toBe("neutral");
  });

  it("gives every stakeholder a distinct id", () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeStakeholder("p", { name: "x" }).id));
    expect(ids.size).toBe(50);
  });

  it("keeps the baseline strategy independent of later edits", () => {
    const s = makeStakeholder("p", { name: "x", strategy: S({ objective: "one" }) });
    s.strategy.objective = "two";
    expect(s.baseline.strategy.objective).toBe("one");
  });
});
