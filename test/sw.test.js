import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Tests for public/sw.js.
 *
 * The registration call is three lines of standard API. The caching *strategy*
 * is the part that can quietly ruin things: a cache-first navigation handler
 * pins every user to whichever build they first loaded, forever, with no
 * symptom except that fixes never arrive. So the worker is loaded into a fake
 * ServiceWorkerGlobalScope here and its handlers are exercised directly.
 */

const SW_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sw.js"),
  "utf8"
);

const BASE = "https://example.org/shift/";

/* ------------------------------------------------------------- fake scope */

const keyOf = (req) => new URL(typeof req === "string" ? req : req.url, BASE).href;

/**
 * A real ServiceWorkerGlobalScope resolves relative Request URLs against the
 * worker's location; Node's Request rejects them outright. sw.js only ever
 * reads `url`, `method` and `mode`, so this stands in for the real thing.
 */
class FakeRequest {
  constructor(input, init = {}) {
    this.url = typeof input === "string" ? new URL(input, BASE).href : input.url;
    this.method = String(init.method || (input && input.method) || "GET").toUpperCase();
    this.mode = init.mode || (input && input.mode) || "no-cors";
  }
}

class MockCache {
  constructor() {
    this.store = new Map();
  }
  async put(req, res) {
    this.store.set(keyOf(req), res);
  }
  async match(req) {
    return this.store.get(keyOf(req));
  }
  async add(req) {
    const res = await globalThis.__swFetch(req);
    if (!res || !res.ok) throw new Error("add failed: " + keyOf(req));
    await this.put(req, res);
  }
  async keys() {
    return [...this.store.keys()].map((u) => new FakeRequest(u));
  }
}

class MockCacheStorage {
  constructor() {
    this.caches = new Map();
  }
  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new MockCache());
    return this.caches.get(name);
  }
  async keys() {
    return [...this.caches.keys()];
  }
  async delete(name) {
    return this.caches.delete(name);
  }
}

function makeScope({ fetchImpl }) {
  const handlers = {};
  const calls = { skipWaiting: 0, claim: 0 };
  const self = {
    location: new URL(BASE + "sw.js"),
    registration: { scope: BASE },
    addEventListener: (type, fn) => {
      (handlers[type] = handlers[type] || []).push(fn);
    },
    skipWaiting: async () => {
      calls.skipWaiting++;
    },
    clients: {
      claim: async () => {
        calls.claim++;
      },
    },
  };
  const cacheStorage = new MockCacheStorage();
  globalThis.__swFetch = fetchImpl;

  // sw.js references `self`, `caches`, `fetch`, `Request`, `Response`, `URL`.
  const load = new Function("self", "caches", "fetch", "Request", "Response", "URL", SW_SOURCE);
  load(self, cacheStorage, fetchImpl, FakeRequest, Response, URL);

  const dispatch = async (type, event) => {
    const waits = [];
    const ev = {
      ...event,
      waitUntil: (p) => waits.push(p),
      respondWith: (p) => (ev._response = p),
    };
    for (const fn of handlers[type] || []) await fn(ev);
    await Promise.all(waits);
    return ev._response ? await ev._response : undefined;
  };

  return { self, cacheStorage, dispatch, calls, handlers };
}

const req = (url, init) => new FakeRequest(url, init);
const navRequest = (url = "./") => new FakeRequest(url, { mode: "navigate" });
const ok = (body, type = "text/html") => new Response(body, { status: 200, headers: { "content-type": type } });

/* -------------------------------------------------------------------- run */

describe("service worker — install", () => {
  it("precaches the application shell", async () => {
    const seen = [];
    const { dispatch, cacheStorage, calls } = makeScope({
      fetchImpl: async (r) => {
        seen.push(keyOf(r));
        return ok("shell");
      },
    });
    await dispatch("install", {});
    const names = await cacheStorage.keys();
    expect(names).toHaveLength(1);
    const cache = await cacheStorage.open(names[0]);
    const cached = (await cache.keys()).map((r) => new URL(r.url).pathname);
    expect(cached).toContain("/shift/index.html");
    expect(cached).toContain("/shift/manifest.webmanifest");
    expect(cached).toContain("/shift/icon-512.png");
    expect(calls.skipWaiting).toBe(1);
  });

  it("still installs when an optional file is missing", async () => {
    // addAll would reject the whole install on one 404 and leave the user with
    // no offline copy at all. Each entry is added independently for that reason.
    const { dispatch, cacheStorage } = makeScope({
      fetchImpl: async (r) =>
        keyOf(r).endsWith("icon-maskable-512.png") ? new Response("nope", { status: 404 }) : ok("shell"),
    });
    await dispatch("install", {});
    const cache = await cacheStorage.open((await cacheStorage.keys())[0]);
    const cached = (await cache.keys()).map((r) => new URL(r.url).pathname);
    expect(cached).toContain("/shift/index.html");
    expect(cached).not.toContain("/shift/icon-maskable-512.png");
  });
});

describe("service worker — activate", () => {
  it("deletes caches from previous versions and claims clients", async () => {
    const { dispatch, cacheStorage, calls } = makeScope({ fetchImpl: async () => ok("x") });
    await cacheStorage.open("shift-v0-old");
    await cacheStorage.open("unrelated-cache");
    await dispatch("install", {});
    await dispatch("activate", {});
    const names = await cacheStorage.keys();
    expect(names).toEqual(["shift-v1"]);
    expect(calls.claim).toBe(1);
  });
});

describe("service worker — fetch strategy", () => {
  it("serves navigations from the network when online, so updates actually arrive", async () => {
    let served = "OLD BUILD";
    const s = makeScope({ fetchImpl: async () => ok(served) });
    await s.dispatch("install", {});

    served = "NEW BUILD";
    const out = await s.dispatch("fetch", { request: navRequest() });
    expect(await out.text()).toBe("NEW BUILD");

    // …and the fresh copy replaced the cached one, so the fallback is not stale.
    const cache = await s.cacheStorage.open("shift-v1");
    expect(await (await cache.match("./index.html")).text()).toBe("NEW BUILD");
  });

  it("falls back to the cached page when the network is gone", async () => {
    let online = true;
    const s = makeScope({
      fetchImpl: async () => {
        if (!online) throw new TypeError("Failed to fetch");
        return ok("CACHED BUILD");
      },
    });
    await s.dispatch("install", {});
    online = false;
    const out = await s.dispatch("fetch", { request: navRequest() });
    expect(await out.text()).toBe("CACHED BUILD");
  });

  it("serves assets from cache first, so they survive the network going away", async () => {
    let online = true;
    const s = makeScope({
      fetchImpl: async () => {
        if (!online) throw new TypeError("Failed to fetch");
        return ok("icon-bytes", "image/png");
      },
    });
    await s.dispatch("install", {});
    online = false; // any network attempt now throws
    const out = await s.dispatch("fetch", { request: req("./icon-192.png") });
    expect(await out.text()).toBe("icon-bytes");
  });

  it("ignores non-GET requests entirely", async () => {
    const s = makeScope({ fetchImpl: async () => ok("x") });
    await s.dispatch("install", {});
    const out = await s.dispatch("fetch", { request: req("./", { method: "POST" }) });
    expect(out).toBeUndefined();
  });

  it("ignores cross-origin requests entirely", async () => {
    const s = makeScope({ fetchImpl: async () => ok("x") });
    await s.dispatch("install", {});
    const out = await s.dispatch("fetch", { request: new FakeRequest("https://elsewhere.example/thing.js", { mode: "cors" }) });
    expect(out).toBeUndefined();
  });

  it("never caches anything the user typed — only the shell", async () => {
    const s = makeScope({ fetchImpl: async () => ok("x") });
    await s.dispatch("install", {});
    const cache = await s.cacheStorage.open("shift-v1");
    const paths = (await cache.keys()).map((r) => new URL(r.url).pathname);
    // The shell and nothing else. User data lives in IndexedDB, which a service
    // worker cannot see and this one never touches.
    expect(paths.every((p) => p.startsWith("/shift/"))).toBe(true);
    expect(paths.length).toBeLessThanOrEqual(8);
  });
});
