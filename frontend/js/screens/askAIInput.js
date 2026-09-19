import { t } from '../i18n/index.js';
import { el, isCompact } from '../dom.js';
import { MultiTap, suggest, WINDOW_MS } from '../t9.js';
import { composer, ask, MAX_TEXT } from '../askAI.js';

// Keypad text entry. Paints in place on each key instead of calling rerender,
// so typing stays instant on a slow handset.
const mt = new MultiTap({ max: MAX_TEXT });
let nodes = null;
let commitTimer = null;
let suggestions = [];
let suggestionIndex = -1;
let draftBeforeSuggestion = '';

function followUps(ctx) { return ctx.params?.followUps || []; }

// `cycling` = the text was just replaced by a suggestion; keep the list being cycled.
function paint(ctx, { cycling = false } = {}) {
  if (!nodes) return;
  const committed = mt.text;
  const full = mt.value;
  nodes.committed.textContent = committed;
  nodes.pending.textContent = full.slice(committed.length);
  nodes.placeholder.hidden = full.length > 0;
  nodes.count.textContent = `${full.length}/${MAX_TEXT}`;
  nodes.attachment.textContent = composer.attachmentLabel;
  nodes.attachment.classList.toggle('on', Boolean(composer.image || composer.audio));

  composer.text = full;
  if (cycling) return;

  // Up/Down offers completions for what is typed, or the answer's follow-ups when
  // empty or when the box still holds one of them (the pre-filled first follow-up).
  const fu = followUps(ctx);
  const fuIndex = fu.indexOf(full);
  suggestions = full.trim() && fuIndex === -1 ? suggest(full) : fu;
  suggestionIndex = fuIndex;
  nodes.hint.textContent = fuIndex !== -1
    ? t('Send to ask · ▲▼ other ({i}/{n})', { i: fuIndex + 1, n: fu.length })
    : suggestions.length
    ? t(suggestions.length > 1 ? '▲▼ {n} suggestions' : '▲▼ {n} suggestion', { n: suggestions.length })
    : t(isCompact() ? '##=send *=del' : '# # send · * delete · 0 space');
}

function scheduleCommit(ctx) {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => { mt.commit(); paint(ctx); }, WINDOW_MS);
}

function cycleSuggestion(ctx, dir) {
  if (!suggestions.length) return;
  if (suggestionIndex === -1) draftBeforeSuggestion = mt.value;
  const n = suggestions.length + 1; // extra slot = back to the user's own draft
  suggestionIndex = ((suggestionIndex + 1 + dir + n) % n) - 1;
  const text = suggestionIndex === -1 ? draftBeforeSuggestion : suggestions[suggestionIndex];
  mt.set(text);
  paint(ctx, { cycling: true });
  nodes.hint.textContent = suggestionIndex === -1 ? t('Your text') : t('Suggestion {i}/{n}', { i: suggestionIndex + 1, n: suggestions.length });
}

function submit(ctx) {
  mt.commit();
  paint(ctx);
  const text = mt.value.trim();
  if (!text && !composer.image && !composer.audio) {
    nodes.hint.textContent = t('Type a question first');
    nodes.box.classList.add('shake');
    setTimeout(() => nodes?.box.classList.remove('shake'), 300);
    return;
  }
  ask(ctx, {
    text,
    image: composer.image,
    audio: composer.audio,
    followUp: Boolean(ctx.params?.followUp),
    replace: true,
  });
}

export default {
  name: 'AskAIInput',
  title: (ctx) => (ctx.params?.followUp ? 'Follow-up' : 'Ask AI'),
  statusBadge: () => (composer.language === 'hi' ? 'HI' : 'EN'),
  softLeft: { label: () => (isCompact() ? 'Opt' : 'Options'), handler: (ctx) => ctx.router.push('AskAIMedia', { from: 'input' }) },
  softCenter: { label: 'Send', handler: (ctx) => submit(ctx) },
  softRight: {
    label: 'Cancel',
    handler(ctx) {
      clearTimeout(commitTimer);
      composer.reset({ keepConversation: true });
      mt.clear();
      ctx.router.pop();
    },
  },

  render(ctx) {
    mt.set(composer.text);
    suggestionIndex = -1;
    // Coming from an answer: pre-fill the first suggested follow-up so pressing 1
    // visibly does something and one more key asks it. Only once per screen entry.
    const fu = followUps(ctx);
    if (ctx.params?.followUp && fu.length && !mt.value && !ctx.params.prefilled) {
      ctx.params.prefilled = true;
      draftBeforeSuggestion = ''; // the "your own text" slot when cycling is an empty box
      mt.set(fu[0]);
    }
    const wrap = el('ai-screen ai-input');

    const box = el('ai-textbox');
    const committed = el('', null, 'span');
    const pending = el('ai-pending', null, 'span');
    const caret = el('ai-caret', null, 'span');
    const placeholder = el('ai-placeholder', t(ctx.params?.followUp ? 'Ask a follow-up…' : 'Type your question…'), 'span');
    box.append(placeholder, committed, pending, caret);

    const meta = el('ai-input-meta');
    const attachment = el('ai-attachment');
    const count = el('ai-count');
    meta.append(attachment, count);

    const hint = el('ai-hint');
    wrap.append(box, meta, hint);

    if (!isCompact()) {
      wrap.appendChild(el('ai-privacy', t('Photo/voice is sent to AI for this answer.')));
    }

    nodes = { box, committed, pending, placeholder, attachment, count, hint };
    queueMicrotask(() => {
      paint(ctx);
      // e.g. "Could not hear the question" after a failed voice request.
      if (ctx.params?.notice && nodes) nodes.hint.textContent = ctx.params.notice;
    });
    return wrap;
  },

  onHide() {
    clearTimeout(commitTimer);
    mt.commit();
    composer.text = mt.value;
    nodes = null;
  },

  onKey(action, ctx) {
    if (action.startsWith('NUM_')) {
      mt.press(Number(action.slice(4)));
      paint(ctx);
      scheduleCommit(ctx);
      return true;
    }
    switch (action) {
      case 'STAR':
        mt.backspace();
        paint(ctx);
        return true;
      case 'HASH':
        if (mt.hash() === 'submit') submit(ctx);
        else paint(ctx);
        return true;
      case 'UP':
      case 'LEFT':
        cycleSuggestion(ctx, -1);
        return true;
      case 'DOWN':
      case 'RIGHT':
        cycleSuggestion(ctx, 1);
        return true;
      case 'BACK': // hardware Clear/Backspace deletes; on an empty box it leaves, like a phone
        if (!mt.value) return false;
        mt.backspace();
        paint(ctx);
        return true;
      default:
        return false;
    }
  },
};
