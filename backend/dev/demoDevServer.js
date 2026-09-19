// The whole app on an in-process PostgreSQL (PGlite), for demo rehearsal: every feature the
// handset shows is mounted, so Home's three rows, the market and Today's Farm all work together.
//   npm run demo:dev             -> http://localhost:3103   (data is in memory; restarts start fresh)
//   MANDI_LIVE=0 npm run demo:dev   skips the live Uttar Pradesh mandi sync (no network needed;
//                                   the farm then shows its seeded prices, marked "Sample data")
// Demo story account: 9100000001 (Ravi K., owner of Green Field Cooperative, Lucknow), PIN 246810.
// Other members: see docs/CODEBASE_STATUS.md section 7.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgPool } from '../tests/helpers.js';
import { createAuthService } from '../services/authService.js';
import { authRouter } from '../routes/auth.js';
import { createForumRouter } from '../routes/forum.js';
import { createMarketRouter } from '../routes/market.js';
import { createFarmOpsRouter } from '../routes/farmOps.js';
import { pricesRouter } from '../routes/prices.js';
import weather from '../routes/weather.js';
import { aiRouter } from '../routes/ai.js';
import { ttsRouter } from '../routes/tts.js';
import { forumErrorHandler } from '../middleware/errors.js';
import { requestId } from '../middleware/requestId.js';
import { ensureForumReference } from '../db/forumReference.js';
import { seedDemo } from '../db/forumSeed.js';
import { seedMarketDemo } from '../db/marketSeed.js';
import { seedFarmOps } from '../db/farmOpsSeed.js';
import { createPriceService, createFarmPriceService } from '../services/priceService.js';
import { pgRepo } from '../services/priceRepo.js';
import { createPriceCacheRepository } from '../repositories/priceCacheRepository.js';
import { getWeather } from '../services/weatherService.js';
import { syncMandi, createGeocoder } from '../db/syncMandi.js';
import { createMandiClient } from '../services/mandiClient.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = path.join(here, '..', 'db', 'migrations');
const db = new PGlite();
await db.exec('CREATE ROLE agrilink_app; CREATE ROLE agrilink_migrator;');
for (const name of fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
  const sql = fs.readFileSync(path.join(migrations, name), 'utf8');
  await db.exec(name === '001_foundation.sql' ? sql.replace(/CREATE EXTENSION[^;]*;/, '') : sql); // gen_random_uuid() is built in
}
const pool = pgPool(db);
const secret = 'demo-only-secret-demo-only-secret-demo';
const auth = createAuthService(pool, { AUTH_LOOKUP_SECRET: secret, NODE_ENV: 'development' });
await ensureForumReference(pool);
await seedDemo(pool, { auth, pin: '246810' });
await seedMarketDemo(pool, { env: { AUTH_LOOKUP_SECRET: secret } });
await seedFarmOps(pool, { demoDate: process.env.DEMO_DATE || new Date().toISOString().slice(0, 10) });

const prices = createPriceService(pgRepo(pool));
const farmPriceService = createFarmPriceService({ prices, cache: createPriceCacheRepository(pool) });
const app = express();
app.use(requestId);
app.use(express.json({ limit: '32kb' }));
app.use('/api/auth', authRouter({ auth, pool }));
app.use('/api/forum', createForumRouter({ pool, auth }).router);
app.use('/api/market', createMarketRouter({ pool, auth, env: { AUTH_LOOKUP_SECRET: secret } }).router);
app.use('/api/farms', createFarmOpsRouter({ pool, auth, farmPriceService, weatherGetter: getWeather }).router);
app.use('/api/prices', pricesRouter(prices));
app.use('/api/weather', weather);
app.use('/api/ai', aiRouter({ auth }));
app.use('/api/tts', ttsRouter({ auth }));
app.use(forumErrorHandler);
app.use(express.static(path.join(here, '..', '..', 'frontend')));

if (process.env.MANDI_LIVE !== '0') {
  syncMandi({ pool, client: createMandiClient({ log: () => {} }), geocode: createGeocoder() })
    .then((r) => console.log(`mandi: ${r.written} live price rows (${r.complete ? 'complete' : 'paused'})`))
    .catch((e) => console.error(`mandi sync failed (the farm shows its seeded prices): ${e.message}`));
}
const port = Number(process.env.PORT) || 3103;
app.listen(port, '127.0.0.1', () => console.log(`AgriLink demo: http://127.0.0.1:${port}  (sign in 9100000001 / 246810)`));
