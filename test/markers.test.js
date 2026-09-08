import { describe, it, expect } from "vitest";
import {
  normalizeReach,
  reachLabel,
  boundaryPartners,
  BOUNDARY_PARTNER_CEILING,
  normalizeDepth,
  DEPTH_MAP,
  DEPTH_WATCH,
  DEPTH_OUTCOME,
  markerWarnings,
  makeMarker,
  makeObservation,
  makeCycle,
  makeStakeholder,
  makeProject,
  latestObservations,
  ladderState,
  judgedVsObserved,
  INSTRUMENT_MIN_MARKERS,
  defaultCycleLabel,
} from "../src/domain.js";

/* ------------------------------------------------------------ SPEC v2 §5 */

describe("actor triage", () => {
  it("defaults to partner and rejects unknown values", () => {
    expect(normalizeReach(undefined)).toBe("partner");
    expect(normalizeReach("nonsense")).toBe("partner");
    expect(normalizeReach("target")).toBe("target");
    expect(normalizeReach("out-of-reach")).toBe("out-of-reach");
    expect(reachLabel("target")).toBe("Pressure target");
  });

  it("puts reach on new stakeholders, with an empty reachableVia", () => {
    const s = makeStakeholder("p", { name: "Board", reach: "out-of-reach" });
    expect(s.reach).toBe("out-of-reach");
    expect(s.reachableVia).toEqual([]);
  });

  it("keeps reach orthogonal to stance — a hostile partner is still a partner", () => {
    // The commonest way this gets built wrong: a supplier you speak to weekly
    // and score -6 is a boundary partner, not a pressure target.
    const supplier = makeStakeholder("p", { name: "Egg suppliers", interest: -6, reach: "partner" });
    const federation = makeStakeholder("p", { name: "Federation", interest: -6, reach: "target" });
    expect(supplier.reach).toBe("partner");
    expect(federation.reach).toBe("target");
    expect(boundaryPartners([supplier, federation]).map((s) => s.name)).toEqual(["Egg suppliers"]);
  });

  it("counts boundary partners so the ceiling can be enforced", () => {
    const many = Array.from({ length: 9 }, (_, i) => makeStakeholder("p", { name: "A" + i }));
    expect(boundaryPartners(many)).toHaveLength(9);
    expect(boundaryPartners(many).length > BOUNDARY_PARTNER_CEILING).toBe(true);
  });
});

describe("depth", () => {
  it("defaults to Map and only accepts the three known depths", () => {
    expect(normalizeDepth(undefined)).toBe(DEPTH_MAP);
    expect(normalizeDepth(0)).toBe(DEPTH_MAP);
    expect(normalizeDepth(9)).toBe(DEPTH_MAP);
    expect(normalizeDepth(2)).toBe(DEPTH_WATCH);
    expect(normalizeDepth("3")).toBe(DEPTH_OUTCOME);
    expect(makeProject({ name: "m" }).depth).toBe(DEPTH_MAP);
    expect(makeProject({ name: "m", depth: 2 }).depth).toBe(DEPTH_WATCH);
  });
});

/* ---------------------------------------------------------- SPEC v2 §6.9 */

describe("marker form warnings", () => {
  it("passes a well-formed marker from the worked example", () => {
    expect(markerWarnings("publishing a dated conversion timeline")).toEqual([]);
    expect(markerWarnings("attending technical sessions on cage-free housing")).toEqual([]);
    expect(markerWarnings("editing a journal special issue on the field")).toEqual([]);
  });

  it("flags a marker that does not start with a gerund", () => {
    const w = markerWarnings("they publish a timeline");
    expect(w.map((x) => x.code)).toContain("not-gerund");
  });

  it("flags qualifiers, which make a marker unscoreable", () => {
    for (const t of [
      "publishing increasingly detailed timelines",
      "engaging more with the community",
      "improved reporting to buyers",
    ]) {
      expect(markerWarnings(t).map((x) => x.code), t).toContain("qualifier");
    }
  });

  it("flags a marker that bundles two acts", () => {
    const w = markerWarnings("publishing a dated conversion timeline and lobbying their association");
    expect(w.map((x) => x.code)).toContain("two-acts");
  });

  it("does not flag a short phrase that merely contains 'and'", () => {
    expect(markerWarnings("convening producers and buyers").map((x) => x.code)).not.toContain("two-acts");
  });

  it("returns nothing for empty input rather than a pile of complaints", () => {
    expect(markerWarnings("")).toEqual([]);
    expect(markerWarnings(null)).toEqual([]);
  });

  it("never blocks — warnings are advisory, because every rule here is a heuristic", () => {
    // "better" sits in the object, not the measurement. The checker cannot tell,
    // which is exactly why it warns instead of refusing.
    const w = markerWarnings("lobbying their association for better welfare standards");
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((x) => typeof x.message === "string")).toBe(true);
  });
});

/* ------------------------------------------------------------- the ladder */

const mk = (text, tier, extra = {}) => makeMarker("p", "s1", { text, tier, ...extra });
const obs = (marker, observed, at) =>
  makeObservation("p", "s1", marker.id, "c1", { observed, at: at || "2026-03-01T00:00:00.000Z" });

describe("ladderState", () => {
  it("counts each tier separately and ignores retired markers", () => {
    const markers = [
      mk("attending a convening", "start"),
      mk("citing the literature", "start"),
      mk("publishing in a mainstream journal", "like"),
      mk("establishing a permanent centre", "love"),
      mk("publishing once and leaving the field", "regression"),
      mk("an old idea we dropped", "like", { retired: true }),
    ];
    const state = ladderState(markers, [obs(markers[0], "yes")]);
    expect(state.markers).toBe(5);
    expect(state.tiers.start).toEqual({ total: 2, observed: 1, backwards: 0 });
    expect(state.tiers.like.total).toBe(1);
    expect(state.tiers.regression.total).toBe(1);
  });

  it("weights by depth of tier, so a love-to-see counts for more than a start-to-see", () => {
    const start = mk("attending a convening", "start");
    const love = mk("establishing a permanent centre", "love");
    const onlyStart = ladderState([start, love], [obs(start, "yes")]);
    const onlyLove = ladderState([start, love], [obs(love, "yes")]);
    expect(onlyStart.progress).toBeCloseTo(1 / 4);
    expect(onlyLove.progress).toBeCloseTo(3 / 4);
  });

  it("excludes regression markers from progress and counts them separately", () => {
    const start = mk("attending a convening", "start");
    const bad = mk("withdrawing from a published timeline", "regression");
    const state = ladderState([start, bad], [obs(start, "yes"), obs(bad, "yes")]);
    expect(state.progress).toBe(1); // the one real marker is complete
    expect(state.regressionSeen).toBe(1); // and the regression is reported anyway
  });

  it("treats a marker that moved backwards as regression, whatever its tier", () => {
    const like = mk("publishing in a mainstream journal", "like");
    const state = ladderState([like], [obs(like, "backwards")]);
    expect(state.regressionSeen).toBe(1);
    expect(state.tiers.like.backwards).toBe(1);
    expect(state.progress).toBe(0);
  });

  it("handles untiered depth-2 markers with no ladder at all", () => {
    const a = mk("publishing a conversion timeline", null);
    const b = mk("accepting third-party auditing", null);
    const state = ladderState([a, b], [obs(a, "yes")]);
    expect(state.untiered.total).toBe(2);
    expect(state.progress).toBeCloseTo(0.5);
  });

  it("uses only the most recent observation for each marker", () => {
    const m = mk("publishing a conversion timeline", "like");
    const state = ladderState(
      [m],
      [obs(m, "yes", "2026-01-01T00:00:00.000Z"), obs(m, "backwards", "2026-06-01T00:00:00.000Z")]
    );
    expect(state.regressionSeen).toBe(1);
    expect(state.progress).toBe(0);
    expect(latestObservations([obs(m, "yes", "2026-01-01T00:00:00.000Z"), obs(m, "backwards", "2026-06-01T00:00:00.000Z")]).get(m.id).observed).toBe("backwards");
  });

  it("is empty and safe with no markers", () => {
    const state = ladderState([], []);
    expect(state.markers).toBe(0);
    expect(state.progress).toBe(0);
    expect(state.anyObservation).toBe(false);
  });
});

/* ------------------------------------------------- SPEC 6.8, the instrument */

function stakeholderAt(baselineInterest, currentInterest) {
  const s = makeStakeholder("p", { name: "PIs", power: 4, interest: baselineInterest });
  s.interest = currentInterest;
  return s;
}

const fullLadder = () => [
  mk("submitting a proposal using the framing", "start"),
  mk("attending a convening and presenting", "start"),
  mk("citing the existing literature", "start"),
  mk("publishing in a mainstream journal", "like"),
  mk("supervising a student on the topic", "like"),
  mk("establishing a permanent centre", "love"),
];

describe("judgedVsObserved", () => {
  it("says nothing until there are enough markers", () => {
    const r = judgedVsObserved(stakeholderAt(0, 8), [mk("attending a convening", "start")], []);
    expect(r.verdict).toBe("insufficient");
    expect(r.message).toMatch(new RegExp("at least " + INSTRUMENT_MIN_MARKERS));
  });

  it("says nothing until something has actually been reviewed", () => {
    const r = judgedVsObserved(stakeholderAt(0, 8), fullLadder(), []);
    expect(r.verdict).toBe("insufficient");
    expect(r.message).toMatch(/reflection cycle/);
  });

  it("flags a score running ahead of the behaviour", () => {
    // interest 0 -> +8 is most of the available room; one start-to-see observed
    // is a small fraction of the ladder.
    const markers = fullLadder();
    const r = judgedVsObserved(stakeholderAt(0, 8), markers, [obs(markers[0], "yes")]);
    expect(r.verdict).toBe("ahead");
    expect(r.gap).toBeGreaterThan(0);
    expect(r.message).toMatch(/running ahead of the evidence/);
  });

  it("flags a map that has fallen behind the behaviour", () => {
    const markers = fullLadder();
    const observed = [markers[0], markers[1], markers[2], markers[3], markers[5]].map((m) => obs(m, "yes"));
    const r = judgedVsObserved(stakeholderAt(0, 1), markers, observed);
    expect(r.verdict).toBe("behind");
    expect(r.gap).toBeLessThan(0);
    expect(r.message).toMatch(/has not caught up/);
  });

  it("corroborates when the two readings roughly agree", () => {
    const markers = fullLadder();
    const observed = [markers[0], markers[1], markers[2], markers[3]].map((m) => obs(m, "yes"));
    const r = judgedVsObserved(stakeholderAt(0, 5), markers, observed);
    expect(r.verdict).toBe("corroborated");
  });

  it("lets backsliding outrank everything else", () => {
    // Even with a score and ladder that agree, an observed regression takes over.
    const markers = [...fullLadder(), mk("publishing once and leaving the field", "regression")];
    const observed = [
      obs(markers[0], "yes"),
      obs(markers[1], "yes"),
      obs(markers[2], "yes"),
      obs(markers[6], "yes"),
    ];
    const r = judgedVsObserved(stakeholderAt(0, 4), markers, observed);
    expect(r.verdict).toBe("regressing");
    expect(r.message).toMatch(/moved backwards/);
  });

  it("measures the score against the room that was available, not the raw number", () => {
    // +6 -> +8 uses half the remaining room, so it is not dismissed as "only 2".
    const markers = fullLadder();
    const r = judgedVsObserved(stakeholderAt(6, 8), markers, [obs(markers[0], "yes")]);
    expect(r.judged).toBeCloseTo(0.5);
  });

  it("does not treat a stakeholder already at the top as having moved", () => {
    const markers = fullLadder();
    const r = judgedVsObserved(stakeholderAt(10, 10), markers, [obs(markers[0], "yes")]);
    expect(r.judged).toBe(0);
  });

  it("never claims causation in any message it produces", () => {
    const markers = fullLadder();
    const cases = [
      judgedVsObserved(stakeholderAt(0, 8), markers, [obs(markers[0], "yes")]),
      judgedVsObserved(stakeholderAt(0, 1), markers, markers.slice(0, 5).map((m) => obs(m, "yes"))),
      judgedVsObserved(stakeholderAt(0, 5), markers, markers.slice(0, 4).map((m) => obs(m, "yes"))),
    ];
    for (const c of cases) {
      expect(c.message).not.toMatch(/\b(caused|because of|thanks to|due to our|proves)\b/i);
    }
  });
});

/* ------------------------------------------------------------------ misc */

describe("records", () => {
  it("makes a marker watched by default", () => {
    expect(makeMarker("p", "s", { text: "publishing" }).watched).toBe(true);
    expect(makeMarker("p", "s", { text: "publishing", watched: false }).watched).toBe(false);
  });

  it("defaults an observation to not-yet rather than to a claim", () => {
    const o = makeObservation("p", "s", "m", "c");
    expect(o.observed).toBe("not-yet");
    expect(o.significance).toBe("");
  });

  it("rejects an unknown observed value", () => {
    expect(makeObservation("p", "s", "m", "c", { observed: "maybe" }).observed).toBe("not-yet");
  });

  it("labels a cycle by quarter", () => {
    expect(defaultCycleLabel(new Date("2026-02-11T00:00:00Z"))).toBe("Q1 2026");
    expect(defaultCycleLabel(new Date("2026-11-02T00:00:00Z"))).toBe("Q4 2026");
    expect(makeCycle("p").closedAt).toBe(null);
  });

  it("gives every record a distinct id", () => {
    const ids = new Set([
      ...Array.from({ length: 20 }, () => makeMarker("p", "s", { text: "x" }).id),
      ...Array.from({ length: 20 }, () => makeObservation("p", "s", "m", "c").id),
    ]);
    expect(ids.size).toBe(40);
  });
});
