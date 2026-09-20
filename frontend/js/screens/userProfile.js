import { t } from '../i18n/index.js';
import { el } from '../dom.js';
import { auth, currentFlash } from '../forum/forumState.js';
import { flashLine } from '../forum/ui.js';

// Personal activity inside Farmer Circle. App-wide profile and account controls
// stay in the global Settings screen instead of being duplicated here.
const ROWS = ['My posts', 'Saved posts'];

export default {
  name: 'UserProfile',
  title: 'My activity',
  numericSelect: true,
  softLeft: { label: '', handler() {} },
  softCenter: { label: 'Select', handler: (ctx, _c, i) => choose(ctx, i) },

  render() {
    const wrap = el('forum-screen forum-profile');
    const f = flashLine(currentFlash());
    if (f) wrap.appendChild(f);
    const u = auth.user;
    if (u) {
      const card = el('forum-profile-card');
      card.appendChild(el('forum-title', u.displayName));
      card.appendChild(el('forum-meta', `${u.village} · ${u.regionName}${u.role !== 'member' ? ` · ${u.role}` : ''}`));
      wrap.appendChild(card);
    }
    const list = el('list');
    ROWS.forEach((label, i) => {
      const row = el('item forum-choice');
      row.appendChild(el('forum-choice-n', String(i + 1), 'span'));
      row.appendChild(el('forum-choice-label', t(label), 'span'));
      list.appendChild(row);
    });
    wrap.appendChild(list);
    return wrap;
  },

  onEnter(_r, ctx, i) { choose(ctx, i); },
};

function choose(ctx, i) {
  if (i === 0) ctx.router.push('MyPosts');
  else if (i === 1) ctx.router.push('SavedPosts');
}
