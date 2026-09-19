import { t } from './i18n/index.js';
import { Focus } from './focus.js';
import { readAloud, stop as stopTts, isPlaying } from './tts.js';
import { extractScreenText } from './screenText.js';
import { identity } from './state.js';

// Screen stack kept in sync with browser history so the platform's Right Soft Key
// ("back if history, else close") behaves correctly.
export function createRouter({ screens, els, ctxExtra = {} }) {
  const stack = [];
  const ctx = { ...ctxExtra };
  let focus = null;
  let pendingRoot = null;

  function show() {
    const entry = stack[stack.length - 1];
    const screen = screens[entry.name];
    ctx.params = entry.params;
    // A screen may compute its title, and may add a right-aligned badge
    // (confidence, recording state) without owning the header element.
    els.status.textContent = t((typeof screen.title === 'function' ? screen.title(ctx) : screen.title) || screen.name);
    const badge = screen.statusBadge?.(ctx);
    if (badge) {
      const b = document.createElement('span');
      b.className = 'status-badge';
      b.textContent = badge;
      els.status.appendChild(b);
    }
    els.content.replaceChildren();
    const root = document.createElement('div');
    root.className = 'scroll';
    els.content.appendChild(root);
    ctx.root = root;
    ctx.rerender = show;
    const built = screen.render(ctx);
    if (built) root.appendChild(built);
    focus = new Focus(root);
    ctx.focus = focus;
    const fi = screen.initialFocus?.(ctx);
    if (fi != null) focus.set(fi);
    const l = screen.softLeft, c = screen.softCenter, r = screen.softRight;
    const label = (k) => t(typeof k.label === 'function' ? k.label(ctx) : k.label);
    els.sl.textContent = l ? label(l) : t('Menu');
    els.sc.textContent = c ? label(c) : (focus.items.length ? t('Select') : '');
    els.sr.textContent = r ? label(r) : (stack.length > 1 ? t('Back') : t('Exit'));
    screen.onShow?.(ctx);
  }

  function hideCurrent() { screens[stack[stack.length - 1]?.name]?.onHide?.(ctx); }

  const router = {
    push(name, params) {
      hideCurrent();
      stack.push({ name, params });
      history.pushState({ d: stack.length - 1 }, '');
      show();
    },
    replace(name, params) { hideCurrent(); stack[stack.length - 1] = { name, params }; show(); },
    pop() { history.back(); }, // popstate handler below does the work; at root this closes the page
    // Unwinds to the screen that was `depth` deep (router.depth captured earlier).
    // The popstate handler re-renders it; if already there, just re-render.
    popTo(depth) { const n = stack.length - depth; if (n > 0) history.go(-n); else show(); },
    reset() { if (stack.length > 1) history.go(-(stack.length - 1)); },
    // Unwinds to the root and swaps it for `name` (e.g. sign-out). history.go is async, so a
    // replace() right after reset() would hit the old top entry and then be unwound away.
    resetTo(name, params) {
      if (stack.length > 1) { pendingRoot = { name, params }; history.go(-(stack.length - 1)); return; }
      hideCurrent(); stack[0] = { name, params }; show();
    },
    start(name) {
      history.replaceState({ d: 0 }, '');
      stack.push({ name });
      show();
    },
    /** Lets the current screen refetch quietly (e.g. after the sync poller saw news). */
    refresh() { screens[stack[stack.length - 1]?.name]?.onRefresh?.(ctx); },
    get depth() { return stack.length; },
  };
  ctx.router = router;

  addEventListener('popstate', (e) => {
    const d = e.state?.d ?? 0;
    hideCurrent();
    stack.length = Math.min(stack.length, d + 1);
    if (pendingRoot && stack.length === 1) { stack[0] = pendingRoot; pendingRoot = null; }
    show();
  });

  router.dispatch = (action) => {
    const screen = screens[stack[stack.length - 1].name];
    if (screen.onKey?.(action, ctx) === true) return;
    switch (action) {
      case 'UP': return focus.move(-1);
      case 'DOWN': return focus.move(1);
      // The handset's centre soft key reports as Enter, so a screen that labels it
      // (e.g. "Send") handles it there instead of through list selection.
      case 'ENTER': return screen.softCenter?.handler
        ? screen.softCenter.handler(ctx, focus.current, focus.index)
        : screen.onEnter?.(focus.current, ctx, focus.index);
      case 'SOFT_L': return (screen.softLeft?.handler ?? (() => router.reset()))(ctx);
      case 'SOFT_R':
      case 'BACK': return (screen.softRight?.handler ?? (() => router.pop()))(ctx);
      default:
        // Cloud TTS Broadcaster: # reads the current screen aloud after login.
        // Screens that consume HASH in their onKey (e.g. T9 text input) will
        // have returned true above, so this code only runs when # is unhandled.
        if (action === 'HASH' && identity.profile) {
          if (isPlaying()) { stopTts(); return; }
          const text = extractScreenText(els.content);
          if (text) readAloud(text, identity.profile.language || 'en');
          return;
        }
        if (action.startsWith('NUM_')) {
          const n = Number(action.slice(4));
          if (n >= 1 && focus.items[n - 1] && screen.numericSelect) {
            focus.set(n - 1);
            screen.onEnter?.(focus.current, ctx, n - 1);
          }
        }
    }
  };
  return router;
}
