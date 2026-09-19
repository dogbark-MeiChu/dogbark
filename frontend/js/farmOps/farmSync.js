import { t } from '../i18n/index.js';
import { identity } from '../state.js';
import { getApi } from '../api.js';

// Near-real-time Today's Farm across phones, the same way as the market (market/marketSync.js):
// poll /api/farms/sync every few seconds for what the other members did. A worker starting or
// finishing a task shows on the owner's phone within seconds, and the open screen refetches.
const INTERVAL = 5000;
const HIDE_MS = 5000;
const STATUS = { in_progress: 'started', completed: 'finished', verified: 'verified', blocked: 'blocked', delayed: 'delayed', cancelled: 'cancelled', accepted: 'accepted' };

/** "Asha P. started Irrigate north section" (+ "(+2 more)" when several arrived at once). */
export function describe(events) {
  const e = events[events.length - 1];
  const who = e.actor || t('Someone');
  let text;
  if (e.kind === 'status_changed' && STATUS[e.status]) text = t(`{who} ${STATUS[e.status]} {task}`, { who, task: e.task });
  else if (e.kind === 'assigned') text = t('{who} assigned {task}', { who, task: e.task });
  else if (e.kind === 'rescheduled') text = t('{who} moved {task}', { who, task: e.task });
  else if (e.kind === 'created') text = t('{who} added {task}', { who, task: e.task });
  else text = t('{who} updated {task}', { who, task: e.task });
  return events.length > 1 ? t('{text} (+{n} more)', { text, n: events.length - 1 }) : text;
}

export function startFarmSync({ router, toast = document.getElementById('toast') }) {
  let cursor = null, user = null, failures = 0, timer = null, hideTimer = null, stopped = false;
  const show = (text) => {
    if (!toast) return;
    toast.textContent = `🌾 ${text}`;
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
      const res = await getApi(`/api/farms/sync${cursor ? `?since=${encodeURIComponent(cursor)}` : ''}`, { timeout: 6000 });
      failures = 0;
      cursor = res.cursor;
      if (res.events.length) { show(describe(res.events)); router.refresh(); }
    } catch (err) {
      if (err.status === 503 || err.status === 404) { stopped = true; return; } // Today's Farm not on this server
      failures += 1;
    }
    schedule();
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
  schedule(0);
  return { stop() { stopped = true; clearTimeout(timer); } };
}
