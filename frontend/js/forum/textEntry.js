import { t } from '../i18n/index.js';
import { el } from '../dom.js';
import { MultiTap, WINDOW_MS } from '../t9.js';
import { autoCap } from './forumUtils.js';

// Multi-tap text box shared by the title, body, reply, name and note screens.
// Routed through the screen's onKey, which is called by the shared keypad dispatcher.
//   digits = type (existing t9 rules)    * = delete    # = commit letter, ## = done
//   Enter/centre softkey = done          Right = new paragraph (multiline only)
export function createTextEntry({ max, min = 0, multiline = false, cap = 'sentence', initial = '', placeholder = '', onDone }) {
  const mt = new MultiTap({ max });
  mt.set(initial);
  let nodes = null;
  let timer = null;

  const shown = () => autoCap(mt.value, cap);
  const done = () => { mt.commit(); paint(); onDone?.(mt.value.trim()); };

  function paint() {
    if (!nodes) return;
    const full = shown();
    const committed = autoCap(mt.text, cap);
    nodes.committed.textContent = committed;
    nodes.pending.textContent = full.slice(committed.length);
    nodes.placeholder.hidden = full.length > 0;
    const left = max - mt.value.length;
    nodes.count.textContent = min && mt.value.trim().length < min ? t('min {min} · {left} left', { min, left }) : t('{left} left', { left });
  }
  const scheduleCommit = () => { clearTimeout(timer); timer = setTimeout(() => { mt.commit(); paint(); }, WINDOW_MS); };

  return {
    get value() { mt.commit(); return mt.value.trim(); },
    get raw() { return mt.value; },
    set(text) { mt.set(text); paint(); },
    hint(text) { if (nodes) nodes.hint.textContent = text; },
    render() {
      const box = el('forum-textbox');
      const committed = el('', null, 'span');
      const pending = el('forum-pending', null, 'span');
      const caret = el('forum-caret', null, 'span');
      const placeholderEl = el('forum-placeholder', placeholder, 'span');
      box.append(placeholderEl, committed, pending, caret);
      const count = el('forum-count');
      const hint = el('forum-hint', t(multiline ? '▶ new paragraph · * delete · # # done' : '* delete · # # done'));
      nodes = { box, committed, pending, placeholder: placeholderEl, count, hint };
      const wrap = el('forum-entry');
      wrap.append(box, count, hint);
      queueMicrotask(paint);
      return wrap;
    },
    dispose() { clearTimeout(timer); mt.commit(); nodes = null; },
    done,
    /** Returns true when the key was consumed. */
    onKey(action) {
      if (action.startsWith('NUM_')) { mt.press(Number(action.slice(4))); paint(); scheduleCommit(); return true; }
      switch (action) {
        case 'STAR': mt.backspace(); paint(); return true;
        case 'HASH': if (mt.hash() === 'submit') done(); else paint(); return true;
        case 'RIGHT':
          if (multiline && !mt.isFull) { mt.set(`${mt.commit()}\n\n`); paint(); }
          return true;
        case 'LEFT': case 'UP': case 'DOWN': return true;
        case 'BACK': if (!mt.value) return false; mt.backspace(); paint(); return true; // empty box: leave
        default: return false;
      }
    },
  };
}

// Fixed-length digit field for Farm ID and PIN. Digits type, * deletes, # or Enter continue.
export function createDigitEntry({ length, mask = false, group = false }) {
  let digits = '';
  let node = null;
  const display = () => {
    if (mask) return [...Array(length)].map((_, i) => (i < digits.length ? '●' : '_')).join(' ');
    const padded = digits.padEnd(length, '_');
    return group ? `${padded.slice(0, 4)} ${padded.slice(4)}` : padded;
  };
  const paint = () => { if (node) node.textContent = display(); };
  return {
    get value() { return digits; },
    get complete() { return digits.length === length; },
    set(v) { digits = String(v).replace(/\D/g, '').slice(0, length); paint(); },
    clear() { digits = ''; paint(); },
    render() { node = el('forum-pin-input'); node.textContent = display(); return node; },
    dispose() { node = null; },
    onKey(action) {
      if (action.startsWith('NUM_')) { if (digits.length < length) digits += action.slice(4); paint(); return true; }
      if (action === 'STAR') { digits = digits.slice(0, -1); paint(); return true; }
      if (action === 'BACK' && digits) { digits = digits.slice(0, -1); paint(); return true; }
      return false;
    },
  };
}
