/**
 * An example map, so a new user is not facing an empty grid and can see what a
 * populated history looks like before committing anything real.
 *
 * EVERY BODY AND PERSON HERE IS INVENTED. That is deliberate. This tool stores
 * adverse judgements about named organisations (SPEC 10) and shipping a real
 * one as sample data would publish an assessment nobody agreed to. The country,
 * the regulator, the federation and the individual are all fictional; the
 * *shapes* — a regulator with powers it does not use for welfare reasons, an
 * organised industry opponent, a university that could generate evidence and has
 * never been asked — are the real recurring patterns.
 *
 * It also demonstrates the things that are otherwise invisible on day one:
 * a stakeholder who moved, a strategy that was replaced, a score corrected with
 * the rationale confirmed unchanged, an opponent with a proper posture, and a
 * named individual carrying the data-protection flag.
 */

import { newId, normalizeStrategy } from "./domain.js";

const DAY = 86400000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();

const S = (o) => normalizeStrategy(o);

/** [daysAgo, patch, note] — applied in order to build the history. */
const SEED = [
  {
    key: "inspectorate",
    name: "National Animal Health Inspectorate",
    type: "Regulator",
    base: {
      daysAgo: 240,
      power: 9,
      interest: 1,
      rationale:
        "Holds the only statutory power to suspend a holding's licence, and has used it 40+ times in three years — but every case was disease control, none welfare. Interest scored +1 rather than higher because no inspector has yet cited a welfare condition, and we have had one exploratory meeting only.",
      strategy: S({}),
    },
    steps: [
      {
        daysAgo: 205,
        strategy: S({
          objective:
            "Get welfare non-compliance recorded as a standing item on the routine inspection form, so it is captured whether or not anyone acts on it.",
          approach:
            "They already inspect these holdings on a disease cycle and are under pressure over inspection volumes. Asking them to add a tick-box to a visit they are already making costs them almost nothing; asking for a separate welfare inspection regime costs them a budget line they do not have.",
          actions: "Submit the draft form amendment by the end of the month. Follow up at the regional briefing.",
          owner: "Priya",
          cadence: "Monthly until the form goes to committee",
        }),
        note: "First substantive meeting with the Deputy Chief Inspector.",
      },
      {
        daysAgo: 120,
        interest: 4,
        rationale:
          "Holds the only statutory power to suspend a holding's licence, and has used it 40+ times in three years. Interest raised to +4: the Deputy Chief Inspector took our draft form amendment to the standards committee unprompted, and it is now on the agenda for the next cycle. Still not higher because nothing has been adopted and the committee has rejected two prior amendments.",
        note: "Amendment tabled at the standards committee — they did this without being pushed.",
      },
      {
        daysAgo: 34,
        power: 8,
        rationale:
          "Holds the only statutory power to suspend a holding's licence. Power reduced to 8: the licensing function is being split out to a separate body next year, which will leave the inspectorate with inspection but not suspension. Interest steady at +4 — the committee has not met since.",
        note: "Restructuring announced in the ministry's annual plan.",
      },
    ],
  },

  {
    key: "ministry",
    name: "Ministry of Agriculture and Rural Development",
    type: "Government department",
    base: {
      daysAgo: 240,
      power: 10,
      interest: -1,
      rationale:
        "Writes the regulations the inspectorate enforces, and sets its budget. Scored -1 rather than 0: the current minister's rural jobs programme is explicitly built on expanding intensive production, so there is a structural reason to prefer the status quo, but no one in the department has taken a position on welfare either way.",
      strategy: S({}),
    },
    steps: [
      {
        daysAgo: 190,
        strategy: S({
          objective:
            "Move the department from no position to accepting that welfare standards are within the scope of the next five-year rural plan consultation.",
          approach:
            "The department responds to trade exposure, not to welfare arguments. Two of its three export markets are tightening import welfare requirements; framing this as market access rather than animal welfare puts it inside a brief they already own.",
          actions: "Submit evidence to the rural plan consultation before it closes. Request a meeting with the trade unit rather than the animal health unit.",
          owner: "Priya",
          cadence: "Quarterly; next review when the consultation response is published",
        }),
        note: "",
      },
    ],
  },

  {
    key: "federation",
    name: "Poultry Producers Federation",
    type: "Industry body",
    base: {
      daysAgo: 240,
      power: 8,
      interest: -8,
      rationale:
        "Represents roughly 70% of commercial production by volume and sits on the ministry's advisory panel. Scored -8: they published a rebuttal to our first briefing within a fortnight, and their director has twice described mandatory standards as an existential threat in the trade press. Organised, funded and paying attention.",
      strategy: S({}),
    },
    steps: [
      {
        daysAgo: 200,
        strategy: S({
          objective:
            "Contain rather than convert. Keep their public position anchored to the cost argument, which is testable, rather than letting it broaden into a jobs-and-rural-livelihoods argument, which is not.",
          approach:
            "They are strongest when they can speak for the whole sector. Their own membership is split — the three largest integrators already meet the standards we are asking for, because their export contracts require it. Making the cost argument specific invites that split into public view without us having to attack them.",
          actions:
            "Do not approach first. Publish the per-bird cost analysis using their own members' filed accounts. Respond only through the consultation, never in the trade press.",
          owner: "Daniel",
          cadence: "Monitor filings monthly. Reassess if their director changes.",
        }),
        note: "Agreed posture at the strategy day.",
      },
      {
        daysAgo: 76,
        interest: -6,
        rationale:
          "Represents roughly 70% of commercial production by volume and sits on the ministry's advisory panel. Raised from -8 to -6: their submission to the rural plan consultation conceded that stocking density standards are 'a legitimate subject for phased regulation', which is a real move from their previous position. Still firmly opposed, and still the principal organised opposition.",
        note: "Consultation submission published — noticeably softer on stocking density than their 2024 line.",
      },
    ],
  },

  {
    key: "university",
    name: "Eastvale University Veterinary School",
    type: "Technical and academic",
    base: {
      daysAgo: 240,
      power: 4,
      interest: 0,
      rationale:
        "No contact yet — assumed neutral. They are the only institution in the country with the facilities to run the in-shed air quality measurements the ministry would accept as evidence, which is why they are on this map at all. Power scored 4: no authority, but a near-monopoly on the evidence.",
      strategy: S({}),
    },
    steps: [
      {
        daysAgo: 150,
        strategy: S({
          objective:
            "Move them from no position to an active research collaboration producing measurements we can cite in the consultation.",
          approach:
            "An academic department with publication incentives and no fieldwork budget. Offer co-authorship and site access rather than asking them to donate time. The ask is a paper they want to write anyway; what they lack is farm access, which we have.",
          actions: "Approach Professor Adeyemi's group directly rather than the department. Offer three sites for a pilot.",
          owner: "Daniel",
          cadence: "Fortnightly during the pilot; monthly after",
        }),
        note: "",
      },
      {
        daysAgo: 60,
        interest: 6,
        rationale:
          "The only institution with the facilities to run the in-shed air quality measurements. Raised to +6: the pilot ran, they have committed to a full study, and they approached us about a second site. Not higher because nothing is published yet and funding for the full study is not secured.",
        note: "Pilot complete. They asked for a second site unprompted.",
      },
    ],
  },

  {
    key: "welfare-alliance",
    name: "Coastal Animal Welfare Alliance",
    type: "Civil society",
    base: {
      daysAgo: 240,
      power: 5,
      interest: 8,
      rationale:
        "A national NGO with 40 years of standing and direct access to two select committees. Interest +8: they co-signed our first briefing without amendment. Not higher because their board has ruled out any campaign that names individual producers, which constrains what we can do jointly.",
      strategy: S({
        objective: "Get them to lead the parliamentary side of the consultation response, using their committee access, so we are not the only organisation on the record.",
        approach:
          "They have access we do not and a board nervous about confrontation. Giving them the parliamentary lead plays to the access and keeps them away from the naming-and-shaming they have ruled out. Their name on the submission also makes it harder to dismiss as a single-issue campaign.",
        actions: "Joint drafting session before the consultation closes. Agree who speaks to which committee member.",
        owner: "Priya",
        cadence: "Fortnightly while the consultation is open",
      }),
    },
    steps: [],
  },

  {
    key: "trust",
    name: "Marlowe Foundation",
    type: "Funder",
    base: {
      daysAgo: 240,
      power: 6,
      interest: 3,
      rationale:
        "Funds roughly a third of this programme and has a second grant cycle opening. Interest +3: supportive of the work but their stated priority is direct welfare improvement rather than policy, and our last report was told it was 'strong on activity, thin on outcomes'.",
      strategy: S({
        objective: "Get the policy strand explicitly named as fundable in the next cycle's guidance, rather than tolerated within a direct-welfare grant.",
        approach:
          "Their objection is not to policy work, it is to policy work they cannot evidence. What they lack is a way to report influence outcomes to their own board. Showing them a longitudinal record of stakeholder movement answers their problem, not ours.",
        actions: "Take the movement record to the December review rather than an activity list.",
        owner: "Priya",
        cadence: "Each reporting cycle",
      }),
    },
    steps: [
      {
        daysAgo: 15,
        power: 7,
        rationale:
          "Funds roughly a third of this programme. Power raised to 7 — the second cycle is now confirmed as larger than the first, and a decision against us would end the policy strand rather than shrink it. Interest unchanged at +3.",
        note: "Cycle size confirmed at the trustees' meeting.",
      },
    ],
  },

  {
    key: "integrator",
    name: "Northfield Integrated Poultry",
    type: "Regulated population",
    base: {
      daysAgo: 240,
      power: 7,
      interest: -3,
      rationale:
        "The largest single producer, roughly 18% of national volume, and already meets most of the standards we are asking for because of an export contract. Scored -3 rather than lower: opposed to mandatory standards on principle and on cost-of-compliance-for-competitors grounds, but not organised against us and not funding the federation's campaign.",
      strategy: S({ objective: "monitor" }),
    },
    steps: [],
  },

  {
    key: "adeyemi",
    name: "Professor Ngozi Adeyemi",
    type: "Technical and academic",
    isIndividual: true,
    base: {
      daysAgo: 150,
      power: 3,
      interest: 7,
      rationale:
        "Leads the group running the air quality pilot and is the named author the ministry's technical committee would find hardest to dismiss. Interest +7 on the evidence of the pilot going ahead and her asking for a second site. Power 3: no institutional authority, but personal standing with the committee.",
      strategy: S({
        objective: "Secure her as the named presenter of the findings to the ministry's technical committee.",
        approach: "Publication and standing are what she is optimising for; the committee appearance serves both. The ask is not a favour.",
        actions: "Confirm before the committee's spring cycle.",
        owner: "Daniel",
        cadence: "Monthly",
      }),
    },
    steps: [],
  },
];

/**
 * Build the example project as {project, stakeholders, changes}, ready for a
 * single atomic import.
 */
export function buildExampleProject() {
  const projectId = newId();
  const project = {
    id: projectId,
    name: "Example — poultry welfare standards (fictional)",
    description:
      "A worked example with eight months of recorded history, so the movement and effect views have something in them. Every organisation and person in it is invented. Delete it whenever you like.",
    scaleNote:
      "Power 0–10 over whether the standards are adopted. Interest −10 to +10 on adoption specifically, not on animal welfare generally.",
    createdAt: iso(240),
    updatedAt: iso(15),
  };

  const stakeholders = [];
  const changes = [];

  for (const seed of SEED) {
    const id = newId();
    let cur = {
      power: seed.base.power,
      interest: seed.base.interest,
      rationale: seed.base.rationale,
      strategy: normalizeStrategy(seed.base.strategy),
    };
    const baseline = { ...cur, strategy: { ...cur.strategy }, at: iso(seed.base.daysAgo) };
    let updatedAt = null;

    for (const step of seed.steps) {
      const next = {
        power: step.power != null ? step.power : cur.power,
        interest: step.interest != null ? step.interest : cur.interest,
        rationale: step.rationale != null ? step.rationale : cur.rationale,
        strategy: step.strategy ? normalizeStrategy(step.strategy) : { ...cur.strategy },
      };
      const fields = [];
      if (next.power !== cur.power) fields.push("power");
      if (next.interest !== cur.interest) fields.push("interest");
      if (next.rationale !== cur.rationale) fields.push("rationale");
      if (JSON.stringify(next.strategy) !== JSON.stringify(cur.strategy)) fields.push("strategy");
      if (!fields.length) continue;

      const at = iso(step.daysAgo);
      changes.push({
        id: newId(),
        projectId,
        stakeholderId: id,
        at,
        by: "",
        power: next.power,
        interest: next.interest,
        rationale: next.rationale,
        strategy: next.strategy,
        note: step.note || "",
        prevPower: cur.power,
        prevInterest: cur.interest,
        prevRationale: cur.rationale,
        prevStrategy: { ...cur.strategy },
        changedFields: fields,
      });
      cur = next;
      updatedAt = at;
    }

    stakeholders.push({
      id,
      projectId,
      name: seed.name,
      type: seed.type,
      isIndividual: Boolean(seed.isIndividual),
      power: cur.power,
      interest: cur.interest,
      rationale: cur.rationale,
      strategy: cur.strategy,
      baseline,
      createdAt: baseline.at,
      updatedAt,
      updatedBy: "",
    });
  }

  return { project, stakeholders, changes };
}
