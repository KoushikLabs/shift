/**
 * The privacy notice and the participation agreement are static pages in
 * public/. They must load nothing from anywhere else (SPEC 10), link to each
 * other, and name a way to reach the controller.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const read = (f) => readFileSync(join(pub, f), "utf8");

describe.each(["privacy.html", "agreement.html"])("%s", (file) => {
  const html = read(file);

  it("runs no script and loads nothing from another site", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<(img|iframe|video|audio|source|embed|object)\b/i);
    for (const m of html.matchAll(/<link\b[^>]*href="([^"]*)"/gi)) expect(m[1]).toMatch(/^\.\//);
    expect(read("legal.css")).not.toMatch(/url\(|@import/i);
  });

  it("names the privacy contact and links back to the app", () => {
    expect(html).toContain("mailto:privacy@themelbarn.org");
    expect(html).toContain('href="./"');
  });

  it("is not indexed", () => {
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow">/);
  });
});

describe("the two pages", () => {
  it("link to each other", () => {
    expect(read("privacy.html")).toContain('href="./agreement.html"');
    expect(read("agreement.html")).toContain('href="./privacy.html"');
  });

  it("make no promise of backups while the service keeps none", () => {
    expect(read("privacy.html")).toMatch(/Backups<\/td><td[^>]*>None at present/);
    expect(read("agreement.html")).toContain("No backups are kept at present");
  });
});
