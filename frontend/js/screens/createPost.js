import { t } from '../i18n/index.js';
import { el, isCompact } from '../dom.js';
import { forumApi } from '../forum/forumApi.js';
import { auth, forum, loadDraft, newDraft, saveDraft, clearDraft, flash, expireSession, setWizardStarter } from '../forum/forumState.js';
import { COMMUNITIES, TYPE_LABEL, communityName, tagLabel, autoCap, errorText } from '../forum/forumUtils.js';
import { createTextEntry } from '../forum/textEntry.js';
import { loadingView } from '../forum/ui.js';

// Post wizard: Type -> Community -> Title -> Body -> Tags -> Location -> Preview.
// Every step is pushed onto the router stack, so Back returns to the previous step
// with everything already typed (the draft lives in forum.draftPost, and title/body
// are mirrored to sessionStorage - never localStorage).
const draft = () => loadDraft() || newDraft();

// The Type picker is the first step; forumState.startWizard calls this.
setWizardStarter((ctx) => ctx.router.push('CreatePostType', typeStepParams()));

function typeStepParams() {
  const d = draft();
  return {
    title: 'New post 1/7', note: 'What do you want to do?', selected: d.type,
    options: [{ label: 'Question', value: 'question' }, { label: 'Discussion', value: 'discussion' }, { label: 'Local report', value: 'local_report' }],
    onPick(o, ctx) { d.type = o.value; saveDraft(); ctx.router.push('CreatePostCommunity', communityStepParams()); },
  };
}

function communityStepParams() {
  const d = draft();
  return {
    title: 'New post 2/7', note: 'Which community?', selected: d.community,
    options: COMMUNITIES.map((c) => ({ label: c.name, value: c.slug })),
    onPick(o, ctx) { d.community = o.value; saveDraft(); ctx.router.push('CreatePostTitle'); },
  };
}

// ---- text steps -----------------------------------------------------------
function textStep({ name, title, label, max, min, multiline, field, next, cap }) {
  let entry = null;
  const go = (ctx, value) => {
    const d = draft();
    if (value.length < min) return entry.hint(t('Needs at least {n} characters', { n: min }));
    d[field] = value; saveDraft();
    ctx.router.push(next);
  };
  return {
    name, title,
    softLeft: { label: '', handler() {} },
    softCenter: { label: 'Next', handler: () => entry?.done() },
    render(ctx) {
      entry = createTextEntry({
        max, min, multiline, cap, initial: draft()[field] || '', placeholder: t('Type here…'),
        onDone: (v) => go(ctx, autoCap(v, cap)),
      });
      const wrap = el('forum-screen forum-form-step');
      wrap.appendChild(el('forum-label', t(label)));
      wrap.appendChild(entry.render());
      return wrap;
    },
    onHide() { if (entry) { const d = draft(); d[field] = autoCap(entry.raw.trim(), cap); saveDraft(); entry.dispose(); } },
    onKey(action) { return entry.onKey(action); },
    onEnter() {},
  };
}

export const CreatePostTitle = textStep({ name: 'CreatePostTitle', title: 'New post 3/7', label: 'Title (8-80 characters)', max: 80, min: 8, field: 'title', next: 'CreatePostBody', cap: 'sentence' });
export const CreatePostBody = textStep({ name: 'CreatePostBody', title: 'New post 4/7', label: 'Details (10-500 characters)', max: 500, min: 10, multiline: true, field: 'body', next: 'CreatePostTagsLoader', cap: 'sentence' });

// The Tags picker is opened by the Body step's `next`; wrap so it can fetch tags first.
export const CreatePostTagsLoader = {
  name: 'CreatePostTagsLoader',
  title: 'New post 5/7',
  softLeft: { label: '', handler() {} },
  render(ctx) {
    const wrap = el('forum-screen');
    wrap.appendChild(loadingView(t('Loading tags…')));
    const root = ctx.root;
    const d = draft();
    forumApi.tags(d.community).then((r) => {
      if (ctx.root !== root) return;
      ctx.router.replace('CreatePostTags', {
        title: 'New post 5/7', note: 'Pick up to 2 tags (optional). # = done', multi: true, max: 2,
        selectedValues: d.tags,
        options: r.items.map((tag) => ({ label: tagLabel(tag.slug), value: tag.slug })),
        onDone(values, c) { d.tags = values; saveDraft(); c.router.push('CreatePostLocation', locationParams()); },
      });
    }).catch((err) => { if (ctx.root === root) { wrap.replaceChildren(el('forum-error-text', errorText(err)), retryRow()); } });
    return wrap;
  },
  onEnter(row, ctx) { if (row?.dataset.act === 'retry') ctx.rerender(); },
};
const retryRow = () => { const r = el('item forum-retry', t('↻ Retry')); r.dataset.act = 'retry'; return r; };

function locationParams() {
  const d = draft();
  const region = auth.user?.regionName || t('my region');
  return {
    title: 'New post 6/7', note: 'Where should this show? No exact address is shared.', selected: d.locationScope,
    options: [{ label: t('Near me: {region}', { region }), value: 'region' }, { label: 'My whole country', value: 'country' }],
    onPick(o, ctx) { d.locationScope = o.value; saveDraft(); ctx.router.push('CreatePostPreview'); },
  };
}

// ---- preview --------------------------------------------------------------
let sub = null; // { busy, error }

export const CreatePostPreview = {
  name: 'CreatePostPreview',
  title: 'Preview 7/7',
  softLeft: { label: '', handler() {} },
  softCenter: { label: (ctx) => (sub?.busy ? '…' : t('Post')), handler: (ctx) => submit(ctx) },
  render(ctx) {
    sub ??= { busy: false, error: null };
    const d = draft();
    const wrap = el('forum-screen forum-preview');
    if (sub.busy) { wrap.appendChild(loadingView(t('Posting…'))); return wrap; }
    const box = el('item forum-post');
    box.appendChild(el('forum-meta', `${TYPE_LABEL[d.type]} · ${communityName(d.community)}`));
    box.appendChild(el('forum-title forum-title--full', d.title));
    box.appendChild(el('forum-body', d.body));
    if (d.tags.length) { const tagBox = el('forum-tags'); d.tags.forEach((x) => tagBox.appendChild(el('forum-tag', `#${tagLabel(x)}`, 'span'))); box.appendChild(tagBox); }
    box.appendChild(el('forum-meta', t(d.locationScope === 'country' ? 'Shown for: my country' : 'Shown for: near me')));
    box.appendChild(el('forum-meta', t('Photo: none')));
    wrap.appendChild(box);
    if (sub.error) wrap.appendChild(el('forum-error-text', sub.error));
    wrap.appendChild(el('forum-hint', t(isCompact() ? 'Enter = post' : 'Press Post to publish. Back to edit.')));
    return wrap;
  },
  initialFocus: () => 0,
  onKey(action, ctx) { if (action === 'HASH') { submit(ctx); return true; } return action.startsWith('NUM_') || action === 'STAR'; },
  onEnter() {},
};

async function submit(ctx) {
  if (sub.busy) return;
  const d = draft();
  sub.busy = true; sub.error = null; ctx.rerender();
  try {
    // The same requestId is re-sent on retry, so a flaky network can never double-post.
    const r = await forumApi.createPost({ requestId: d.requestId, type: d.type, community: d.community, title: d.title, body: d.body, tags: d.tags, locationScope: d.locationScope });
    clearDraft();
    sub = null;
    forum.cachedFeeds.clear();
    flash(t('Posted.'));
    const w = forum.wizard;
    forum.pendingIntent = { kind: 'openPost', postId: r.post.id, origin: w.origin, depth: w.depth, ready: true };
    ctx.router.popTo(w.depth);
  } catch (err) {
    sub.busy = false;
    if (err.code === 'AUTH_REQUIRED') { expireSession(); sub.error = t('Please sign in again.'); }
    else sub.error = errorText(err);
    ctx.rerender();
  }
}

