import { t } from '../i18n/index.js';
import { el } from '../dom.js';
import { forumApi } from '../forum/forumApi.js';
import { forum, flash, expireSession } from '../forum/forumState.js';
import { createTextEntry } from '../forum/textEntry.js';
import { errorText, autoCap, newRequestId } from '../forum/forumUtils.js';
import { loadingView } from '../forum/ui.js';
import { markPostStale } from './postDetail.js';

// One composer draft per post; the request id survives retries so a slow network
// cannot post the same reply twice.
let composer = null; // { postId, text, requestId, busy, error }
let entry = null;

export default {
  name: 'CreateReply',
  title: 'Reply',
  softLeft: { label: '', handler() {} },
  softCenter: { label: 'Send', handler: () => entry?.done() },

  render(ctx) {
    const postId = ctx.params.postId;
    if (composer?.postId !== postId) composer = { postId, text: '', requestId: newRequestId(), busy: false, error: null };
    const wrap = el('forum-screen forum-form-step');
    if (composer.busy) { wrap.appendChild(loadingView(t('Sending…'))); return wrap; }
    entry?.dispose();
    entry = createTextEntry({
      max: 400, min: 2, initial: composer.text, placeholder: t('Write a helpful reply…'),
      onDone: (v) => send(ctx, autoCap(v)),
    });
    wrap.appendChild(el('forum-label', t('Your reply (plain text, no links)')));
    wrap.appendChild(entry.render());
    if (composer.error) wrap.appendChild(el('forum-error-text', composer.error));
    return wrap;
  },

  onHide() { if (entry && composer && !composer.busy) { composer.text = entry.raw; } entry?.dispose(); entry = null; },
  onKey(action) { return composer?.busy ? true : (entry?.onKey(action) ?? false); },
  onEnter() {},
};

async function send(ctx, text) {
  if (text.length < 2) return entry.hint(t('Write at least 2 characters'));
  composer.text = text;
  composer.busy = true; composer.error = null;
  ctx.rerender();
  try {
    await forumApi.createReply(composer.postId, { requestId: composer.requestId, body: text });
    composer = null;
    forum.cachedFeeds.clear();
    flash(t('Reply posted.'));
    markPostStale(); // the detail screen refetches when Back lands on it
    ctx.router.pop();
  } catch (err) {
    composer.busy = false;
    if (err.code === 'AUTH_REQUIRED') { expireSession(); composer.error = t('Please sign in again.'); }
    else composer.error = errorText(err);
    ctx.rerender();
  }
}
