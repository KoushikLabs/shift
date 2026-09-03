/**
 * The CSV paste-and-map wizard (SPEC 7 MVP: "Add stakeholders manually, or
 * paste CSV and map columns").
 *
 * Three steps: paste → map columns → preview and confirm. Column mapping is
 * guessed from the headers and always shown for correction, because a wrong
 * guess on the interest column silently inverts a map.
 */

import { IMPORT_FIELDS, guessMapping, parseCsv, rowsToStakeholderFields } from "../io/csv.js";
import { readFile } from "../io/download.js";
import { stanceLabel, stanceOf } from "../domain.js";
import { customDialog } from "./modal.js";
import { esc, signed, truncate } from "./dom.js";

export function csvImportDialog() {
  return customDialog((dlg, close) => {
    let step = 1;
    let parsed = { headers: [], rows: [], delimiter: "," };
    let mapping = [];

    dlg.innerHTML = `<div class="dlg">
      <div class="dlghead">
        <h2>Import stakeholders from a spreadsheet</h2>
        <p>Paste rows copied from Excel, Google Sheets or a CSV file. Nothing is uploaded — this all happens in your browser.</p>
      </div>
      <div class="dlgbody" id="wizBody"></div>
      <div class="dlgfoot">
        <span class="status" id="wizStatus"></span>
        <button id="wizBack" hidden>Back</button>
        <button id="wizCancel">Cancel</button>
        <button id="wizNext" class="primary" disabled>Next</button>
      </div>
    </div>`;

    const body = dlg.querySelector("#wizBody");
    const status = dlg.querySelector("#wizStatus");
    const next = dlg.querySelector("#wizNext");
    const back = dlg.querySelector("#wizBack");

    dlg.querySelector("#wizCancel").addEventListener("click", () => close(null));
    back.addEventListener("click", () => {
      step = Math.max(1, step - 1);
      draw();
    });
    next.addEventListener("click", () => {
      if (step === 1) {
        const text = dlg.querySelector("#csvText").value;
        parsed = parseCsv(text);
        if (!parsed.headers.length) {
          status.className = "status err";
          status.textContent = "Nothing to read.";
          return;
        }
        mapping = guessMapping(parsed.headers);
        step = 2;
      } else if (step === 2) {
        step = 3;
      } else {
        const { records } = rowsToStakeholderFields(parsed.rows, parsed.headers, mapping);
        close(records);
        return;
      }
      draw();
    });

    function steps() {
      return `<div class="wizsteps">
        <span class="${step === 1 ? "on" : ""}">1 · Paste</span>
        <span class="${step === 2 ? "on" : ""}">2 · Map columns</span>
        <span class="${step === 3 ? "on" : ""}">3 · Check</span>
      </div>`;
    }

    function draw() {
      status.className = "status";
      status.textContent = "";
      back.hidden = step === 1;
      if (step === 1) drawPaste();
      else if (step === 2) drawMap();
      else drawPreview();
    }

    /* ------------------------------------------------------------ step 1 */

    function drawPaste() {
      next.textContent = "Next";
      body.innerHTML =
        steps() +
        `<fieldset>
          <span class="flabel">Paste CSV or tab-separated rows</span>
          <p class="fhint">Include the header row. Commas, semicolons and tabs are all recognised.</p>
          <textarea id="csvText" rows="10" data-autofocus placeholder="Name,Type,Power,Interest,Rationale&#10;State Pollution Board,Regulator,9,6,Closure powers and has used them&#10;National Poultry Federation,Industry,7,-6,Public position against mandatory standards"></textarea>
        </fieldset>
        <div class="actions tight">
          <input type="file" id="csvFile" accept=".csv,.tsv,.txt,text/csv" class="sr-only">
          <button type="button" id="csvPick">Choose a file instead…</button>
          <span class="status" id="fileName"></span>
        </div>
        <div class="caveat" style="margin-top:14px">
          <strong>Rows with no name are skipped.</strong> Any actor you cannot name is not a stakeholder —
          “local NGOs” is a category, not an entry on a map. Missing power defaults to 5; missing interest
          defaults to 0, which is neutral, not positive.
        </div>`;

      const ta = body.querySelector("#csvText");
      ta.addEventListener("input", () => {
        next.disabled = !ta.value.trim();
      });
      body.querySelector("#csvPick").addEventListener("click", () => body.querySelector("#csvFile").click());
      body.querySelector("#csvFile").addEventListener("change", async (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        try {
          ta.value = await readFile(f);
          body.querySelector("#fileName").textContent = f.name;
          next.disabled = false;
        } catch (err) {
          status.className = "status err";
          status.textContent = err.message;
        }
      });
      ta.focus();
      next.disabled = !ta.value.trim();
    }

    /* ------------------------------------------------------------ step 2 */

    function drawMap() {
      next.textContent = "Next";
      const options = (selected) =>
        `<option value="">— skip —</option>` +
        IMPORT_FIELDS.map(
          (f) => `<option value="${f.key}" ${f.key === selected ? "selected" : ""}>${esc(f.label)}</option>`
        ).join("");

      body.innerHTML =
        steps() +
        `<p class="note tight">${parsed.rows.length} data row${parsed.rows.length === 1 ? "" : "s"},
          ${parsed.headers.length} column${parsed.headers.length === 1 ? "" : "s"}, separated by
          <code>${parsed.delimiter === "\t" ? "tab" : parsed.delimiter}</code>. Check the guesses below.</p>
        <div class="tablewrap"><table class="maptable"><thead><tr>
          <th>Column in your file</th><th>First value</th><th>Import as</th>
        </tr></thead><tbody>
        ${parsed.headers
          .map(
            (h, i) => `<tr>
              <td style="font-weight:600">${esc(h || "(no header)")}</td>
              <td class="sample">${esc(truncate((parsed.rows[0] || [])[i] || "", 48))}</td>
              <td><select data-col="${i}">${options(mapping[i])}</select></td>
            </tr>`
          )
          .join("")}
        </tbody></table></div>
        <p class="warnline" id="mapWarn" hidden></p>`;

      body.addEventListener("change", (e) => {
        const sel = e.target.closest("select[data-col]");
        if (!sel) return;
        const idx = Number(sel.dataset.col);
        const value = sel.value;
        // A field can only be filled from one column.
        if (value) mapping = mapping.map((m, i) => (i !== idx && m === value ? "" : m));
        mapping[idx] = value;
        for (const s of body.querySelectorAll("select[data-col]")) s.value = mapping[Number(s.dataset.col)] || "";
        validateMapping();
      });

      validateMapping();
    }

    function validateMapping() {
      const warn = body.querySelector("#mapWarn");
      const hasName = mapping.includes("name");
      const missing = [];
      if (!mapping.includes("power")) missing.push("power");
      if (!mapping.includes("interest")) missing.push("interest");
      if (!hasName) {
        warn.hidden = false;
        warn.innerHTML = "<strong>A name column is required.</strong> Pick which column holds the stakeholder names.";
      } else if (missing.length) {
        warn.hidden = false;
        warn.innerHTML = `No <strong>${missing.join("</strong> and <strong>")}</strong> column mapped. Those will default to ${missing.includes("power") ? "power 5" : ""}${missing.length === 2 ? " and " : ""}${missing.includes("interest") ? "interest 0 (neutral)" : ""} and you can score them afterwards.`;
      } else {
        warn.hidden = true;
      }
      next.disabled = !hasName;
    }

    /* ------------------------------------------------------------ step 3 */

    function drawPreview() {
      const { records, skipped, warnings } = rowsToStakeholderFields(parsed.rows, parsed.headers, mapping);
      next.textContent = `Import ${records.length} stakeholder${records.length === 1 ? "" : "s"}`;
      next.disabled = records.length === 0;

      body.innerHTML =
        steps() +
        `<p class="note tight">${records.length} will be imported${skipped ? `, ${skipped} skipped for having no name` : ""}.</p>
        ${
          warnings.length
            ? `<p class="warnline" style="display:block">${warnings.slice(0, 6).map(esc).join("<br>")}${warnings.length > 6 ? `<br>…and ${warnings.length - 6} more.` : ""}</p>`
            : ""
        }
        <div class="previewwrap"><table class="maptable"><thead><tr>
          <th>Name</th><th>Type</th><th>Power</th><th>Interest</th><th>Stance</th><th>Strategy</th>
        </tr></thead><tbody>
        ${records
          .slice(0, 200)
          .map((r) => {
            const st = stanceOf(r.interest);
            return `<tr>
              <td style="font-weight:600">${esc(r.name)}${r.isIndividual ? '<span class="person">person</span>' : ""}</td>
              <td class="typ">${esc(r.type)}</td>
              <td class="num">${r.power}${r._powerSupplied ? "" : '<span class="chip" style="margin-left:4px">default</span>'}</td>
              <td class="num">${signed(r.interest)}${r._interestSupplied ? "" : '<span class="chip" style="margin-left:4px">default</span>'}</td>
              <td style="color:var(--${st === "oppose" ? "oppose" : st === "ally" ? "ally" : "neutral"});font-weight:600">${stanceLabel(st)}</td>
              <td class="sample">${
                Object.values(r.strategy).some((v) => v.trim())
                  ? esc(truncate(r.strategy.objective || Object.values(r.strategy).find((v) => v.trim()), 40))
                  : '<em style="color:var(--faint)">none</em>'
              }</td>
            </tr>`;
          })
          .join("")}
        </tbody></table></div>
        ${records.length > 200 ? `<p class="note">Showing the first 200.</p>` : ""}
        ${
          records.some((r) => r.isIndividual)
            ? `<div class="caveat" style="margin-top:14px"><strong>Some of these look like named individuals.</strong>
               A written adverse assessment of an identifiable person is personal data with real obligations attached,
               including their right of access. Consider mapping the role or the institution instead. They are flagged
               so you can review them.</div>`
            : ""
        }`;
    }

    draw();
  }, { wide: true });
}
