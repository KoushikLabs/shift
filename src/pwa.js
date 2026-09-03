/**
 * Progressive-web-app plumbing: service worker registration and the install
 * prompt.
 *
 * This is how Shift gets "installed" without installers. Chrome and Edge fire
 * `beforeinstallprompt` on an eligible page; accepting it puts a real icon in
 * the Start menu or Dock, opens the app in its own window with no browser
 * chrome, and keeps working offline. Safari 17+ does the same through
 * "Add to Dock", though it never fires the event, so the button simply does not
 * appear there.
 *
 * Everything here is optional and fails soft. Opened from a plain static server
 * with no service worker support, over http on a LAN, or in a browser that has
 * none of this — the app still works exactly as before. Nothing in the data
 * path depends on it.
 */

let deferredPrompt = null;
let onChange = () => {};

/** True when the browser has offered us an install prompt we can trigger. */
export function canInstall() {
  return deferredPrompt !== null;
}

/** True when already running as an installed app rather than a browser tab. */
export function isInstalled() {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: window-controls-overlay)").matches ||
      window.navigator.standalone === true
    );
  } catch (e) {
    return false;
  }
}

/**
 * Show the browser's install prompt. Must be called from a user gesture.
 * @returns {Promise<"accepted"|"dismissed"|"unavailable">}
 */
export async function promptInstall() {
  if (!deferredPrompt) return "unavailable";
  const prompt = deferredPrompt;
  deferredPrompt = null; // a prompt may only be used once
  onChange();
  try {
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    return outcome === "accepted" ? "accepted" : "dismissed";
  } catch (e) {
    return "dismissed";
  }
}

/** @param {() => void} listener called whenever install availability changes. */
export function init(listener) {
  onChange = listener || (() => {});

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // suppress the browser's own mini-infobar; we place our own button
    deferredPrompt = e;
    onChange();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    onChange();
  });

  registerServiceWorker();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // A service worker needs a secure context. localhost counts; a plain-http LAN
  // address does not, and that is a perfectly reasonable way to run this, so
  // failing silently is correct rather than alarming.
  if (!window.isSecureContext) return;

  window.addEventListener("load", () => {
    // Relative URL so this works at a subpath (…github.io/shift/) and at a
    // domain root alike. The scope follows the worker's own location.
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {
      /* offline support unavailable; the app is unaffected */
    });
  });
}
