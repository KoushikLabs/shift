/**
 * Signed-in maps take organisations and public roles, not named people.
 * Browser-only maps are unaffected.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { namedPeopleIn, namedPeopleMessage, withoutNamedPeople } from "../src/domain.js";
import { buildExampleProject } from "../src/example.js";

describe("namedPeopleIn / namedPeopleMessage", () => {
  const list = [
    { id: "a", name: "Ministry of Fisheries", isIndividual: false },
    { id: "b", name: "Dr Amara Okoye", isIndividual: true },
  ];
  it("picks out only the flagged ones", () => {
    expect(namedPeopleIn(list).map((s) => s.id)).toEqual(["b"]);
    expect(namedPeopleIn([])).toEqual([]);
    expect(namedPeopleIn(undefined)).toEqual([]);
  });
  it("names them, says what to do, and says nothing was saved", () => {
    const msg = namedPeopleMessage(namedPeopleIn(list));
    expect(msg).toContain("“Dr Amara Okoye”");
    expect(msg).toContain("organisations and public roles");
    expect(msg).toContain("Nothing was saved.");
  });
  it("does not list more than five names", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: "Person " + i, isIndividual: true }));
    expect(namedPeopleMessage(many)).toContain("and 3 more");
  });
});

describe("withoutNamedPeople", () => {
  it("drops the example's named individual with everything that hangs off it", () => {
    const built = buildExampleProject();
    const people = namedPeopleIn(built.stakeholders);
    expect(people.length).toBeGreaterThan(0); // the example is meant to show the flag
    const out = withoutNamedPeople(built);
    const ids = new Set(out.stakeholders.map((s) => s.id));
    expect(namedPeopleIn(out.stakeholders)).toEqual([]);
    expect(out.stakeholders.length).toBe(built.stakeholders.length - people.length);
    expect(out.changes.every((c) => ids.has(c.stakeholderId))).toBe(true);
    expect(out.project).toBe(built.project);
  });
  it("removes links that pointed at a dropped person, and their behaviours", () => {
    const out = withoutNamedPeople({
      project: { id: "p" },
      stakeholders: [
        { id: "a", name: "A ministry", isIndividual: false, reachableVia: ["b"] },
        { id: "b", name: "Dr B", isIndividual: true },
      ],
      changes: [{ stakeholderId: "a" }, { stakeholderId: "b" }],
      markers: [{ stakeholderId: "b" }],
      observations: [{ stakeholderId: "b" }, { stakeholderId: "a" }],
    });
    expect(out.stakeholders).toEqual([{ id: "a", name: "A ministry", isIndividual: false, reachableVia: [] }]);
    expect(out.changes).toEqual([{ stakeholderId: "a" }]);
    expect(out.markers).toEqual([]);
    expect(out.observations).toEqual([{ stakeholderId: "a" }]);
  });
  it("returns the same payload when there is nobody to drop", () => {
    const p = { project: {}, stakeholders: [{ id: "a", isIndividual: false }], changes: [] };
    expect(withoutNamedPeople(p)).toBe(p);
  });
});

describe("the hosted backend refuses named people before sending anything", () => {
  const calls = [];
  beforeEach(() => {
    calls.length = 0;
    vi.resetModules();
    vi.doMock("../src/supabaseClient.js", () => ({
      explainError: (e, f) => (e && e.message) || f,
      cloudConfigured: () => true,
      supabase: () => ({
        from: (table) => {
          const q = {
            upsert: async (rows) => (calls.push(["upsert", table, rows]), { error: null }),
            insert: async (rows) => (calls.push(["insert", table, rows]), { error: null }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
          return q;
        },
      }),
    }));
  });

  const person = { id: "11111111-1111-4111-8111-111111111111", projectId: "p", name: "Dr Amara Okoye", isIndividual: true, power: 5, interest: 0, strategy: {}, baseline: {} };
  const body = { ...person, id: "22222222-2222-4222-8222-222222222222", name: "Ministry of Fisheries", isIndividual: false };
  const change = { id: "c", projectId: "p", stakeholderId: person.id, power: 6, interest: 0, strategy: {}, prevStrategy: {}, changedFields: ["power"] };

  async function load() {
    const auth = await import("../src/auth.js");
    auth.session.user = { id: "u", email: "a@b.org" };
    auth.session.orgId = "org";
    return import("../src/backends/cloud.js");
  }

  it("putStakeholder, addStakeholders, commitChange and importProject all refuse", async () => {
    const cloud = await load();
    await expect(cloud.putStakeholder(person)).rejects.toThrow(/not named people/);
    await expect(cloud.addStakeholders([body, person])).rejects.toThrow(/Dr Amara Okoye/);
    await expect(cloud.commitChange(person, change)).rejects.toThrow(/Nothing was saved/);
    await expect(
      cloud.importProject({ project: { id: "p", name: "Map" }, stakeholders: [body, person], changes: [] })
    ).rejects.toThrow(/not named people/);
    // Above all: no history row for a save that was refused, and no empty map.
    expect(calls).toEqual([]);
  });

  it("still saves organisations and roles", async () => {
    const cloud = await load();
    await cloud.putStakeholder(body);
    await cloud.addStakeholders([body]);
    expect(calls.map((c) => c.slice(0, 2))).toEqual([["upsert", "stakeholders"], ["insert", "stakeholders"]]);
  });
});
