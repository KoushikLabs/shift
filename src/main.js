/**
 * Shift — a stakeholder tracker that versions the score, the reasoning and the
 * engagement strategy together.
 *
 * Local-first, no accounts, no backend (SPEC 9). Everything lives in this
 * browser's IndexedDB; the only way data leaves the machine is an export the
 * user asks for. Built from the stakeholder-matrix Claude skill, whose scatter
 * plot and strategy-period derivation are ported rather than reinvented.
 *
 * MIT licensed.
 */

import "./styles.css";
import { init } from "./store.js";
import { mount, refreshInstallButton } from "./ui/app.js";
import { init as initPwa } from "./pwa.js";

const root = document.getElementById("app");
root.innerHTML = "";
mount(root);
init();

// Offline support and the Install button. Entirely optional — see src/pwa.js.
initPwa(refreshInstallButton);
