import { t } from '../i18n/index.js';
import { getJSON } from '../api.js';
import { user, identity } from '../state.js';
import { money, h } from '../fmt.js';

// Prices follow the signed-in member: their region (a district resolves to its state on the
// server), the mandi nearest to their region centre as "your area", and their own crops first.
// Without a profile it falls back to the fixed demo region.
let crops = null, cropsFor = null, ci = 0, data = null, error = null, loading = false, lastIdx = 0;

const region = () => identity.profile?.regionCode || user.region;
const point = () => {
  const p = identity.profile;
  return p?.regionLat != null && p?.regionLng != null ? `&lat=${p.regionLat}&lng=${p.regionLng}` : '';
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m) => t(m));
function dataDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value || t('Unknown date');
  const [year, month, day] = value.split('-');
  return `${day} ${MONTHS[Number(month) - 1]} ${year}`;
}

function shortDate(value) {
  const [, month, day] = String(value).split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

function sourceLabel(source) {
  return source === 'agmarknet' ? t('Agmarknet (Govt of India)') : source || t('Database');
}

// Own crops first (in the member's order), then the rest alphabetically.
function orderCrops(items) {
  const mine = identity.profile?.cropCodes || [];
  const rank = (c) => (mine.includes(c.code) ? mine.indexOf(c.code) : mine.length);
  return [...items].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

async function load(ctx) {
  loading = true; error = null;
  try {
    if (cropsFor !== region()) {
      crops = orderCrops((await getJSON(`/api/prices/crops?region=${region()}`)).items);
      cropsFor = region(); ci = 0;
    }
    if (!crops.length) { data = null; error = t('No mandi prices for your area yet.'); }
    else data = await getJSON(`/api/prices?crop=${crops[ci].code}&region=${region()}${point()}`);
  } catch {
    data = null; error = t('Prices unavailable');
  }
  loading = false;
  ctx.rerender();
}

// The server sends this sentence in English with the percentage baked in.
function trendReason(reason) {
  const m = /^7-day price change: ([+-]?[\d.]+)%\./.exec(reason || '');
  return m ? t('7-day price change: {pct}%. This is market data, not advice.', { pct: `${Number(m[1]) >= 0 && !m[1].startsWith('+') ? '+' : ''}${m[1]}` }) : t(reason);
}

function switchCrop(ctx, delta) {
  if (!crops?.length) return;
  ci = (ci + delta + crops.length) % crops.length;
  data = null; error = null; lastIdx = 0;
  ctx.rerender(); // onShow reloads
}

export default {
  name: 'MarketPrices',
  title: 'Verified Prices',
  softCenter: { label: 'Detail' },
  initialFocus: () => lastIdx,
  onShow(ctx) {
    if (cropsFor !== region()) { data = null; error = null; } // another member signed in
    if (!data && !loading && !error) load(ctx);
  },
  onHide() { error = null; },
  render() {
    const wrap = h('list');
    const crop = h('item');
    const many = crops?.length > 1;
    crop.append(h('', crops?.length ? `${many ? '◄ ' : ''}${t(crops[ci].name)}${many ? ' ►' : ''}` : t('Crop')));
    wrap.appendChild(crop);

    if (!data) { wrap.appendChild(h('msg', error || t('Loading…'))); return wrap; }

    data.markets.forEach((m, i) => {
      const row = h('item');
      const arrow = m.change_pct > 0 ? '▲' : m.change_pct < 0 ? '▼' : '';
      // A market whose latest price is from another day than the home market says so.
      const when = m.days_from_home ? ` · ${shortDate(m.date)}` : '';
      const away = i > 0 && m.distance_km != null ? ` · ${m.distance_km}km` : '';
      // Home is "your area" only when it is near; otherwise it is the nearest mandi with a price today.
      const far = data.home_from_you_km > 25;
      const label = i > 0 ? `${m.name}${away}` : far ? `${t('Nearest')} · ${m.name} · ${data.home_from_you_km}km` : `${t('Your area')} · ${m.name}`;
      row.append(h('', label), h('dim', `${money(m.price, data.currency)}/${t('qt')} ${arrow}${when} · ${m.confidence?.grade || 'C'}`));
      wrap.appendChild(row);
    });
    const variety = data.variety && !['Common', 'Other', 'FAQ'].includes(data.variety) ? ` · ${data.variety}` : '';
    wrap.appendChild(h('msg dim', `${t('Latest verified:')} ${dataDate(data.date)} · ${sourceLabel(data.source)}${variety}`));
    wrap.appendChild(h('msg', `${t('Trend:')} ${trendReason(data.analysis.reason)}`));
    if (data.sample) wrap.appendChild(h('msg src-stale', t('Sample data'))); // shown on every screen size: judges and farmers must know
    return wrap;
  },
  onKey(action, ctx) {
    if (ctx.focus.index === 0 && (action === 'LEFT' || action === 'RIGHT')) {
      switchCrop(ctx, action === 'LEFT' ? -1 : 1);
      return true;
    }
    return false;
  },
  onEnter(_el, ctx, i) {
    if (i === 0 || !data) return;
    lastIdx = i;
    ctx.router.push('PriceDetail', { crop: crops[ci].code, cropLabel: crops[ci].name, market: data.markets[i - 1], home: data.home, region: region() });
  },
};
