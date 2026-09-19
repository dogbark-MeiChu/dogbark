import { el } from '../dom.js';
import { identity } from '../state.js';
import { errorText, newRequestId, relTime } from '../forum/forumUtils.js';
import { loadingView, errorView } from '../forum/ui.js';

export { newRequestId, relTime };

export const UNITS = ['kg', 'bag', 'crate', 'quintal', 'ton'];
export const PAYMENT_LABEL = {
  cash_on_pickup: 'Cash on pickup', external_mobile_money: 'Mobile money (outside app)',
  external_bank_transfer: 'Bank transfer (outside app)', pay_after_delivery: 'Pay after delivery',
};
export const FULFILL_LABEL = { pickup: 'Pickup', buyer_pickup: 'Buyer pickup', seller_delivery: 'Seller delivers', negotiable: 'Negotiable' };
export const GRADE_LABEL = { A: 'Grade A', B: 'Grade B', C: 'Grade C', not_graded: 'Not graded', not_specified: 'Any grade' };
export const PRICING_LABEL = { fixed: 'Fixed price', negotiable: 'Negotiable', request_offers: 'Request offers' };
export const DEAL_STATUS = {
  awaiting_confirmation: 'Awaiting confirmation', agreed: 'Agreed', pickup_scheduled: 'Pickup set', handed_over: 'Handed over',
  completed: 'Completed', cancelled: 'Cancelled', no_show: 'No show', disputed: 'Disputed',
};
export const OFFER_STATUS = { open: 'Open', countered: 'Countered', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn', expired: 'Expired' };
export const EVIDENCE_BAND = { new: 'New member', established: 'Established trader' };

// Numbers keep at most 3 decimals, without trailing zeros.
export const fmtNum = (n) => String(Number(Number(n).toFixed(3)));
const SYMBOL = { INR: '₹' };
export const money = (n, cur = 'INR') => `${SYMBOL[cur] || `${cur} `}${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
export const perUnit = (n, cur, unit) => `${money(n, cur)}/${unit}`;

export function dateLabel(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
const localDay = (offset) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Date choices instead of typing dates on a keypad. */
export const dayOptions = (count = 7) => Array.from({ length: count }, (_, i) => ({
  value: localDay(i), label: `${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dateLabel(localDay(i))}${i < 2 ? ` · ${dateLabel(localDay(i))}` : ''}`,
}));
export const WINDOWS = [
  { label: 'Any time', value: null }, { label: '06:00–09:00', value: ['06:00', '09:00'] }, { label: '09:00–11:00', value: ['09:00', '11:00'] },
  { label: '11:00–14:00', value: ['11:00', '14:00'] }, { label: '14:00–17:00', value: ['14:00', '17:00'] },
];
export function timeLeft(iso, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))} min left`;
  return h < 48 ? `${h} h left` : `${Math.floor(h / 24)} days left`;
}
export const windowLabel = (s, e) => (s && e ? `${s}–${e}` : 'Any time');

const SHOWN = ['INVALID_STATE', 'CONFLICT', 'QUANTITY_UNAVAILABLE', 'PICKUP_LOCKED', 'VALIDATION_ERROR', 'FORBIDDEN', 'RATE_LIMITED'];
export const marketError = (err) => (SHOWN.includes(err?.code) && err.message ? err.message : errorText(err));

/** Session gone: same gate the forum uses. Returns true when it handled the error. */
export function handleAuth(ctx, err) {
  if (err?.code !== 'AUTH_REQUIRED') return false;
  identity.profile = null;
  ctx.router.replace('AuthGate');
  return true;
}

// Async screens keep {status,data,error} on their params so a re-render never refetches.
export function load(ctx, fetcher) {
  const p = ctx.params;
  const root = ctx.root;
  p.state = { status: 'loading' };
  fetcher().then((data) => { p.state = { status: 'ready', data }; })
    .catch((error) => { p.state = { status: 'error', error }; })
    .finally(() => { if (ctx.root === root) ctx.rerender(); });
}
export function stateView(ctx, fetcher) {
  const p = ctx.params;
  p.fetcher = fetcher;
  if (!p.state) load(ctx, fetcher);
  if (p.state.status === 'loading') return loadingView();
  if (p.state.status === 'error') {
    if (p.state.error?.code === 'AUTH_REQUIRED') { queueMicrotask(() => handleAuth(ctx, p.state.error)); return loadingView(); }
    return errorView({ ...p.state.error, code: p.state.error.code, message: marketError(p.state.error) });
  }
  return null;
}
/** Silent refetch for the open screen (used when the sync poller sees news): keeps focus, shows no spinner. */
export async function refreshScreen(ctx) {
  const p = ctx.params;
  if (!p?.fetcher || p.state?.status !== 'ready' || p.busy || p.pending) return;
  const root = ctx.root;
  try {
    const data = await p.fetcher();
    if (ctx.root !== root || p.busy) return;
    p.focusIndex = ctx.focus?.index ?? p.focusIndex;
    p.state = { status: 'ready', data };
    ctx.rerender();
  } catch { /* the next tick or a manual retry will recover */ }
}
export const isRetry = (row) => row?.dataset?.act === 'retry';

/** Runs an action after a Yes/No picker, once the picker has been popped (see screens' onShow). */
export function confirm(ctx, { title, note, yes, run }) {
  const parent = ctx.params;
  ctx.router.push('ForumPicker', {
    title, note,
    options: [{ label: yes, value: true }, { label: 'No, go back', value: false }],
    onPick(o, c) { parent.pending = o.value ? run : null; c.router.pop(); },
  });
}
export function runPending(ctx) {
  const run = ctx.params?.pending;
  if (run) { ctx.params.pending = null; run(ctx); }
}

export const row = (n, label, value) => {
  const r = el('item forum-choice');
  r.appendChild(el('forum-choice-n', n == null ? '·' : String(n), 'span'));
  r.appendChild(el('forum-choice-label', label, 'span'));
  if (value) r.appendChild(el('forum-choice-value', value, 'span'));
  return r;
};
export const line = (label, value) => {
  const d = el('market-line');
  d.appendChild(el('market-k', label, 'span'));
  d.appendChild(el('market-v', value, 'span'));
  return d;
};
export function evidenceLines(evidence) {
  if (!evidence) return [];
  const label = EVIDENCE_BAND[evidence.band] || evidence.band;
  const stars = evidence.avgStars != null ? ` · ${evidence.avgStars}★` : '';
  const deals = `${evidence.completedDeals} deal${evidence.completedDeals !== 1 ? 's' : ''}`;
  return [line('Status', label), line('Record', `${deals}${stars}`)];
}
