// UI translations. English text is the key: t('Settings') returns the string for the
// active language and falls back to the English text when a translation is missing.
// The language is fixed for a page load (read synchronously from localStorage), so screens
// may call t() at module level. Changing it stores the new code and reloads the page.
import hi from './hi.js';
import bn from './bn.js';
import vi from './vi.js';

export const LANGUAGES = [['en', 'English'], ['hi', 'हिन्दी'], ['bn', 'বাংলা'], ['vi', 'Tiếng Việt']];
const DICTIONARIES = { hi, bn, vi };
const KEY = 'agrilink.lang';

function stored() {
  try { const code = localStorage.getItem(KEY); return LANGUAGES.some(([c]) => c === code) ? code : 'en'; } catch { return 'en'; }
}
export const language = stored();
// Latin digits in every language: prices and quantities must read the same on every screen.
export const dateLocale = { en: 'en-GB', hi: 'hi-IN-u-nu-latn', bn: 'bn-BD-u-nu-latn', vi: 'vi-VN' }[language];
if (typeof document !== 'undefined') document.documentElement.lang = language;

export function t(text, vars) {
  const out = DICTIONARIES[language]?.[text] ?? text;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : out;
}

/** Switches the UI language. Reloads when it changes so every screen is rebuilt in it. */
export function setLanguage(code) {
  if (!LANGUAGES.some(([c]) => c === code) || code === language) return false;
  try { localStorage.setItem(KEY, code); } catch { return false; }
  location.reload();
  return true;
}
