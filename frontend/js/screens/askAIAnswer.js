import { t } from '../i18n/index.js';
import { el, isCompact } from '../dom.js';
import { ask, composer, saveAnswer, track } from '../askAI.js';

// Structured answer: a fixed sequence of cards built from validated JSON.
// Every string goes through textContent (see dom.js); nothing is parsed as markup.
//
// Each card is a focus .item. Up/Down first scrolls through a card taller than the
// screen, then moves to the next card, so no content is ever unreachable.

const expanded = new Set();
let toastTimer = null;

function card(kind, title, { open = true, preview = '', cls = '' } = {}) {
  const c = el(`item ai-card ai-card-${kind} ${cls}`.trim());
  c.dataset.kind = kind;
  const head = el('ai-card-title', title);
  if (!open) head.append(el('ai-card-more', ' ▸', 'span'));
  c.appendChild(head);
  if (!open && preview) c.appendChild(el('ai-card-preview', preview));
  return c;
}

function bullets(parent, items, numbered = false) {
  items.forEach((text, i) => {
    const row = el('ai-line');
    row.append(el('ai-line-mark', numbered ? String(i + 1) : '•'), el('ai-line-text', text));
    parent.appendChild(row);
  });
}

function trustChips(meta = {}, error) {
  const chips = [];
  if (meta.offline || error) chips.push([t('OFFLINE'), 'warn']);
  else if (meta.fallback) chips.push([t('BASIC TIPS'), 'warn']);
  if (meta.stale) chips.push([t('CACHED'), 'dim']);
  if (meta.sampleData) chips.push([t('SAMPLE DATA'), 'dim']);
  return chips;
}

function buildCards(params) {
  const { result, error, retry, question } = params;
  const a = result.answer;
  const cards = [];
  const compact = isCompact();

  if (error) {
    const c = card('error', retry ? t('⟳ Retry') : t('Could not reach AI'));
    c.appendChild(el('ai-card-body', error.message));
    if (retry) c.appendChild(el('ai-hint', t('Press Enter to try again')));
    cards.push(c);
  }

  if (result.transcript) {
    const c = card('heard', t('We heard'));
    c.appendChild(el('ai-card-body', `“${result.transcript}”`));
    cards.push(c);
  } else if (question && !compact) {
    const q = el('ai-question', question);
    cards.push(q); // not focusable: context only
  }

  if (a.needs_better_photo && a.retake_instruction) {
    const c = card('retake', t('Retake photo'));
    c.appendChild(el('ai-card-body', a.retake_instruction));
    cards.push(c);
  }

  const bottom = card('bottom', t('Bottom line'));
  const chips = trustChips(result.meta, error);
  if (chips.length) {
    const row = el('ai-chips');
    chips.forEach(([label, tone]) => row.appendChild(el(`ai-chip ${tone}`, label)));
    bottom.appendChild(row);
  }
  bottom.appendChild(el('ai-headline', a.headline));
  if (!compact) bottom.appendChild(el('ai-card-body', a.summary));
  cards.push(bottom);

  const now = card('now', t('Do now'));
  a.actions.forEach((act, i) => {
    const row = el('ai-line');
    const text = el('ai-line-text');
    text.appendChild(el('ai-action-label', act.label));
    if (act.detail && !compact) text.appendChild(el('ai-action-detail', act.detail));
    row.append(el('ai-line-mark', String(i + 1)), text);
    now.appendChild(row);
  });
  cards.push(now);

  // Optional cards start collapsed; Enter opens them. Warnings are always open.
  if (a.warnings.length) {
    const c = card('warning', t('⚠ Watch for'), { cls: 'ai-warning' });
    bullets(c, a.warnings);
    cards.push(c);
  }
  const optional = [
    ['why', t('Why'), a.reasons],
    ['context', t('Local context'), a.context_used],
    ['sources', t('Sources ({n})', { n: a.sources.length }), a.sources.map((s) => s.label)],
  ];
  for (const [kind, title, items] of optional) {
    if (!items.length) continue;
    const open = expanded.has(kind);
    const c = card(kind, title, { open, preview: items[0], cls: kind === 'sources' ? 'ai-source' : '' });
    if (open) bullets(c, items);
    cards.push(c);
  }

  if (a.follow_ups.length) {
    const c = card('followups', t(compact ? '1 Follow-up' : 'Ask next (1)'), { cls: 'ai-followup' });
    bullets(c, a.follow_ups);
    cards.push(c);
  }

  const foot = el('ai-disclaimer', compact ? t('2 Src · 3 Ask farmers · * Save') : `${a.disclaimer} · ${t('2 Sources · 3 Ask farmers · * Save')}`);
  cards.push(foot);
  return cards;
}

function toast(ctx, text) {
  let node = ctx.root.querySelector('.ai-toast');
  if (!node) { node = el('ai-toast'); ctx.root.appendChild(node); }
  node.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 1500);
}

// Moves within a tall card before moving between cards.
function step(ctx, dir) {
  const root = ctx.root;
  const cur = ctx.focus.current;
  if (cur) {
    const r = cur.getBoundingClientRect();
    const view = root.getBoundingClientRect();
    const page = Math.max(24, Math.round(view.height * 0.7));
    if (dir > 0 && r.bottom > view.bottom + 2) { root.scrollTop += page; return; }
    if (dir < 0 && r.top < view.top - 2) { root.scrollTop -= page; return; }
  }
  const before = ctx.focus.index;
  ctx.focus.move(dir);
  // At the last card, keep scrolling so the disclaimer footer is reachable.
  if (ctx.focus.index === before) root.scrollTop += dir * Math.round(root.clientHeight * 0.7);
}

function openFollowUp(ctx) {
  const a = ctx.params.result.answer;
  composer.reset({ keepConversation: true });
  ctx.router.push('AskAIInput', { followUp: true, followUps: a.follow_ups });
}

function askFarmers(ctx) {
  // Carry the question over locally so Farmer Circle can prefill it when it exists.
  try { localStorage.setItem('agrilink.circle.draft', ctx.params.question || ''); } catch { /* ignore */ }
  track('farmer_circle_escalated');
  ctx.router.push('ComingSoon', { title: t('Farmer Circle') });
}

export default {
  name: 'AskAIAnswer',
  title: () => (isCompact() ? 'AI' : 'AI Answer'),
  statusBadge: (ctx) => t((ctx.params?.result?.answer?.confidence || 'low').toUpperCase()),
  softLeft: { label: () => (isCompact() ? 'F-up' : 'Follow-up'), handler: (ctx) => openFollowUp(ctx) },
  softCenter: { label: 'More' },
  softRight: { label: 'Back', handler: (ctx) => ctx.router.pop() },

  render(ctx) {
    const wrap = el('ai-screen ai-answer');
    buildCards(ctx.params).forEach((c) => wrap.appendChild(c));
    return wrap;
  },

  initialFocus(ctx) {
    // Land on the bottom line (or the retry card when something failed).
    const i = ctx.focus.items.findIndex((c) => c.dataset.kind === 'error' || c.dataset.kind === 'bottom');
    return i < 0 ? 0 : i;
  },

  onHide() { expanded.clear(); clearTimeout(toastTimer); },

  onKey(action, ctx) {
    switch (action) {
      case 'UP': step(ctx, -1); return true;
      case 'DOWN': step(ctx, 1); return true;
      case 'LEFT': ctx.root.scrollTop -= Math.round(ctx.root.clientHeight * 0.8); return true;
      case 'RIGHT': ctx.root.scrollTop += Math.round(ctx.root.clientHeight * 0.8); return true;
      case 'NUM_1': openFollowUp(ctx); return true;
      case 'NUM_2': ctx.router.push('AskAISources', { sources: ctx.params.result.answer.sources }); return true;
      case 'NUM_3': askFarmers(ctx); return true;
      case 'STAR': toast(ctx, saveAnswer(ctx.params.question, ctx.params.result.answer) ? t('Saved on phone') : t('Nothing to save')); return true;
      default:
        return action.startsWith('NUM_'); // ignore other digits
    }
  },

  onEnter(item, ctx) {
    const kind = item?.dataset.kind;
    if (kind === 'error' && ctx.params.retry) {
      ask(ctx, { ...ctx.params.retry, replace: true, origin: 'home' });
      return;
    }
    if (kind === 'followups') { openFollowUp(ctx); return; }
    if (['why', 'context', 'sources'].includes(kind)) {
      if (expanded.has(kind)) expanded.delete(kind); else expanded.add(kind);
      const i = ctx.focus.index;
      ctx.rerender();
      ctx.focus.set(i);
    }
  },
};

// Compact source list. Links are shown, not opened: the handset browser may not
// support leaving the app, and a source is only listed if the backend used it.
export const AskAISources = {
  name: 'AskAISources',
  title: 'Sources',
  softCenter: { label: '' },
  render(ctx) {
    const wrap = el('ai-screen list');
    const sources = ctx.params?.sources || [];
    if (!sources.length) {
      wrap.appendChild(el('msg', t('No external sources. Answer uses your farm context only.')));
      return wrap;
    }
    sources.forEach((s, i) => {
      const row = el('item ai-source');
      row.append(el('ai-line-mark', String(i + 1)), el('ai-line-text', s.url ? `${s.label} · ${s.url.replace(/^https?:\/\//, '')}` : s.label));
      wrap.appendChild(row);
    });
    return wrap;
  },
};
