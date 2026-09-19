import { t, dateLocale } from './i18n/index.js';

// Every number on screen says where it came from and how old it is. When an upstream source
// (Agmarknet, Open-Meteo) is down, the server answers with its last stored copy marked `stale`;
// the farmer then sees that copy with a warning and its age, never a silent old price.
const PROVIDER = { agmarknet: 'Agmarknet', 'open-meteo': 'Open-Meteo' };

export function ago(iso, now = Date.now()) {
  const m = Math.max(0, (now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return '';
  if (m < 2) return t('just now');
  if (m < 60) return t('{n} min ago', { n: Math.floor(m) });
  if (m < 48 * 60) return t('{n} h ago', { n: Math.floor(m / 60) });
  return t('{n} days ago', { n: Math.floor(m / 1440) });
}

const day = (iso) => new Intl.DateTimeFormat(dateLocale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  .format(new Date(`${iso}T00:00:00Z`));

/**
 * `{ provider, source, date, fetchedAt, stale }` → `{ text, warn }`.
 * `date` is the day the figures are for (a mandi's price day); `fetchedAt` is when we got them.
 */
export function freshness({ provider, source, date, fetchedAt, stale } = {}) {
  if (source === 'sample' || source === 'demo') return { text: t('Sample data'), warn: true };
  const name = PROVIDER[provider] || provider || t('Database');
  if (stale) return { text: `⚠ ${name} · ${t('updated {ago}', { ago: fetchedAt ? ago(fetchedAt) : '?' })}`, warn: true };
  const when = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? day(date) : fetchedAt ? ago(fetchedAt) : '';
  return { text: when ? `${name} · ${when}` : name, warn: false };
}
