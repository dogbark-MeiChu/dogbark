import { t } from '../i18n/index.js';
import { el, isCompact } from '../dom.js';
import { forumApi } from '../forum/forumApi.js';
import {
  auth, forum, refreshNotifications, requireAuth, resumeIntent, currentFlash, startWizard,
} from '../forum/forumState.js';
import { COMMUNITIES, SORTS, communityName } from '../forum/forumUtils.js';
import { postRow, sortTabs } from '../forum/postRow.js';
import { loadingView, emptyView, errorView, flashLine } from '../forum/ui.js';

// The Farmer Circle front page: a compact Reddit-style feed. Filters (community,
// tag, location, type, status) live in ForumOptions; sort is Left/Right.
const feedKey = () => JSON.stringify([
  forum.sort, forum.community, forum.scope, forum.tag, forum.type, forum.status,
  auth.user?.id || forum.browseRegion,
]);

function query(cursor) {
  return {
    sort: forum.sort, community: forum.community, scope: forum.scope, tag: forum.tag,
    type: forum.type, status: forum.status, cursor, limit: 10,
    region: auth.authenticated ? null : forum.browseRegion,
  };
}

function load(ctx, { more = false } = {}) {
  const key = feedKey();
  const root = ctx.root;
  const entry = forum.cachedFeeds.get(key) || { items: [], nextCursor: null };
  if (entry.loading) return;
  entry.loading = true; entry.error = null;
  forum.cachedFeeds.set(key, entry);
  forumApi.posts(query(more ? entry.nextCursor : null)).then((r) => {
    entry.items = more ? entry.items.concat(r.items) : r.items;
    entry.nextCursor = r.nextCursor;
    if (more && r.items[0]) forum.focusedPostId = r.items[0].id;
    entry.loaded = true;
  }).catch((err) => { entry.error = err; }).finally(() => {
    entry.loading = false;
    if (ctx.root === root) ctx.rerender();
    const shown = ctx.root; // the rerender above replaced the root
    const before = forum.notifications;
    refreshNotifications().then((n) => { if (n !== before && ctx.root === shown) ctx.rerender(); });
  });
}

function filterLine() {
  const bits = [];
  if (forum.tag) bits.push(`#${forum.tag}`);
  if (forum.scope !== 'global') bits.push(t(forum.scope === 'region' ? 'Near me' : 'My country'));
  if (forum.type) bits.push(t(forum.type.replace('_', ' ')));
  if (forum.status) bits.push(t(forum.status));
  return bits.join(' · ');
}

function changeSort(ctx, dir) {
  const i = SORTS.indexOf(forum.sort);
  forum.sort = SORTS[(i + dir + SORTS.length) % SORTS.length];
  forum.focusedPostId = null;
  ctx.rerender();
}

function setCommunity(ctx, slug) {
  forum.community = slug;
  forum.focusedPostId = null;
  ctx.rerender();
}

export default {
  name: 'FarmerCircleHome',
  title: () => (forum.community ? communityName(forum.community) : 'Farmer Circle'),
  statusBadge: () => (auth.authenticated && forum.notifications > 0 ? `● ${forum.notifications}` : ''),
  softLeft: {
    label: 'New',
    handler(ctx) { if (requireAuth(ctx)) startWizard(ctx, 'FarmerCircleHome'); },
  },
  softCenter: { label: 'Open', handler: (ctx, cur, i) => openRow(ctx, cur, i) },

  render(ctx) {
    ctx.root.classList.add('forum-scroll');
    const wrap = el('forum-screen');
    wrap.appendChild(sortTabs(forum.sort));
    wrap.appendChild(el('forum-filters', t('◄► Sort · # Filter · * My activity')));
    const fl = filterLine();
    if (fl && !isCompact()) wrap.appendChild(el('forum-filters', fl));
    const flash = flashLine(currentFlash());
    if (flash) wrap.appendChild(flash);

    const key = feedKey();
    let entry = forum.cachedFeeds.get(key);
    if (!entry || (!entry.loaded && !entry.loading && !entry.error)) { load(ctx); entry = forum.cachedFeeds.get(key); }

    if (entry.error && !entry.items.length) { wrap.appendChild(errorView(entry.error)); return wrap; }
    if (!entry.loaded && !entry.items.length) { wrap.appendChild(loadingView()); return wrap; }
    if (!entry.items.length) {
      wrap.appendChild(emptyView(t('No posts here yet.'), t('Press New to start the first one.')));
      return wrap;
    }
    const list = el('list');
    for (const p of entry.items) list.appendChild(postRow(p, { showRegion: forum.sort === 'local' }));
    if (entry.nextCursor) {
      const more = el('item forum-more', entry.loading ? t('Loading…') : t('Load more…'));
      more.dataset.act = 'more';
      list.appendChild(more);
    } else if (entry.error) {
      const retry = el('item forum-more', t('Could not load more. Retry'));
      retry.dataset.act = 'more';
      list.appendChild(retry);
    }
    wrap.appendChild(list);
    return wrap;
  },

  initialFocus(ctx) {
    const i = ctx.focus.items.findIndex((n) => n.dataset.postId === forum.focusedPostId);
    return i >= 0 ? i : 0;
  },

  onShow(ctx) { resumeIntent(ctx, 'FarmerCircleHome'); },

  onHide(ctx) {
    const id = ctx.focus?.current?.dataset?.postId;
    if (id) forum.focusedPostId = id;
  },

  onEnter(row, ctx, i) { openRow(ctx, row, i); },

  onKey(action, ctx) {
    switch (action) {
      case 'LEFT': changeSort(ctx, -1); return true;
      case 'RIGHT': changeSort(ctx, 1); return true;
      case 'NUM_0': setCommunity(ctx, null); return true;
      case 'HASH': ctx.router.push('ForumOptions'); return true;
      case 'STAR':
        if (requireAuth(ctx)) ctx.router.push('UserProfile');
        return true;
      default:
        if (/^NUM_[1-5]$/.test(action)) { setCommunity(ctx, COMMUNITIES[Number(action[4]) - 1].slug); return true; }
        return action.startsWith('NUM_'); // 6-9 do nothing here
    }
  },
};

function openRow(ctx, row) {
  if (!row) return;
  if (row.dataset.act === 'retry') {
    forum.cachedFeeds.delete(feedKey());
    return ctx.rerender();
  }
  if (row.dataset.act === 'more') {
    const entry = forum.cachedFeeds.get(feedKey());
    if (entry && !entry.loading) {
      forum.focusedPostId = row.previousElementSibling?.dataset.postId || forum.focusedPostId;
      load(ctx, { more: true });
      ctx.rerender();
    }
    return;
  }
  forum.focusedPostId = row.dataset.postId;
  ctx.router.push('PostDetail', { postId: row.dataset.postId });
}
