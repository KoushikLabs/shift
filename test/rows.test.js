import { describe, it, expect } from "vitest";
import {
  isUuid,
  projectToRow,
  rowToProject,
  stakeholderToRow,
  rowToStakeholder,
  changeToRow,
  rowToChange,
  markerToRow,
  rowToMarker,
  observationToRow,
  rowToObservation,
  cycleToRow,
  rowToCycle,
  ensureUuids,
} from "../src/backends/rows.js";
import {
  makeProject,
  makeStakeholder,
  makeMarker,
  makeObservation,
  makeCycle,
  newId,
  normalizeStrategy,
  VOCABULARY_DEFAULTS,
} from "../src/domain.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("uuid detection", () => {
  it("accepts real uuids and rejects the local fallback format", () => {
    expect(isUuid(newId())).toBe(true);
    expect(isUuid("id-k3jd9f-lz01")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("project mapping", () => {
  it("round-trips without losing a field", () => {
    const p = makeProject({ name: "Poultry standards", description: "d", scaleNote: "s" });
    const back = rowToProject(projectToRow(p, ORG));
    expect(back).toEqual({
      id: p.id,
      name: "Poultry standards",
      description: "d",
      scaleNote: "s",
      depth: 1,
      vision: "",
      mission: "",
      vocabulary: VOCABULARY_DEFAULTS,
      readiness: null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  });

  it("renames scaleNote to scale_note in both directions", () => {
    const row = projectToRow(makeProject({ name: "x", scaleNote: "Power over adoption" }), ORG);
    expect(row.scale_note).toBe("Power over adoption");
    expect(row.org_id).toBe(ORG);
    expect(rowToProject(row).scaleNote).toBe("Power over adoption");
  });
});

describe("depth on the project row", () => {
  it("round-trips the depth and defaults to Map", () => {
    expect(projectToRow(makeProject({ name: "x", depth: 3 }), ORG).depth).toBe(3);
    expect(rowToProject({ id: "x", name: "x", depth: 2 }).depth).toBe(2);
    expect(rowToProject({ id: "x", name: "x" }).depth).toBe(1);
    expect(rowToProject({ id: "x", name: "x", depth: 99 }).depth).toBe(1);
  });
});

describe("outcome-map fields on the project row", () => {
  it("round-trips vision, mission, vocabulary and readiness", () => {
    const p = makeProject({
      name: "Field building",
      depth: 3,
      vision: "Wild animal welfare is a normal, funded field of inquiry.",
      mission: "We build the field by funding researchers and convening them.",
      vocabulary: { partner: "Key actor", startTier: "Expect to see" },
      readiness: { funder: 2, person: 1 },
    });
    const back = rowToProject(projectToRow(p, ORG));
    expect(back.vision).toMatch(/normal, funded field/);
    expect(back.mission).toMatch(/funding researchers/);
    expect(back.vocabulary.partner).toBe("Key actor");
    expect(back.vocabulary.target).toBe("Pressure target");
    expect(back.readiness).toEqual({ funder: 2, person: 1 });
  });

  it("keeps readiness null when it was never scored", () => {
    expect(rowToProject(projectToRow(makeProject({ name: "x" }), ORG)).readiness).toBe(null);
  });
});

describe("strategy map on the stakeholder row", () => {
  it("round-trips the six cells", () => {
    const s = makeStakeholder("p", {
      name: "Suppliers",
      strategyMap: { i1: "Fund conversion training", e3: "Support a producer association" },
    });
    const back = rowToStakeholder(stakeholderToRow(s, ORG));
    expect(back.strategyMap.i1).toBe("Fund conversion training");
    expect(back.strategyMap.e3).toBe("Support a producer association");
    expect(back.strategyMap.e1).toBe("");
  });

  it("survives a row with no strategy_map at all", () => {
    const back = rowToStakeholder({ id: "x", project_id: "p", name: "n", power: 5, interest: 0, baseline: {} });
    expect(back.strategyMap).toEqual({ i1: "", i2: "", i3: "", e1: "", e2: "", e3: "" });
  });
});

describe("triage on the stakeholder row", () => {
  it("round-trips reach and reachableVia", () => {
    const s = makeStakeholder("p", { name: "Ministry", reach: "out-of-reach" });
    s.reachableVia = ["a", "b"];
    const row = stakeholderToRow(s, ORG);
    expect(row.reach).toBe("out-of-reach");
    expect(row.reachable_via).toEqual(["a", "b"]);
    const back = rowToStakeholder(row);
    expect(back.reach).toBe("out-of-reach");
    expect(back.reachableVia).toEqual(["a", "b"]);
  });

  it("defaults a row with no reach to partner rather than dropping the field", () => {
    const back = rowToStakeholder({
      id: "x", project_id: "p", name: "n", power: 5, interest: 0, strategy: {}, baseline: {},
    });
    expect(back.reach).toBe("partner");
    expect(back.reachableVia).toEqual([]);
  });
});

describe("stakeholder mapping", () => {
  const mk = () => {
    const s = makeStakeholder("proj-1", {
      name: "State Board",
      type: "Regulator",
      power: 9,
      interest: -4,
      rationale: "documented hostility",
      strategy: { objective: "Change the consent form", owner: "Priya" },
      isIndividual: false,
    });
    s.projectId = "33333333-3333-4333-8333-333333333333";
    return s;
  };

  it("round-trips every field including the baseline", () => {
    const s = mk();
    const back = rowToStakeholder(stakeholderToRow(s, ORG));
    expect(back.name).toBe("State Board");
    expect(back.type).toBe("Regulator");
    expect(back.power).toBe(9);
    expect(back.interest).toBe(-4);
    expect(back.rationale).toBe("documented hostility");
    expect(back.strategy.objective).toBe("Change the consent form");
    expect(back.strategy.owner).toBe("Priya");
    expect(back.baseline.power).toBe(9);
    expect(back.baseline.interest).toBe(-4);
    expect(back.baseline.rationale).toBe("documented hostility");
    expect(back.projectId).toBe(s.projectId);
  });

  it("keeps the baseline frozen when the current scores have moved", () => {
    // This is the one that matters: a lost baseline means movement is measured
    // from the wrong place, permanently and invisibly.
    const s = mk();
    s.power = 4;
    s.interest = 7;
    s.rationale = "they moved";
    const row = stakeholderToRow(s, ORG);
    expect(row.power).toBe(4);
    expect(row.interest).toBe(7);
    expect(row.baseline.power).toBe(9);
    expect(row.baseline.interest).toBe(-4);
    expect(row.baseline.rationale).toBe("documented hostility");

    const back = rowToStakeholder(row);
    expect(back.baseline.power).toBe(9);
    expect(back.baseline.interest).toBe(-4);
  });

  it("maps isIndividual to is_individual, which the GDPR flag depends on", () => {
    const s = mk();
    s.isIndividual = true;
    const row = stakeholderToRow(s, ORG);
    expect(row.is_individual).toBe(true);
    expect(rowToStakeholder(row).isIndividual).toBe(true);
  });

  it("clamps scores that arrive out of range from the database", () => {
    const back = rowToStakeholder({
      id: "x",
      project_id: "p",
      name: "n",
      power: 99,
      interest: -99,
      strategy: {},
      baseline: { power: 3, interest: 0, strategy: {} },
    });
    expect(back.power).toBe(10);
    expect(back.interest).toBe(-10);
  });

  it("survives a null strategy or baseline coming back from Postgres", () => {
    const back = rowToStakeholder({
      id: "x",
      project_id: "p",
      name: "n",
      power: 5,
      interest: 0,
      strategy: null,
      baseline: {},
    });
    expect(back.strategy).toEqual(normalizeStrategy(null));
    expect(back.baseline.power).toBe(0);
  });
});

describe("change mapping", () => {
  const change = {
    id: newId(),
    projectId: "33333333-3333-4333-8333-333333333333",
    stakeholderId: "44444444-4444-4444-8444-444444444444",
    at: "2026-03-01T00:00:00.000Z",
    power: 9,
    interest: 5,
    rationale: "new reasoning",
    strategy: normalizeStrategy({ objective: "B" }),
    note: "met the officer",
    prevPower: 9,
    prevInterest: 1,
    prevRationale: "old reasoning",
    prevStrategy: normalizeStrategy({ objective: "A" }),
    changedFields: ["interest", "rationale", "strategy"],
  };

  it("round-trips the whole record, both sides of the change", () => {
    const back = rowToChange(changeToRow(change, ORG, USER, "priya@example.org"));
    expect(back.power).toBe(9);
    expect(back.interest).toBe(5);
    expect(back.prevInterest).toBe(1);
    expect(back.rationale).toBe("new reasoning");
    expect(back.prevRationale).toBe("old reasoning");
    expect(back.strategy.objective).toBe("B");
    expect(back.prevStrategy.objective).toBe("A");
    expect(back.note).toBe("met the officer");
    expect(back.changedFields).toEqual(["interest", "rationale", "strategy"]);
    expect(back.at).toBe("2026-03-01T00:00:00.000Z");
  });

  it("stamps attribution from the signed-in user, not from the payload", () => {
    // The insert policy requires by = auth.uid(); a caller cannot claim to be
    // someone else, so the row builder must ignore anything in the change.
    const row = changeToRow({ ...change, by: "someone-else@example.org" }, ORG, USER, "priya@example.org");
    expect(row.by).toBe(USER);
    expect(row.by_email).toBe("priya@example.org");
    expect(rowToChange(row).by).toBe("priya@example.org");
  });

  it("maps every snake_case column back", () => {
    const row = changeToRow(change, ORG, USER, "p@e.org");
    for (const k of ["prev_power", "prev_interest", "prev_rationale", "prev_strategy", "changed_fields", "stakeholder_id", "project_id", "org_id"]) {
      expect(row, `missing ${k}`).toHaveProperty(k);
    }
  });

  it("defaults changedFields to an array when the row is malformed", () => {
    expect(rowToChange({ changed_fields: null, strategy: {}, prev_strategy: {} }).changedFields).toEqual([]);
  });
});

describe("ensureUuids — migrating a local map to Postgres", () => {
  function localMap({ badIds }) {
    const pid = badIds ? "id-proj-abc" : newId();
    const sid = badIds ? "id-stake-xyz" : newId();
    return {
      project: { id: pid, name: "Local map" },
      stakeholders: [{ id: sid, projectId: pid, name: "Board", power: 5, interest: 0 }],
      changes: [{ id: badIds ? "id-change-1" : newId(), projectId: pid, stakeholderId: sid, changedFields: ["interest"] }],
    };
  }

  it("leaves valid uuids untouched", () => {
    const m = localMap({ badIds: false });
    const out = ensureUuids(m);
    expect(out.remapped).toBe(0);
    expect(out.project.id).toBe(m.project.id);
    expect(out.stakeholders[0].id).toBe(m.stakeholders[0].id);
  });

  it("renumbers ids a uuid column would reject, keeping every link", () => {
    const out = ensureUuids(localMap({ badIds: true }));
    expect(out.remapped).toBe(3);
    expect(isUuid(out.project.id)).toBe(true);
    expect(isUuid(out.stakeholders[0].id)).toBe(true);
    expect(isUuid(out.changes[0].id)).toBe(true);
    // the history must still point at the right stakeholder and project
    expect(out.changes[0].stakeholderId).toBe(out.stakeholders[0].id);
    expect(out.changes[0].projectId).toBe(out.project.id);
    expect(out.stakeholders[0].projectId).toBe(out.project.id);
  });

  it("gives the same old id the same new id everywhere", () => {
    const pid = "id-p";
    const sid = "id-s";
    const out = ensureUuids({
      project: { id: pid, name: "m" },
      stakeholders: [{ id: sid, projectId: pid, name: "a" }],
      changes: [
        { id: "id-c1", projectId: pid, stakeholderId: sid, changedFields: [] },
        { id: "id-c2", projectId: pid, stakeholderId: sid, changedFields: [] },
      ],
    });
    expect(out.changes[0].stakeholderId).toBe(out.changes[1].stakeholderId);
    expect(new Set(out.changes.map((c) => c.id)).size).toBe(2);
  });

  it("drops orphan history rather than failing the whole migration", () => {
    const out = ensureUuids({
      project: { id: "id-p", name: "m" },
      stakeholders: [{ id: "id-s", projectId: "id-p", name: "a" }],
      changes: [{ id: "id-c", projectId: "id-p", stakeholderId: "id-missing", changedFields: [] }],
    });
    expect(out.changes).toHaveLength(0);
    expect(out.stakeholders).toHaveLength(1);
  });
});

/* ------------------------------------- markers, observations and cycles */

describe("marker mapping", () => {
  it("round-trips every field", () => {
    const m = makeMarker("proj", "stake", { text: "publishing a dated timeline", tier: "like", watched: false });
    const back = rowToMarker(markerToRow(m, ORG));
    expect(back.text).toBe("publishing a dated timeline");
    expect(back.tier).toBe("like");
    expect(back.watched).toBe(false);
    expect(back.retired).toBe(false);
    expect(back.stakeholderId).toBe("stake");
    expect(markerToRow(m, ORG).org_id).toBe(ORG);
  });

  it("carries an untiered depth-2 marker through as null, not as a string", () => {
    const m = makeMarker("proj", "stake", { text: "publishing a timeline" });
    expect(markerToRow(m, ORG).tier).toBe(null);
    expect(rowToMarker(markerToRow(m, ORG)).tier).toBe(null);
  });

  it("rejects an unknown tier from the database", () => {
    expect(rowToMarker({ id: "x", project_id: "p", stakeholder_id: "s", text: "t", tier: "nonsense" }).tier).toBe(null);
  });
});

describe("observation mapping", () => {
  const o = makeObservation("proj", "stake", "marker", "cycle", {
    observed: "yes",
    narrative: "Two PIs said they have students interested.",
    evidence: "Convening notes, 14 March.",
    contribution: "We raised studentships as an agenda item.",
    significance: "Moderate - this is the bottleneck rung.",
  });

  it("round-trips the whole journal entry", () => {
    const back = rowToObservation(observationToRow(o, ORG, USER, "p@e.org"));
    expect(back.observed).toBe("yes");
    expect(back.narrative).toMatch(/students interested/);
    expect(back.evidence).toMatch(/14 March/);
    expect(back.contribution).toMatch(/agenda item/);
    expect(back.significance).toMatch(/bottleneck/);
    expect(back.markerId).toBe("marker");
    expect(back.cycleId).toBe("cycle");
  });

  it("stamps attribution from the session, not the payload", () => {
    const row = observationToRow({ ...o, by: "someone-else@example.org" }, ORG, USER, "p@e.org");
    expect(row.by).toBe(USER);
    expect(row.by_email).toBe("p@e.org");
  });

  it("never lets an unknown observed value through in either direction", () => {
    expect(observationToRow({ ...o, observed: "probably" }, ORG, USER, "e").observed).toBe("not-yet");
    expect(rowToObservation({ id: "x", observed: "probably" }).observed).toBe("not-yet");
  });

  it("keeps significance, which is the whole answer to the so-what gap", () => {
    for (const k of ["narrative", "evidence", "contribution", "significance"]) {
      expect(observationToRow(o, ORG, USER, "e"), k).toHaveProperty(k);
    }
  });
});

describe("cycle mapping", () => {
  it("round-trips the three closing questions", () => {
    const c = makeCycle("proj", {
      label: "Q1 2026",
      wentBackwards: "One supplier withdrew from its timeline.",
      matteredForGoal: "Markers ticked but the ministry has not moved.",
      mapChangesProposed: "Retire the auditing marker; nobody can observe it.",
    });
    const back = rowToCycle(cycleToRow(c, ORG, USER, "p@e.org"));
    expect(back.label).toBe("Q1 2026");
    expect(back.wentBackwards).toMatch(/withdrew/);
    expect(back.matteredForGoal).toMatch(/has not moved/);
    expect(back.mapChangesProposed).toMatch(/Retire the auditing marker/);
    expect(back.closedAt).toBe(null);
  });
});

describe("ensureUuids with the behaviour layer", () => {
  it("re-keys markers, observations and cycles while keeping every link", () => {
    const out = ensureUuids({
      project: { id: "id-p", name: "m" },
      stakeholders: [{ id: "id-s", projectId: "id-p", name: "a" }],
      changes: [],
      markers: [{ id: "id-m", projectId: "id-p", stakeholderId: "id-s", text: "publishing" }],
      observations: [
        { id: "id-o", projectId: "id-p", stakeholderId: "id-s", markerId: "id-m", cycleId: "id-c", observed: "yes" },
      ],
      cycles: [{ id: "id-c", projectId: "id-p", label: "Q1" }],
    });
    expect(out.markers[0].stakeholderId).toBe(out.stakeholders[0].id);
    expect(out.observations[0].markerId).toBe(out.markers[0].id);
    expect(out.observations[0].cycleId).toBe(out.cycles[0].id);
    expect(out.observations[0].projectId).toBe(out.project.id);
    expect(out.remapped).toBeGreaterThan(0);
  });

  it("drops an observation whose marker is gone rather than failing the whole migration", () => {
    const out = ensureUuids({
      project: { id: "id-p", name: "m" },
      stakeholders: [{ id: "id-s", projectId: "id-p", name: "a" }],
      changes: [],
      markers: [],
      observations: [{ id: "id-o", projectId: "id-p", stakeholderId: "id-s", markerId: "id-missing" }],
      cycles: [],
    });
    expect(out.observations).toHaveLength(0);
    expect(out.stakeholders).toHaveLength(1);
  });

  it("still works for a depth-1 map with no behaviour layer at all", () => {
    const out = ensureUuids({
      project: { id: "id-p", name: "m" },
      stakeholders: [{ id: "id-s", projectId: "id-p", name: "a" }],
      changes: [],
    });
    expect(out.markers).toEqual([]);
    expect(out.observations).toEqual([]);
    expect(out.cycles).toEqual([]);
  });
});
