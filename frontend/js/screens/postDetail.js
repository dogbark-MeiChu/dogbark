import { t } from '../i18n/index.js';
import { el, isCompact } from '../dom.js';
import { forumApi } from '../forum/forumApi.js';
import { forum, requireAuth, resumeIntent, flash, currentFlash, expireSession } from '../forum/forumState.js';
import { identity } from '../state.js';
import { TYPE_LABEL, REASON_LABEL, relTime, replies as replyCount, tagLabel, errorText, chunkText } from '../forum/forumUtils.js';
import { loadingView, emptyView, errorView, flashLine, setSoftkeys } from '../forum/ui.js';

// Post + flat replies. One module-level `view` holds the open post so Back from the
// reply composer / report picker re-renders instantly and refreshes in the background.
let view = null;      // { id, status, data, error, focusIndex, expanded, stale, fetching }
export const markPostStale = () => { if (view) { view.stale = true; view.focusIndex = 0; } }; // reply sent: show the confirmation from the top
let afterShow = null; // action queued by the Actions menu, run once this screen is back on top

function fetchPost(ctx) {
  const v = view;
  if (v.fetching) return;
  v.fetching = true;
  const root = ctx.root;
  forumApi.post(v.id, identity.profile?.language).then((data) => { v.data = data; v.status = 'ready'; v.error = null; })
    .catch((error) => { v.error = error; if (!v.data) v.status = 'error'; })
    .finally(() => {
      v.fetching = false; v.stale = false;
      if (view === v && ctx.root === root) { v.focusIndex = ctx.focus?.index ?? v.focusIndex; ctx.rerender(); }
    });
}

const voteChip = (score, mine) => {
  const c = el(mine === 1 ? 'forum-vote up' : mine === -1 ? 'forum-vote down' : 'forum-vote', mine === 1 ? `▲ ${score}` : mine === -1 ? `▼ ${score}` : String(score), 'span');
  if (mine) c.setAttribute('aria-label', mine === 1 ? t('you voted up') : t('you voted down'));
  return c;
};

function focusedReply(ctx) {
  const id = ctx.focus?.current?.dataset.replyId;
  return id ? view.data.replies.find((r) => r.id === id) : null;
}

function softLabels(ctx) {
  const cur = ctx.focus?.current;
  const isReply = Boolean(cur?.dataset.replyId);
  const compact = isCompact();
  return {
    l: t(isReply ? 'Vote' : 'Reply'),
    c: t(isReply ? (compact ? 'More' : 'Expand') : cur?.dataset.act === 'actions' ? 'Actions' : (compact ? '' : 'Select')),
  };
}

function build(ctx) {
  const { post: p, replies, viewer } = view.data;
  const wrap = el('forum-screen forum-detail');
  const msg = flashLine(currentFlash());
  if (msg) wrap.appendChild(msg);

  // The post is several focusable pieces (head, body chunks, footer) so Up/Down can
  // walk through a long post on a 128x160 screen instead of clipping it.
  const piece = () => { const n = el('item forum-post'); n.dataset.act = 'post'; wrap.appendChild(n); return n; };
  const head = piece();
  const meta = el('forum-meta', [TYPE_LABEL[p.type], t(p.community.name)].join(' · '));
  const compact = isCompact();
  for (const [on, text] of [[p.isSolved, '✓ SOLVED'], [p.isPinned, 'PINNED'], [p.isLocked, 'LOCKED'], [p.isHidden, 'HIDDEN'], [p.isDemo && !compact, 'DEMO']]) {
    if (on) meta.appendChild(el(text === '✓ SOLVED' ? 'forum-state solved' : 'forum-state', t(text), 'span'));
  }
  head.appendChild(meta);
  const shownPost=!view.showOriginal&&p.translation?p.translation:p;
  head.appendChild(el('forum-title forum-title--full', shownPost.title));
  if(p.translation&&!view.showOriginal)head.appendChild(el('forum-meta',t('🌐 Translated from {lang}', { lang: p.language })));
  for (const text of chunkText(shownPost.body, compact ? 90 : 260)) piece().appendChild(el('forum-body', text));

  const foot = piece();
  if (p.tags.length) {
    const tags = el('forum-tags');
    p.tags.forEach((tag) => tags.appendChild(el('forum-tag', `#${tagLabel(tag)}`, 'span')));
    foot.appendChild(tags);
  }
  foot.appendChild(el('forum-meta', `${p.author.isVerifiedExpert?'✓ ':''}${p.author.displayName}${p.author.expertTitle?' · '+p.author.expertTitle:''} · ${p.locationLabel} · ${relTime(p.createdAt)}`));
  if (p.type === 'local_report') foot.appendChild(el('forum-meta forum-usernote', t('USER REPORT · not official')));
  if (!compact && (p.community.slug === 'livestock' || p.tags.some((tag) => ['pest', 'disease', 'fertilizer'].includes(tag)))) {
    foot.appendChild(el('forum-meta forum-usernote', t('Community advice is not verified. Ask a local expert before using chemicals or treating animals.')));
  }
  const votes = el('forum-votes');
  votes.append(voteChip(p.score, viewer.vote), el('forum-meta', replyCount(p.replyCount), 'span'));
  foot.appendChild(votes);

  const actions = el('item forum-actions', isCompact() ? t('1▲ 0▼ 2Rep 3Sav #') : t('1 Up · 0 Down · 2 Reply · 3 {action} · # More', { action: t(viewer.saved ? 'Unsave' : 'Save') }));
  actions.dataset.act = 'actions';
  wrap.appendChild(actions);

  if (!replies.length) {
    wrap.appendChild(emptyView(t('No replies yet.'), t(viewer.canReply ? 'Press 2 to be the first to reply.' : (p.isLocked ? 'This post is locked.' : 'Sign in to reply.'))));
  }
  for (const r of replies) {
    const row = el(`item forum-reply${r.isAccepted ? ' forum-reply--accepted' : ''}${r.depth ? ' forum-reply--nested' : ''}`);
    row.dataset.replyId = r.id;
    if (r.isAccepted) row.appendChild(el('forum-solution', t('✓ SOLUTION')));
    const meta = el('forum-meta');
    const sourceLabel=r.source==='ai'?t('🤖 AI · '):r.source==='official'?t('📌 Official · '):r.author.isVerifiedExpert?'✓ ':'';
    meta.appendChild(document.createTextNode(`${sourceLabel}${r.author.displayName}${r.author.expertTitle?' · '+r.author.expertTitle:''} · ${relTime(r.createdAt)}${r.isEdited ? ' · ' + t('edited') : ''} `));
    meta.appendChild(voteChip(r.score, r.viewerVote));
    row.appendChild(meta);
    const shownReply=!view.showOriginal&&r.translation?r.translation.body:r.body;
    row.appendChild(el(view.expanded.has(r.id) ? 'forum-body expanded' : 'forum-body', shownReply));
    if(r.source==='ai')row.appendChild(el('forum-meta forum-usernote',t('AI suggestion · Consult a local expert.')));
    wrap.appendChild(row);
  }
  return wrap;
}

// ---- actions --------------------------------------------------------------
const done = (ctx, root) => { if (ctx.root === root) { view.focusIndex = ctx.focus?.index ?? view.focusIndex; ctx.rerender(); } };

function authFail(ctx, err) {
  if (err.code === 'AUTH_REQUIRED') { expireSession(); return true; }
  return false;
}

async function vote(ctx, value, replyId) {
  const v = view, d = v.data;
  if (!requireAuth(ctx)) return;
  if (!replyId && d.viewer.isAuthor) { flash(t('You cannot vote on your own post.')); return ctx.rerender(); }
  if (d.post.isLocked) { flash(t('This post is locked.')); return ctx.rerender(); }
  const target = replyId ? d.replies.find((r) => r.id === replyId) : null;
  const read = () => (target ? { vote: target.viewerVote, score: target.score } : { vote: d.viewer.vote, score: d.post.score });
  const write = ({ vote: mine, score }) => { if (target) { target.viewerVote = mine; target.score = score; } else { d.viewer.vote = mine; d.post.score = score; } };
  const prev = read();
  const mine = prev.vote === value ? 0 : value;
  write({ vote: mine, score: prev.score + mine - prev.vote }); // optimistic
  const root = ctx.root;
  done(ctx, root);
  try {
    const r = await forumApi.vote(replyId ? 'reply' : 'post', replyId || d.post.id, value);
    write(r);                    // reconcile with the server's truth
    forum.cachedFeeds.clear();
  } catch (err) {
    write(prev);                 // restore the old score and say why
    if (!authFail(ctx, err)) flash(errorText(err));
  }
  if (view === v) done(ctx, root);
}

async function toggleSave(ctx) {
  const v = view, d = v.data;
  if (!requireAuth(ctx)) return;
  const was = d.viewer.saved;
  d.viewer.saved = !was;
  const root = ctx.root;
  done(ctx, root);
  try {
    await (was ? forumApi.unsave(d.post.id) : forumApi.save(d.post.id));
    flash(t(was ? 'Removed from saved.' : 'Saved.'));
  } catch (err) {
    d.viewer.saved = was;
    if (!authFail(ctx, err)) flash(errorText(err));
  }
  if (view === v) done(ctx, root);
}

function reply(ctx) {
  if (view.data.post.isLocked) { flash(t('This post is locked.')); return ctx.rerender(); }
  if (requireAuth(ctx)) ctx.router.push('CreateReply', { postId: view.id });
}

function report(ctx, target) {
  if (!requireAuth(ctx)) return;
  const reasons = ['spam', 'scam', 'harassment', 'dangerous_advice', 'false_information', 'other'];
  ctx.router.push('ReportContent', {
    title: target.type === 'reply' ? 'Report reply' : 'Report post', note: 'Why are you reporting this?',
    options: reasons.map((r) => ({ label: REASON_LABEL[r], value: r })),
    onPick(o, pctx) {
      forumApi.report(target.type, target.id, o.value)
        .then(() => flash(t('Report sent. Thank you.')))
        .catch((err) => flash(errorText(err)))
        .finally(() => pctx.router.pop());
    },
  });
}

async function mutate(ctx, call, okText) {
  const root = ctx.root;
  try { await call(); forum.cachedFeeds.clear(); if (okText) flash(okText); view.stale = true; }
  catch (err) { if (!authFail(ctx, err)) flash(errorText(err)); }
  done(ctx, root);
}

function openActions(ctx) {
  const { post: p, viewer } = view.data;
  const r = focusedReply(ctx);
  const isReply = Boolean(r);
  const list = [];
  const add = (label, run) => list.push({ label, value: label, run });
  add(t(isReply ? 'Upvote reply' : 'Upvote post'), (c) => vote(c, 1, r?.id));
  add(t(isReply ? 'Downvote reply' : 'Downvote post'), (c) => vote(c, -1, r?.id));
  add(t('Reply'), (c) => reply(c));
  add(t(viewer.saved ? 'Unsave' : 'Save'), (c) => toggleSave(c));
  add(t(isReply ? 'Report reply' : 'Report post'), (c) => report(c, { type: r ? 'reply' : 'post', id: r ? r.id : p.id }));
  if (viewer.canMarkSolved && r && !r.isAccepted) add(t('Mark as solution'), (c) => mutate(c, () => forumApi.setSolution(p.id, r.id), t('Marked as solution.')));
  if (viewer.canMarkSolved && p.isSolved) add(t('Remove solution'), (c) => mutate(c, () => forumApi.clearSolution(p.id), t('Solution removed.')));
  if (viewer.canModerate) {
    add(t(p.isPinned ? 'Unpin post' : 'Pin post'), (c) => mutate(c, () => forumApi.moderate(p.id, { isPinned: !p.isPinned })));
    add(t(p.isLocked ? 'Unlock post' : 'Lock post'), (c) => mutate(c, () => forumApi.moderate(p.id, { isLocked: !p.isLocked })));
    add(t('Hide post'), async (c) => { await mutate(c, () => forumApi.moderate(p.id, { isHidden: true }), t('Post hidden.')); c.router.pop(); });
  }
  view.focusIndex = ctx.focus.index;
  ctx.router.push('ForumPicker', {
    title: 'Actions',
    options: list,
    onPick(o, pctx) {
      afterShow = () => o.run(pctx);   // runs when the detail screen is on top again
      pctx.router.pop();
    },
  });
}

function toggleExpand(ctx, id) {
  view.expanded.has(id) ? view.expanded.delete(id) : view.expanded.add(id);
  view.focusIndex = ctx.focus.index;
  ctx.rerender();
}

export default {
  name: 'PostDetail',
  title: 'Post',
  softLeft: {
    label: (ctx) => (view?.data ? softLabels(ctx).l : ''),
    handler(ctx) {
      if (!view?.data) return;
      const r = focusedReply(ctx);
      return r ? vote(ctx, 1, r.id) : reply(ctx);
    },
  },
  softCenter: { label: (ctx) => (view?.data ? softLabels(ctx).c : ''), handler: (ctx, cur) => onEnter(cur, ctx) },

  render(ctx) {
    ctx.root.classList.add('forum-scroll');
    const id = ctx.params.postId;
    if (!view || view.id !== id) view = { id, status: 'loading', data: null, error: null, focusIndex: 0, expanded: new Set(), showOriginal:false, stale: false, fetching: false };
    if ((view.status === 'loading' && !view.fetching) || view.stale) fetchPost(ctx);
    if (view.data) return build(ctx);
    const wrap = el('forum-screen');
    wrap.appendChild(view.status === 'error' ? errorView(view.error) : loadingView());
    return wrap;
  },

  initialFocus: (ctx) => Math.max(0, Math.min(view?.focusIndex || 0, ctx.focus.items.length - 1)),

  onShow(ctx) {
    if (resumeIntent(ctx, 'PostDetail')) return;
    if (afterShow && view?.data) { const run = afterShow; afterShow = null; run(); }
  },

  onHide(ctx) { if (view && ctx.focus) view.focusIndex = ctx.focus.index; },

  onEnter(cur, ctx) { onEnter(cur, ctx); },

  onKey(action, ctx) {
    if (!view?.data) return false;
    const key = { NUM_1: 1, NUM_0: -1 }[action];
    if (key) { vote(ctx, key, focusedReply(ctx)?.id); return true; }
    switch (action) {
      case 'NUM_2': reply(ctx); return true;
      case 'NUM_3': toggleSave(ctx); return true;
      case 'HASH': openActions(ctx); return true;
      case 'STAR': {
        if(view.data.post.translation||view.data.replies.some((r)=>r.translation)){view.showOriginal=!view.showOriginal;ctx.rerender();return true;}
        const onPost = !ctx.focus.current?.dataset.replyId;
        const firstReply = ctx.focus.items.findIndex((n) => n.dataset.replyId);
        ctx.focus.set(onPost ? (firstReply >= 0 ? firstReply : 0) : 0);
        setSoftkeys(softLabels(ctx));
        return true;
      }
      case 'UP': case 'DOWN':
        ctx.focus.move(action === 'UP' ? -1 : 1);
        setSoftkeys(softLabels(ctx));
        return true;
      default: return action.startsWith('NUM_'); // other digits do nothing
    }
  },
};

function onEnter(cur, ctx) {
  if (!cur) return;
  if (cur.dataset.act === 'retry') { view.status = 'loading'; view.error = null; return ctx.rerender(); }
  if (cur.dataset.act === 'actions') return openActions(ctx);
  if (cur.dataset.replyId) return toggleExpand(ctx, cur.dataset.replyId);
}
