/**
 * PNG export of the map (SPEC 7 MVP).
 *
 * The awkward part: the live SVG is styled with CSS custom properties
 * (`fill="var(--ally)"`) and an external webfont. Neither survives being
 * serialised and rasterised — an SVG loaded into an <img> is an isolated
 * document with no access to the page's stylesheet, no cascade, and no network
 * for fonts. So before serialising we walk the live tree and the clone in
 * lockstep, baking every computed paint and text property onto the clone as an
 * inline style, and swap the webfont for a system stack.
 */

const BAKED_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "opacity",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-anchor",
  "text-transform",
  "dominant-baseline",
];

const SYSTEM_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';

/**
 * @param {SVGSVGElement} svg   the live, rendered map
 * @param {object} opts         {scale, background, title, subtitle}
 * @returns {Promise<Blob>}
 */
export async function svgToPngBlob(svg, opts = {}) {
  const scale = opts.scale || 2;
  const vb = svg.viewBox.baseVal;
  const width = vb && vb.width ? vb.width : svg.clientWidth || 900;
  const height = vb && vb.height ? vb.height : svg.clientHeight || 540;

  const clone = svg.cloneNode(true);
  bakeStyles(svg, clone);

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("font-family", SYSTEM_STACK);
  clone.removeAttribute("class");
  clone.style.cssText = "";

  // Opaque ground, so the PNG is legible when dropped into a light document
  // even if it was exported from the dark theme.
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(height));
  bg.setAttribute("fill", opts.background || "#FFFFFF");
  clone.insertBefore(bg, clone.firstChild);

  const caption = buildCaption(opts, width, height);
  if (caption) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height + caption.height}`);
    clone.setAttribute("height", String(height + caption.height));
    bg.setAttribute("height", String(height + caption.height));
    clone.appendChild(caption.node);
  }

  const totalHeight = caption ? height + caption.height : height;
  const source = '<?xml version="1.0" standalone="no"?>\n' + new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));

  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(totalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = opts.background || "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Walk live and cloned trees together, copying resolved styles onto the clone. */
function bakeStyles(liveRoot, cloneRoot) {
  const live = [liveRoot, ...liveRoot.querySelectorAll("*")];
  const copy = [cloneRoot, ...cloneRoot.querySelectorAll("*")];
  const n = Math.min(live.length, copy.length);
  for (let i = 0; i < n; i++) {
    const cs = getComputedStyle(live[i]);
    const target = copy[i];
    const decls = [];
    for (const prop of BAKED_PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v && v !== "none" && v !== "normal" && v !== "auto") decls.push(`${prop}:${v}`);
    }
    decls.push(`font-family:${SYSTEM_STACK}`);
    target.setAttribute("style", decls.join(";"));
    target.removeAttribute("class");
  }
}

function buildCaption(opts, width, height) {
  const title = String(opts.title || "").trim();
  const subtitle = String(opts.subtitle || "").trim();
  if (!title && !subtitle) return null;
  const NS = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(NS, "g");
  const h = subtitle ? 46 : 30;

  const rule = document.createElementNS(NS, "line");
  rule.setAttribute("x1", "24");
  rule.setAttribute("x2", String(width - 24));
  rule.setAttribute("y1", String(height + 2));
  rule.setAttribute("y2", String(height + 2));
  rule.setAttribute("style", `stroke:${opts.rule || "#D9E1E8"};stroke-width:1`);
  g.appendChild(rule);

  if (title) {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", "24");
    t.setAttribute("y", String(height + 20));
    t.setAttribute("style", `fill:${opts.ink || "#0F1720"};font-size:13px;font-weight:600;font-family:${SYSTEM_STACK}`);
    t.textContent = title;
    g.appendChild(t);
  }
  if (subtitle) {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", "24");
    t.setAttribute("y", String(height + (title ? 36 : 20)));
    t.setAttribute("style", `fill:${opts.muted || "#5C6E7C"};font-size:10.5px;font-family:${SYSTEM_STACK}`);
    t.textContent = subtitle;
    g.appendChild(t);
  }
  return { node: g, height: h };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "sync";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The map could not be rendered to an image in this browser."));
    img.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the PNG."))), "image/png");
    } else {
      try {
        const data = canvas.toDataURL("image/png").split(",")[1];
        const bin = atob(data);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        resolve(new Blob([buf], { type: "image/png" }));
      } catch (e) {
        reject(new Error("Could not encode the PNG."));
      }
    }
  });
}

/** Read the current theme's tokens so the PNG matches what is on screen. */
export function themeColours() {
  const cs = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => (cs.getPropertyValue(name) || "").trim() || fallback;
  return {
    background: pick("--surface", "#FFFFFF"),
    ink: pick("--ink", "#0F1720"),
    muted: pick("--muted", "#5C6E7C"),
    rule: pick("--rule", "#D9E1E8"),
  };
}
