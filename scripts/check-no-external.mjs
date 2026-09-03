/**
 * Fails the build if the page would load anything from a third party.
 *
 *   node scripts/check-no-external.mjs [path-to-html]
 *
 * SPEC 10 is "private by architecture". A stray CDN font or analytics tag would
 * leak, on every single page view, the fact that someone is using a stakeholder
 * tool — and their IP — to a company that has nothing to do with them. That is
 * worth a release blocker rather than a code review comment.
 *
 * Why this is not just `grep -o 'https\?://'`:
 *
 * The first version of this check was exactly that, and it failed the moment
 * the Supabase SDK arrived — on three github.com links inside error-message
 * strings and a `localhost:9999` default. None of those is a request. A URL
 * appearing in a JavaScript string is not a URL the browser fetches, and a
 * check that cannot tell the difference gets switched off the first time it
 * cries wolf, which is worse than having no check.
 *
 * So this looks at what the browser can actually be made to load:
 *
 *   1. Subresource attributes in the markup (src, href, srcset, poster, action).
 *      These must be relative, data:, or a fragment.
 *   2. A denylist of hosts that only ever appear when someone has added a font,
 *      a CDN or a tracker — checked anywhere in the file, string or not.
 *
 * Anything else absolute is reported for a human to glance at, not failed on.
 */

import { readFileSync } from "node:fs";

const file = process.argv[2] || "dist/index.html";
const html = readFileSync(file, "utf8");

/** Hosts that have no legitimate reason to appear in this bundle, ever. */
const DENY = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "unpkg.com",
  "ajax.googleapis.com",
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.net",
  "hotjar.com",
  "segment.com",
  "sentry.io",
  "mixpanel.com",
  "plausible.io",
  "posthog.com",
];

/** Origins the app is designed to talk to. Empty unless a backend was configured. */
const allowed = new Set();
const backend = (process.env.VITE_SUPABASE_URL || "").trim();
if (backend) {
  try {
    allowed.add(new URL(backend).origin);
  } catch (e) {
    console.error(`VITE_SUPABASE_URL is not a valid URL: ${backend}`);
    process.exit(1);
  }
}

const problems = [];

/* 1. Anything the markup tells the browser to load. */
const ATTR = /\s(?:src|href|srcset|poster|action|data-src)\s*=\s*("([^"]*)"|'([^']*)')/gi;
for (const m of html.matchAll(ATTR)) {
  const value = (m[2] ?? m[3] ?? "").trim();
  if (!value) continue;
  if (/^(#|\/|\.|data:|blob:|mailto:|javascript:)/i.test(value)) continue;
  if (!/^https?:\/\//i.test(value)) continue; // relative path
  let origin;
  try {
    origin = new URL(value).origin;
  } catch (e) {
    continue;
  }
  if (allowed.has(origin)) continue;
  problems.push(`loads a subresource from ${origin}  →  ${value.slice(0, 120)}`);
}

/* 2. Hosts that are never innocent. */
for (const host of DENY) {
  if (html.includes(host)) problems.push(`references ${host}, which this page must never contact`);
}

/* 3. Everything else absolute: informational only. */
const others = new Set();
for (const m of html.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) {
  let origin;
  try {
    origin = new URL(m[0]).origin;
  } catch (e) {
    continue;
  }
  if (origin === "http://www.w3.org" || origin === "https://www.w3.org") continue; // XML namespaces
  if (allowed.has(origin)) continue;
  others.add(origin);
}

console.log(`Checked ${file} (${(html.length / 1024).toFixed(0)} KB)`);
if (allowed.size) console.log(`Permitted backend origin: ${[...allowed].join(", ")}`);
if (others.size) {
  console.log("\nURL strings present but not loaded as subresources (documentation and error text):");
  for (const o of [...others].sort()) console.log(`  · ${o}`);
}

if (problems.length) {
  console.error("\nFAILED — this build would contact a third party:\n");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("\nSee SPEC 10: private by architecture.\n");
  process.exit(1);
}

console.log("\nNo third-party subresources. The page loads only itself" + (allowed.size ? " and its configured backend." : "."));
