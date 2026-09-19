import { t } from './i18n/index.js';
// Shared state and request pipeline for Ask AI. The five screens stay render-only;
// everything that outlives a screen (composer contents, the in-flight request,
// conversation id, local history) lives here.
import { postJSON, postFormData, ApiError } from './api.js';
import { user, identity } from './state.js';

export const MAX_TEXT = 300;

// Display list for the handset. Ids must match backend/services/aiPresets.js.
export const ASK_AI_PRESETS = [
  { id: 'yellow_leaves', label: 'Why are leaves yellow?', intent: 'crop_diagnosis' },
  { id: 'rain_spray', label: 'Is rain safe for spray?', intent: 'weather_action' },
  { id: 'sell_or_wait', label: 'Sell rice now or wait?', intent: 'market_decision' },
  { id: 'local_support', label: 'Find local support', intent: 'government_support' },
];

export const composer = {
  mode: 'text',
  text: '',
  image: null,   // { blob, previewUrl, isDemoSample }
  audio: null,   // { blob, seconds }
  // Until the member toggles it here, Ask AI answers in their profile language when it supports it.
  chosenLanguage: null,
  get language() { return this.chosenLanguage ?? (identity.profile?.language === 'hi' ? 'hi' : 'en'); },
  set language(value) { this.chosenLanguage = value; },
  conversationId: null,
  reset({ keepConversation = false } = {}) {
    this.clearMedia();
    this.text = '';
    this.mode = 'text';
    if (!keepConversation) this.conversationId = null;
  },
  clearMedia() {
    if (this.image?.previewUrl) URL.revokeObjectURL(this.image.previewUrl);
    this.image = null;
    this.audio = null;
  },
  get attachmentLabel() {
    if (this.image) return this.image.isDemoSample ? t('DEMO PHOTO') : t('PHOTO READY');
    if (this.audio) return this.audio.seconds
      ? `${t('VOICE')} ${String(this.audio.seconds).padStart(2, '0')}s`
      : t('VOICE READY');
    return t('NO ATTACHMENT');
  },
  get hasContent() { return Boolean(this.text.trim() || this.image || this.audio); },
};

// Result of the most recent request; AskAIAnswer renders from this.
export const session = {
  phase: 'idle', // idle | thinking | answered | error
  question: '',
  presetId: null,
  result: null,
  error: null,
  controller: null,
};

const capabilities = { text: true, image: true, audio: true, loaded: false };
export const serverCapabilities = capabilities;

export async function loadCapabilities() {
  try {
    const res = await fetch('/api/ai/capabilities', { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return capabilities;
    Object.assign(capabilities, await res.json(), { loaded: true });
  } catch { /* keep optimistic defaults; the ask itself will report the real state */ }
  return capabilities;
}

const requestId = () => `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// From the signed-in member's profile. The price market is only named when prices are loaded for
// the member's own region; otherwise it would describe somebody else's market.
export const userContext = () => {
  const p = identity.profile;
  const region = p?.regionCode || user.region;
  return {
    region,
    crops: (p?.cropCodes || []).slice(0, 4),
    experienceLevel: 'smallholder',
    ...(region === user.region ? { market: user.homeMarket } : {}),
  };
};

/**
 * Starts a request and moves to the Thinking screen. Returns immediately: the
 * Thinking screen renders progress and swaps itself for the answer when done.
 */
export function ask(ctx, {
  presetId = null, text = '', image = null, audio = null, followUp = false,
  replace = false, origin = replace ? 'input' : 'home',
} = {}) {
  cancel();
  // 'input' = came from the composer, so Cancel/errors go back there with the draft intact.
  session.origin = origin;
  session.followUp = followUp;
  session.phase = 'thinking';
  session.error = null;
  session.presetId = presetId;
  session.question = presetId ? t(ASK_AI_PRESETS.find((p) => p.id === presetId)?.label || '') : text;
  session.controller = new AbortController();
  session.pending = { presetId, text, image, audio, followUp };
  track(followUp ? 'followup_selected' : presetId ? 'preset_selected' : 'text_submitted', {
    mode: image ? 'photo' : audio ? 'voice' : 'text',
  });
  // From the composer we replace it, so Back on the answer returns to Ask AI home
  // rather than to a half-typed question.
  if (replace) ctx.router.replace('AskAIThinking');
  else ctx.router.push('AskAIThinking');
}

/** Performs the request the Thinking screen is showing progress for. */
export async function runPending() {
  const { presetId, text, image, audio, followUp } = session.pending || {};
  const signal = session.controller?.signal;
  const payload = {
    requestId: requestId(),
    conversationId: followUp ? composer.conversationId : null,
    presetId,
    text: (text || '').slice(0, MAX_TEXT),
    language: composer.language,
    userContext: userContext(),
  };

  try {
    let body;
    if (image || audio) {
      const form = new FormData();
      form.append('requestId', payload.requestId);
      if (payload.conversationId) form.append('conversationId', payload.conversationId);
      if (presetId) form.append('presetId', presetId);
      form.append('text', payload.text);
      form.append('language', payload.language);
      form.append('context', JSON.stringify(payload.userContext));
      if (image) {
        form.append('image', image.blob, 'photo.jpg');
        if (image.isDemoSample) form.append('demoSample', '1');
      }
      if (audio) form.append('audio', audio.blob, 'voice.webm');
      body = await postFormData('/api/ai/ask-media', form, { signal, timeout: 20000 });
    } else {
      body = await postJSON('/api/ai/ask', payload, { signal, timeout: 12000 });
    }
    session.result = body;
    session.phase = 'answered';
    composer.conversationId = body.conversationId;
    composer.clearMedia(); // raw photo/audio is not kept once it has been answered
    if (body.transcript) session.question = body.transcript;
    rememberQuestion(session.question);
    cacheAnswer(session.question, body);
    track('answer_success', { fallback: body.meta?.fallback, cached: body.meta?.cached, ms: body.meta?.latencyMs });
  } catch (err) {
    if (err.code === 'CANCELLED') return;
    const cached = readCachedAnswer(session.question);
    if (cached) {
      // `stale` = served from this phone because the network failed (UI shows CACHED).
      session.result = { ...cached, meta: { ...cached.meta, cached: true, stale: true } };
      session.phase = 'answered';
      track('answer_fallback', { source: 'cache' });
      return;
    }
    session.result = offlineResult(session.question, presetId);
    session.error = err instanceof ApiError ? err : new ApiError('INTERNAL_ERROR', t('Something went wrong.'));
    session.phase = 'error';
    track('answer_fallback', { source: 'offline', code: session.error.code });
  }
}

export function cancel() {
  session.controller?.abort();
  session.controller = null;
  if (session.phase === 'thinking') session.phase = 'idle';
}

// --- offline fallback (server unreachable; the server has its own, richer one) ---

const OFFLINE_STEPS = {
  crop_diagnosis: ['Check soil moisture 5cm down', 'Compare old and new leaves', 'Look under the leaves for insects'],
  weather_action: ['Check the Weather screen first', 'Do not spray if rain is likely', 'Wear gloves and a mask'],
  market_decision: ['Open Market Prices', 'Subtract transport before comparing', 'Check today against the week'],
  government_support: ['Ask the block agriculture office', 'Carry land record, ID, passbook', 'Never pay a fee to apply'],
  general: ['Press # to ask again', 'Check Weather and Market Prices', 'Ask Farmer Circle'],
};

export function guessIntent(text = '', presetId = null) {
  const preset = ASK_AI_PRESETS.find((p) => p.id === presetId);
  if (preset) return preset.intent;
  const lower = text.toLowerCase();
  if (/(price|sell|market|mandi|rate)/.test(lower)) return 'market_decision';
  if (/(rain|spray|weather|wind|irrigat)/.test(lower)) return 'weather_action';
  if (/(subsid|scheme|government|loan|support)/.test(lower)) return 'government_support';
  if (/(leaf|leaves|pest|disease|yellow|spot|wilt|rot|insect)/.test(lower)) return 'crop_diagnosis';
  return 'general';
}

function offlineResult(question, presetId) {
  const intent = guessIntent(question, presetId);
  return {
    ok: true,
    conversationId: null,
    intent,
    transcript: null,
    answer: {
      headline: t('Offline checklist'),
      summary: t('AI could not be reached. These steps are safe to start with.'),
      actions: OFFLINE_STEPS[intent].map((label) => ({ label: t(label), detail: '' })),
      reasons: [],
      warnings: [t('Confirm with a local expert before spending money.')],
      confidence: 'low',
      needs_better_photo: false,
      retake_instruction: null,
      context_used: [],
      sources: [],
      follow_ups: [],
      disclaimer: t('AI guidance is not a substitute for a local agronomist.'),
    },
    meta: { cached: false, sampleData: false, fallback: true, offline: true, latencyMs: 0 },
  };
}

// --- local storage: recent questions and a small answer cache (never media) ---

const HISTORY_KEY = 'agrilink.ai.history';
const CACHE_KEY = 'agrilink.ai.cache';
const SAVED_KEY = 'agrilink.ai.saved';

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / full quota */ }
}

export const history = () => read(HISTORY_KEY, []);

function rememberQuestion(text) {
  if (!text) return;
  const list = [text, ...history().filter((q) => q !== text)].slice(0, 5);
  write(HISTORY_KEY, list);
}

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function cacheAnswer(question, body) {
  if (!question || body.meta?.fallback) return;
  const list = read(CACHE_KEY, []).filter((e) => e.q !== norm(question));
  list.unshift({ q: norm(question), at: Date.now(), body });
  write(CACHE_KEY, list.slice(0, 5));
}

function readCachedAnswer(question) {
  const hit = read(CACHE_KEY, []).find((e) => e.q === norm(question));
  return hit ? hit.body : null;
}

export function saveAnswer(question, answer) {
  if (!answer) return false;
  const list = read(SAVED_KEY, []);
  list.unshift({ q: question, at: Date.now(), answer });
  write(SAVED_KEY, list.slice(0, 10));
  return true;
}

// --- analytics: aggregate only, never question text or media ---
const events = [];
export function track(event, props = {}) {
  events.push({ event, ...props, t: Date.now() });
  if (events.length > 50) events.shift();
  if (new URLSearchParams(location.search).has('debug')) console.debug('[analytics]', event, props);
}
export const analyticsEvents = () => events.slice();
