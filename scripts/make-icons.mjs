/**
 * Generates the PWA icons.
 *
 * Writes real PNGs with nothing but Node's zlib — no image library, no native
 * binary, no network. An icon set is not worth a dependency tree, and this repo
 * is meant to stay installable by someone with only Node.
 *
 * The mark: three dots climbing left-to-right through opponent → neutral → ally,
 * joined by a dotted trail. It is the product in one glyph — a stakeholder
 * moving across stances, with the trail showing where they started.
 *
 *   node scripts/make-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

/* ------------------------------------------------------------ PNG encoding */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** @param {Uint8Array} rgba length = w*h*4 */
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --------------------------------------------------------------- drawing */

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

const GROUND = hex("#0F1720"); // --ink, the dark ground
const ALLY = hex("#2E9E8C");
const NEUTRAL = hex("#D9A648");
const OPPOSE = hex("#D2694A");
const TRAIL = hex("#3A4650");

function canvas(size, bg) {
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = bg[0];
    px[i * 4 + 1] = bg[1];
    px[i * 4 + 2] = bg[2];
    px[i * 4 + 3] = 255;
  }
  return px;
}

/** Alpha-blend a colour into one pixel. */
function blend(px, size, x, y, colour, alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= size || y >= size) return;
  const a = Math.min(1, alpha);
  const i = (y * size + x) * 4;
  px[i] = Math.round(px[i] * (1 - a) + colour[0] * a);
  px[i + 1] = Math.round(px[i + 1] * (1 - a) + colour[1] * a);
  px[i + 2] = Math.round(px[i + 2] * (1 - a) + colour[2] * a);
}

/** Antialiased filled disc. */
function disc(px, size, cx, cy, r, colour) {
  const lo = Math.max(0, Math.floor(cx - r - 2));
  const hi = Math.min(size - 1, Math.ceil(cx + r + 2));
  const lo2 = Math.max(0, Math.floor(cy - r - 2));
  const hi2 = Math.min(size - 1, Math.ceil(cy + r + 2));
  for (let y = lo2; y <= hi2; y++) {
    for (let x = lo; x <= hi; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      blend(px, size, x, y, colour, r - d + 0.5);
    }
  }
}

/** Dashed line from a to b — the movement trail. */
function dashedLine(px, size, x1, y1, x2, y2, colour, width, dash, gap) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(len * 2);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const along = t * len;
    if (along % (dash + gap) > dash) continue;
    disc(px, size, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, width / 2, colour);
  }
}

/**
 * @param inset fraction of the canvas kept clear around the mark. Maskable
 *   icons are cropped to a circle by the OS, so their content must sit inside
 *   the middle 80%.
 */
function drawMark(size, inset) {
  const px = canvas(size, GROUND);
  const pad = size * inset;
  const span = size - pad * 2;
  const at = (fx, fy) => [pad + fx * span, pad + fy * span];

  const [x1, y1] = at(0.14, 0.84);
  const [x2, y2] = at(0.5, 0.5);
  const [x3, y3] = at(0.86, 0.16);

  dashedLine(px, size, x1, y1, x3, y3, TRAIL, span * 0.028, span * 0.05, span * 0.04);

  disc(px, size, x1, y1, span * 0.085, OPPOSE);
  disc(px, size, x2, y2, span * 0.105, NEUTRAL);
  disc(px, size, x3, y3, span * 0.135, ALLY);

  return px;
}

/* -------------------------------------------------------------------- run */

mkdirSync(OUT, { recursive: true });

const outputs = [
  ["icon-192.png", 192, 0.14],
  ["icon-512.png", 512, 0.14],
  ["icon-maskable-512.png", 512, 0.22], // extra padding for the OS circle crop
  ["apple-touch-icon.png", 180, 0.14],
  ["favicon-32.png", 32, 0.1],
];

for (const [name, size, inset] of outputs) {
  const png = encodePng(drawMark(size, inset), size, size);
  writeFileSync(join(OUT, name), png);
  console.log(`${name.padEnd(26)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
