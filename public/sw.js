/*
 * Service worker — offline support and installability.
 *
 * Strategy, and why:
 *
 *   Navigations  -> network first, cache as fallback.
 *   Everything   -> cache first, refreshed in the background.
 *
 * A tool whose whole claim is "the record is being kept" must not serve a stale
 * build to someone who is online: an old bundle reading a newer IndexedDB schema
 * is exactly the kind of quiet wrongness this project refuses elsewhere. So the
 * page itself is always fetched fresh when the network allows, and the cache is
 * strictly a fallback for being offline.
 *
 * The worker never touches IndexedDB. User data is not cached, not synced and
 * not sent anywhere — the cache holds the application shell and nothing else.
 */

const VERSION = "shift-v1";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      // addAll fails the whole install if any single file 404s; add individually
      // so a missing optional icon cannot leave the app with no offline copy.
      await Promise.all(
        SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {}))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // nothing cross-origin is ever requested

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(VERSION);
          cache.put("./index.html", fresh.clone());
          return fresh;
        } catch (e) {
          const cache = await caches.open(VERSION);
          return (await cache.match("./index.html")) || (await cache.match("./")) || Response.error();
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      return hit || (await network) || Response.error();
    })()
  );
});

// Lets the page trigger an immediate update instead of waiting for a reload.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});
