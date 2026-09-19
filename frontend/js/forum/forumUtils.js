import { t } from '../i18n/index.js';
// Pure helpers for Farmer Circle screens. No DOM, no network.

export const COMMUNITIES = [
  { slug: 'crop-talk', name: t('Crop Talk') },
  { slug: 'machinery', name: t('Machinery') },
  { slug: 'market-talk', name: t('Market Talk') },
  { slug: 'livestock', name: t('Livestock') },
  { slug: 'farm-life', name: t('Farm Life') },
];
export const communityName = (slug) => COMMUNITIES.find((c) => c.slug === slug)?.name || slug;

export const SORTS = ['local', 'new', 'top'];
export const SORT_LABEL = { local: t('Local'), new: t('New'), top: t('Top') };
export const TYPE_LABEL = { question: t('Question'), discussion: t('Discussion'), local_report: t('User report') };
export const REASON_LABEL = {
  spam: t('Spam'), scam: t('Scam/payment request'), harassment: t('Harassment'),
  dangerous_advice: t('Dangerous advice'), false_information: t('False information'), other: t('Other'),
};
export const SCOPE_LABEL = { region: t('Near me'), country: t('My country'), global: t('Everywhere') };

export function relTime(iso, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return t('now');
  if (s < 3600) return t('{n}m', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n}h', { n: Math.floor(s / 3600) });
  if (s < 604800) return t('{n}d', { n: Math.floor(s / 86400) });
  return t('{n}w', { n: Math.floor(s / 604800) });
}

export const tagLabel = (slug) => t(slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' '));
export const plural = (n, one, many = `${one}s`) => t(n === 1 ? `{n} ${one}` : `{n} ${many}`, { n });
export const replies = (n) => plural(n, 'reply', 'replies');
export const scoreText = (n) => `${n < 0 ? '▼' : '▲'}${Math.abs(n)}`;

// Multi-tap gives lowercase only; capitalise sentence starts (or every word, for names).
export function autoCap(text, mode = 'sentence') {
  if (mode === 'none') return text;
  const re = mode === 'words' ? /(^|\s)(\p{Ll})/gu : /(^|[.!?]\s+|\n\n)(\p{Ll})/gu;
  return text.replace(re, (_m, pre, ch) => pre + ch.toUpperCase());
}


export function newRequestId() {
  try { if (globalThis.crypto?.randomUUID) return crypto.randomUUID(); } catch { /* insecure context */ }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

// UI branches on the stable error code; only server-authored hints (rate limits,
// validation text) are shown verbatim because they are already user-safe.
export function errorText(err) {
  switch (err?.code) {
    case 'OFFLINE': return t('No network. Check your signal.');
    case 'TIMEOUT': return t('Slow connection. Try again.');
    case 'AUTH_REQUIRED': return t('Please sign in.');
    case 'INVALID_CREDENTIALS': return t('Invalid Farm ID or PIN');
    case 'ACCOUNT_SUSPENDED': return t('This account is not active.');
    case 'FORBIDDEN': return err.message || t('Not allowed.');
    case 'NOT_FOUND': return t('Not found. It may have been removed.');
    case 'POST_LOCKED': return t('This post is locked.');
    case 'ALREADY_REPORTED': return t('Already reported. Thank you.');
    case 'VALIDATION_ERROR':
    case 'RATE_LIMITED':
    case 'ACCOUNT_LOCKED': return err.message;
    default: return t('Something went wrong. Try again.');
  }
}

// Splits text into pieces of at most `size` characters, breaking at paragraph ends
// first and then at spaces, so a long post can be read piece by piece on a tiny screen.
export function chunkText(text, size) {
  const out = [];
  for (const para of String(text).split(/\n{2,}/)) {
    let rest = para.trim();
    while (rest.length > size) {
      let cut = rest.lastIndexOf(' ', size);
      if (cut < size * 0.5) cut = size;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
  }
  return out.length ? out : [''];
}
