import { el } from '../dom.js';
import { identity } from '../state.js';
import { emptyView } from '../forum/ui.js';
import { marketApi } from './marketApi.js';
import { ensureOptions, listingForm, requestForm, offerForm } from './marketForms.js';
import {
  GRADE_LABEL, FULFILL_LABEL, PRICING_LABEL, confirm, dateLabel, evidenceLines, fmtNum, handleAuth, isRetry, line, load, marketError, money, perUnit,
  relTime, timeLeft, row, runPending, stateView, refreshScreen,
} from './marketUtils.js';

// Filters live for the session only. Location is always the member's profile region, never IP.
export const filters = { crop: null, area: 'district', sort: null };
const AREAS = [['district', 'My district', {}], ['25', 'Within 25 km', { radiusKm: 25 }], ['100', 'Within 100 km', { radiusKm: 100 }], ['country', 'My country', { scope: 'country' }]];
const SORTS = [[null, 'Default'], ['newest', 'Newest'], ['nearest', 'Nearest'], ['ready', 'Ready soonest'], ['price', 'Lowest price']];
const query = () => ({ ...(AREAS.find((a) => a[0] === filters.area)?.[2] || {}), ...(filters.crop ? { crop: filters.crop } : {}), ...(filters.sort ? { sort: filters.sort } : {}) });

// ---------------------------------------------------------------- home
const HOME = [
  ['Browse Produce', (ctx) => ctx.router.push('MarketFeed', { kind: 'listing' })],
  ['Buyer Requests', (ctx) => ctx.router.push('MarketFeed', { kind: 'request' })],
  ['Sell Produce', (ctx) => openForm(ctx, listingForm(afterCreate('listing')))],
  ['Post Buy Request', (ctx) => openForm(ctx, requestForm(afterCreate('request')))],
  ['Offers to Answer', (ctx) => ctx.router.push('MarketOffers', { role: 'incoming' })],
  ['Offers I Sent', (ctx) => ctx.router.push('MarketOffers', { role: 'outgoing' })],
  ['My Deals', (ctx) => ctx.router.push('MarketDeals', {})],
];
async function openForm(ctx, form) {
  try { await ensureOptions(); } catch { ctx.params.notice = 'No network. Try again.'; return ctx.rerender(); }
  ctx.router.push('MarketForm', form);
}
const afterCreate = (kind) => (ctx, result) => ctx.router.replace('MarketDetail', { kind, id: result.id, notice: 'Posted.' });

// Badge: offers waiting for the member's answer.
function badge(ctx) {
  marketApi.offers('incoming').then((r) => {
    const n = r.items.filter((i) => i.awaitingMyResponse).length;
    const target = ctx.root?.querySelectorAll('.item')[4]?.querySelector('.forum-choice-label');
    if (target) target.textContent = n ? `Offers to Answer (${n} new)` : 'Offers to Answer';
  }).catch(() => {});
}

export const MarketHome = {
  name: 'MarketHome',
  title: 'Local Market',
  numericSelect: true,
  softLeft: { label: '', handler() {} },
  render(ctx) {
    const wrap = el('forum-screen');
    const list = el('list');
    HOME.forEach(([label], i) => list.appendChild(row(i + 1, label)));
    wrap.appendChild(list);
    if (ctx.params?.notice) wrap.appendChild(el('forum-error-text', ctx.params.notice));
    return wrap;
  },
  onShow(ctx) { badge(ctx); },
  onRefresh(ctx) { badge(ctx); },
  onEnter(_r, ctx, i) { HOME[i]?.[1](ctx); },
};

// ---------------------------------------------------------------- feed
const cardTitle = (it) => `${it.crop.name}${it.variety ? ` (${it.variety})` : ''} · ${GRADE_LABEL[it.grade || it.desiredGrade] || ''}`.replace(/ · $/, '');
const distance = (it) => (it.location.approxDistanceKm ? ` · ~${it.location.approxDistanceKm} km` : '');

function cardRow(it) {
  const r = el('item forum-post-row market-card');
  r.dataset.id = it.id;
  const main = el('forum-main');
  main.appendChild(el('forum-meta', `${it.type === 'selling' ? 'SELLING' : 'BUYING'}${distance(it)}${it.isDemo ? ' · DEMO' : ''}`));
  main.appendChild(el('forum-title', cardTitle(it)));
  const price = it.type === 'selling'
    ? (it.askingPrice != null ? perUnit(it.askingPrice, it.currency, it.unit) : 'Offers welcome')
    : (it.targetPriceMax != null ? `up to ${perUnit(it.targetPriceMax, it.currency, it.unit)}` : 'Any price');
  main.appendChild(el('forum-meta', `${fmtNum(it.availableQuantity)} ${it.unit} · ${price}`));
  main.appendChild(el('forum-meta', `${dateLabel(it.availableDate || it.neededBy)} · ${it.location.label}`));
  r.appendChild(main);
  return r;
}

export const MarketFeed = {
  name: 'MarketFeed',
  title: (ctx) => (ctx.params.kind === 'listing' ? 'Browse produce' : 'Buyer requests'),
  softLeft: { label: 'Filter', handler: (ctx) => ctx.router.push('MarketFilter', { kind: ctx.params.kind }) },
  softCenter: { label: 'Open', handler: (ctx, cur) => open(ctx, cur) },
  render(ctx) {
    ctx.root.classList.add('forum-scroll');
    const p = ctx.params;
    const wrap = el('forum-screen');
    const status = stateView(ctx, () => marketApi.browse(p.kind, query()));
    if (status) { wrap.appendChild(status); return wrap; }
    const { items, nextCursor } = p.state.data;
    const area = AREAS.find((a) => a[0] === filters.area)[1];
    wrap.appendChild(el('forum-filters', `${area}${filters.crop ? ` · ${filters.crop}` : ''}`));
    if (!items.length) {
      wrap.appendChild(emptyView(p.kind === 'listing' ? 'No produce for sale here yet.' : 'No buyer requests here yet.', 'Press Filter to search a wider area.'));
      return wrap;
    }
    const list = el('list');
    items.forEach((it) => list.appendChild(cardRow(it)));
    if (nextCursor) { const more = el('item forum-more', 'More…'); more.dataset.act = 'more'; list.appendChild(more); }
    wrap.appendChild(list);
    return wrap;
  },
  initialFocus: (ctx) => ctx.params.focusIndex ?? 0,
  onHide(ctx) { ctx.params.state = null; },
  onRefresh: refreshScreen,
  onEnter(cur, ctx, i) { ctx.params.focusIndex = i; open(ctx, cur); },
};
function open(ctx, cur) {
  if (!cur) return;
  const p = ctx.params;
  if (isRetry(cur)) { p.state = null; return ctx.rerender(); }
  if (cur.dataset.act === 'more') {
    const { items, nextCursor } = p.state.data;
    return marketApi.browse(p.kind, { ...query(), cursor: nextCursor }).then((r) => {
      p.state.data = { items: [...items, ...r.items], nextCursor: r.nextCursor };
      ctx.rerender();
    }).catch(() => {});
  }
  ctx.router.push('MarketDetail', { kind: p.kind, id: cur.dataset.id });
}

// ---------------------------------------------------------------- filter
const cycle = (list, cur) => list[(list.findIndex((x) => x[0] === cur) + 1) % list.length][0];
export const MarketFilter = {
  name: 'MarketFilter',
  title: 'Filter',
  numericSelect: true,
  softLeft: { label: '', handler() {} },
  softCenter: { label: 'Change', handler: (ctx, _c, i) => change(ctx, i) },
  render(ctx) {
    const wrap = el('forum-screen');
    const list = el('list');
    const rows = [
      ['Crop', filters.crop || 'All'], ['Area', AREAS.find((a) => a[0] === filters.area)[1]],
      ['Sort', SORTS.find((s) => s[0] === filters.sort)[1]], ['Clear filters', ''],
    ];
    rows.forEach(([label, value], i) => list.appendChild(row(i + 1, label, value)));
    wrap.appendChild(list);
    return wrap;
  },
  initialFocus: (ctx) => ctx.params.focusIndex ?? 0,
  onEnter(_r, ctx, i) { change(ctx, i); },
};
async function change(ctx, i) {
  ctx.params.focusIndex = i;
  if (i === 0) {
    try { await ensureOptions(); } catch { return; }
    const crops = identity.options.crops;
    return ctx.router.push('ForumPicker', {
      title: 'Crop', selected: filters.crop,
      options: [{ label: 'All crops', value: null }, ...crops.map((c) => ({ label: c.name, value: c.code }))],
      onPick(o, c) { filters.crop = o.value; c.router.pop(); },
    });
  }
  if (i === 1) filters.area = cycle(AREAS, filters.area);
  if (i === 2) {
    const list = ctx.params.kind === 'listing' ? SORTS : SORTS.filter((s) => s[0] !== 'price');
    filters.sort = cycle(list, filters.sort);
  }
  if (i === 3) Object.assign(filters, { crop: null, area: 'district', sort: null });
  ctx.rerender();
}

// ---------------------------------------------------------------- detail
const REASONS = [['spam', 'Spam'], ['scam', 'Scam or fake'], ['prohibited_item', 'Not allowed item'], ['fake_price', 'Wrong price'], ['harassment', 'Harassment'], ['other', 'Other']];

export const MarketDetail = {
  name: 'MarketDetail',
  title: (ctx) => (ctx.params.kind === 'listing' ? 'Listing' : 'Buyer request'),
  numericSelect: true,
  softLeft: { label: '', handler() {} },
  render(ctx) {
    ctx.root.classList.add('forum-scroll');
    const p = ctx.params;
    const wrap = el('forum-screen');
    const status = stateView(ctx, () => marketApi.detail(p.kind, p.id));
    if (status) { wrap.appendChild(status); return wrap; }
    const it = p.state.data.item;
    p.actions = actionsFor(ctx, it, p.state.data.item.openOffers);
    if (p.notice) wrap.appendChild(el('forum-flash', p.notice));
    const info = el('forum-profile-card');
    info.appendChild(el('forum-title forum-title--full', `${it.type === 'selling' ? 'SELLING' : 'BUYING'} · ${cardTitle(it)}`));
    info.appendChild(line('Quantity', `${fmtNum(it.availableQuantity)} of ${fmtNum(it.quantity)} ${it.unit}`));
    if (it.type === 'selling') {
      info.appendChild(line('Price', it.askingPrice != null ? `${perUnit(it.askingPrice, it.currency, it.unit)} · ${PRICING_LABEL[it.pricingMode]}` : 'Offers welcome'));
      info.appendChild(line('Ready', dateLabel(it.availableDate)));
    } else {
      const range = [it.targetPriceMin, it.targetPriceMax].filter((v) => v != null).map((v) => money(v, it.currency)).join(' – ');
      info.appendChild(line('Budget', range ? `${range}/${it.unit}` : 'Any'));
      info.appendChild(line('Needed by', dateLabel(it.neededBy)));
    }
    info.appendChild(line('Handover', FULFILL_LABEL[it.fulfillment]));
    info.appendChild(line('Area', `${it.location.label}${distance(it)}`));
    info.appendChild(line(it.type === 'selling' ? 'Seller' : 'Buyer', it.owner.displayName));
    for (const ev of evidenceLines(it.owner.evidence)) info.appendChild(ev);
    info.appendChild(line('Expires', timeLeft(it.expiresAt)));
    info.appendChild(el('forum-hint', 'Asking prices are not verified. Payment happens outside AgriLink.'));
    if (it.isDemo && !it.isMine) info.appendChild(el('forum-error-text', 'Demo post: nobody answers offers here. Use a second phone to try a real trade.'));
    wrap.appendChild(info);
    const list = el('list');
    p.actions.forEach((a, i) => list.appendChild(row(i + 1, a.label)));
    wrap.appendChild(list);
    return wrap;
  },
  initialFocus: (ctx) => ctx.params.focusIndex ?? 0,
  onShow(ctx) { runPending(ctx); },
  onRefresh: refreshScreen,
  onHide(ctx) { ctx.params.state = null; },
  onEnter(cur, ctx, i) {
    if (isRetry(cur)) { ctx.params.state = null; return ctx.rerender(); }
    ctx.params.focusIndex = i;
    ctx.params.actions?.[i]?.run();
  },
};

function actionsFor(ctx, it, openOffers) {
  const p = ctx.params;
  const fail = (err) => { if (!handleAuth(ctx, err)) { p.notice = marketError(err); p.state = null; ctx.rerender(); } };
  if (it.isMine) {
    return [
      ...(openOffers ? [{ label: `View offers (${openOffers})`, run: () => ctx.router.push('MarketOffers', { role: 'incoming' }) }] : []),
      { label: 'Remove post', run: () => confirm(ctx, { title: 'Remove post?', note: 'Open offers on it will end.', yes: 'Yes, remove', run: (c) => marketApi.remove(p.kind, it.id).then(() => c.router.pop()).catch(fail) }) },
    ];
  }
  return [
    it.myOfferId
      ? { label: 'View my offer', run: () => ctx.router.push('MarketOffer', { id: it.myOfferId }) }
      : { label: 'Make offer', run: () => ctx.router.push('MarketForm', offerForm(p.kind, it, (c, r) => c.router.replace('MarketOffer', { id: r.id, notice: 'Offer sent.' }))) },
    { label: 'Report', run: () => ctx.router.push('ForumPicker', {
      title: 'Report', options: REASONS.map(([value, label]) => ({ label, value })),
      onPick(o, c) { p.pending = () => marketApi.report(p.kind, it.id, o.value).then(() => { p.notice = 'Reported. Thank you.'; ctx.rerender(); }).catch(fail); c.router.pop(); },
    }) },
    { label: `Block ${it.owner.displayName}`, run: () => confirm(ctx, { title: 'Block this user?', note: 'You will not see each other’s posts.', yes: 'Yes, block', run: (c) => marketApi.block(it.owner.id).then(() => c.router.pop()).catch(fail) }) },
  ];
}
