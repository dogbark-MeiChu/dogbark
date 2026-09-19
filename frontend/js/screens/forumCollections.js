import { t } from '../i18n/index.js';
import { el } from '../dom.js';
import { forumApi } from '../forum/forumApi.js';
import { auth, forum } from '../forum/forumState.js';
import { postRow } from '../forum/postRow.js';
import { loadingView, emptyView, errorView } from '../forum/ui.js';

// "My posts" and "Saved posts": same row layout as the feed, personal data, login required.
function collection({ name, title, fetch, empty, hint, afterLoad }) {
  let state = null; // { status, items, error }

  function start(ctx) {
    const root = ctx.root;
    state = { status: 'loading', items: [] };
    fetch().then((r) => { state = { status: 'ready', items: r.items }; afterLoad?.(); })
      .catch((error) => { state = { status: 'error', items: [], error }; })
      .finally(() => { if (ctx.root === root) ctx.rerender(); });
  }

  return {
    name,
    title,
    softLeft: { label: '', handler() {} },
    softCenter: { label: 'Open', handler: (ctx, row) => open(ctx, row) },
    render(ctx) {
      ctx.root.classList.add('forum-scroll');
      const wrap = el('forum-screen');
      if (!auth.authenticated) { wrap.appendChild(emptyView(t('Sign in to see this list.'))); return wrap; }
      if (!state) start(ctx);
      if (state.status === 'loading') wrap.appendChild(loadingView());
      else if (state.status === 'error') wrap.appendChild(errorView(state.error));
      else if (!state.items.length) wrap.appendChild(emptyView(t(empty), t(hint)));
      else { const list = el('list'); state.items.forEach((p) => list.appendChild(postRow(p, { showRegion: true }))); wrap.appendChild(list); }
      return wrap;
    },
    onHide() { state = null; }, // always fresh on re-entry
    onEnter(row, ctx) { open(ctx, row); },
  };
  function open(ctx, row) {
    if (!row) return;
    if (row.dataset.act === 'retry') { state = null; return ctx.rerender(); }
    ctx.router.push('PostDetail', { postId: row.dataset.postId });
  }
}

export const MyPosts = collection({
  name: 'MyPosts', title: 'My posts', fetch: forumApi.myPosts,
  empty: 'You have not posted yet.', hint: 'Press New on the feed to ask a question.',
  afterLoad() { forumApi.notificationsSeen().then(() => { forum.notifications = 0; }).catch(() => {}); },
});
export const SavedPosts = collection({
  name: 'SavedPosts', title: 'Saved posts', fetch: forumApi.saved,
  empty: 'No saved posts.', hint: 'Open a post and press 3 to save it.',
});
