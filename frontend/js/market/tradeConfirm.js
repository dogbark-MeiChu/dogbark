import { t } from '../i18n/index.js';
import { el } from '../dom.js';
import { identity } from '../state.js';
import { readAloud, stop as stopTts } from '../tts.js';
import { PAYMENT_LABEL, dateLabel, fmtNum, money, perUnit, windowLabel } from './marketUtils.js';

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
export function confirmTrade(ctx, { title, verb, terms, crop, counterparty, role, pickup, run }) {
  const parent = ctx.params;
  ctx.router.push('TradeConfirm', {
    title, verb, terms, crop, counterparty, role, pickup,
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
    t('To confirm, type the last two digits of the total.'),
  ].filter(Boolean).join(' ');
}

export const TradeConfirm = {
  name: 'TradeConfirm',
  title: (ctx) => ctx.params.title,
  softLeft: { label: 'Read', handler: (ctx) => readAloud(sentence(ctx.params), identity.profile?.language || 'en') },
  softCenter: { label: '' },
  softRight: { label: 'Cancel', handler: (ctx) => ctx.router.pop() },
  render(ctx) {
    const p = ctx.params, { terms } = p;
    const wrap = el('forum-screen trade-confirm');
    wrap.appendChild(el('trade-what', `${t(p.crop)} · ${fmtNum(terms.quantity)} ${t(terms.unit)}`));
    wrap.appendChild(el('trade-price', perUnit(terms.unitPrice, terms.currency, t(terms.unit))));
    const total = el('trade-total');
    total.append(el('trade-k', t('Total (estimate)')), el('big', money(terms.estimatedTotal, terms.currency)));
    wrap.appendChild(total);
    wrap.appendChild(el('trade-line', `${t(p.role === 'buyer' ? 'Seller' : 'Buyer')}: ${p.counterparty}`));
    wrap.appendChild(el('trade-line', PAYMENT_LABEL[terms.paymentMethod] || '—'));
    if (p.pickup?.date) wrap.appendChild(el('trade-line', `${t('Pickup')}: ${dateLabel(p.pickup.date)} ${windowLabel(p.pickup.windowStart, p.pickup.windowEnd)}`));
    wrap.appendChild(el('trade-note', t('AgriLink moves no money. Pay or get paid at handover.')));
    const box = el(`trade-check${wrong ? ' trade-wrong' : ''}`);
    box.append(
      el('trade-k', wrong ? t('Does not match. Try again.') : t('Type the last 2 digits of the total to {verb}', { verb: t(p.verb) })),
      el('trade-digits', `${check.padEnd(2, '_').split('').join(' ')}`),
    );
    wrap.appendChild(box);
    wrap.appendChild(el('trade-note', t('# Read aloud · * Delete')));
    return wrap;
  },
  onHide() { check = ''; wrong = false; stopTts(); },
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
