import { t } from '../i18n/index.js';
import { el, isCompact } from '../dom.js';
import { SORT_LABEL, tagLabel, relTime, replies, scoreText } from './forumUtils.js';

// One feed row: score, state marks, title (2 lines / 1 on the small screen),
// then community · tag · region · replies · time. Never the body.
export function postRow(p, { showRegion = false } = {}) {
  const row = el('item forum-post-row');
  row.dataset.postId = p.id;
  row.appendChild(el('forum-score', scoreText(p.score)));

  const main = el('forum-main');
  const title = el('forum-title');
  const marks = [p.isPinned && t('PIN'), p.isSolved && '✓', p.isLocked && t('LOCK')].filter(Boolean);
  if (marks.length) title.appendChild(el('forum-state', marks.join(' '), 'span'));
  title.appendChild(document.createTextNode(p.title));
  main.appendChild(title);

  const bits = [t(p.community.name)];
  if (p.author?.isVerifiedExpert) bits.push(`✓ ${p.author.expertTitle || t('Verified expert')}`);
  else if (String(p.title).startsWith('[GOV]')) bits.push(t('📌 Official'));
  const tag = p.tags.find((tag) => tag !== p.community.slug);
  if (tag) bits.push(tagLabel(tag));
  if (showRegion) bits.push(p.locationLabel);
  bits.push(replies(p.replyCount));
  const compact = isCompact();
  if (!compact) bits.push(relTime(p.lastActivityAt));
  main.appendChild(el('forum-meta', bits.join(' · ')));
  row.appendChild(main);
  return row;
}

export function sortTabs(active) {
  const tabs = el('forum-sort-tabs');
  for (const key of ['local', 'new', 'top']) {
    const tab = el(key === active ? 'forum-tab on' : 'forum-tab', key === active ? `[${SORT_LABEL[key]}]` : SORT_LABEL[key], 'span');
    if (key === active) tab.setAttribute('aria-current', 'true');
    tabs.appendChild(tab);
  }
  return tabs;
}
