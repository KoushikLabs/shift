/**
 * CSV in and out (SPEC 7 MVP: "paste CSV and map columns", "CSV of current
 * state including strategy fields").
 *
 * The parser is a real one — quoted fields, escaped quotes, embedded newlines,
 * CRLF, BOM, and comma/semicolon/tab detection. Advocacy orgs export from Excel
 * and Google Sheets in whatever locale they have, and a naive `split(",")`
 * mangles exactly the fields that matter here: rationales and approaches, which
 * are long prose full of commas.
 */

import { STRATEGY_FIELDS, clampInterest, clampPower, emptyStrategy, looksLikeIndividual } from "../domain.js";

/* ------------------------------------------------------------------ parse */

/** Fields a CSV column can be mapped onto. Order drives the mapping UI. */
export const IMPORT_FIELDS = [
  { key: "name", label: "Name", required: true },
  { key: "type", label: "Type" },
  { key: "power", label: "Power (0–10)" },
  { key: "interest", label: "Interest (−10 to +10)" },
  { key: "rationale", label: "Rationale" },
  { key: "objective", label: "Strategy · Objective" },
  { key: "approach", label: "Strategy · Approach" },
  { key: "actions", label: "Strategy · Actions" },
  { key: "owner", label: "Strategy · Owner" },
  { key: "cadence", label: "Strategy · Cadence" },
];

export function detectDelimiter(text) {
  const firstLine = sliceFirstLogicalLine(text);
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (ch === '"') {
      if (inQuotes && firstLine[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && ch in counts) counts[ch]++;
  }
  let best = ",";
  for (const d of Object.keys(counts)) if (counts[d] > counts[best]) best = d;
  return counts[best] === 0 ? "," : best;
}

function sliceFirstLogicalLine(text) {
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && (ch === "\n" || ch === "\r")) return text.slice(0, i);
  }
  return text;
}

/**
 * @returns {{headers:string[], rows:string[][], delimiter:string}}
 * The first non-empty row is treated as the header row.
 */
export function parseCsv(text, delimiter) {
  let src = String(text == null ? "" : text);
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1); // strip BOM
  const delim = delimiter || detectDelimiter(src);

  const table = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0].trim() !== "") table.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delim) {
      endField();
    } else if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) endRow();

  if (!table.length) return { headers: [], rows: [], delimiter: delim };
  const headers = table[0].map((h) => h.trim());
  const width = headers.length;
  const rows = table.slice(1).map((r) => {
    const out = r.slice(0, width);
    while (out.length < width) out.push("");
    return out;
  });
  return { headers, rows, delimiter: delim };
}

/* ---------------------------------------------------------------- mapping */

const HEADER_HINTS = {
  name: [/^name$/i, /stake ?holder/i, /organi[sz]ation/i, /^org$/i, /^actor/i, /^who$/i, /^entity/i, /^body$/i],
  type: [/^type$/i, /^categor/i, /^class/i, /^group$/i, /^segment/i, /^tier$/i],
  power: [/^power/i, /influence/i, /^impact/i, /^weight/i],
  interest: [/^interest/i, /alignment/i, /^support/i, /^stance/i, /^position/i, /^attitude/i],
  rationale: [/rationale/i, /reasoning/i, /evidence/i, /justification/i, /^why/i, /^basis/i, /assessment/i],
  objective: [/objective/i, /^goal/i, /^aim$/i, /desired.*(change|outcome)/i],
  approach: [/approach/i, /^theory/i, /^tactic/i, /^strategy$/i, /^method/i],
  actions: [/action/i, /next steps?/i, /^activit/i, /^plan$/i, /^todo/i],
  owner: [/^owner/i, /^lead$/i, /responsib/i, /^assigned/i, /point of contact/i, /^contact$/i],
  cadence: [/cadence/i, /frequen/i, /^rhythm/i, /^review/i, /how often/i],
};

/**
 * Suggest a field for each column. Returns an array parallel to `headers`,
 * holding a field key or "" for "do not import". Never assigns a field twice.
 */
export function guessMapping(headers) {
  const used = new Set();
  const mapping = headers.map(() => "");
  for (const [field, patterns] of Object.entries(HEADER_HINTS)) {
    if (used.has(field)) continue;
    const idx = headers.findIndex((h, i) => mapping[i] === "" && patterns.some((re) => re.test(String(h).trim())));
    if (idx >= 0) {
      mapping[idx] = field;
      used.add(field);
    }
  }
  // A single-column paste with no recognisable header is almost certainly names.
  if (headers.length === 1 && mapping[0] === "") mapping[0] = "name";
  return mapping;
}

/* ---------------------------------------------------------------- numbers */

/**
 * Tolerant score parsing. Handles "+6", the Unicode minus "−6", "6/10",
 * "7 (high)", decimal commas, and blanks. Blank means "not supplied", which is
 * different from zero: the caller supplies the default.
 */
export function parseScore(raw) {
  const t = String(raw == null ? "" : raw)
    .replace(/−|–|—/g, "-") // unicode minus / en dash / em dash
    .trim();
  if (!t) return null;
  const m = t.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const TRUTHY = /^(y|yes|true|1|x|individual|person)$/i;
export function parseBool(raw) {
  return TRUTHY.test(String(raw == null ? "" : raw).trim());
}

/* ------------------------------------------------------------- row -> field */

/**
 * Turn parsed rows plus a column mapping into stakeholder field objects ready
 * for makeStakeholder. Rows with no name are dropped and reported, never
 * silently swallowed.
 *
 * @returns {{records:object[], skipped:number, warnings:string[]}}
 */
export function rowsToStakeholderFields(rows, headers, mapping) {
  const col = {};
  mapping.forEach((field, i) => {
    if (field) col[field] = i;
  });

  const records = [];
  const warnings = [];
  let skipped = 0;
  const seen = new Set();

  rows.forEach((row, n) => {
    const get = (f) => (col[f] == null ? "" : String(row[col[f]] == null ? "" : row[col[f]]).trim());
    const name = get("name");
    if (!name) {
      skipped++;
      return;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) warnings.push(`Row ${n + 2}: “${name}” appears more than once — imported as separate entries.`);
    seen.add(key);

    const rawPower = col.power == null ? null : parseScore(row[col.power]);
    const rawInterest = col.interest == null ? null : parseScore(row[col.interest]);

    if (rawPower != null && (rawPower < 0 || rawPower > 10)) {
      warnings.push(`Row ${n + 2}: power ${rawPower} is outside 0–10 and was clamped.`);
    }
    if (rawInterest != null && (rawInterest < -10 || rawInterest > 10)) {
      warnings.push(`Row ${n + 2}: interest ${rawInterest} is outside −10 to +10 and was clamped.`);
    }

    const strategy = emptyStrategy();
    for (const f of STRATEGY_FIELDS) if (col[f] != null) strategy[f] = get(f);

    records.push({
      name,
      type: get("type"),
      // SPEC 6.6: an unsupplied interest is neutral, never optimistic.
      power: rawPower == null ? 5 : clampPower(rawPower),
      interest: rawInterest == null ? 0 : clampInterest(rawInterest),
      rationale: get("rationale"),
      strategy,
      isIndividual: looksLikeIndividual(name),
      _interestSupplied: rawInterest != null,
      _powerSupplied: rawPower != null,
    });
  });

  return { records, skipped, warnings };
}

/* ----------------------------------------------------------------- export */

const CSV_HEADERS = [
  "Name",
  "Type",
  "Named individual",
  "Power",
  "Interest",
  "Stance",
  "Rationale",
  "Objective",
  "Approach",
  "Actions",
  "Owner",
  "Cadence",
  "Baseline power",
  "Baseline interest",
  "Δ power",
  "Δ interest",
  "Last changed",
];

export function toCsv(stakeholders, { stanceLabelOf }) {
  const rows = [CSV_HEADERS];
  for (const s of stakeholders) {
    const st = s.strategy || emptyStrategy();
    const b = s.baseline || {};
    rows.push([
      s.name,
      s.type || "",
      s.isIndividual ? "yes" : "",
      s.power,
      s.interest,
      stanceLabelOf(s.interest),
      s.rationale || "",
      st.objective || "",
      st.approach || "",
      st.actions || "",
      st.owner || "",
      st.cadence || "",
      b.power ?? "",
      b.interest ?? "",
      b.power == null ? "" : s.power - b.power,
      b.interest == null ? "" : s.interest - b.interest,
      s.updatedAt || "",
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function csvCell(v) {
  const s = v == null ? "" : String(v);
  // Excel treats a leading =, +, - or @ as a formula. Prefix with a quote so a
  // rationale beginning "-3 because…" cannot become an executable cell.
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
