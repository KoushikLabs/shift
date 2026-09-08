/**
 * Reading .xlsx, without a library.
 *
 * Most organisations that already keep a stakeholder list keep it in Excel, not
 * in CSV — so "export to CSV first" is a step where a real import quietly dies.
 * This reads the workbook directly and hands the wizard the same
 * `{headers, rows}` shape `parseCsv` produces, so everything downstream —
 * column mapping, the defaults, the preview — is unchanged.
 *
 * Why hand-rolled rather than SheetJS:
 *
 *   1. The build inlines everything into one `dist/index.html` that has to work
 *      off a USB stick with no network. A full spreadsheet library is close to a
 *      megabyte of that budget to read a name column and two numbers.
 *   2. Nothing here may fetch at runtime — that is the privacy guarantee the CI
 *      guard enforces. Vendoring is the only option anyway, so the question is
 *      only how much to vendor.
 *
 * An .xlsx is a ZIP of XML. We need three parts of each: which sheets exist,
 * the shared string table, and the cell values. That is a small, stable and
 * well-specified subset — this file is about 300 lines and does not grow.
 *
 * Deliberately NOT handled, because none of it reaches a stakeholder map:
 * formulas (we take Excel's cached result), styles, dates as dates (no import
 * field is a date), merged cells, charts, images.
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** An .xlsx is a ZIP: it always starts "PK\x03\x04". */
export function looksLikeXlsx(bytes) {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * The pre-2007 binary .xls is an OLE compound file, an entirely different and
 * much nastier format. Worth detecting purely so we can say so plainly instead
 * of failing with something about a missing central directory.
 */
export function looksLikeOldXls(bytes) {
  return (
    bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
  );
}

export class XlsxError extends Error {}

/* -------------------------------------------------------------------- ZIP */

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new XlsxError("This browser cannot unpack .xlsx files. Save the sheet as CSV instead.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findEocd(view, length) {
  // The end-of-central-directory record sits at the very end, unless there is a
  // trailing comment — which caps out at 64K.
  const earliest = Math.max(0, length - 65557);
  for (let i = length - 22; i >= earliest; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * Unpack the entries whose names pass `wanted`. Everything in an .xlsx that we
 * care about is XML; skipping the rest means a workbook with embedded images
 * does not cost us the time and memory to inflate them.
 *
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function unzip(buffer, wanted = () => true) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocd = findEocd(view, bytes.length);
  if (eocd < 0) throw new XlsxError("That file is not a readable .xlsx — the archive index is missing.");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (offset === 0xffffffff || count === 0xffff) {
    throw new XlsxError("That workbook uses the ZIP64 format, which this reader does not handle. Save it as CSV.");
  }

  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localAt = view.getUint32(offset + 42, true);
    const name = new TextDecoder("utf-8").decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;

    if (!wanted(name)) continue;
    if (view.getUint32(localAt, true) !== SIG_LOCAL) continue;

    // The local header repeats the name and extra lengths, and they can differ
    // from the central ones — the data starts after the local copies, not the
    // central ones. Getting this wrong shifts every byte.
    const localNameLen = view.getUint16(localAt + 26, true);
    const localExtraLen = view.getUint16(localAt + 28, true);
    const start = localAt + 30 + localNameLen + localExtraLen;
    const raw = bytes.subarray(start, start + compressedSize);

    if (method === 0) out.set(name, raw.slice());
    else if (method === 8) out.set(name, await inflateRaw(raw));
    // Anything else (bzip2, lzma) is not something Excel writes; skip it rather
    // than fail the whole workbook for one stray entry.
  }
  return out;
}

/* -------------------------------------------------------------------- XML */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s) {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : whole;
  });
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  return m ? decodeEntities(m[1]) : "";
}

/**
 * The text of a run-containing element (`<si>` or `<is>`): the concatenation of
 * its `<t>` children.
 *
 * `<rPh>` holds furigana — the phonetic reading of a Japanese cell — in its own
 * `<t>`. Concatenating it doubles the value, so it is stripped first.
 */
function runText(xml) {
  const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  const re = /<t\b[^>]*?(\/>|>([\s\S]*?)<\/t>)/g;
  let m;
  while ((m = re.exec(body))) out += m[1] === "/>" ? "" : decodeEntities(m[2]);
  return out;
}

/* --------------------------------------------------------------- workbook */

function xmlOf(files, path) {
  const bytes = files.get(path);
  return bytes ? new TextDecoder("utf-8").decode(bytes) : "";
}

function sharedStrings(files) {
  const xml = xmlOf(files, "xl/sharedStrings.xml");
  if (!xml) return [];
  const out = [];
  const re = /<si\b[^>]*?(\/>|>([\s\S]*?)<\/si>)/g;
  let m;
  while ((m = re.exec(xml))) out.push(m[1] === "/>" ? "" : runText(m[2]));
  return out;
}

/** "AB12" -> 27. Excel columns are base-26 with no zero. */
export function colIndex(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i) & ~0x20; // upper-case
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function numberText(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  // A cell holding a formula result carries the full float, so a perfectly
  // ordinary 0.3 can arrive as 0.30000000000000004. Ten significant digits is
  // far more precision than a 0-10 score needs and kills the noise.
  return String(Number(n.toPrecision(10)));
}

function sheetCells(xml, strings) {
  const rows = [];
  const rowRe = /<row\b[^>]*?(\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = [];
    if (rm[1] !== "/>") {
      const cellRe = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
      let cm;
      let auto = 0;
      while ((cm = cellRe.exec(rm[2]))) {
        const tag = cm[1];
        const inner = cm[2] === "/>" ? "" : cm[3];
        const ref = attr(tag, "r");
        const at = ref ? colIndex(ref) : auto;
        auto = at + 1;

        const type = attr(tag, "t");
        let value = "";
        if (type === "inlineStr") {
          value = runText(inner);
        } else {
          const v = inner.match(/<v\b[^>]*?(\/>|>([\s\S]*?)<\/v>)/);
          const raw = !v ? "" : v[1] === "/>" ? "" : decodeEntities(v[2]);
          if (type === "s") value = strings[Number(raw)] ?? "";
          else if (type === "str") value = raw;
          else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
          else if (type === "e") value = ""; // #REF!, #N/A — blank is the honest reading
          else value = numberText(raw);
        }
        if (at >= 0) cells[at] = value;
      }
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
    rows.push(cells);
  }
  return rows;
}

const nonEmpty = (row) => row.filter((c) => String(c).trim() !== "").length;

/**
 * Choose the header row.
 *
 * Real org spreadsheets very often open with a title ("Ring 1 stakeholder
 * matrix — updated March") and maybe a blank line before the actual headers.
 * Taking row 1 blindly turns the whole import into one nonsense column, and the
 * user is left guessing why. So: the first row that has at least two values and
 * at least half as many as the widest row nearby.
 *
 * The row it picked is always reported to the user rather than applied
 * silently, because a wrong guess here mislabels every column.
 */
export function pickHeaderRow(rows) {
  const window = rows.slice(0, 10);
  const widest = window.reduce((max, r) => Math.max(max, nonEmpty(r)), 0);
  for (let i = 0; i < window.length; i++) {
    const n = nonEmpty(window[i]);
    if (n >= 2 && n * 2 >= widest) return i;
  }
  return rows.findIndex((r) => nonEmpty(r) > 0);
}

function toTable(cells) {
  const headerAt = pickHeaderRow(cells);
  if (headerAt < 0) return { headers: [], rows: [], headerRow: 0, skippedAbove: 0 };

  const headers = cells[headerAt].map((h) => String(h).trim());
  while (headers.length && headers[headers.length - 1] === "") headers.pop();

  const rows = cells
    .slice(headerAt + 1)
    .filter((r) => nonEmpty(r) > 0)
    .map((r) => {
      const row = headers.map((_, i) => String(r[i] ?? "").trim());
      return row;
    });

  return { headers, rows, headerRow: headerAt + 1, skippedAbove: headerAt };
}

/**
 * Read a workbook into per-sheet tables.
 *
 * @returns {Promise<{sheets: {name:string, headers:string[], rows:string[][],
 *   headerRow:number, skippedAbove:number}[]}>}
 */
export async function readWorkbook(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (looksLikeOldXls(bytes)) {
    throw new XlsxError(
      "That is the older .xls format. Open it in Excel or LibreOffice and use Save As to make a .xlsx, or export a CSV."
    );
  }
  if (!looksLikeXlsx(bytes)) throw new XlsxError("That does not look like an Excel file.");

  const files = await unzip(bytes, (n) => n.endsWith(".xml") || n.endsWith(".rels"));
  const workbook = xmlOf(files, "xl/workbook.xml");
  if (!workbook) throw new XlsxError("That .xlsx has no workbook inside it.");

  // rId -> path, so the sheets come back in the order the tabs appear.
  const rels = new Map();
  const relRe = /<Relationship\b([^>]*)\/?>/g;
  let rel;
  while ((rel = relRe.exec(xmlOf(files, "xl/_rels/workbook.xml.rels")))) {
    const target = attr(rel[1], "Target");
    rels.set(attr(rel[1], "Id"), target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }

  const strings = sharedStrings(files);
  const sheets = [];
  const sheetRe = /<sheet\b([^>]*)\/?>/g;
  let sm;
  let fallback = 0;
  while ((sm = sheetRe.exec(workbook))) {
    fallback += 1;
    const id = attr(sm[1], "r:id") || attr(sm[1], "id");
    const path = rels.get(id) || `xl/worksheets/sheet${fallback}.xml`;
    const xml = xmlOf(files, path);
    if (!xml) continue;
    sheets.push({
      name: attr(sm[1], "name") || `Sheet ${fallback}`,
      hidden: attr(sm[1], "state") === "hidden" || attr(sm[1], "state") === "veryHidden",
      ...toTable(sheetCells(xml, strings)),
    });
  }

  if (!sheets.length) throw new XlsxError("That workbook has no readable sheets.");
  return { sheets };
}
