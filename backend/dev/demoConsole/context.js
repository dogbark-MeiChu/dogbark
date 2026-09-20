// The live connection: one pg pool through the tunnel, plus the app's own service objects so every
// write the console makes is the write the app would have made (revisions, events, notifications,
// reservation math). Raw SQL is used only where the app has no write path of its own (mandi prices).
import pg from 'pg';
import { createMarketService } from '../../services/marketService.js';
import { createPriceService } from '../../services/priceService.js';
import { pgRepo } from '../../services/priceRepo.js';
import { createPriceAlertService } from '../../services/priceAlertService.js';
import { createAuthService } from '../../services/authService.js';
import { createLimiter } from '../../middleware/rateLimits.js';
import { config, redact } from './config.js';

let ctx = null;

export function connected() { return Boolean(ctx); }

export function describeConnection() {
  return { url: redact(config.databaseUrl), configured: Boolean(config.databaseUrl), connected: Boolean(ctx) };
}

export async function connect() {
  if (ctx) return ctx;
  if (!config.databaseUrl) {
    throw new Error('No database URL. Set DEMO_DATABASE_URL (or DEMO_DB_PASSWORD) in dev/demoConsole/.env.');
  }
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4, connectionTimeoutMillis: 4000 });
  await pool.query('SELECT 1'); // fail fast while the operator is still looking at the button
  const env = { MARKET_CODE_SECRET: config.codeSecret, AUTH_LOOKUP_SECRET: config.codeSecret };
  // The console is the only client; the app's per-user hourly caps would just block a rehearsal.
  const market = createMarketService({
    pool, env, limiter: createLimiter(),
    config: { listingsPerHour: 1e6, offersPerHour: 1e6, reportsPerDay: 1e6 },
  });
  const prices = createPriceService(pgRepo(pool));
  const alerts = createPriceAlertService({ pool, prices });
  // The PIN action uses the real auth service so the scrypt hashing matches what login checks.
  // AUTH_LOOKUP_SECRET only peppers the phone -> login_hash lookup, and the console addresses
  // members by user id, so a placeholder is enough to construct the service when it is unset.
  const auth = createAuthService(pool, {
    AUTH_LOOKUP_SECRET: config.authSecret || 'demo-console-placeholder-lookup-secret-0001',
    NODE_ENV: 'production',
  });
  ctx = { pool, market, prices, alerts, auth };
  return ctx;
}

export async function disconnect() {
  if (!ctx) return;
  const { pool } = ctx;
  ctx = null;
  await pool.end().catch(() => {});
}

/** Reconnects after the tunnel was restarted. */
export async function reconnect() {
  await disconnect();
  return connect();
}

export async function ctxOrThrow() {
  return ctx || connect();
}

export async function query(text, params) {
  const { pool } = await ctxOrThrow();
  return pool.query(text, params);
}

/** A superuser pool, only for the destructive reset (append-only triggers must be bypassed). */
export async function resetPool() {
  if (!config.resetDatabaseUrl) {
    throw new Error('Reset needs a superuser connection: set DEMO_RESET_DATABASE_URL in dev/demoConsole/.env.');
  }
  return new pg.Pool({ connectionString: config.resetDatabaseUrl, max: 2, connectionTimeoutMillis: 4000 });
}
