import { describe, it, expect } from "vitest";
import {
  detectDelimiter,
  parseCsv,
  guessMapping,
  parseScore,
  rowsToStakeholderFields,
  toCsv,
} from "../src/io/csv.js";
import { buildExport, parseImport, applyImportMode, describeImport, ImportError } from "../src/io/json.js";
import {
  makeProject,
  makeStakeholder,
  makeMarker,
  makeObservation,
  makeCycle,
  stanceLabel,
  stanceOf,
  normalizeStrategy,
  newId,
} from "../src/domain.js";

/* ------------------------------------------------------------------- CSV in */

describe("CSV parsing", () => {
  it("handles quoted fields containing the delimiter", () => {
    const { headers, rows } = parseCsv('Name,Rationale\n"Board, State","Closure powers, and has used them"');
    expect(headers).toEqual(["Name", "Rationale"]);
    expect(rows[0]).toEqual(["Board, State", "Closure powers, and has used them"]);
  });

  it("handles escaped quotes and embedded newlines", () => {
    const csv = 'Name,Rationale\n"Federation","They call it ""existential"".\nSecond line."';
    const { rows } = parseCsv(csv);
    expect(rows[0][1]).toBe('They call it "existential".\nSecond line.');
  });

  it("handles CRLF and a UTF-8 BOM", () => {
    const { headers, rows } = parseCsv('﻿Name,Power\r\nMinistry,10\r\n');
    expect(headers).toEqual(["Name", "Power"]);
    expect(rows).toEqual([["Ministry", "10"]]);
  });

  it("detects semicolon and tab separators", () => {
    expect(detectDelimiter("Name;Power;Interest\nA;1;2")).toBe(";");
    expect(detectDelimiter("Name\tPower\tInterest")).toBe("\t");
    expect(detectDelimiter("Name,Power")).toBe(",");
  });

  it("does not count delimiters inside quotes when detecting", () => {
    expect(detectDelimiter('"Smith, John";Regulator;9')).toBe(";");
  });

  it("pads short rows and trims long ones to the header width", () => {
    const { rows } = parseCsv("A,B,C\n1,2\n1,2,3,4");
    expect(rows[0]).toEqual(["1", "2", ""]);
    expect(rows[1]).toEqual(["1", "2", "3"]);
  });

  it("ignores blank lines", () => {
    const { rows } = parseCsv("Name\nA\n\nB\n");
    expect(rows.map((r) => r[0])).toEqual(["A", "B"]);
  });
});

describe("column mapping", () => {
  it("guesses common header names", () => {
    const headers = ["Stakeholder", "Category", "Influence", "Alignment", "Reasoning", "Goal", "Owner"];
    expect(guessMapping(headers)).toEqual(["name", "type", "power", "interest", "rationale", "objective", "owner"]);
  });

  it("never assigns one field to two columns", () => {
    const m = guessMapping(["Name", "Organisation name", "Power", "Influence"]);
    expect(m.filter((x) => x === "name")).toHaveLength(1);
    expect(m.filter((x) => x === "power")).toHaveLength(1);
  });

  it("treats a lone unrecognised column as names", () => {
    expect(guessMapping(["Who we need to move"])).toEqual(["name"]);
  });

  it("leaves unrecognised columns unmapped when there are several", () => {
    const m = guessMapping(["Name", "Sparkle level", "Notes on the weather"]);
    expect(m[1]).toBe("");
  });
});

describe("score parsing", () => {
  it("reads plain, signed and unicode-minus numbers", () => {
    expect(parseScore("7")).toBe(7);
    expect(parseScore("+6")).toBe(6);
    expect(parseScore("−6")).toBe(-6); // U+2212
    expect(parseScore("–4")).toBe(-4); // en dash
    expect(parseScore("-3")).toBe(-3);
  });

  it("copes with spreadsheet noise", () => {
    expect(parseScore("8/10")).toBe(8);
    expect(parseScore("7 (high)")).toBe(7);
    expect(parseScore("6,5")).toBe(6.5);
  });

  it("returns null for blank or non-numeric, so the caller can apply a default", () => {
    expect(parseScore("")).toBe(null);
    expect(parseScore("   ")).toBe(null);
    expect(parseScore("high")).toBe(null);
    expect(parseScore(null)).toBe(null);
  });
});

describe("rows to stakeholder fields", () => {
  const headers = ["Name", "Type", "Power", "Interest", "Rationale"];
  const mapping = ["name", "type", "power", "interest", "rationale"];

  it("converts rows and clamps out-of-range scores with a warning", () => {
    const rows = [["Board", "Regulator", "99", "-40", "because"]];
    const { records, warnings } = rowsToStakeholderFields(rows, headers, mapping);
    expect(records[0].power).toBe(10);
    expect(records[0].interest).toBe(-10);
    expect(warnings).toHaveLength(2);
  });

  it("defaults a missing interest to neutral, not positive (SPEC 6.6)", () => {
    const { records } = rowsToStakeholderFields([["Board", "", "", "", ""]], headers, mapping);
    expect(records[0].interest).toBe(0);
    expect(records[0].power).toBe(5);
    expect(records[0]._interestSupplied).toBe(false);
  });

  it("skips nameless rows rather than importing blanks", () => {
    const { records, skipped } = rowsToStakeholderFields(
      [["", "x", "1", "1", ""], ["Real Body", "", "5", "0", ""]],
      headers,
      mapping
    );
    expect(records).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it("warns about duplicate names but still imports them", () => {
    const { records, warnings } = rowsToStakeholderFields(
      [["Board", "", "", "", ""], ["board", "", "", "", ""]],
      headers,
      mapping
    );
    expect(records).toHaveLength(2);
    expect(warnings.join()).toMatch(/more than once/);
  });

  it("flags likely named individuals", () => {
    const { records } = rowsToStakeholderFields([["Dr Amara Okoye", "", "", "", ""]], headers, mapping);
    expect(records[0].isIndividual).toBe(true);
  });

  it("collects the strategy columns", () => {
    const h = ["Name", "Objective", "Owner"];
    const { records } = rowsToStakeholderFields([["A", "Change the consent form", "Priya"]], h, ["name", "objective", "owner"]);
    expect(records[0].strategy.objective).toBe("Change the consent form");
    expect(records[0].strategy.owner).toBe("Priya");
    expect(records[0].strategy.approach).toBe("");
  });
});

/* ------------------------------------------------------------------ CSV out */

describe("CSV export", () => {
  const opts = { stanceLabelOf: (i) => stanceLabel(stanceOf(i)) };

  it("round-trips a value containing quotes, commas and newlines", () => {
    const s = makeStakeholder("p", { name: 'The "Big" Board, Ltd', power: 9, interest: -4, rationale: "line1\nline2" });
    const csv = toCsv([s], opts);
    const back = parseCsv(csv);
    expect(back.rows[0][0]).toBe('The "Big" Board, Ltd');
    expect(back.rows[0][6]).toBe("line1\nline2");
  });

  it("neutralises spreadsheet formula injection", () => {
    const s = makeStakeholder("p", { name: "=cmd|'/c calc'!A1", rationale: "-3 because of the ruling" });
    const csv = toCsv([s], opts);
    const back = parseCsv(csv);
    expect(back.rows[0][0].startsWith("'=")).toBe(true);
    expect(back.rows[0][6].startsWith("'-3")).toBe(true);
  });

  it("includes strategy fields and movement columns", () => {
    const s = makeStakeholder("p", { name: "A", power: 4, interest: 0, strategy: { objective: "obj", owner: "Sam" } });
    s.power = 7;
    s.interest = 5;
    const back = parseCsv(toCsv([s], opts));
    expect(back.headers).toContain("Objective");
    expect(back.headers).toContain("Δ power");
    expect(back.rows[0][back.headers.indexOf("Objective")]).toBe("obj");
    expect(back.rows[0][back.headers.indexOf("Δ power")]).toBe("3");
    expect(back.rows[0][back.headers.indexOf("Δ interest")]).toBe("5");
    expect(back.rows[0][back.headers.indexOf("Stance")]).toBe("Ally");
  });
});

/* --------------------------------------------------------------------- JSON */

function fixture() {
  const project = makeProject({ name: "Test map", description: "d", scaleNote: "s" });
  const a = makeStakeholder(project.id, {
    name: "Regulator",
    type: "Statutory",
    power: 9,
    interest: 1,
    rationale: "baseline reasoning",
  });
  const b = makeStakeholder(project.id, { name: "Federation", power: 7, interest: -8, rationale: "opposed" });
  const changes = [
    {
      id: newId(),
      projectId: project.id,
      stakeholderId: a.id,
      at: "2026-03-01T00:00:00.000Z",
      by: "",
      power: 9,
      interest: 5,
      rationale: "moved because the committee tabled it",
      strategy: normalizeStrategy({ objective: "Get it on the form", owner: "Priya" }),
      note: "committee meeting",
      prevPower: 9,
      prevInterest: 1,
      prevRationale: "baseline reasoning",
      prevStrategy: normalizeStrategy({}),
      changedFields: ["interest", "rationale", "strategy"],
    },
  ];
  a.interest = 5;
  a.rationale = "moved because the committee tabled it";
  a.strategy = normalizeStrategy({ objective: "Get it on the form", owner: "Priya" });
  a.updatedAt = "2026-03-01T00:00:00.000Z";

  const changesFor = (id) => changes.filter((c) => c.stakeholderId === id);
  return { project, stakeholders: [a, b], changes, changesFor };
}

describe("JSON export", () => {
  it("carries everything including derived periods", () => {
    const f = fixture();
    const out = buildExport({ project: f.project, stakeholders: f.stakeholders, changesFor: f.changesFor });
    expect(out.format).toBe("shift.project");
    expect(out.stakeholders).toHaveLength(2);
    expect(out.changes).toHaveLength(1);
    expect(out.derived.strategyPeriods[f.stakeholders[0].id]).toBeTruthy();
    expect(out.derived.strategyPeriods[f.stakeholders[0].id][0].strategy.objective).toBe("Get it on the form");
  });
});

describe("JSON import", () => {
  it("round-trips an export with no loss (SPEC 7)", () => {
    const f = fixture();
    const text = JSON.stringify(buildExport({ project: f.project, stakeholders: f.stakeholders, changesFor: f.changesFor }));
    const back = parseImport(text);

    expect(back.project.id).toBe(f.project.id);
    expect(back.project.name).toBe("Test map");
    expect(back.stakeholders.map((s) => s.id).sort()).toEqual(f.stakeholders.map((s) => s.id).sort());
    expect(back.changes).toHaveLength(1);

    const a = back.stakeholders.find((s) => s.id === f.stakeholders[0].id);
    expect(a.interest).toBe(5);
    expect(a.baseline.interest).toBe(1);
    expect(a.strategy.objective).toBe("Get it on the form");
    expect(back.changes[0].changedFields).toEqual(["interest", "rationale", "strategy"]);
    expect(back.changes[0].prevStrategy.objective).toBe("");
  });

  it("survives a second round trip unchanged", () => {
    const f = fixture();
    const once = parseImport(JSON.stringify(buildExport({ project: f.project, stakeholders: f.stakeholders, changesFor: f.changesFor })));
    const twice = parseImport(
      JSON.stringify(
        buildExport({
          project: once.project,
          stakeholders: once.stakeholders,
          changesFor: (id) => once.changes.filter((c) => c.stakeholderId === id),
        })
      )
    );
    expect(twice.stakeholders).toEqual(once.stakeholders);
    expect(twice.changes).toEqual(once.changes);
  });

  it("drops history rows pointing at stakeholders that are not in the file", () => {
    const f = fixture();
    const dump = buildExport({ project: f.project, stakeholders: f.stakeholders, changesFor: f.changesFor });
    dump.changes.push({ ...dump.changes[0], id: "orphan", stakeholderId: "does-not-exist" });
    const back = parseImport(JSON.stringify(dump));
    expect(back.changes).toHaveLength(1);
  });

  it("rejects junk with a readable message", () => {
    expect(() => parseImport("not json")).toThrow(ImportError);
    expect(() => parseImport("[]")).toThrow(/not a map export/);
    expect(() => parseImport('{"hello":1}')).toThrow(/no .stakeholders./);
  });

  it("reads a stakeholder-matrix skill export", () => {
    const skill = {
      project: "Haryana poultry",
      exportedAt: "2026-04-01T00:00:00.000Z",
      stakeholders: {
        hspcb: {
          name: "State Pollution Control Board",
          type: "Key",
          baseline: { p: 9, i: 2, r: "start", s: {} },
          current: { p: 9, i: 6, r: "now", s: { objective: "Consent conditions", owner: "Nimisha" } },
          history: [
            {
              at: "2026-02-01T00:00:00.000Z",
              p: 9,
              i: 6,
              r: "now",
              s: { objective: "Consent conditions", owner: "Nimisha" },
              note: "RTI filed",
              prevP: 9,
              prevI: 2,
              prevR: "start",
              prevS: {},
              changed: ["interest", "rationale", "strategy"],
            },
          ],
        },
      },
    };
    const back = parseImport(JSON.stringify(skill));
    expect(back.source).toBe("stakeholder-matrix");
    expect(back.project.name).toBe("Haryana poultry");
    expect(back.stakeholders).toHaveLength(1);
    const s = back.stakeholders[0];
    expect(s.id).toBe("hspcb"); // stable id preserved — history keys off it
    expect(s.interest).toBe(6);
    expect(s.baseline.interest).toBe(2);
    expect(s.strategy.owner).toBe("Nimisha");
    expect(back.changes[0].changedFields).toEqual(["interest", "rationale", "strategy"]);
    expect(back.changes[0].prevInterest).toBe(2);
  });

  it("describes an import before it runs", () => {
    const f = fixture();
    const info = describeImport(parseImport(JSON.stringify(buildExport({ project: f.project, stakeholders: f.stakeholders, changesFor: f.changesFor }))));
    expect(info).toMatchObject({ projectName: "Test map", stakeholders: 2, changes: 1, withStrategy: 1 });
  });
});

describe("import collision handling", () => {
  it("replace mode keeps every id", () => {
    const f = fixture();
    const parsed = parseImport(JSON.stringify(buildExport({ project: f.project, stakeholders: f.stakeholders, changesFor: f.changesFor })));
    const out = applyImportMode(parsed, "replace");
    expect(out.project.id).toBe(f.project.id);
    expect(out.stakeholders[0].id).toBe(parsed.stakeholders[0].id);
  });

  it("copy mode re-keys everything but keeps history pointing at the right actor", () => {
    const f = fixture();
    const parsed = parseImport(JSON.stringify(buildExport({ project: f.project, stakeholders: f.stakeholders, changesFor: f.changesFor })));
    const out = applyImportMode(parsed, "copy");

    expect(out.project.id).not.toBe(parsed.project.id);
    expect(out.project.name).toBe("Test map (copy)");
    const oldOwner = parsed.changes[0].stakeholderId;
    const oldIndex = parsed.stakeholders.findIndex((s) => s.id === oldOwner);
    expect(out.changes[0].stakeholderId).toBe(out.stakeholders[oldIndex].id);
    expect(out.stakeholders.every((s) => s.projectId === out.project.id)).toBe(true);
    expect(out.changes.every((c) => c.projectId === out.project.id)).toBe(true);
    // no recycled ids anywhere
    const oldIds = new Set([parsed.project.id, ...parsed.stakeholders.map((s) => s.id), ...parsed.changes.map((c) => c.id)]);
    for (const id of [out.project.id, ...out.stakeholders.map((s) => s.id), ...out.changes.map((c) => c.id)]) {
      expect(oldIds.has(id)).toBe(false);
    }
  });

  it("does not append (copy) twice", () => {
    const f = fixture();
    const parsed = parseImport(JSON.stringify(buildExport({ project: f.project, stakeholders: f.stakeholders, changesFor: f.changesFor })));
    const once = applyImportMode(parsed, "copy");
    const twice = applyImportMode(once, "copy");
    expect(twice.project.name).toBe("Test map (copy)");
  });
});

/* ------------------------------------ SPEC 10: the behaviour layer exports */

function behaviourFixture() {
  const project = makeProject({ name: "Field building", depth: 3 });
  const s = makeStakeholder(project.id, {
    name: "Funded principal investigators",
    power: 4,
    interest: 0,
    rationale: "No contact yet - assumed neutral.",
    reach: "partner",
  });
  const ministry = makeStakeholder(project.id, {
    name: "Ministry of Agriculture",
    power: 10,
    interest: -1,
    rationale: "Cannot get a meeting.",
    reach: "out-of-reach",
  });
  ministry.reachableVia = [s.id];

  const markers = [
    makeMarker(project.id, s.id, { text: "attending a convening and presenting work", tier: "start" }),
    makeMarker(project.id, s.id, { text: "publishing in a mainstream disciplinary journal", tier: "like" }),
    makeMarker(project.id, s.id, { text: "publishing once and leaving the field", tier: "regression", watched: false }),
  ];
  const cycle = makeCycle(project.id, {
    label: "Q1 2026",
    wentBackwards: "Nothing.",
    matteredForGoal: "The convening is the bottleneck.",
    mapChangesProposed: "Retire nothing yet.",
  });
  const observations = [
    makeObservation(project.id, s.id, markers[0].id, cycle.id, {
      observed: "yes",
      narrative: "Presented at the March convening.",
      evidence: "Convening notes, 14 March.",
      contribution: "We funded the travel.",
      significance: "Moderate.",
      at: "2026-03-20T00:00:00.000Z",
    }),
  ];

  s.interest = 6;
  return { project, stakeholders: [s, ministry], changes: [], markers, observations, cycles: [cycle] };
}

describe("behaviour layer export and import", () => {
  it("carries markers, observations and cycles through a round trip", () => {
    const f = behaviourFixture();
    const dump = buildExport({
      project: f.project,
      stakeholders: f.stakeholders,
      changesFor: () => [],
      markers: f.markers,
      observations: f.observations,
      cycles: f.cycles,
    });
    expect(dump.markers).toHaveLength(3);
    expect(dump.observations).toHaveLength(1);
    expect(dump.cycles).toHaveLength(1);

    const back = parseImport(JSON.stringify(dump));
    expect(back.markers).toHaveLength(3);
    expect(back.observations).toHaveLength(1);
    expect(back.cycles).toHaveLength(1);

    const obs = back.observations[0];
    expect(obs.observed).toBe("yes");
    expect(obs.evidence).toBe("Convening notes, 14 March.");
    expect(obs.significance).toBe("Moderate.");
    expect(obs.markerId).toBe(f.markers[0].id);

    const regression = back.markers.find((m) => m.tier === "regression");
    expect(regression.watched).toBe(false);
    expect(back.cycles[0].matteredForGoal).toBe("The convening is the bottleneck.");
  });

  it("carries depth and the actor triage through a round trip", () => {
    const f = behaviourFixture();
    const back = parseImport(
      JSON.stringify(buildExport({ project: f.project, stakeholders: f.stakeholders, changesFor: () => [], ...f }))
    );
    expect(back.project.depth).toBe(3);
    const ministry = back.stakeholders.find((s) => s.name.startsWith("Ministry"));
    expect(ministry.reach).toBe("out-of-reach");
    expect(ministry.reachableVia).toHaveLength(1);
    const pis = back.stakeholders.find((s) => s.name.startsWith("Funded"));
    expect(pis.reach).toBe("partner");
  });

  it("drops an observation whose marker is not in the file", () => {
    const f = behaviourFixture();
    const dump = buildExport({ project: f.project, stakeholders: f.stakeholders, changesFor: () => [], ...f });
    dump.observations.push({ ...dump.observations[0], id: "orphan", markerId: "does-not-exist" });
    expect(parseImport(JSON.stringify(dump)).observations).toHaveLength(1);
  });

  it("still reads a depth-1 export that has no behaviour layer at all", () => {
    const project = makeProject({ name: "Plain map" });
    const s = makeStakeholder(project.id, { name: "Board", power: 5, interest: 0 });
    const back = parseImport(
      JSON.stringify(buildExport({ project, stakeholders: [s], changesFor: () => [] }))
    );
    expect(back.markers).toEqual([]);
    expect(back.observations).toEqual([]);
    expect(back.project.depth).toBe(1);
  });

  it("re-keys the behaviour layer consistently when importing as a copy", () => {
    const f = behaviourFixture();
    const parsed = parseImport(
      JSON.stringify(buildExport({ project: f.project, stakeholders: f.stakeholders, changesFor: () => [], ...f }))
    );
    const copy = applyImportMode(parsed, "copy");

    expect(copy.markers.every((m) => m.projectId === copy.project.id)).toBe(true);
    // the observation must still point at the copied marker, not the original
    expect(copy.observations[0].markerId).toBe(copy.markers[0].id);
    expect(copy.observations[0].cycleId).toBe(copy.cycles[0].id);
    const oldIds = new Set([...parsed.markers.map((m) => m.id), ...parsed.cycles.map((c) => c.id)]);
    for (const m of copy.markers) expect(oldIds.has(m.id)).toBe(false);
  });

  it("reports the behaviour layer in the import summary", () => {
    const f = behaviourFixture();
    const info = describeImport(
      parseImport(JSON.stringify(buildExport({ project: f.project, stakeholders: f.stakeholders, changesFor: () => [], ...f })))
    );
    expect(info.markers).toBe(3);
    expect(info.observations).toBe(1);
  });
});
