import { t } from '../i18n/index.js';
import { el } from '../dom.js';
import { errorText } from './forumUtils.js';

// Shared building blocks so every async screen has loading / empty / error+retry.
export const loadingView = (text = t('Loading…')) => el('forum-empty forum-loading', text);

export function emptyView(text, hint) {
  const d = el('forum-empty');
  d.appendChild(el('', text));
  if (hint) d.appendChild(el('forum-hint', hint));
  return d;
}

/** Focusable retry row: the screen's onEnter checks `dataset.act === 'retry'`. */
export function errorView(err, { action = t('Retry') } = {}) {
  const d = el('forum-error');
  d.appendChild(el('forum-error-text', errorText(err)));
  const row = el('item forum-retry', `↻ ${action}`);
  row.dataset.act = 'retry';
  d.appendChild(row);
  return d;
}

export const flashLine = (text) => (text ? el('forum-flash', text) : null);

/** Keeps the softkey bar in step with focus changes that the router does not re-render for. */
export function setSoftkeys({ l, c, r }) {
  const set = (id, v) => { const n = document.getElementById(id); if (n && v != null) n.textContent = v; };
  set('sk-l', l); set('sk-c', c); set('sk-r', r);
}
