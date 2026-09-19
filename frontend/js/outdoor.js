// Outdoor mode: high contrast for strong sun (css/outdoor.css). A per-phone setting, kept in this
// browser like the language; it applies before the first screen is drawn.
const KEY = 'agrilink.outdoor';

function stored() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
export let outdoor = stored();
if (typeof document !== 'undefined') document.documentElement.classList.toggle('outdoor', outdoor);

/** Switches outdoor mode and returns the new state. */
export function toggleOutdoor() {
  outdoor = !outdoor;
  document.documentElement.classList.toggle('outdoor', outdoor);
  try { localStorage.setItem(KEY, outdoor ? '1' : '0'); } catch { /* private mode: this visit only */ }
  return outdoor;
}
