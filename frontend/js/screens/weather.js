import { getJSON } from '../api.js';
import { user } from '../state.js';
import { t } from '../i18n/index.js';
import { freshness } from '../freshness.js';

// WMO weather_code -> [emoji, text label]. Text label is the fallback if the
// handset font lacks emoji glyphs.
export function wmo(code) {
  if (code === 0) return ['☀️', t('Clear')];
  if (code <= 3) return ['⛅', t('Cloudy')];
  if (code === 45 || code === 48) return ['🌫️', t('Fog')];
  if (code >= 51 && code <= 67) return ['🌧️', t('Rain')];
  if (code >= 71 && code <= 77) return ['❄️', t('Snow')];
  if (code >= 80 && code <= 82) return ['🌦️', t('Showers')];
  if (code >= 95) return ['⛈️', t('Storm')];
  return ['☁️', t('Cloud')];
}
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => t(d));
const dayName = (iso, i) => (i === 0 ? t('Today') : DAY[new Date(iso + 'T00:00:00').getDay()]);

let data = null;
let error = null;
let loading = false;
let tried = false;
let detail = false;

function el(cls, text) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  return d;
}

async function load(ctx) {
  loading = true; tried = true; error = null;
  try {
    const { lat, lng } = user.location;
    data = await getJSON(`/api/weather?lat=${lat}&lng=${lng}`);
  } catch {
    error = t('Weather unavailable');
  }
  loading = false;
  ctx.rerender();
}

export default {
  name: 'Weather',
  title: 'Weather',
  softCenter: { label: 'Detail' },
  onShow(ctx) { if (!data && !loading && !tried) load(ctx); },
  render() {
    const wrap = el('list');
    if (loading && !data) return el('msg', t('Loading…'));
    if (!data) return el('msg', error || t('Loading…'));

    const today = data.daily[0];
    const [icon, label] = wmo(data.current.code);
    const head = el('', null);
    head.style.padding = 'var(--pad)';
    head.append(
      el('', `📍 ${t(user.location.name)}  * ▸`),
      el('big', `${data.current.temp}°C`),
      el('', `${icon} ${label} · ${t('Rain')} ${today.rain_prob}%`),
    );
    wrap.appendChild(head);

    data.daily.slice(0, 7).forEach((d, i) => {
      const [ic, lb] = wmo(d.code);
      const row = el('item');
      row.append(
        el('', dayName(d.date, i)),
        el('', `${ic} ${lb}`),
        el('dim hide-small', `${d.tmin}-${d.tmax}° ${d.rain_prob}%`),
      );
      row.dataset.i = i;
      wrap.appendChild(row);
    });

    const d = data.daily[this._sel ?? 0];
    if (detail) {
      wrap.appendChild(el('msg', `${t('Rain')} ${d.rain_mm}mm · ET0 ${d.et0}mm · ${d.tmin}-${d.tmax}°C`));
    } else {
      // Same rules and words as Today's Farm (the server builds both from sprayAssessment).
      const a = data.advice, w = a.bestWindow;
      wrap.appendChild(el(`msg wx-spray wx-${a.action}`, `${t('SPRAY')}: ${t(a.action.toUpperCase())} · ${t(a.reason)}`));
      wrap.appendChild(el('msg dim hide-small', w ? t('Best window {from}–{to} ({hours} h).', w) : t('No safe spray window left today.')));
    }
    // Source and age always show (small screens too): a stale forecast must never pass as today's.
    const f = freshness({ provider: 'open-meteo', ...data });
    wrap.appendChild(el(f.warn ? 'msg src-stale' : 'msg dim', f.text));
    return wrap;
  },
  onKey(action, ctx) {
    if (action === 'STAR') {
      user.nextLocation();
      data = null; error = null; tried = false;
      ctx.rerender();
      return true;
    }
    if (action === 'LEFT' || action === 'RIGHT') {
      ctx.focus.move(action === 'LEFT' ? -1 : 1);
      return true;
    }
    return false;
  },
  onEnter(_el, ctx, i) {
    detail = !detail;
    this._sel = i;
    ctx.rerender();
    ctx.focus.set(i);
  },
  // Refetch on every visit (the server caches for 30 min): the forecast and the signed-in member may have changed.
  onHide() { detail = false; tried = false; data = null; },
};
