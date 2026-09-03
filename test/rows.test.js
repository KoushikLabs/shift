import { describe, it, expect } from "vitest";
import {
  isUuid,
  projectToRow,
  rowToProject,
  stakeholderToRow,
  rowToStakeholder,
  changeToRow,
  rowToChange,
  ensureUuids,
} from "../src/backends/rows.js";
import { makeProject, makeStakeholder, newId, normalizeStrategy } from "../src/domain.js";

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
