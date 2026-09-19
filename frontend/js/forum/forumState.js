import { t } from '../i18n/index.js';
import { forumApi } from './forumApi.js';
import { identity } from '../state.js';
import { newRequestId } from './forumUtils.js';

// Sign-in state is owned by the app-wide identity (state.js). The session is an
// HttpOnly cookie the page cannot read; nothing here is a source of truth.
export const auth = {
  loaded: true,
  get authenticated() { return Boolean(identity.profile); },
  get user() { return identity.profile; },
};

export const forum = {
  sort: 'local',
  community: null,
  scope: 'global',         // Local sort already ranks nearby posts first; scope narrows further
  tag: null,
  type: null,
  status: null,
  browseRegion: 'IN-UP-01', // guests only; members use their profile region
  focusedPostId: null,
  cachedFeeds: new Map(),
  draftPost: null,
  pendingIntent: null,
  flash: null,
  notifications: 0,
};

const DRAFT_KEY = 'agrilink.fc.draft';

// Only title/body/choices are kept, and only for this browser session.
export function loadDraft() {
  if (forum.draftPost) return forum.draftPost;
  try { const raw = sessionStorage.getItem(DRAFT_KEY); if (raw) forum.draftPost = JSON.parse(raw); } catch { /* ignore */ }
  return forum.draftPost;
}
export function newDraft() {
  forum.draftPost = { requestId: newRequestId(), type: 'question', community: null, title: '', body: '', tags: [], locationScope: 'region' };
  saveDraft();
  return forum.draftPost;
}
export function saveDraft() {
  try { forum.draftPost ? sessionStorage.setItem(DRAFT_KEY, JSON.stringify(forum.draftPost)) : sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}
export function clearDraft() { forum.draftPost = null; saveDraft(); }

export function flash(text) { forum.flash = { text, until: Date.now() + 5000 }; }
export function currentFlash() {
  if (forum.flash && forum.flash.until > Date.now()) return forum.flash.text;
  forum.flash = null;
  return null;
}

/** The server said the session is gone: forget the local copy so the UI shows the sign-in gate. */
export function expireSession() {
  identity.profile = null;
  forum.cachedFeeds.clear();
  forum.notifications = 0;
  flash(t('Session ended. Please sign in again.'));
}

export async function refreshNotifications() {
  if (!auth.authenticated) { forum.notifications = 0; return 0; }
  try { forum.notifications = (await forumApi.notifications()).count; } catch { /* badge is best effort */ }
  return forum.notifications;
}

// ---- guest gate & return-to-screen ------------------------------------------
/** True when signed in. Otherwise shows the sign-in gate and returns false. */
export function requireAuth(ctx) {
  if (auth.authenticated) return true;
  ctx.router.push('AuthGate');
  return false;
}

/** Call from onShow of the screen the post wizard started from: opens the post just created. */
export function resumeIntent(ctx, screenName) {
  const it = forum.pendingIntent;
  if (!it?.ready || it.origin !== screenName) return false;
  forum.pendingIntent = null;
  if (it.kind === 'openPost') { ctx.router.push('PostDetail', { postId: it.postId }); return true; }
  return false;
}

// The wizard lives in screens/createPost.js; it registers itself here to avoid a circular import.
let wizardStarter = null;
export const setWizardStarter = (fn) => { wizardStarter = fn; };
export function startWizard(ctx, originName) {
  forum.wizard = { origin: originName, depth: ctx.router.depth };
  wizardStarter(ctx);
}
