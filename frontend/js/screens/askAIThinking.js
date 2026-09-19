import { t } from '../i18n/index.js';
import { el, isCompact } from '../dom.js';
import { session, runPending, cancel } from '../askAI.js';

// Honest progress labels (what the app is doing), not fake model "thoughts".
function steps() {
  const s = [];
  const p = session.pending || {};
  if (p.audio) s.push(t('Listening to voice'));
  if (p.image) s.push(t('Looking at photo'));
  s.push(t('Reading question'), t('Checking context'), t('Preparing steps'));
  return s;
}

// Errors the farmer fixes in the composer rather than by reading a fallback.
const BACK_TO_COMPOSER = new Set(['INVALID_INPUT', 'MEDIA_UNSUPPORTED', 'MEDIA_TOO_LARGE']);

let ticker = null;
let running = null; // the request this screen instance started

function stopTicker() { clearInterval(ticker); ticker = null; }

function leave(ctx) {
  stopTicker();
  cancel();
  // A composer draft (and a recording) is kept so one retry is a single key press.
  if (session.origin === 'input') ctx.router.replace('AskAIInput', { followUp: session.followUp });
  else ctx.router.pop();
}

export default {
  name: 'AskAIThinking',
  title: 'AgriLink AI',
  statusBadge: () => '◌ …',
  softLeft: { label: '', handler() {} },
  softCenter: { label: '' },
  softRight: { label: 'Cancel', handler: (ctx) => leave(ctx) },

  render() {
    const wrap = el('ai-screen ai-thinking');
    const orb = el('ai-orb ai-orb-busy');
    const label = el('ai-progress-label', steps()[0]);
    const bar = el('ai-progress');
    bar.appendChild(el('ai-progress-fill'));
    wrap.append(orb, label, bar);
    if (session.question && !isCompact()) wrap.appendChild(el('ai-echo', `“${session.question.slice(0, 80)}”`));
    wrap.appendChild(el('ai-hint', t('Right key cancels')));
    return wrap;
  },

  onShow(ctx) {
    if (session.phase !== 'thinking' || running) return;
    const labels = steps();
    let i = 0;
    ticker = setInterval(() => {
      i = Math.min(i + 1, labels.length - 1);
      const node = ctx.root.querySelector('.ai-progress-label');
      if (node) node.textContent = labels[i];
    }, 1200);

    const mine = runPending();
    running = mine;
    mine.finally(() => {
      if (running !== mine) return; // superseded or cancelled; this screen is gone
      running = null;
      stopTicker();
      if (session.phase === 'idle') return; // cancelled
      const code = session.error?.code;
      if (code && BACK_TO_COMPOSER.has(code) && session.origin === 'input') {
        ctx.router.replace('AskAIInput', { followUp: session.followUp, notice: session.error.message });
        return;
      }
      ctx.router.replace('AskAIAnswer', {
        result: session.result,
        question: session.question,
        error: session.error ? { code: session.error.code, message: session.error.message } : null,
        retry: session.error?.retryable ? { ...session.pending } : null,
      });
    });
  },

  // Platform Back (history.back) arrives here too: never leave a paid request running.
  onHide() {
    stopTicker();
    if (session.phase === 'thinking') {
      running = null;
      cancel();
    }
  },

  // Swallow stray presses while waiting; only Cancel/Back get through.
  onKey: (action) => action !== 'SOFT_R' && action !== 'BACK',
};
