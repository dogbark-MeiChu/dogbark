import { Router } from 'express';
import crypto from 'node:crypto';
import { synthesize as defaultSynthesize, TtsError, TTS_MAX_CHARS, isConfigured } from '../services/ttsService.js';
import { memberOnly, quotaLimits } from '../middleware/memberAccess.js';
import { errorBody } from '../middleware/errors.js';

const PER_MINUTE = Number(process.env.TTS_RATE_LIMIT_PER_MINUTE) || 30;
const PER_DAY    = Number(process.env.TTS_RATE_LIMIT_PER_DAY)    || 500;
const GLOBAL_PER_DAY = Number(process.env.TTS_GLOBAL_LIMIT_PER_DAY) || 300;

const ALLOWED_LANGUAGES = new Set(['en', 'hi', 'bn', 'vi']);

const limitPayload = (message) => ({
  ok: false,
  error: { code: 'TTS_RATE_LIMIT', message, retryable: true },
});

const CACHE_MAX = 60;
const cache = new Map();
const cacheKey = (text, language) => crypto.createHash('sha256').update(`${language}\n${text}`).digest('hex');
function remember(key, value) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

const STATUS = {
  TTS_EMPTY: 400, TTS_UNAVAILABLE: 503, TTS_TIMEOUT: 504,
  TTS_RATE_LIMIT: 429, TTS_NO_AUDIO: 502, CANCELLED: 499,
  INVALID_INPUT: 400, TTS_FALLBACK_NATIVE: 503
};

function sendError(res, err) {
  const code = err instanceof TtsError ? err.code : 'INTERNAL_ERROR';
  if (code === 'CANCELLED') return;
  if (!(err instanceof TtsError)) console.error('tts route error:', err.message);
  // The shared envelope (with the request id); fallbackText lets the handset read aloud itself
  // when both cloud voices failed (TTS_FALLBACK_NATIVE).
  res.status(STATUS[code] || 500).json(errorBody(res.req, {
    code,
    message: err instanceof TtsError ? err.message : 'Something went wrong.',
    retryable: Boolean(err.retryable),
    ...(err.fallbackText ? { fallbackText: err.fallbackText } : {}),
  }));
}

export function ttsRouter({ auth, synthesize = defaultSynthesize } = {}) {
  const router = Router();
  const limits = quotaLimits({ perMinute: PER_MINUTE, perDay: PER_DAY, globalPerDay: GLOBAL_PER_DAY, payload: limitPayload });

  router.get('/capabilities', (_req, res) => {
    res.json({ ok: true, tts: isConfigured(), maxChars: TTS_MAX_CHARS, languages: [...ALLOWED_LANGUAGES] });
  });

  function readRequest(req, res, next) {
    const { text, language } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return sendError(res, new TtsError('INVALID_INPUT', 'Text is required.'));
    }
    if (language && !ALLOWED_LANGUAGES.has(language)) {
      return sendError(res, new TtsError('INVALID_INPUT', `Unsupported language: ${language}`));
    }
    req.tts = { text: text.trim().slice(0, TTS_MAX_CHARS), language: language || 'en' };
    req.tts.key = cacheKey(req.tts.text, req.tts.language);
    const hit = cache.get(req.tts.key);
    if (hit) {
      remember(req.tts.key, hit);
      return res.type(hit.mimeType).send(hit.audio);
    }
    next();
  }

  router.post('/', memberOnly(auth), readRequest, limits, async (req, res) => {
    const controller = new AbortController();
    req.on('aborted', () => controller.abort());

    try {
      const result = await synthesize(req.tts.text, req.tts.language, { signal: controller.signal });
      remember(req.tts.key, result);
      res.type(result.mimeType).send(result.audio);
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}
