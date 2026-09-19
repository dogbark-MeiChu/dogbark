import { t } from '../i18n/index.js';
import { identity } from '../state.js';
import { marketApi } from './marketApi.js';

// Near-real-time updates without WebSockets: poll the outbox replay endpoint every few seconds (the PRD's
// polling fallback). One request is tiny; it pauses while the page is hidden and backs off on errors.
const TEXT = {
  'offer.created': 'New offer on your post',
  'offer.countered': 'Counter offer received',
  'offer.declined': 'An offer was declined',
  'deal.awaiting_confirmation': 'Deal update: confirm the terms',
  'deal.agreed': 'Deal agreed by both sides',
  'deal.pickup_scheduled': 'Pickup was scheduled',
  'deal.handover_verified': 'Handover confirmed',
  'deal.completed': 'Deal completed',
  'deal.cancelled': 'A deal was cancelled',
  'listing.created': 'New produce for sale nearby',
  'buy_request.created': 'New buyer request nearby',
};
const INTERVAL = 4000;
const HIDE_MS = 5000;

export const describe = (events) => {
  const last = events[events.length - 1];
  const text = t(TEXT[last.kind] || 'Market update');
  return events.length > 1 ? t('{text} (+{n} more)', { text, n: events.length - 1 }) : text;
};

export function startMarketSync({ router, toast = document.getElementById('toast') }) {
  let cursor = null;
  let user = null;
  let failures = 0;
  let timer = null;
  let hideTimer = null;
  let stopped = false;

  const show = (text) => {
    if (!toast) return;
    toast.textContent = `● ${text}`;
    toast.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { toast.hidden = true; }, HIDE_MS);
  };
  const schedule = (ms = INTERVAL * Math.min(failures + 1, 5)) => { clearTimeout(timer); if (!stopped) timer = setTimeout(tick, ms); };

  async function tick() {
    const me = identity.profile?.id || null;
    if (!me || document.hidden) return schedule();
    if (me !== user) { user = me; cursor = null; } // new sign-in: start from "now"
    try {
      const res = await marketApi.sync(cursor);
      failures = 0;
      cursor = res.cursor;
      if (res.events.length) { show(describe(res.events)); router.refresh(); }
    } catch (err) {
      if (err.status === 503 || err.status === 404) { stopped = true; return; } // market not enabled on this server
      failures += 1;
    }
    schedule();
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
  schedule(0);
  return { stop() { stopped = true; clearTimeout(timer); } };
}
