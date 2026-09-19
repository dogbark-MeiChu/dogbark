import { t } from '../i18n/index.js';
import { el } from '../dom.js';
import { createTextEntry } from '../forum/textEntry.js';
import { loadingView } from '../forum/ui.js';
import { handleAuth, marketError, row } from './marketUtils.js';

// Generic keypad form. fields: [{ key, label, type:'choice'|'date'|'number'|'text', options|(values)=>options,
// decimals, max, maxLen, optional, show(values), fmt(value, values) }]. Choices and dates use pickers so no
// one has to type a date or a unit on a keypad; numbers use digits (# = decimal point).
const visible = (p) => p.fields.filter((f) => !f.show || f.show(p.values));
const shown = (f, v) => {
  const val = v[f.key];
  if (f.fmt) return f.fmt(val, v);
  if (val == null || val === '') return '—';
  if (f.type === 'choice' || f.type === 'date') return (typeof f.options === 'function' ? f.options(v) : f.options).find((o) => o.value === val)?.label ?? String(val);
  return String(val);
};

export const MarketForm = {
  name: 'MarketForm',
  title: (ctx) => ctx.params.title,
  numericSelect: true,
  softLeft: { label: '', handler() {} },
  softCenter: { label: 'Select', handler: (ctx, _c, i) => choose(ctx, i) },
  render(ctx) {
    const p = ctx.params;
    ctx.root.classList.add('forum-scroll');
    const wrap = el('forum-screen');
    if (p.busy) { wrap.appendChild(loadingView(t('Sending…'))); return wrap; }
    if (p.intro) wrap.appendChild(el('forum-note', t(p.intro)));
    const list = el('list');
    visible(p).forEach((f, i) => {
      const r = row(i < 9 ? i + 1 : null, t(f.label), shown(f, p.values));
      if (p.errorField === f.key) r.classList.add('market-bad');
      list.appendChild(r);
    });
    // The error sits right above the submit row, which keeps focus after a failed send, so it is
    // on screen at 240x320 instead of below a long form.
    if (p.error) list.appendChild(el('forum-error-text', p.error));
    const submit = el('item forum-retry', `✓ ${t(p.submitLabel)}`);
    list.appendChild(submit);
    wrap.appendChild(list);
    return wrap;
  },
  initialFocus: (ctx) => ctx.params.focusIndex ?? 0,
  onKey: (_a, ctx) => Boolean(ctx.params.busy),
  onEnter(_r, ctx, i) { choose(ctx, i); },
};

function choose(ctx, i) {
  const p = ctx.params;
  const fields = visible(p);
  if (i === fields.length) return submit(ctx);
  const f = fields[i];
  if (!f) return;
  p.focusIndex = i;
  p.error = null; p.errorField = null;
  const set = (v, c) => { p.values[f.key] = v; c.router.pop(); };
  if (f.type === 'number') {
    return ctx.router.push('MarketNumber', { title: f.label, initial: p.values[f.key], decimals: f.decimals ?? 2, maxLen: f.maxLen ?? 9, onDone: set });
  }
  if (f.type === 'text') {
    return ctx.router.push('MarketText', { title: f.label, initial: p.values[f.key] || '', max: f.max ?? 160, min: f.optional ? 0 : 3, onDone: set });
  }
  const options = f.type === 'date' ? f.options : (typeof f.options === 'function' ? f.options(p.values) : f.options);
  ctx.router.push('ForumPicker', { title: f.label, options, selected: p.values[f.key], onPick: (o, c) => set(o.value, c) });
}

async function submit(ctx) {
  const p = ctx.params;
  const missing = visible(p).find((f) => !f.optional && (p.values[f.key] == null || p.values[f.key] === ''));
  if (missing) { p.error = t('Fill in: {field}', { field: t(missing.label) }); p.errorField = missing.key; p.focusIndex = visible(p).indexOf(missing); return ctx.rerender(); }
  p.busy = true; p.error = null; p.errorField = null;
  const root = ctx.root;
  ctx.rerender();
  try {
    const result = await p.submit(p.values, p.requestId);
    p.busy = false;
    p.done(ctx, result);
  } catch (err) {
    p.busy = false;
    if (handleAuth(ctx, err)) return;
    p.error = marketError(err);
    p.errorField = err.field && visible(p).some((f) => f.key === err.field) ? err.field : null;
    p.focusIndex = p.errorField ? visible(p).findIndex((f) => f.key === p.errorField) : visible(p).length;
    if (ctx.root === root || p.busy === false) ctx.rerender();
  }
}

// ---- number entry: digits type, * deletes, # inserts the decimal point ----
let num = null;
export const MarketNumber = {
  name: 'MarketNumber',
  title: (ctx) => ctx.params.title,
  softLeft: { label: '', handler() {} },
  softCenter: { label: 'OK', handler: (ctx) => finish(ctx) },
  render(ctx) {
    const p = ctx.params;
    num = { text: p.initial != null ? String(p.initial) : '', node: null, hint: null };
    const wrap = el('forum-screen');
    wrap.appendChild(el('forum-label', t(p.title)));
    num.node = el('forum-pin-input');
    wrap.appendChild(num.node);
    num.hint = el('forum-hint', t(p.decimals > 0 ? '* delete · # decimal point · OK to save' : '* delete · OK to save'));
    wrap.appendChild(num.hint);
    paint();
    return wrap;
  },
  onKey(action, ctx) {
    const p = ctx.params;
    if (action.startsWith('NUM_')) {
      const digits = num.text.replace('.', '');
      const [, frac = ''] = num.text.split('.');
      if (digits.length < p.maxLen && (!num.text.includes('.') || frac.length < p.decimals)) num.text += action.slice(4);
      paint(); return true;
    }
    if (action === 'STAR' || (action === 'BACK' && num.text)) { num.text = num.text.slice(0, -1); paint(); return true; }
    if (action === 'HASH') { if (p.decimals > 0 && !num.text.includes('.')) num.text = `${num.text || '0'}.`; paint(); return true; }
    return action === 'LEFT' || action === 'RIGHT' || action === 'UP' || action === 'DOWN';
  },
  onEnter() {},
};
const paint = () => { if (num?.node) num.node.textContent = num.text || '_'; };
function finish(ctx) {
  const p = ctx.params;
  const text = num.text.replace(/\.$/, '');
  if (!text || Number.isNaN(Number(text))) { num.hint.textContent = t('Enter a number first'); return; }
  if (p.exactLength && text.length !== p.exactLength) { num.hint.textContent = t('Enter {n} digits', { n: p.exactLength }); return; }
  p.onDone(p.exactLength ? text : Number(text), ctx);
}

// ---- free text (T9 multi-tap), used for pickup location ----
let entry = null;
export const MarketText = {
  name: 'MarketText',
  title: (ctx) => ctx.params.title,
  softLeft: { label: '', handler() {} },
  softCenter: { label: 'OK', handler: () => entry?.done() },
  render(ctx) {
    const p = ctx.params;
    entry?.dispose();
    entry = createTextEntry({
      max: p.max, min: p.min, initial: p.initial, placeholder: t('Type here…'),
      onDone: (v) => {
        if (v.length < p.min) return entry.hint(t('Write at least {n} characters', { n: p.min }));
        p.onDone(v, ctx);
      },
    });
    const wrap = el('forum-screen forum-form-step');
    wrap.appendChild(el('forum-label', t('{title} (no links)', { title: t(p.title) })));
    wrap.appendChild(entry.render());
    return wrap;
  },
  onHide() { entry?.dispose(); entry = null; },
  onKey: (action) => entry?.onKey(action) ?? false,
  onEnter() {},
};
