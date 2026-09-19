import { t } from '../i18n/index.js';
import { el } from '../dom.js';
import { identity } from '../state.js';
import { readAloud, stop as stopTts } from '../tts.js';
import { PAYMENT_LABEL, dateLabel, fmtNum, money, perUnit, windowLabel } from './marketUtils.js';
import { mandiReference, compare, againstMe } from './priceCheck.js';
import { freshness } from '../freshness.js';

// The one screen before a farmer commits to a trade (accepting an offer, confirming a deal's
// terms). Everything that matters on one screen with the total in large type; # reads it aloud
// in the member's language; and it is confirmed by typing the last two digits of the total, not
// by one press of OK. That small effort is deliberate: a pocket press, or someone at the market
// stall hurrying the farmer, cannot commit a trade. AgriLink moves no money: the screen says so.

let check = '';
let wrong = false;

const lastTwo = (total) => String(Math.round(Number(total) || 0) % 100).padStart(2, '0');

/**
 * Opens the confirm screen. `run(ctx)` is left as the caller's pending action (the same
 * contract as marketUtils.confirm) and runs when the caller's screen shows again.
 */
export function confirmTrade(ctx, { title, verb, terms, crop, cropCode, counterparty, role, pickup, run }) {
  const parent = ctx.params;
  ctx.router.push('TradeConfirm', {
    title, verb, terms, crop, cropCode, counterparty, role, pickup,
    onConfirm(c) { parent.pending = run; c.router.pop(); },
  });
}

// "Accept offer. Rice, 2 quintal at ₹2,200 per quintal. Total ₹4,400. Buyer Meena S. Cash on pickup."
function sentence(p) {
  const { terms } = p;
  return [
    t(p.title),
    t('{crop}, {qty} {unit} at {price} per {unit}.', { crop: t(p.crop), qty: fmtNum(terms.quantity), unit: t(terms.unit), price: money(terms.unitPrice, terms.currency) }),
    t('Total {total}.', { total: money(terms.estimatedTotal, terms.currency) }),
    `${t(p.role === 'buyer' ? 'Seller' : 'Buyer')} ${String(p.counterparty).replace(/\.$/, '')}.`, // "Meena S." ends in one full stop
    PAYMENT_LABEL[terms.paymentMethod] ? `${PAYMENT_LABEL[terms.paymentMethod]}.` : '',
    gapSentence(p),
    t('To confirm, type the last two digits of the total.'),
  ].filter(Boolean).join(' ');
}

// "Mandi today ₹2,537 per quintal. This price is 13% below the mandi."
function gapSentence(p) {
  const c = compare(p.terms, p.ref);
  if (!c) return '';
  return `${t('Mandi today {price} per quintal.', { price: money(Math.round(p.ref.price), p.ref.currency) })} ${gapText(c.pct)}.`;
}
const gapText = (pct) => (pct < 0 ? t('{pct}% below the mandi', { pct: -pct }) : pct > 0 ? t('{pct}% above the mandi', { pct }) : t('Same as the mandi'));

// The price check block: today's nearest mandi price, the gap, and where the mandi price is from.
function priceCheck(ctx) {
  const p = ctx.params;
  if (p.ref === undefined) {
    p.ref = null; p.refLoading = true;
    mandiReference(p.cropCode).then((ref) => { p.ref = ref; p.refLoading = false; if (!p.gone) ctx.rerender(); });
  }
  const box = el('trade-mandi');
  if (p.refLoading) { box.append(el('trade-k', t('Checking mandi price…'))); return box; }
  if (!p.ref) { box.append(el('trade-k', t('No mandi price to compare.'))); return box; }
  const c = compare(p.terms, p.ref);
  box.append(el('trade-line', `${t('Mandi today')}: ${money(Math.round(p.ref.price), p.ref.currency)}/${t('qt')} ${p.ref.market}`));
  if (c) {
    const warn = againstMe(p.role, c.pct);
    if (warn) box.classList.add('trade-mandi-warn'); // :has() is not a given on the cloud browser
    box.append(el(`trade-gap${warn ? ' trade-gap-warn' : ''}`, `${warn ? '⚠ ' : ''}${gapText(c.pct)}`));
  } else box.append(el('trade-k', t('Cannot compare a price per {unit}.', { unit: t(p.terms.unit) })));
  const f = freshness({ provider: p.ref.source, source: p.ref.sample ? 'sample' : 'live', date: p.ref.date });
  box.append(el(`trade-k${f.warn ? ' src-stale' : ''}`, f.text));
  return box;
}

export const TradeConfirm = {
  name: 'TradeConfirm',
  title: (ctx) => ctx.params.title,
  softLeft: { label: 'Read', handler: (ctx) => readAloud(sentence(ctx.params), identity.profile?.language || 'en') },
  softCenter: { label: '' },
  softRight: { label: 'Cancel', handler: (ctx) => ctx.router.pop() },
  // Order matters on 240×320: what and at what price, the mandi check, the total, then the box to
  // type in (always on screen), and the details last.
  render(ctx) {
    const p = ctx.params, { terms } = p;
    const wrap = el('forum-screen trade-confirm');
    wrap.appendChild(el('trade-what', `${t(p.crop)} · ${fmtNum(terms.quantity)} ${t(terms.unit)} · ${perUnit(terms.unitPrice, terms.currency, t(terms.unit))}`));
    wrap.appendChild(priceCheck(ctx));
    const total = el('trade-total');
    total.append(el('trade-k', t('Total (estimate)')), el('big', money(terms.estimatedTotal, terms.currency)));
    wrap.appendChild(total);
    const box = el(`trade-check${wrong ? ' trade-wrong' : ''}`);
    box.append(
      el('trade-k', wrong ? t('Does not match. Try again.') : t('Type the last 2 digits of the total to {verb}', { verb: t(p.verb) })),
      el('trade-digits', `${check.padEnd(2, '_').split('').join(' ')}`),
    );
    wrap.appendChild(box);
    wrap.appendChild(el('trade-line', `${t(p.role === 'buyer' ? 'Seller' : 'Buyer')}: ${p.counterparty} · ${PAYMENT_LABEL[terms.paymentMethod] || '—'}`));
    if (p.pickup?.date) wrap.appendChild(el('trade-line', `${t('Pickup')}: ${dateLabel(p.pickup.date)} ${windowLabel(p.pickup.windowStart, p.pickup.windowEnd)}`));
    wrap.appendChild(el('trade-note', `${t('AgriLink moves no money. Pay or get paid at handover.')} ${t('# Read aloud · * Delete')}`));
    return wrap;
  },
  onHide(ctx) { ctx.params.gone = true; check = ''; wrong = false; stopTts(); },
  onKey(action, ctx) {
    const p = ctx.params;
    if (action === 'HASH') { readAloud(sentence(p), identity.profile?.language || 'en'); return true; }
    if (action === 'STAR') { check = check.slice(0, -1); wrong = false; ctx.rerender(); return true; }
    if (!action.startsWith('NUM_')) return ['UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER'].includes(action);
    check += action.slice(4);
    if (check.length < 2) { wrong = false; ctx.rerender(); return true; }
    if (check === lastTwo(p.terms.estimatedTotal)) { check = ''; wrong = false; p.onConfirm(ctx); return true; }
    check = ''; wrong = true; ctx.rerender();
    return true;
  },
};
