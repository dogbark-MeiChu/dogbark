import { t } from '../i18n/index.js';
import { el, isCompact } from '../dom.js';
import { ASK_AI_PRESETS, composer, ask, loadCapabilities, serverCapabilities, track } from '../askAI.js';
import { capabilities, loadFeatures } from '../media.js';

// Focus order: 0 = composer, 1..n = presets.
const presetsFor = () => (isCompact() ? ASK_AI_PRESETS.slice(0, 3) : ASK_AI_PRESETS);

let onResize = null;

export default {
  name: 'AskAIHome',
  title: () => (isCompact() ? 'Agri AI' : 'AgriLink AI'),
  statusBadge: () => (serverCapabilities.loaded && !serverCapabilities.text ? '○ OFF' : '● ON'),
  softLeft: { label: () => (isCompact() ? 'Opt' : 'Options'), handler: (ctx) => ctx.router.push('AskAIMedia') },
  softCenter: { label: 'Ask' },

  render() {
    const compact = isCompact();
    const wrap = el('ai-screen ai-home');

    const hero = el('ai-hero');
    const mark = el('ai-mark');
    mark.append(el('ai-orb'), el('ai-mark-text', t('AI FIELD')));
    hero.append(mark);
    if (compact) {
      hero.append(el('ai-tagline', t('Ask/Snap/Talk')));
    } else {
      hero.append(el('ai-tagline', t('Ask. Snap. Speak.')), el('ai-subline', t('Get a clear next step')));
    }
    wrap.appendChild(hero);

    const box = el('item ai-composer');
    box.append(el('ai-composer-label', t(compact ? 'Ask a farm question' : 'Ask about your farm')));
    if (!compact) {
      const media = capabilities();
      const modes = el('ai-modes');
      modes.append(
        el('ai-mode-badge', t('Type')),
        el(`ai-mode-badge${media.photo ? '' : ' off'}`, t('Photo')),
        el(`ai-mode-badge${media.voice ? '' : ' off'}`, t('Mic')),
      );
      box.appendChild(modes);
    }
    wrap.appendChild(box);

    const list = el('ai-presets');
    presetsFor().forEach((p, i) => {
      const row = el('item ai-preset');
      row.append(el('ai-preset-num', String(i + 1)), el('ai-preset-label', t(p.label)));
      list.appendChild(row);
    });
    wrap.appendChild(list);
    return wrap;
  },

  // Coming back from an answer should land on the composer, not a stale preset.
  initialFocus: () => 0,

  // onShow also runs on every rerender, so the one-time work is guarded.
  onShow(ctx) {
    if (onResize) return;
    if (ctx.router.depth === 2) track('ask_ai_opened');
    const keepFocus = () => {
      if (!onResize) return; // user already left this screen
      const i = ctx.focus.index;
      ctx.rerender();
      ctx.focus.set(Math.min(i, ctx.focus.items.length - 1));
    };
    if (!serverCapabilities.loaded) loadCapabilities().then(keepFocus);
    if (typeof navigator.hasFeature === 'function' && !capabilities().platform.loaded) loadFeatures().then(keepFocus); // Cloud Phone
    onResize = keepFocus;
    addEventListener('resize', onResize);
  },
  onHide() {
    if (onResize) removeEventListener('resize', onResize);
    onResize = null;
  },

  onKey(action, ctx) {
    if (action.startsWith('NUM_')) {
      const n = Number(action.slice(4));
      const preset = presetsFor()[n - 1];
      if (preset) {
        composer.reset();
        ask(ctx, { presetId: preset.id });
      }
      return true; // swallow other digits: no accidental navigation
    }
    if (action === 'STAR') { ctx.router.push('AskAIHistory'); return true; }
    return false;
  },

  onEnter(_el, ctx, i) {
    if (i === 0) {
      composer.reset();
      ctx.router.push('AskAIInput');
      return;
    }
    const preset = presetsFor()[i - 1];
    if (preset) {
      composer.reset();
      ask(ctx, { presetId: preset.id });
    }
  },
};
