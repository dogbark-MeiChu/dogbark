import { t } from '../i18n/index.js';
import { el } from '../dom.js';
import { getJSON } from '../api.js';
import { identity, user } from '../state.js';
import { freshness } from '../freshness.js';
import { marketApi } from '../market/marketApi.js';
import { money, fmtNum } from '../market/marketUtils.js';
import * as farmApi from '../farmOps/farmOpsApi.js';
import { farmToday, selectFarm } from './farmOps.js';
import { wmo } from './weather.js';

// Home: the three things a farmer picks up the second phone for, on one screen, each one key away.
//   1 what the crop is worth today and where it pays most (the price question the app exists for)
//   2 buyers waiting for an answer, or deals under way
//   3 the farm: today's work and the weather that changes it
//   0 every other feature (the old main menu)
// The order never changes, so the keys become habit. Each row loads on its own: a slow source
// leaves its own row "Loading…" instead of holding up the rest.

const OPEN_DEAL = ['awaiting_confirmation', 'agreed', 'pickup_scheduled', 'handed_over'];
const RAIN_ALERT = 60; // % chance that is worth a warning on Home

let rows = { price: null, market: null, farm: null }; // each: { ok, ... } | { error } | null (loading)
let active = false, keepFocus = null;

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function settle(ctx, key, promise) {
  promise.then((v) => ({ ok: true, ...v }), (e) => ({ error: e?.message || 'Unavailable' })).then((v) => {
    rows[key] = v;
    if (!active) return;
    keepFocus = ctx.focus?.index ?? 0;
    ctx.rerender();
  });
}

async function loadFarm() {
  const { items } = await farmApi.farms();
  const farm = items[0];
  if (!farm) return { farm: null };
  const today = await farmApi.today(farm.id, new URLSearchParams(location.search).get('demoDate') || farmToday(farm.timezone));
  return { farm, today };
}

// Price without a farm: the member's first crop in their region, straight from the mandi data.
async function loadRegionPrice() {
  const region = identity.profile?.regionCode || user.region;
  const crops = (await getJSON(`/api/prices/crops?region=${region}`)).items;
  const mine = identity.profile?.cropCodes || [];
  const crop = crops.find((c) => mine.includes(c.code)) || crops[0];
  if (!crop) throw new Error('No mandi prices for your area yet.');
  const p = identity.profile;
  const at = p?.regionLat != null && p?.regionLng != null ? `&lat=${p.regionLat}&lng=${p.regionLng}` : '';
  const data = await getJSON(`/api/prices?crop=${crop.code}&region=${region}${at}`);
  const [home, ...others] = data.markets;
  const best = [...others].sort((a, b) => b.price - a.price)[0];
  return {
    crop: crop.name, price: Math.round(home.price), currency: data.currency, change: home.change_pct,
    // No farm location means no transport cost: this is the highest price, not the best net deal.
    best: best && best.price > home.price ? { label: 'Highest: {market} {amount}', market: best.name, text: `${money(Math.round(best.price), data.currency)}/${t('qt')}` } : null,
    src: { provider: data.source, source: data.sample ? 'sample' : 'live', date: data.date },
  };
}

async function loadMarket() {
  const [offers, deals] = await Promise.all([marketApi.offers('incoming'), marketApi.deals()]);
  return {
    waiting: offers.items.filter((o) => o.awaitingMyResponse),
    open: deals.items.filter((d) => OPEN_DEAL.includes(d.status)),
  };
}

function load(ctx) {
  rows = { price: null, market: null, farm: null };
  const farm = loadFarm();
  settle(ctx, 'farm', farm);
  // With a farm, its dashboard already carries the price snapshot (net of transport); reuse it.
  settle(ctx, 'price', farm.then((f) => {
    const m = f.today?.marketSnapshots?.[0];
    if (!m) return loadRegionPrice();
    return {
      crop: t(cap(m.crop)), price: Math.round(m.localPrice), currency: 'INR', change: m.trend7d,
      best: m.bestNearbyMarket && m.netGainPerUnit > 0 ? { market: m.bestNearbyMarket, text: `+${money(m.netGainPerUnit)}/${t('qt')} ${t('net')}` } : null,
      src: m,
    };
  }, () => loadRegionPrice()));
  settle(ctx, 'market', loadMarket());
}

// One Home row: its key, a headline, a detail line and the source line.
function row(n, key, { main, meta, src, warn }) {
  const r = el(`item home-row${warn ? ' home-warn' : ''}`);
  r.dataset.key = key;
  r.append(el('home-n', String(n)));
  const body = el('home-body');
  body.append(el('home-main', main));
  if (meta) body.append(el('home-meta', meta));
  if (src) { const f = freshness(src); body.append(el(`home-src${f.warn ? ' src-stale' : ''}`, f.text)); }
  r.append(body);
  return r;
}
const pending = (n, key, title, v) => row(n, key, { main: title, meta: v ? `⚠ ${t(v.error)}` : t('Loading…') });

function priceRow() {
  const v = rows.price;
  if (!v?.ok) return pending(1, 'price', t('Market Prices'), v);
  const pct = String(v.change ?? '');
  const arrow = pct.startsWith('-') ? '▼' : Number.parseFloat(pct) > 0 ? '▲' : '';
  const change = pct && pct !== '0' && pct !== '+0%' ? ` ${arrow}${pct}${pct.endsWith('%') ? '' : '%'}` : '';
  return row(1, 'price', {
    main: `${t(v.crop)} ${money(v.price, v.currency)}/${t('qt')}${change}`,
    meta: v.best ? t(v.best.label || 'Best: {market} {amount}', { market: v.best.market, amount: v.best.text }) : null,
    src: v.src,
  });
}

function marketRow() {
  const v = rows.market;
  if (!v) return pending(2, 'market', t('Sell / Buy'), v);
  if (v.error) return row(2, 'market', { main: t('Sell / Buy') }); // market off on this server: still a plain way in
  if (v.waiting.length) {
    const o = v.waiting[0];
    return row(2, 'market', { warn: true,
      main: t('Offers to answer: {n}', { n: v.waiting.length }),
      meta: `${t(o.crop.name)} ${fmtNum(o.terms.quantity)} ${t(o.terms.unit)} · ${money(o.terms.unitPrice, o.terms.currency)} · ${o.counterparty.displayName}` });
  }
  if (v.open.length) {
    const d = v.open[0];
    return row(2, 'market', {
      main: t('Deals in progress: {n}', { n: v.open.length }),
      meta: `${t(d.crop.name)} ${fmtNum(d.terms.quantity)} ${t(d.terms.unit)} · ${d.counterparty.displayName}` });
  }
  return row(2, 'market', { main: t('Sell / Buy'), meta: t('No offers waiting') });
}

// The first day in the next two with a real chance of rain, e.g. "Rain tomorrow 80%".
function rainAhead(weather) {
  const days = weather?.daily || [];
  for (let i = 0; i < Math.min(3, days.length); i++) {
    const p = days[i].rain_prob ?? days[i].rainProb;
    if (p >= RAIN_ALERT) return t(i === 0 ? 'Rain today {pct}%' : i === 1 ? 'Rain tomorrow {pct}%' : 'Rain in {n} days {pct}%', { pct: p, n: i });
  }
  return null;
}

function farmRow() {
  const v = rows.farm;
  if (!v?.ok) return pending(3, 'farm', t("Today's Farm"), v);
  if (!v.farm) return row(3, 'farm', { main: t("Today's Farm"), meta: t('Add your farm to plan daily work') });
  const d = v.today, s = d.summary || {};
  const open = Math.max(0, (s.total || 0) - (s.completed || 0));
  const rain = rainAhead(d.weather);
  const spray = d.sprayAssessment;
  let meta;
  if (spray && spray.overall !== 'optimal') meta = `${t('SPRAY')}: ${t(spray.overall.toUpperCase())} · ${spray.bestWindow ? `${spray.bestWindow.from}–${spray.bestWindow.to}` : t('no safe window')}`;
  else if (rain) meta = `⚠ ${rain}`;
  else if (d.weather?.current) { const w = d.weather.current; meta = `${wmo(w.code ?? w.weatherCode)[0]} ${Math.round(w.temp ?? w.temperatureC ?? 0)}°C`; }
  return row(3, 'farm', {
    warn: Boolean(rain || (spray && spray.overall !== 'optimal') || s.blocked),
    main: t('Farm: {n} tasks open', { n: open }), // the count must fit; the dashboard names the farm
    meta,
    src: d.weather?.stale ? { provider: 'open-meteo', ...d.weather } : null,
  });
}

export default {
  name: 'Home',
  title: 'Today',
  numericSelect: true,
  softLeft: { label: 'Menu', handler: (ctx) => ctx.router.push('MainMenu', { title: t('All features') }) },
  // The router calls onShow on every rerender too; load once per visit (prices, offers and tasks
  // move while you are away, so coming back reloads).
  onShow(ctx) { if (active) return; active = true; load(ctx); },
  onHide() { active = false; },
  onRefresh(ctx) { settle(ctx, 'market', loadMarket()); }, // the market poller saw news
  render() {
    const list = el('list home');
    list.append(priceRow(), marketRow(), farmRow());
    const all = el('item home-row home-all');
    all.dataset.key = 'all';
    all.append(el('home-n', '0'), el('home-main', t('All features')));
    list.append(all);
    return list;
  },
  initialFocus() { const i = keepFocus; keepFocus = null; return i; },
  onKey(action, ctx) {
    if (action === 'NUM_0') { go(ctx, 'all'); return true; }
    if (action === 'NUM_4') return true; // 4 is the "All features" row's position, not its key
    return false;
  },
  onEnter(node, ctx) { if (node) go(ctx, node.dataset.key); },
};

function go(ctx, key) {
  if (key === 'price') return ctx.router.push('MarketPrices');
  if (key === 'market') {
    const v = rows.market;
    if (v?.ok && v.waiting.length) return ctx.router.push('MarketOffers', { role: 'incoming' });
    if (v?.ok && v.open.length) return ctx.router.push('MarketDeals', {});
    return ctx.router.push('MarketHome', { title: t('Sell / Buy') });
  }
  if (key === 'farm') {
    const v = rows.farm;
    if (v?.ok && v.farm) { selectFarm(v.farm); return ctx.router.push('TodayDashboard'); }
    return ctx.router.push('FarmGate');
  }
  if (key === 'all') return ctx.router.push('MainMenu', { title: t('All features') });
}
