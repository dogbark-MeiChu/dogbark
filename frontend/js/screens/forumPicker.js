import { t } from '../i18n/index.js';
import { el, isCompact } from '../dom.js';

// Generic numbered choice list, registered under several names (CreatePostType,
// ReportContent, CommunityList ...) so the wizard reads naturally. Digits 1-9 pick
// directly through the router's numericSelect.
//
// params: { title, options:[{label, value}], selected, multi, max, onPick(option, ctx),
//           onDone(values, ctx), doneLabel, note, empty }
//
// onPick/onDone own navigation: forward with router.push/replace, or router.pop().
function makePicker(name) {
  const chosen = new WeakMap(); // multi-select state per params object

  const values = (ctx) => {
    if (!chosen.has(ctx.params)) chosen.set(ctx.params, new Set(ctx.params.selectedValues || []));
    return chosen.get(ctx.params);
  };

  return {
    name,
    numericSelect: true,
    title: (ctx) => ctx.params?.title || 'Choose',
    softCenter: {
      label: (ctx) => (ctx.params?.multi ? 'Done' : 'Select'),
      handler(ctx, _cur, index) {
        const p = ctx.params;
        if (p.multi) return p.onDone?.([...values(ctx)], ctx);
        return p.onPick?.(p.options[index], ctx);
      },
    },
    softLeft: { label: '', handler() {} },

    render(ctx) {
      const p = ctx.params;
      const wrap = el('forum-screen');
      if (p.note && !isCompact()) wrap.appendChild(el('forum-note', t(p.note)));
      if (!p.options?.length) { wrap.appendChild(el('forum-empty', t(p.empty || 'Nothing to choose.'))); return wrap; }
      const list = el('list');
      const picked = p.multi ? values(ctx) : null;
      p.options.forEach((o, i) => {
        const on = p.multi ? picked.has(o.value) : o.value === p.selected;
        const row = el('item forum-choice');
        row.appendChild(el('forum-choice-n', i < 9 ? String(i + 1) : '·', 'span'));
        row.appendChild(el('forum-choice-label', t(o.label), 'span'));
        if (p.multi) row.appendChild(el('forum-check', on ? '[x]' : '[ ]', 'span'));
        else if (on) row.appendChild(el('forum-check', '✓', 'span'));
        list.appendChild(row);
      });
      wrap.appendChild(list);
      return wrap;
    },

    initialFocus(ctx) {
      const p = ctx.params;
      if (p.multi) return p.focusIndex ?? null;
      const i = p.options?.findIndex((o) => o.value === p.selected);
      return i >= 0 ? i : null;
    },

    onEnter(_row, ctx, index) {
      const p = ctx.params;
      const o = p.options?.[index];
      if (!o) return;
      if (!p.multi) return p.onPick?.(o, ctx);
      const set = values(ctx);
      if (set.has(o.value)) set.delete(o.value);
      else if (set.size < (p.max || 99)) set.add(o.value);
      ctx.params.focusIndex = index;
      ctx.rerender();
    },

    onKey(action, ctx) {
      if (action === 'HASH' && ctx.params.multi) { ctx.params.onDone?.([...values(ctx)], ctx); return true; }
      return false;
    },
  };
}

export const pickerScreens = Object.fromEntries(
  ['ForumPicker', 'CommunityList', 'CreatePostType', 'CreatePostCommunity', 'CreatePostTags', 'CreatePostLocation',
    'ReportContent', 'RegisterCountry', 'RegisterRegion', 'RegisterCrop'].map((n) => [n, makePicker(n)]),
);
