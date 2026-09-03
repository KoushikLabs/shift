/**
 * Dialogs, built on <dialog> for its native modality — focus trapping, the
 * inert background and the backdrop come free.
 *
 * IMPORTANT: nothing here depends on the `close` event, and no dialog uses
 * `<form method="dialog">`.
 *
 * Both are the obvious way to write this, and both were wrong. In at least one
 * embedded Chromium (the one this was developed against) `dialog.close()` sets
 * `open` to false and sets `returnValue`, but never dispatches `close`. A modal
 * layer built on that event resolves its promise never: the user clicks
 * "Import 3 stakeholders", the dialog vanishes, and absolutely nothing happens
 * — no import, no error, no clue. That is the silent-failure mode SPEC 6.4
 * exists to prevent, so the resolution path is explicit instead.
 *
 * `finish()` is the single, idempotent exit. Every route into it is wired
 * directly: button clicks, backdrop clicks, Escape via keydown, plus `cancel`
 * and `close` listeners as belt and braces for engines where they do fire.
 */

import { esc } from "./dom.js";

let openDialog = null;

/**
 * @returns {{dlg: HTMLDialogElement, finish: (value:any)=>void, done: Promise<any>}}
 */
function build(innerHtml, { wide = false, onEscape = null } = {}) {
  const dlg = document.createElement("dialog");
  if (wide) dlg.className = "wide";
  dlg.innerHTML = innerHtml;
  document.body.appendChild(dlg);
  openDialog = dlg;

  let settle;
  let settled = false;
  const done = new Promise((res) => (settle = res));

  const finish = (value) => {
    if (settled) return;
    settled = true;
    try {
      if (dlg.open) dlg.close();
    } catch (e) {
      /* already closing */
    }
    dlg.remove();
    if (openDialog === dlg) openDialog = null;
    settle(value);
  };

  // Escape: handle it ourselves so the resolution does not ride on `cancel`.
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      finish(onEscape ? onEscape() : null);
    }
  });
  // Fallbacks for engines that do dispatch these.
  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    finish(onEscape ? onEscape() : null);
  });
  dlg.addEventListener("close", () => finish(onEscape ? onEscape() : null));

  // Backdrop click closes; clicks inside the panel do not.
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) finish(onEscape ? onEscape() : null);
  });

  return { dlg, finish, done };
}

function show(dlg) {
  try {
    dlg.showModal();
  } catch (e) {
    // Already-open or unsupported: fall back to a non-modal open so the dialog
    // is at least usable rather than invisible.
    dlg.setAttribute("open", "");
  }
  const first = dlg.querySelector("[data-autofocus]") || dlg.querySelector("input,textarea,select,button");
  if (first) first.focus();
}

/** Wire every [data-close] button to finish with its value. */
function wireCloseButtons(dlg, finish, map) {
  for (const b of dlg.querySelectorAll("[data-close]")) {
    b.addEventListener("click", (e) => {
      e.preventDefault();
      finish(map(b.dataset.close));
    });
  }
}

/* ---------------------------------------------------------------- confirm */

export function confirmDialog({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
  const { dlg, finish, done } = build(`<div class="dlg">
      <div class="dlghead"><h2>${esc(title)}</h2></div>
      <div class="dlgbody">${body}</div>
      <div class="dlgfoot">
        <button type="button" data-close="cancel">${esc(cancelLabel)}</button>
        <button type="button" data-close="ok" class="${danger ? "danger" : "primary"}" data-autofocus>${esc(confirmLabel)}</button>
      </div>
    </div>`, { onEscape: () => false });
  wireCloseButtons(dlg, finish, (v) => v === "ok");
  show(dlg);
  return done;
}

export function alertDialog({ title, body, label = "OK" }) {
  const { dlg, finish, done } = build(`<div class="dlg">
      <div class="dlghead"><h2>${esc(title)}</h2></div>
      <div class="dlgbody">${body}</div>
      <div class="dlgfoot"><button type="button" data-close="ok" class="primary" data-autofocus>${esc(label)}</button></div>
    </div>`, { onEscape: () => true });
  wireCloseButtons(dlg, finish, () => true);
  show(dlg);
  return done;
}

/**
 * A dialog with several named outcomes. Returns the chosen key, or null if the
 * user escaped, clicked the backdrop, or chose an option marked `cancel`.
 *
 * Exists because overloading a Cancel button with a second real action is a
 * trap: Escape and a backdrop click then perform it too. If there are three
 * outcomes, show three buttons.
 */
export function choiceDialog({ title, body, options }) {
  const buttons = options
    .map(
      (o) =>
        `<button type="button" data-close="${esc(o.key)}" class="${o.danger ? "danger" : o.primary ? "primary" : ""}"${
          o.primary ? " data-autofocus" : ""
        }>${esc(o.label)}</button>`
    )
    .join("");
  const { dlg, finish, done } = build(
    `<div class="dlg">
      <div class="dlghead"><h2>${esc(title)}</h2></div>
      <div class="dlgbody">${body}</div>
      <div class="dlgfoot">${buttons}</div>
    </div>`,
    { onEscape: () => null }
  );
  wireCloseButtons(dlg, finish, (v) => {
    const opt = options.find((o) => o.key === v);
    return opt && opt.cancel ? null : v;
  });
  show(dlg);
  return done;
}

/* ------------------------------------------------------------------- form */

/**
 * Generic form dialog. Resolves to an object of field values, or null if cancelled.
 * @param fields [{key, label, hint, type:"text"|"textarea"|"checkbox"|"range"|"select", value, options, rows, min, max, required, placeholder}]
 */
export function formDialog({ title, intro, fields, submitLabel = "Save", extraHtml = "", onInput }) {
  const body = fields
    .map((f) => {
      const id = "f-" + f.key;
      if (f.type === "checkbox") {
        return `<label class="ack" style="margin:0 0 14px">
            <input type="checkbox" id="${id}" ${f.value ? "checked" : ""}>
            <span>${esc(f.label)}${f.hint ? `<br><span class="fhint" style="font-style:normal">${esc(f.hint)}</span>` : ""}</span></label>`;
      }
      const control =
        f.type === "textarea"
          ? `<textarea id="${id}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || "")}">${esc(f.value || "")}</textarea>`
          : f.type === "select"
            ? `<select id="${id}">${(f.options || [])
                .map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? "selected" : ""}>${esc(o.label)}</option>`)
                .join("")}</select>`
            : f.type === "range"
              ? `<div class="row" style="display:flex;align-items:center;gap:10px">
                     <input type="range" id="${id}" min="${f.min}" max="${f.max}" step="1" value="${f.value}" style="flex:1">
                     <span class="v" id="${id}-v" style="font-family:var(--font-mono);font-weight:700;min-width:2.6em;text-align:right">${f.value}</span></div>
                   <div class="scaleband" id="${id}-band"></div>`
              : `<input type="text" id="${id}" value="${esc(f.value || "")}" placeholder="${esc(f.placeholder || "")}">`;
      return `<fieldset>
          <span class="flabel">${esc(f.label)}</span>
          ${f.hint ? `<p class="fhint">${esc(f.hint)}</p>` : ""}
          ${control}
        </fieldset>`;
    })
    .join("");

  const { dlg, finish, done } = build(`<div class="dlg">
      <div class="dlghead"><h2>${esc(title)}</h2>${intro ? `<p>${esc(intro)}</p>` : ""}</div>
      <div class="dlgbody">${body}${extraHtml}</div>
      <div class="dlgfoot">
        <span class="status" id="formStatus"></span>
        <button type="button" data-close="cancel">Cancel</button>
        <button type="button" data-close="ok" class="primary" id="formSubmit">${esc(submitLabel)}</button>
      </div>
    </div>`, { onEscape: () => null });

  const read = () => {
    const out = {};
    for (const f of fields) {
      const el = dlg.querySelector("#f-" + f.key);
      if (!el) continue;
      out[f.key] = f.type === "checkbox" ? el.checked : f.type === "range" ? Number(el.value) : el.value;
    }
    return out;
  };

  const submitBtn = dlg.querySelector("#formSubmit");
  const validate = () => {
    const v = read();
    submitBtn.disabled = fields.some((f) => f.required && !String(v[f.key] ?? "").trim());
    if (onInput) onInput(v, dlg);
    return v;
  };

  wireCloseButtons(dlg, finish, (v) => (v === "ok" ? read() : null));

  dlg.addEventListener("input", (e) => {
    const t = e.target;
    if (t.type === "range") {
      const disp = dlg.querySelector("#" + CSS.escape(t.id) + "-v");
      if (disp) disp.textContent = Number(t.value) > 0 && Number(t.min) < 0 ? "+" + t.value : t.value;
    }
    validate();
  });
  dlg.addEventListener("change", validate);

  // Enter submits from a single-line field; Ctrl/Cmd+Enter submits from anywhere.
  dlg.addEventListener("keydown", (e) => {
    const single = e.target.tagName === "INPUT" && e.target.type === "text";
    if (e.key === "Enter" && (single || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!submitBtn.disabled) finish(read());
    }
  });

  show(dlg);
  validate();
  return done;
}

/* ------------------------------------------------------------ custom shell */

/**
 * Escape hatch for dialogs with their own logic (the CSV wizard).
 * `render(dlg, close)` populates the dialog; call `close(value)` to resolve.
 * `close(null)` / Escape / backdrop all resolve to null.
 */
export function customDialog(render, { wide = false } = {}) {
  const { dlg, finish, done } = build("", { wide, onEscape: () => null });
  render(dlg, finish);
  show(dlg);
  return done;
}

export function closeAll() {
  if (openDialog) {
    const d = openDialog;
    openDialog = null;
    try {
      if (d.open) d.close();
    } catch (e) {
      /* ignore */
    }
    d.remove();
  }
}
