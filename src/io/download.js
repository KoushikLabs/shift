/**
 * File downloads.
 *
 * This app is served as static files (or opened straight off disk), not inside
 * a sandboxed viewer, so a real `<a download>` works and the clipboard hack the
 * skill template needed is not required here. `copyText` remains as a fallback
 * for the rare browser that blocks programmatic downloads.
 */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next frame; revoking synchronously cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function downloadText(text, filename, mime = "text/plain;charset=utf-8") {
  // The BOM makes Excel open UTF-8 CSV correctly instead of mangling accents.
  const needsBom = mime.startsWith("text/csv");
  downloadBlob(new Blob([needsBom ? "\uFEFF" + text : text], { type: mime }), filename);
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

/** Slug safe for a filename on Windows, macOS and Linux. */
export function slug(text, fallback = "map") {
  const s = String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase()
    .slice(0, 60)
    .replace(/^-|-$/g, "");
  return s || fallback;
}

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("Could not read that file."));
    fr.readAsText(file);
  });
}
