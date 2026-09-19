import { el } from '../dom.js';
import { emptyView, loadingView } from '../forum/ui.js';
import { marketApi } from './marketApi.js';
import { counterForm, scheduleForm } from './marketForms.js';
import {
  DEAL_STATUS, OFFER_STATUS, PAYMENT_LABEL, confirm, dateLabel, evidenceLines, fmtNum, handleAuth, isRetry, line, marketError, money, perUnit, relTime, timeLeft, row,
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
  fetch: (p) => marketApi.offers(p.role),
  emptyText: (p) => (p.role === 'outgoing' ? 'You have not sent any offers.' : 'No offers waiting for your answer.'),
  item: (o) => card(o.id, `${o.awaitingMyResponse ? '● ' : ''}${o.crop.name} · ${fmtNum(o.terms.quantity)} ${o.terms.unit}`,
    `${perUnit(o.terms.unitPrice, o.terms.currency, o.terms.unit)} · ${o.counterparty.displayName}`,
    `${o.awaitingMyResponse ? 'Your turn' : OFFER_STATUS[o.status]} · ${relTime(o.updatedAt)}`),
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
    if (p.busy) { wrap.appendChild(loadingView('Working…')); return wrap; }
    const status = stateView(ctx, () => marketApi.getOffer(p.id));
    if (status) { wrap.appendChild(status); return wrap; }
    const { item: o, revisions } = p.state.data;
    p.actions = offerActions(ctx, o);
    if (p.notice) wrap.appendChild(el('forum-flash', p.notice));
    const t = o.terms;
    const info = el('forum-profile-card');
    info.appendChild(el('forum-title forum-title--full', `${o.crop.name} · ${OFFER_STATUS[o.status]}`));
    info.appendChild(line('With', o.counterparty.displayName));
    for (const ev of evidenceLines(o.counterparty.evidence)) info.appendChild(ev);
    info.appendChild(line('Quantity', `${fmtNum(t.quantity)} ${t.unit}`));
    info.appendChild(line('Price', perUnit(t.unitPrice, t.currency, t.unit)));
    info.appendChild(line('Est. total', money(t.estimatedTotal, t.currency)));
    info.appendChild(line('Pickup', `${dateLabel(t.pickupDate)} ${windowLabel(t.pickupWindowStart, t.pickupWindowEnd)}`));
    info.appendChild(line('Payment', `${PAYMENT_LABEL[t.paymentMethod]}`));
    if (t.note) info.appendChild(line('Note', t.note));
    info.appendChild(line('Round', `${revisions.length}${o.proposedByMe ? ' · yours' : ' · theirs'}`));
    if (['open', 'countered'].includes(o.status)) info.appendChild(line('Ends', timeLeft(o.expiresAt)));
    info.appendChild(el('forum-hint', 'Total is an estimate; weight may be measured at handover.'));
    if (o.onDemoPost && o.proposedByMe && ['open', 'countered'].includes(o.status)) {
      info.appendChild(el('forum-error-text', 'Demo post: nobody will answer this offer.'));
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
    acts.push({ label: 'Accept', run: () => confirm(ctx, {
      title: 'Accept offer?', note: `${fmtNum(o.terms.quantity)} ${o.terms.unit} will be reserved for this deal.`, yes: 'Yes, accept',
      run: async (c) => { const r = await act(c, () => marketApi.accept(o.id), 'Accepted.'); if (r) c.router.replace('MarketDeal', { id: r.dealId, notice: 'Deal created. Confirm the terms.' }); },
    }) });
    acts.push({ label: 'Counter', run: () => ctx.router.push('MarketForm', counterForm(o, (c) => c.router.pop())) });
    acts.push({ label: 'Decline', run: () => confirm(ctx, { title: 'Decline offer?', yes: 'Yes, decline', run: (c) => act(c, () => marketApi.decline(o.id), 'Declined.') }) });
  } else if (['open', 'countered'].includes(o.status)) {
    acts.push({ label: 'Withdraw', run: () => confirm(ctx, { title: 'Withdraw offer?', yes: 'Yes, withdraw', run: (c) => act(c, () => marketApi.withdraw(o.id), 'Withdrawn.') }) });
  }
  if (o.dealId) acts.push({ label: 'Open deal', run: () => ctx.router.push('MarketDeal', { id: o.dealId }) });
  return acts;
}

// ---------------------------------------------------------------- deals
export const MarketDeals = listScreen({
  name: 'MarketDeals',
  title: 'My deals',
  fetch: () => marketApi.deals(),
  emptyText: 'No deals yet. A deal appears once an offer is accepted.',
  item: (d) => card(d.id, `${d.crop.name} · ${fmtNum(d.terms.quantity)} ${d.terms.unit}`,
    `${d.role === 'buyer' ? 'Buying from' : 'Selling to'} ${d.counterparty.displayName}`, DEAL_STATUS[d.status]),
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
    if (p.busy) { wrap.appendChild(loadingView('Working…')); return wrap; }
    const status = stateView(ctx, () => marketApi.deal(p.id));
    if (status) { wrap.appendChild(status); return wrap; }
    const d = p.state.data.item;
    p.actions = dealActions(ctx, d);
    if (p.notice) wrap.appendChild(el('forum-flash', p.notice));
    const t = d.terms;
    const info = el('forum-profile-card');
    info.appendChild(el('forum-title forum-title--full', `${d.crop.name} · ${DEAL_STATUS[d.status]}`));
    info.appendChild(line(d.role === 'buyer' ? 'Seller' : 'Buyer', d.counterparty.displayName));
    for (const ev of evidenceLines(d.counterparty.evidence)) info.appendChild(ev);
    info.appendChild(line('Quantity', `${fmtNum(t.quantity)} ${t.unit}`));
    info.appendChild(line('Price', perUnit(t.unitPrice, t.currency, t.unit)));
    info.appendChild(line('Est. total', money(t.estimatedTotal, t.currency)));
    info.appendChild(line('Payment', PAYMENT_LABEL[t.paymentMethod] || '—'));
    info.appendChild(line('Pickup', `${dateLabel(d.pickup.date)} ${windowLabel(d.pickup.windowStart, d.pickup.windowEnd)}`));
    if (d.pickup.location) info.appendChild(line('Place', d.pickup.location));
    if (d.status === 'awaiting_confirmation') info.appendChild(line('Confirmed', `You ${d.confirmedByMe ? '✓' : '—'}  Them ${d.confirmedByOther ? '✓' : '—'}`));
    if (d.paymentStatus) info.appendChild(line('Payment', { pending: 'Pending', received: 'Received', not_applicable: 'Not applicable' }[d.paymentStatus]));
    if (d.cancelReason) info.appendChild(line('Cancelled', d.cancelReason));
    wrap.appendChild(info);
    if (d.status === 'handed_over') {
      const wait = d.role === 'buyer' ? (d.buyerReceived ? 'Waiting for the seller to record payment.' : '') : (d.buyerReceived ? '' : 'Waiting for the buyer to mark goods received.');
      if (wait) wrap.appendChild(el('forum-hint', wait));
    }
    if (d.pickupCode) {
      const code = el('market-code');
      code.appendChild(el('forum-hint', 'Pickup code — show to the seller at handover'));
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
  const cancel = { label: 'Cancel deal', run: () => ctx.router.push('MarketReason', { title: 'Why cancel?', onPick: (reason, c) => { ctx.params.pending = post('cancel', { reason }, 'Cancelled.'); c.router.pop(); } }) };
  const schedule = (label) => ({ label, run: () => ctx.router.push('MarketForm', scheduleForm(d, (c) => c.router.pop())) });
  switch (d.status) {
    case 'awaiting_confirmation':
      if (!d.confirmedByMe) acts.push({ label: 'Confirm terms', run: () => confirm(ctx, { title: 'Confirm these terms?', note: 'Both sides must confirm. This is a record of what you agreed, not a payment.', yes: 'Yes, confirm', run: post('confirm', {}, 'Confirmed.') }) });
      acts.push(cancel);
      break;
    case 'agreed':
      acts.push(schedule('Set pickup'), cancel);
      break;
    case 'pickup_scheduled':
      if (d.role === 'seller') {
        acts.push({ label: 'Enter pickup code', run: () => ctx.router.push('MarketNumber', {
          title: 'Pickup code', decimals: 0, maxLen: 4, exactLength: 4,
          onDone: (code, c) => { ctx.params.pending = post('verify-pickup', { code }, 'Handover confirmed.'); c.router.pop(); },
        }) });
      }
      acts.push(schedule('Change pickup'), cancel);
      break;
    case 'handed_over':
      if (d.role === 'buyer' && !d.buyerReceived) acts.push({ label: 'Mark goods received', run: () => confirm(ctx, { title: 'Goods received?', yes: 'Yes, received', run: post('received', {}, 'Marked received.') }) });
      if (d.role === 'seller') {
        acts.push({ label: 'Record payment', run: () => ctx.router.push('ForumPicker', {
          title: 'Payment', note: 'Only records what happened. AgriLink moves no money.',
          options: [{ label: 'Paid — received', value: 'received' }, { label: 'Not paid yet', value: 'pending' }, { label: 'No payment needed', value: 'not_applicable' }],
          onPick(o, c) { ctx.params.pending = post('payment-status', { status: o.value }, 'Payment recorded.'); c.router.pop(); },
        }) });
      }
      break;
    case 'completed':
      if (!d.ratedByMe) acts.push({ label: 'Rate this trade', run: () => ctx.router.push('ForumPicker', {
        title: 'Rate', options: [5, 4, 3, 2, 1].map((n) => ({ label: `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`, value: n })),
        onPick(o, c) { ctx.params.pending = post('rating', { stars: o.value }, 'Thanks for rating.'); c.router.pop(); },
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
