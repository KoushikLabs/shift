import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import {
  readWorkbook,
  looksLikeXlsx,
  looksLikeOldXls,
  decodeEntities,
  colIndex,
  pickHeaderRow,
  XlsxError,
} from "../src/io/xlsx.js";
import { guessMapping, rowsToStakeholderFields } from "../src/io/csv.js";

/**
 * A real ZIP, built byte by byte, so these tests exercise the actual archive
 * parsing rather than a stub of it. CRCs are left zero: the reader does not
 * verify them, and pinning that here would only make the fixture longer.
 */
function zip(entries, { store = false } = {}) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, text] of entries) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(text);
    const data = store ? raw : deflateRawSync(raw);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, store ? 0 : 8, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);
    central.push({ name: nameBytes, method: store ? 0 : 8, comp: data.length, uncomp: raw.length, offset });
    offset += local.length + data.length;
  }

  const cdStart = offset;
  for (const e of central) {
    const rec = new Uint8Array(46 + e.name.length);
    const dv = new DataView(rec.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(10, e.method, true);
    dv.setUint32(20, e.comp, true);
    dv.setUint32(24, e.uncomp, true);
    dv.setUint16(28, e.name.length, true);
    dv.setUint32(42, e.offset, true);
    rec.set(e.name, 46);
    chunks.push(rec);
    offset += rec.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, offset - cdStart, true);
  ev.setUint32(16, cdStart, true);
  chunks.push(eocd);

  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

const WORKBOOK = `<?xml version="1.0"?><workbook xmlns:r="http://x"><sheets>
  <sheet name="Stakeholders" sheetId="1" r:id="rId1"/>
</sheets></workbook>`;

const RELS = `<?xml version="1.0"?><Relationships>
  <Relationship Id="rId1" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

/** Shared strings, in the order the cells below reference them. */
const SHARED = `<?xml version="1.0"?><sst count="8">
  <si><t>Name</t></si>
  <si><t>Type</t></si>
  <si><t>Power</t></si>
  <si><t>Interest</t></si>
  <si><t>State Pollution Board</t></si>
  <si><t>Regulator</t></si>
  <si><r><t>Poultry Federation </t></r><r><t>of India</t></r></si>
  <si><t>Industry &amp; trade</t></si>
</sst>`;

function sheet(rowsXml) {
  return `<?xml version="1.0"?><worksheet><sheetData>${rowsXml}</sheetData></worksheet>`;
}

function book(rowsXml, opts) {
  return zip(
    [
      ["xl/workbook.xml", WORKBOOK],
      ["xl/_rels/workbook.xml.rels", RELS],
      ["xl/sharedStrings.xml", SHARED],
      ["xl/worksheets/sheet1.xml", sheet(rowsXml)],
    ],
    opts
  );
}

const PLAIN_ROWS = `
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
  <row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2"><v>9</v></c><c r="D2"><v>6</v></c></row>
  <row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>7</v></c><c r="C3"><v>7</v></c><c r="D3"><v>-6</v></c></row>`;

describe("xlsx format detection", () => {
  it("recognises a zip container", () => {
    expect(looksLikeXlsx(book(PLAIN_ROWS))).toBe(true);
    expect(looksLikeXlsx(new TextEncoder().encode("Name,Power\nA,1"))).toBe(false);
  });

  it("names the old .xls format instead of failing obscurely", async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(looksLikeOldXls(ole)).toBe(true);
    await expect(readWorkbook(ole)).rejects.toThrow(/older \.xls format/i);
  });

  it("rejects something that is not a spreadsheet at all", async () => {
    await expect(readWorkbook(new TextEncoder().encode("hello"))).rejects.toBeInstanceOf(XlsxError);
  });
});

describe("readWorkbook", () => {
  it("reads headers and rows from a deflated workbook", async () => {
    const { sheets } = await readWorkbook(book(PLAIN_ROWS));
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("Stakeholders");
    expect(sheets[0].headers).toEqual(["Name", "Type", "Power", "Interest"]);
    expect(sheets[0].rows).toEqual([
      ["State Pollution Board", "Regulator", "9", "6"],
      ["Poultry Federation of India", "Industry & trade", "7", "-6"],
    ]);
  });

  it("reads a workbook whose entries are stored uncompressed", async () => {
    const { sheets } = await readWorkbook(book(PLAIN_ROWS, { store: true }));
    expect(sheets[0].rows[0][0]).toBe("State Pollution Board");
  });

  it("joins rich-text runs and decodes entities", async () => {
    const { sheets } = await readWorkbook(book(PLAIN_ROWS));
    expect(sheets[0].rows[1][0]).toBe("Poultry Federation of India");
    expect(sheets[0].rows[1][1]).toBe("Industry & trade");
  });

  it("keeps blank cells in position instead of shifting the row left", async () => {
    // B2 is absent entirely — the classic cause of a silently shifted import.
    const { sheets } = await readWorkbook(
      book(`
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" t="s"><v>4</v></c><c r="C2"><v>9</v></c></row>`)
    );
    expect(sheets[0].rows[0]).toEqual(["State Pollution Board", "", "9"]);
  });

  it("handles inline strings, booleans and error cells", async () => {
    const { sheets } = await readWorkbook(
      book(`
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>Ministry of Fisheries</t></is></c>
                 <c r="B2" t="b"><v>1</v></c>
                 <c r="C2" t="e"><v>#REF!</v></c></row>`)
    );
    expect(sheets[0].rows[0]).toEqual(["Ministry of Fisheries", "TRUE", ""]);
  });

  it("strips float noise from computed cells", async () => {
    const { sheets } = await readWorkbook(
      book(`
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>0.30000000000000004</v></c></row>`)
    );
    expect(sheets[0].rows[0][1]).toBe("0.3");
  });

  it("takes the cached result of a formula cell", async () => {
    const { sheets } = await readWorkbook(
      book(`
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><f>SUM(D2:E2)</f><v>8</v></c></row>`)
    );
    expect(sheets[0].rows[0][1]).toBe("8");
  });

  it("returns every sheet, in tab order", async () => {
    const two = zip([
      [
        "xl/workbook.xml",
        `<workbook xmlns:r="http://x"><sheets><sheet name="Ring 1" sheetId="1" r:id="rId1"/><sheet name="Ring 2" sheetId="2" r:id="rId2"/></sheets></workbook>`,
      ],
      [
        "xl/_rels/workbook.xml.rels",
        `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
      ],
      ["xl/sharedStrings.xml", SHARED],
      ["xl/worksheets/sheet1.xml", sheet(PLAIN_ROWS)],
      [
        "xl/worksheets/sheet2.xml",
        sheet(`<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
               <row r="2"><c r="A2" t="inlineStr"><is><t>District Collector</t></is></c><c r="B2" t="s"><v>5</v></c></row>`),
      ],
    ]);
    const { sheets } = await readWorkbook(two);
    expect(sheets.map((s) => s.name)).toEqual(["Ring 1", "Ring 2"]);
    expect(sheets[1].rows[0][0]).toBe("District Collector");
  });
});

describe("pickHeaderRow", () => {
  it("skips a title row above the real headers", () => {
    expect(
      pickHeaderRow([
        ["Ring 1 stakeholder matrix — March"],
        [],
        ["Name", "Type", "Power", "Interest"],
        ["State Pollution Board", "Regulator", "9", "6"],
      ])
    ).toBe(2);
  });

  it("takes row one when row one is already the headers", () => {
    expect(pickHeaderRow([["Name", "Power"], ["A", "1"]])).toBe(0);
  });

  it("reports the header row it chose so the guess is visible", async () => {
    const { sheets } = await readWorkbook(
      book(`
      <row r="1"><c r="A1" t="inlineStr"><is><t>Ring 1 stakeholder matrix</t></is></c></row>
      <row r="2"/>
      <row r="3"><c r="A3" t="s"><v>0</v></c><c r="B3" t="s"><v>1</v></c><c r="C3" t="s"><v>2</v></c><c r="D3" t="s"><v>3</v></c></row>
      <row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4" t="s"><v>5</v></c><c r="C4"><v>9</v></c><c r="D4"><v>6</v></c></row>`)
    );
    expect(sheets[0].headers).toEqual(["Name", "Type", "Power", "Interest"]);
    expect(sheets[0].headerRow).toBe(3);
    expect(sheets[0].skippedAbove).toBe(2);
    expect(sheets[0].rows).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("converts column letters", () => {
    expect(colIndex("A1")).toBe(0);
    expect(colIndex("Z9")).toBe(25);
    expect(colIndex("AA1")).toBe(26);
    expect(colIndex("AB12")).toBe(27);
  });

  it("decodes numeric and named entities", () => {
    expect(decodeEntities("Industry &amp; trade")).toBe("Industry & trade");
    expect(decodeEntities("&#8212; dash &#x2014;")).toBe("— dash —");
    expect(decodeEntities("no entities here")).toBe("no entities here");
  });
});

describe("a spreadsheet reaches the same place a CSV does", () => {
  it("feeds the existing column mapping and produces stakeholders", async () => {
    const { sheets } = await readWorkbook(book(PLAIN_ROWS));
    const { headers, rows } = sheets[0];
    const mapping = guessMapping(headers);
    expect(mapping).toEqual(["name", "type", "power", "interest"]);

    const { records, skipped } = rowsToStakeholderFields(rows, headers, mapping);
    expect(skipped).toBe(0);
    expect(records.map((r) => r.name)).toEqual(["State Pollution Board", "Poultry Federation of India"]);
    expect(records[0].power).toBe(9);
    expect(records[1].interest).toBe(-6);
  });
});
