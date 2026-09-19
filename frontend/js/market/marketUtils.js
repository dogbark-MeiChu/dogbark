import { t, dateLocale } from '../i18n/index.js';
import { el } from '../dom.js';
import { identity } from '../state.js';
import { errorText, newRequestId, relTime } from '../forum/forumUtils.js';
import { loadingView, errorView } from '../forum/ui.js';

export { newRequestId, relTime };

export const UNITS = ['kg', 'bag', 'crate', 'quintal', 'ton'];
export const PAYMENT_LABEL = {
  cash_on_pickup: t('Cash on pickup'), external_mobile_money: t('Mobile money (outside app)'),
  external_bank_transfer: t('Bank transfer (outside app)'), pay_after_delivery: t('Pay after delivery'),
};
export const FULFILL_LABEL = { pickup: t('Pickup'), buyer_pickup: t('Buyer pickup'), seller_delivery: t('Seller delivers'), negotiable: t('Negotiable') };
export const GRADE_LABEL = { A: t('Grade A'), B: t('Grade B'), C: t('Grade C'), not_graded: t('Not graded'), not_specified: t('Any grade') };
export const PRICING_LABEL = { fixed: t('Fixed price'), negotiable: t('Negotiable'), request_offers: t('Request offers') };
export const DEAL_STATUS = {
  awaiting_confirmation: t('Awaiting confirmation'), agreed: t('Agreed'), pickup_scheduled: t('Pickup set'), handed_over: t('Handed over'),
  completed: t('Completed'), cancelled: t('Cancelled'), no_show: t('No show'), disputed: t('Disputed'),
};
export const OFFER_STATUS = { open: t('Open (status)'), countered: t('Countered'), accepted: t('Accepted'), declined: t('Declined'), withdrawn: t('Withdrawn'), expired: t('Expired') };

// Numbers keep at most 3 decimals, without trailing zeros.
export const fmtNum = (n) => String(Number(Number(n).toFixed(3)));
const SYMBOL = { INR: '₹' };
export const money = (n, cur = 'INR') => `${SYMBOL[cur] || `${cur} `}${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
export const perUnit = (n, cur, unit) => `${money(n, cur)}/${unit}`;

export function dateLabel(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(dateLocale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
const localDay = (offset) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Date choices instead of typing dates on a keypad. */
export const dayOptions = (count = 7) => Array.from({ length: count }, (_, i) => ({
  value: localDay(i), label: `${i === 0 ? t('Today') : i === 1 ? t('Tomorrow') : dateLabel(localDay(i))}${i < 2 ? ` · ${dateLabel(localDay(i))}` : ''}`,
}));
export const WINDOWS = [
  { label: t('Any time'), value: null }, { label: '06:00–09:00', value: ['06:00', '09:00'] }, { label: '09:00–11:00', value: ['09:00', '11:00'] },
  { label: '11:00–14:00', value: ['11:00', '14:00'] }, { label: '14:00–17:00', value: ['14:00', '17:00'] },
];
export function timeLeft(iso, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return t('expired');
  const h = Math.floor(ms / 3600000);
  if (h < 1) return t('{n} min left', { n: Math.max(1, Math.floor(ms / 60000)) });
  return h < 48 ? t('{n} h left', { n: h }) : t('{n} days left', { n: Math.floor(h / 24) });
}
export const windowLabel = (s, e) => (s && e ? `${s}–${e}` : t('Any time'));

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
    options: [{ label: yes, value: true }, { label: t('No, go back'), value: false }],
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
  r.appendChild(el('forum-choice-label', t(label), 'span'));
  if (value) r.appendChild(el('forum-choice-value', value, 'span'));
  return r;
};
export const line = (label, value) => {
  const d = el('market-line');
  d.appendChild(el('market-k', t(label), 'span'));
  d.appendChild(el('market-v', value, 'span'));
  return d;
};

export function appendEvidence(container, evidence) {
  if (!evidence) return;
  const band = evidence.band === 'established' ? t('Established trader')
    : evidence.band === 'restricted' ? t('Restricted') : t('New member');
  container.appendChild(line('Trade history', band));
  if (evidence.completedDeals === 0) {
    container.appendChild(line('Evidence', t('No completed history yet')));
  } else {
    container.appendChild(line('Evidence', t('{deals} deals · {people} traders', {
      deals: evidence.completedDeals, people: evidence.distinctCounterparties,
    })));
    container.appendChild(line('Handovers', String(evidence.verifiedHandovers)));
  }
  if (evidence.ratingCount > 0) {
    container.appendChild(line('Ratings', evidence.averageRating == null
      ? t('{n} ratings · sample too small', { n: evidence.ratingCount })
      : `${evidence.averageRating}/5 · ${evidence.ratingCount}`));
  }
}
