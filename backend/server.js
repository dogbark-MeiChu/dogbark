import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import weather from './routes/weather.js';
import { aiRouter } from './routes/ai.js';
import { ttsRouter } from './routes/tts.js';
import { pricesRouter } from './routes/prices.js';
import { createPool } from './db/pool.js';
import { memoryRepo, pgRepo } from './services/priceRepo.js';
import { createPriceService, createFarmPriceService } from './services/priceService.js';
import { createPriceCacheRepository } from './repositories/priceCacheRepository.js';
import { getWeather } from './services/weatherService.js';
import { createAuthService } from './services/authService.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { createForumRouter } from './routes/forum.js';
import { createMarketRouter } from './routes/market.js';
import { ensureForumReference } from './db/forumReference.js';
import { seedDemo } from './db/forumSeed.js';
import { errorHandler, unavailable, AppError } from './middleware/errors.js';
import { requestId } from './middleware/requestId.js';
import { createFarmOpsRouter } from './routes/farmOps.js';
import { createPriceAlertRouter } from './routes/priceAlerts.js';
import { seedFarmOps } from './db/farmOpsSeed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// nginx on the same host sets X-Forwarded-For; trusting only loopback lets the
// AI rate limiter key on the real client IP without letting clients spoof it.
app.set('trust proxy', 'loopback');
app.use(requestId);

// Content Security Policy: no inline/remote scripts, no remote images. Media is
// uploaded to our own origin only; the Gemini key and calls stay server-side.
app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(express.json({ limit: '32kb' })); // media goes through multipart, not JSON

// Postgres when DATABASE_URL is set, otherwise the in-memory demo data (flagged sample).
const forumUnavailable = unavailable('Farmer Circle is not available right now.');
const pool = createPool();
console.log(pool ? 'prices: using Postgres' : 'prices: using in-memory seed data');
const prices = createPriceService(pool ? pgRepo(pool) : memoryRepo());
app.use('/api/prices', pricesRouter(prices));
app.use('/api/weather', weather);
// Identity is created first so the Gemini-backed routes can require a signed-in member. It stays
// null without a database (local offline demo) or when its secret is missing (see below).
let auth = null;
let authError = null;
if (pool) { try { auth = createAuthService(pool); } catch (err) { authError = err; } }
app.use('/api/ai', aiRouter({ auth }));
app.use('/api/tts', ttsRouter({ auth }));
if (pool) {
  try {
    if (authError) throw authError;
    app.use('/api/auth', authRouter({ auth, pool }));
    app.use('/api/admin', adminRouter({ auth, pool }));
    app.use('/admin', express.static(path.join(here, 'admin')));
    console.log('auth: PostgreSQL sessions enabled');
    // Farmer Circle needs migration 005 (npm run db:migrate) and the auth service above.
    try {
      await ensureForumReference(pool);
      if (process.env.SEED_DEMO_DATA === 'true') {
        const seeded = await seedDemo(pool, { auth });
        console.log(`forum: demo data ready (${seeded.posts} posts)`);
      }
      app.use('/api/forum', createForumRouter({ pool, auth }).router);
      console.log('forum: Farmer Circle enabled');
    } catch (err) {
      console.warn(`forum: disabled (${err.message}) - apply migration 005 with npm run db:migrate`);
      app.use('/api/forum', forumUnavailable);
    }
    // Local Market needs migration 006; a missing table only disables this feature.
    try {
      await pool.query('SELECT 1 FROM app.market_listings LIMIT 0');
      app.use('/api/market', createMarketRouter({ pool, auth }).router);
      console.log('market: Local Market enabled');
    } catch (err) {
      console.warn(`market: disabled (${err.message}) - apply migration 006 with npm run db:migrate`);
      app.use('/api/market', unavailable('Local Market is not available right now.'));
    }
    try {
      await pool.query('SELECT 1 FROM app.farms LIMIT 0');
      if (process.env.SEED_DEMO_DATA === 'true') await seedFarmOps(pool);
      const farmPriceService = createFarmPriceService({ prices, cache: createPriceCacheRepository(pool) }); // same synced data as /api/prices
      app.use('/api/farms', createFarmOpsRouter({ pool, auth, farmPriceService, weatherGetter: getWeather }).router);
      console.log("farm ops: Today's Farm enabled");
    } catch (err) {
      console.warn(`farm ops: disabled (${err.message}) - apply migration 007 with npm run db:migrate`);
      app.use('/api/farms', unavailable("Today's Farm is not available right now."));
    }
    // Price alerts need migration 012; checked again after every mandi sync (db/syncMandi.js).
    try {
      await pool.query('SELECT 1 FROM app.price_alerts LIMIT 0');
      app.use('/api/price-alerts', createPriceAlertRouter({ pool, auth, prices }).router);
      console.log('price alerts: enabled');
    } catch (err) {
      console.warn(`price alerts: disabled (${err.message}) - apply migration 012 with npm run db:migrate`);
      app.use('/api/price-alerts', unavailable('Price alerts are not available right now.'));
    }
  } catch (err) {
    // Prices and offline AI are still useful on a local demo, but identity must
    // never silently use an insecure fallback when its secret is absent.
    console.warn(`auth: disabled (${err.message})`);
    app.use('/api/forum', forumUnavailable);
    app.use(['/api/auth', '/api/admin'], unavailable('Sign-in is not configured on this server.', 'AUTH_UNAVAILABLE', false));
  }
}
if (!pool) app.use('/api/forum', forumUnavailable);
console.log(process.env.GEMINI_API_KEY ? 'ai: gemini configured' : 'ai: no GEMINI_API_KEY - Ask AI serves offline fallbacks');
// Unknown API paths answer in the error envelope, not Express's HTML "Cannot GET".
app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', 'Not found.')));
app.use(express.static(path.join(here, '..', 'frontend')));
app.use(errorHandler);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`AgriLink listening on :${port}`));
