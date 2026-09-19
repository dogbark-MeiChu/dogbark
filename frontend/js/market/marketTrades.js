import { t } from '../i18n/index.js';
import { el } from '../dom.js';
import { emptyView, loadingView } from '../forum/ui.js';
import { marketApi } from './marketApi.js';
import { counterForm, scheduleForm } from './marketForms.js';
import { confirmTrade } from './tradeConfirm.js';
import {
  DEAL_STATUS, OFFER_STATUS, PAYMENT_LABEL, confirm, dateLabel, fmtNum, handleAuth, isRetry, line, marketError, money, perUnit, relTime, timeLeft, row,
  runPending, stateView, windowLabel, refreshScreen,
} from './marketUtils.js';

// Shared by offer and deal detail: run an API call with a busy state, then refresh.
async function act(ctx, fn, ok) {
  const p = ctx.params;
  p.busy = true; p.notice = null;
  ctx.rerender();
  try { const out = await fn(); p.notice = ok; p.busy = false; p.state = null; ctx.rerender(); return out; } catch (err) {
    p.busy = false;
    if (handleAuth(ctx, err)) return null;
    p.notice = marketError(err); p.state = null; ctx.rerender();
    return null;
  }
}

function listScreen({ name, title, fetch, item, emptyText, softLeft }) {
  return {
    name, title, softLeft: softLeft || { label: '', handler() {} },
    softCenter: { label: 'Open', handler: (ctx, cur, i) => go(ctx, cur, i) },
    render(ctx) {
      ctx.root.classList.add('forum-scroll');
      const p = ctx.params;
      const wrap = el('forum-screen');
      const status = stateView(ctx, () => fetch(p));
      if (status) { wrap.appendChild(status); return wrap; }
      const items = p.state.data.items;
      if (!items.length) { wrap.appendChild(emptyView(typeof emptyText === 'function' ? emptyText(p) : emptyText)); return wrap; }
      const list = el('list');
      items.forEach((it) => list.appendChild(item(it)));
      wrap.appendChild(list);
      return wrap;
    },
    initialFocus: (ctx) => ctx.params.focusIndex ?? 0,
    onHide(ctx) { ctx.params.state = null; },
    onRefresh: refreshScreen,
    onEnter(cur, ctx, i) { go(ctx, cur, i); },
  };
  function go(ctx, cur, i) {
    if (!cur) return;
    if (isRetry(cur)) { ctx.params.state = null; return ctx.rerender(); }
    ctx.params.focusIndex = i;
    ctx.router.push(name === 'MarketDeals' ? 'MarketDeal' : 'MarketOffer', { id: cur.dataset.id });
  }
}
const card = (id, head, ...meta) => {
  const r = el('item forum-post-row market-card');
  r.dataset.id = id;
  const main = el('forum-main');
  main.appendChild(el('forum-title', head));
  meta.forEach((m) => main.appendChild(el('forum-meta', m)));
  r.appendChild(main);
  return r;
};

// ---------------------------------------------------------------- offers
export const MarketOffers = listScreen({
  name: 'MarketOffers',
  title: 'My offers',
  // Offers waiting for my answer first, so Home's "Offers to answer" lands on one with Enter.
  fetch: (p) => marketApi.offers(p.role).then((r) => ({ ...r, items: [...r.items].sort((a, b) => b.awaitingMyResponse - a.awaitingMyResponse) })),
  emptyText: (p) => t(p.role === 'outgoing' ? 'You have not sent any offers.' : 'No offers waiting for your answer.'),
  item: (o) => card(o.id, `${o.awaitingMyResponse ? '● ' : ''}${t(o.crop.name)} · ${fmtNum(o.terms.quantity)} ${t(o.terms.unit)}`,
    `${perUnit(o.terms.unitPrice, o.terms.currency, t(o.terms.unit))} · ${o.counterparty.displayName}`,
    `${o.awaitingMyResponse ? t('Your turn') : OFFER_STATUS[o.status]} · ${relTime(o.updatedAt)}`),
  softLeft: { label: (ctx) => (ctx.params.role === 'incoming' ? 'Sent' : 'Inbox'), handler(ctx) { ctx.params.role = ctx.params.role === 'incoming' ? 'outgoing' : 'incoming'; ctx.params.state = null; ctx.rerender(); } },
});
const offersTitle = MarketOffers.title;
MarketOffers.title = (ctx) => (ctx.params.role === 'outgoing' ? 'Offers I sent' : 'Offers to answer') || offersTitle;

export const MarketOffer = {
  name: 'MarketOffer',
  title: 'Offer',
  numericSelect: true,
  softLeft: { label: '', handler() {} },
  render(ctx) {
    ctx.root.classList.add('forum-scroll');
    const p = ctx.params;
    const wrap = el('forum-screen');
    if (p.busy) { wrap.appendChild(loadingView(t('Working…'))); return wrap; }
    const status = stateView(ctx, () => marketApi.getOffer(p.id));
    if (status) { wrap.appendChild(status); return wrap; }
    const { item: o, revisions } = p.state.data;
    p.actions = offerActions(ctx, o);
    if (p.notice) wrap.appendChild(el('forum-flash', p.notice));
    const terms = o.terms;
    const info = el('forum-profile-card');
    info.appendChild(el('forum-title forum-title--full', `${t(o.crop.name)} · ${OFFER_STATUS[o.status]}`));
    info.appendChild(line('With', o.counterparty.displayName));
    info.appendChild(line('Quantity', `${fmtNum(terms.quantity)} ${t(terms.unit)}`));
    info.appendChild(line('Price', perUnit(terms.unitPrice, terms.currency, t(terms.unit))));
    info.appendChild(line('Est. total', money(terms.estimatedTotal, terms.currency)));
    info.appendChild(line('Pickup', `${dateLabel(terms.pickupDate)} ${windowLabel(terms.pickupWindowStart, terms.pickupWindowEnd)}`));
    info.appendChild(line('Payment', `${PAYMENT_LABEL[terms.paymentMethod]}`));
    if (terms.note) info.appendChild(line('Note', terms.note));
    info.appendChild(line('Round', `${revisions.length} · ${t(o.proposedByMe ? 'yours' : 'theirs')}`));
    if (['open', 'countered'].includes(o.status)) info.appendChild(line('Ends', timeLeft(o.expiresAt)));
    info.appendChild(el('forum-hint', t('Total is an estimate; weight may be measured at handover.')));
    if (o.onDemoPost && o.proposedByMe && ['open', 'countered'].includes(o.status)) {
      info.appendChild(el('forum-error-text', t('Demo post: nobody will answer this offer.')));
    }
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

function offerActions(ctx, o) {
  const p = ctx.params;
  const acts = [];
  if (o.awaitingMyResponse) {
    // Money commitments go through the trade confirm screen (big total, read aloud, type 2 digits).
    acts.push({ label: t('Accept'), run: () => confirmTrade(ctx, {
      title: 'Accept offer?', verb: 'accept', terms: o.terms, crop: o.crop.name, counterparty: o.counterparty.displayName, role: o.myRole,
      pickup: { date: o.terms.pickupDate, windowStart: o.terms.pickupWindowStart, windowEnd: o.terms.pickupWindowEnd },
      run: async (c) => { const r = await act(c, () => marketApi.accept(o.id), t('Accepted.')); if (r) c.router.replace('MarketDeal', { id: r.dealId, notice: t('Deal created. Confirm the terms.') }); },
    }) });
    acts.push({ label: t('Counter'), run: () => ctx.router.push('MarketForm', counterForm(o, (c) => c.router.pop())) });
    acts.push({ label: t('Decline'), run: () => confirm(ctx, { title: t('Decline offer?'), yes: t('Yes, decline'), run: (c) => act(c, () => marketApi.decline(o.id), t('Declined.')) }) });
  } else if (['open', 'countered'].includes(o.status)) {
    acts.push({ label: t('Withdraw'), run: () => confirm(ctx, { title: t('Withdraw offer?'), yes: t('Yes, withdraw'), run: (c) => act(c, () => marketApi.withdraw(o.id), t('Withdrawn.')) }) });
  }
  if (o.dealId) acts.push({ label: t('Open deal'), run: () => ctx.router.push('MarketDeal', { id: o.dealId }) });
  return acts;
}

// ---------------------------------------------------------------- deals
export const MarketDeals = listScreen({
  name: 'MarketDeals',
  title: 'My deals',
  fetch: () => marketApi.deals(),
  emptyText: t('No deals yet. A deal appears once an offer is accepted.'),
  item: (d) => card(d.id, `${t(d.crop.name)} · ${fmtNum(d.terms.quantity)} ${t(d.terms.unit)}`,
    `${t(d.role === 'buyer' ? 'Buying from' : 'Selling to')} ${d.counterparty.displayName}`, DEAL_STATUS[d.status]),
});

export const MarketDeal = {
  name: 'MarketDeal',
  title: 'Deal',
  numericSelect: true,
  softLeft: { label: '', handler() {} },
  render(ctx) {
    ctx.root.classList.add('forum-scroll');
    const p = ctx.params;
    const wrap = el('forum-screen');
    if (p.busy) { wrap.appendChild(loadingView(t('Working…'))); return wrap; }
    const status = stateView(ctx, () => marketApi.deal(p.id));
    if (status) { wrap.appendChild(status); return wrap; }
    const d = p.state.data.item;
    p.actions = dealActions(ctx, d);
    if (p.notice) wrap.appendChild(el('forum-flash', p.notice));
    const terms = d.terms;
    const info = el('forum-profile-card');
    info.appendChild(el('forum-title forum-title--full', `${t(d.crop.name)} · ${DEAL_STATUS[d.status]}`));
    info.appendChild(line(d.role === 'buyer' ? 'Seller' : 'Buyer', d.counterparty.displayName));
    info.appendChild(line('Quantity', `${fmtNum(terms.quantity)} ${t(terms.unit)}`));
    info.appendChild(line('Price', perUnit(terms.unitPrice, terms.currency, t(terms.unit))));
    info.appendChild(line('Est. total', money(terms.estimatedTotal, terms.currency)));
    info.appendChild(line('Payment', PAYMENT_LABEL[terms.paymentMethod] || '—'));
    info.appendChild(line('Pickup', `${dateLabel(d.pickup.date)} ${windowLabel(d.pickup.windowStart, d.pickup.windowEnd)}`));
    if (d.pickup.location) info.appendChild(line('Place', d.pickup.location));
    if (d.status === 'awaiting_confirmation') info.appendChild(line('Confirmed', `${t('You')} ${d.confirmedByMe ? '✓' : '—'}  ${t('Them')} ${d.confirmedByOther ? '✓' : '—'}`));
    if (d.paymentStatus) info.appendChild(line('Payment', { pending: t('Pending'), received: t('Received'), not_applicable: t('Not applicable') }[d.paymentStatus]));
    if (d.cancelReason) info.appendChild(line('Cancelled', d.cancelReason));
    wrap.appendChild(info);
    if (d.status === 'handed_over') {
      const wait = d.role === 'buyer' ? (d.buyerReceived ? t('Waiting for the seller to record payment.') : '') : (d.buyerReceived ? '' : t('Waiting for the buyer to mark goods received.'));
      if (wait) wrap.appendChild(el('forum-hint', wait));
    }
    if (d.pickupCode) {
      const code = el('market-code');
      code.appendChild(el('forum-hint', t('Pickup code — show to the seller at handover')));
      code.appendChild(el('big', [...d.pickupCode].join(' ')));
      wrap.appendChild(code);
    }
    const list = el('list');
    p.actions.forEach((a, i) => list.appendChild(row(i + 1, a.label)));
    wrap.appendChild(list);
    wrap.appendChild(el('forum-hint', d.disclosure));
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

function dealActions(ctx, d) {
  const acts = [];
  const post = (action, body, ok) => (c) => act(c, () => marketApi.dealAction(d.id, action, body), ok);
  const cancel = { label: t('Cancel deal'), run: () => ctx.router.push('MarketReason', { title: 'Why cancel?', onPick: (reason, c) => { ctx.params.pending = post('cancel', { reason }, t('Cancelled.')); c.router.pop(); } }) };
  const schedule = (label) => ({ label, run: () => ctx.router.push('MarketForm', scheduleForm(d, (c) => c.router.pop())) });
  switch (d.status) {
    case 'awaiting_confirmation':
      if (!d.confirmedByMe) acts.push({ label: t('Confirm terms'), run: () => confirmTrade(ctx, {
        title: 'Confirm these terms?', verb: 'confirm', terms: d.terms, crop: d.crop.name, counterparty: d.counterparty.displayName, role: d.role, pickup: d.pickup,
        run: post('confirm', {}, t('Confirmed.')),
      }) });
      acts.push(cancel);
      break;
    case 'agreed':
      acts.push(schedule(t('Set pickup')), cancel);
      break;
    case 'pickup_scheduled':
      if (d.role === 'seller') {
        acts.push({ label: t('Enter pickup code'), run: () => ctx.router.push('MarketNumber', {
          title: 'Pickup code', decimals: 0, maxLen: 4, exactLength: 4,
          onDone: (code, c) => { ctx.params.pending = post('verify-pickup', { code }, t('Handover confirmed.')); c.router.pop(); },
        }) });
      }
      acts.push(schedule(t('Change pickup')), cancel);
      break;
    case 'handed_over':
      if (d.role === 'buyer' && !d.buyerReceived) acts.push({ label: t('Mark goods received'), run: () => confirm(ctx, { title: t('Goods received?'), yes: t('Yes, received'), run: post('received', {}, t('Marked received.')) }) });
      if (d.role === 'seller') {
        acts.push({ label: t('Record payment'), run: () => ctx.router.push('ForumPicker', {
          title: 'Payment', note: t('Only records what happened. AgriLink moves no money.'),
          options: [{ label: t('Paid — received'), value: 'received' }, { label: t('Not paid yet'), value: 'pending' }, { label: t('No payment needed'), value: 'not_applicable' }],
          onPick(o, c) { ctx.params.pending = post('payment-status', { status: o.value }, t('Payment recorded.')); c.router.pop(); },
        }) });
      }
      break;
    case 'completed':
      if (!d.ratedByMe) acts.push({ label: t('Rate this trade'), run: () => ctx.router.push('ForumPicker', {
        title: 'Rate', options: [5, 4, 3, 2, 1].map((n) => ({ label: `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`, value: n })),
        onPick(o, c) { ctx.params.pending = post('rating', { stars: o.value }, t('Thanks for rating.')); c.router.pop(); },
      }) });
      break;
    default:
  }
  return acts;
}

// Cancel reasons are preset choices: nobody types on a keypad to cancel a deal.
export const MarketReason = {
  name: 'MarketReason',
  numericSelect: true,
  title: (ctx) => ctx.params.title,
  softLeft: { label: '', handler() {} },
  render(ctx) {
    const wrap = el('forum-screen');
    const list = el('list');
    REASONS.forEach((r, i) => list.appendChild(row(i + 1, r)));
    wrap.appendChild(list);
    return wrap;
  },
  onEnter(_r, ctx, i) { ctx.params.onPick(REASONS[i], ctx); },
};
const REASONS = ['Changed my plans', 'Price or quantity changed', 'Cannot meet at that time', 'Other person not responding', 'Item no longer available'];
