import { t, dateLocale } from '../i18n/index.js';
import { el } from '../dom.js';
import { getApi, postApi, deleteJSON, getJSON } from '../api.js';
import { pricePlace } from '../place.js';
import { money } from '../market/marketUtils.js';
import { mandiReference } from '../market/priceCheck.js';

// Price alerts: "tell me when rice rises to ₹2,600". The server checks them after every mandi
// sync, so the phone can stay off; a reached alert shows on Home and at the top of this list.

export const alertsApi = {
  list: () => getApi('/api/price-alerts'),
  create: (body) => postApi('/api/price-alerts', body),
  remove: (id) => deleteJSON(`/api/price-alerts/${encodeURIComponent(id)}`),
  seen: () => postApi('/api/price-alerts/seen', {}),
};

const day = (iso) => (iso ? new Intl.DateTimeFormat(dateLocale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)) : '');
const target = (a) => `${t(a.crop.name)} ${a.direction === 'above' ? '≥' : '≤'} ${money(a.price, a.currency)}`;

/** One line for a reached alert, as Home and this list show it: "🔔 Rice reached ₹2,537 (≥ ₹2,500)". */
export const reachedText = (a) => t('🔔 {crop} reached {price} ({sign} {target})', {
  crop: t(a.crop.name), price: money(Math.round(a.triggered.price), a.currency), sign: a.direction === 'above' ? '≥' : '≤', target: money(a.price, a.currency),
});

let state = null; // { status, items, error, fresh:Set }

async function load(ctx) {
  state = { status: 'loading', items: [], fresh: new Set() };
  ctx.rerender();
  try {
    const { items } = await alertsApi.list();
    const fresh = new Set(items.filter((a) => a.triggered && !a.seen).map((a) => a.id));
    state = { status: 'ready', items, fresh };
    if (fresh.size) alertsApi.seen().catch(() => {}); // shown now; Home stops pointing at them
  } catch (err) { state = { status: 'error', items: [], error: err.message, fresh: new Set() }; }
  ctx.rerender();
}

export const PriceAlerts = {
  name: 'PriceAlerts',
  title: 'Price alerts',
  numericSelect: true,
  softLeft: { label: 'New', handler: (ctx) => newAlert(ctx) },
  onShow(ctx) { if (!state) load(ctx); },
  onHide() { state = null; },
  render() {
    const wrap = el('list');
    if (!state || state.status === 'loading') { wrap.append(el('msg', t('Loading…'))); return wrap; }
    if (state.status === 'error') { wrap.append(el('msg', `⚠ ${t(state.error)}`)); return wrap; }
    if (!state.items.length) {
      wrap.append(el('msg', t('No price alerts yet. Press New: the cloud watches the mandi price for you, even when your phone is off.')));
      return wrap;
    }
    state.items.forEach((a, i) => {
      const row = el(`item alert-row${a.triggered ? ' alert-reached' : ''}`);
      row.dataset.id = a.id;
      const body = el('home-body');
      body.append(el('home-main', `${i + 1}  ${a.triggered ? reachedText(a) : target(a)}`));
      body.append(el('home-meta', a.triggered
        ? `${a.triggered.market} · ${day(a.triggered.date)}${state.fresh.has(a.id) ? ` · ${t('NEW')}` : ''}`
        : t('Watching · checked every 30 min')));
      row.append(body);
      wrap.append(row);
    });
    return wrap;
  },
  onEnter(node, ctx) {
    const a = state?.items.find((x) => x.id === node?.dataset.id);
    if (!a) return;
    ctx.router.push('ForumPicker', {
      title: 'Price alert', note: a.triggered ? reachedText(a) : target(a),
      options: [{ label: t('Delete this alert'), value: 'delete' }, { label: t('Keep'), value: 'keep' }],
      async onPick(o, c) {
        if (o.value === 'delete') { try { await alertsApi.remove(a.id); } catch { /* list reload shows the truth */ } state = null; }
        c.router.pop();
      },
    });
  },
};

// New alert: crop (skipped when opened from a crop's prices) -> rises or falls -> price.
async function newAlert(ctx) {
  const crop = ctx.params?.crop;
  if (crop) return pickDirection(ctx, crop);
  let crops = [];
  try {
    const { region } = await pricePlace();
    crops = (await getJSON(`/api/prices/crops?region=${encodeURIComponent(region)}`)).items;
  } catch { /* shown as an empty list */ }
  ctx.router.push('ForumPicker', {
    title: 'Which crop?', empty: 'No mandi prices for your area yet.',
    options: crops.map((c) => ({ label: t(c.name), value: c })),
    onPick: (o, c) => pickDirection(c, o.value, true),
  });
}

async function pickDirection(ctx, crop, replace = false) {
  const ref = await mandiReference(crop.code).catch(() => null);
  const now = ref ? Math.round(ref.price) : null;
  const params = {
    title: 'Tell me when the price…',
    note: now ? t('{crop} today: {price}/qt at {market}', { crop: t(crop.name), price: money(now, ref.currency), market: ref.market }) : t(crop.name),
    options: [{ label: t('Rises to…'), value: 'above' }, { label: t('Falls to…'), value: 'below' }],
    onPick: (o, c) => c.router.replace('MarketNumber', {
      title: o.value === 'above' ? 'Alert when it rises to (₹/qt)' : 'Alert when it falls to (₹/qt)',
      decimals: 0, maxLen: 6, initial: now ?? undefined,
      async onDone(price, c2) {
        try {
          await alertsApi.create({ crop: crop.code, direction: o.value, price });
          state = null;
          c2.router.pop();
          const toast = document.getElementById('toast');
          if (toast) { toast.textContent = `✓ ${t('Alert set. The cloud checks the mandi every 30 min.')}`; toast.hidden = false; setTimeout(() => { toast.hidden = true; }, 5000); }
        } catch (err) {
          const toast = document.getElementById('toast');
          if (toast) { toast.textContent = `⚠ ${t(err.message)}`; toast.hidden = false; setTimeout(() => { toast.hidden = true; }, 5000); }
        }
      },
    }),
  };
  if (replace) ctx.router.replace('ForumPicker', params); else ctx.router.push('ForumPicker', params);
}
