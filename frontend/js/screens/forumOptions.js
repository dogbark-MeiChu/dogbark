import { t } from '../i18n/index.js';
import { el } from '../dom.js';
import { forumApi } from '../forum/forumApi.js';
import { auth, forum, resumeIntent } from '../forum/forumState.js';
import { COMMUNITIES, SCOPE_LABEL, TYPE_LABEL, communityName, tagLabel } from '../forum/forumUtils.js';

const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];
const SCOPES = ['global', 'region', 'country'];
const TYPES = [null, 'question', 'discussion', 'local_report'];
const STATUSES = [null, 'open', 'solved'];

// Filters for the feed. Enter cycles a value in place or opens a picker; digits jump
// straight to a row. At 128x160 this screen holds all filtering.
function rows() {
  const list = [
    ['Community', communityName(forum.community) || t('All'), 'community'],
    ['Tag', forum.tag ? tagLabel(forum.tag) : t('All'), 'tag'],
    ['Location', SCOPE_LABEL[forum.scope], 'scope'],
    ['Type', forum.type ? TYPE_LABEL[forum.type] : t('All'), 'type'],
    ['Status', forum.status ? (forum.status === 'open' ? t('Open (status)') : t('Solved')) : t('All'), 'status'],
  ];
  if (!auth.authenticated) list.push(['Browse region', forum.browseRegion, 'region']);
  list.push(['Clear filters', '', 'clear']);
  list.push([auth.authenticated ? 'Profile' : 'Sign in', '', 'profile']);
  return list;
}

export default {
  name: 'ForumOptions',
  title: 'Options',
  numericSelect: true,
  softLeft: { label: '', handler() {} },
  softCenter: { label: 'Change', handler: (ctx, cur, i) => choose(ctx, i) },

  render(ctx) {
    const wrap = el('forum-screen');
    const list = el('list');
    rows().forEach(([label, value, key], i) => {
      const row = el('item forum-choice');
      row.dataset.key = key;
      row.appendChild(el('forum-choice-n', String(i + 1), 'span'));
      row.appendChild(el('forum-choice-label', t(label), 'span'));
      if (value) row.appendChild(el('forum-choice-value', value, 'span'));
      list.appendChild(row);
    });
    wrap.appendChild(list);
    return wrap;
  },

  initialFocus: (ctx) => ctx.params?.focusIndex ?? 0,
  onShow(ctx) { resumeIntent(ctx, 'ForumOptions'); },
  onEnter(_row, ctx, i) { choose(ctx, i); },
};

function changed(ctx, i) {
  forum.focusedPostId = null;
  ctx.params = { ...ctx.params, focusIndex: i };
  ctx.rerender();
}

function choose(ctx, i) {
  const key = rows()[i]?.[2];
  const back = () => ctx.router.pop();
  switch (key) {
    case 'community':
      return ctx.router.push('CommunityList', {
        title: 'Community', selected: forum.community,
        options: [{ label: t('All communities'), value: null }, ...COMMUNITIES.map((c) => ({ label: c.name, value: c.slug }))],
        onPick(o) { forum.community = o.value; forum.focusedPostId = null; back(); },
      });
    case 'tag':
      return forumApi.tags(forum.community).then((r) => ctx.router.push('ForumPicker', {
        title: 'Tag', selected: forum.tag,
        options: [{ label: t('All tags'), value: null }, ...r.items.map((tag) => ({ label: tagLabel(tag.slug), value: tag.slug }))],
        onPick(o) { forum.tag = o.value; forum.focusedPostId = null; back(); },
      })).catch(() => { /* stays on options; user can retry */ });
    case 'scope': forum.scope = cycle(SCOPES, forum.scope); return changed(ctx, i);
    case 'type': forum.type = cycle(TYPES, forum.type); return changed(ctx, i);
    case 'status': forum.status = cycle(STATUSES, forum.status); return changed(ctx, i);
    case 'region':
      return forumApi.regions().then((m) => ctx.router.push('ForumPicker', {
        title: 'Browse region', selected: forum.browseRegion,
        note: t('Sign in to use your own region.'),
        options: m.items.slice(0, 9).map((r) => ({ label: r.name, value: r.code })),
        onPick(o) { forum.browseRegion = o.value; forum.cachedFeeds.clear(); back(); },
      })).catch(() => {});
    case 'clear':
      Object.assign(forum, { community: null, tag: null, scope: 'global', type: null, status: null, focusedPostId: null });
      return changed(ctx, i);
    case 'profile':
      if (auth.authenticated) return ctx.router.push('UserProfile');
      return ctx.router.push('AuthGate');
    default:
  }
}
