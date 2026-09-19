import { t } from '../i18n/index.js';
import { el } from '../dom.js';

// Shown when a signed-out reader tries to post, reply, vote, save or report (or when
// the session has expired). Sign-in itself is the app-wide identity flow.
export default {
  name: 'AuthGate',
  title: 'Sign in required',
  numericSelect: true,
  softLeft: { label: '', handler() {} },
  softCenter: { label: 'Select', handler: (ctx, _c, i) => choose(ctx, i) },
  render() {
    const wrap = el('forum-screen forum-auth-gate');
    wrap.appendChild(el('forum-note', t('You can read freely. Sign in to post, reply, vote or save.')));
    const list = el('list');
    ['Sign in / Create account', 'Continue reading'].forEach((label, i) => {
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
  if (i === 0) ctx.router.replace('AuthWelcome'); // back at the app menu after signing in
  else ctx.router.pop();
}
