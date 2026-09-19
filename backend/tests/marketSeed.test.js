import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeDb } from './helpers.js';
import { createAuthService } from '../services/authService.js';
import { ensureForumReference } from '../db/forumReference.js';
import { seedDemo } from '../db/forumSeed.js';
import { seedMarketDemo, resetMarketDemo } from '../db/marketSeed.js';

const migration = (name) => fs.readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');
const ENV = { AUTH_LOOKUP_SECRET: 'x'.repeat(40), NODE_ENV: 'test' };

async function setup() {
  const { db, pool } = await makeDb();
  await db.exec(migration('002_marketplace.sql'));
  await db.exec(migration('006_market_exchange.sql'));
  await ensureForumReference(pool);
  await seedDemo(pool, { auth: createAuthService(pool, ENV), pin: '246810' });
  return { db, pool };
}
const count = async (db, sql) => (await db.query(sql)).rows[0].n;

test('market demo seed builds every visible state and is repeatable', async () => {
  const { db, pool } = await setup();
  await seedMarketDemo(pool, { env: ENV });
  const snap = async () => ({
    listings: await count(db, 'SELECT count(*)::int n FROM app.market_listings'),
    requests: await count(db, 'SELECT count(*)::int n FROM app.market_buy_requests'),
    offers: await count(db, 'SELECT count(*)::int n FROM app.market_offers'),
    revisions: await count(db, 'SELECT count(*)::int n FROM app.market_offer_revisions'),
    deals: await count(db, 'SELECT count(*)::int n FROM app.market_deals'),
    events: await count(db, 'SELECT count(*)::int n FROM app.market_events'),
  });
  const first = await snap();
  assert.equal(first.listings, 15);
  assert.equal(first.requests, 5);
  assert.equal(first.offers, 7);
  assert.equal(first.deals, 4);
  assert.equal(await count(db, 'SELECT count(*)::int n FROM app.market_listings WHERE NOT is_demo'), 0);
  assert.equal(await count(db, 'SELECT count(*)::int n FROM app.market_buy_requests WHERE NOT is_demo'), 0);

  const statuses = (await db.query('SELECT status FROM app.market_deals ORDER BY status')).rows.map((r) => r.status);
  assert.deepEqual(statuses, ['awaiting_confirmation', 'completed', 'completed', 'completed']);
  const wheat = (await db.query("SELECT quantity, reserved_quantity, sold_quantity, status FROM app.market_listings l JOIN app.crops c ON c.id=l.crop_id WHERE c.code='wheat' AND asking_price = 2250")).rows[0];
  assert.equal(Number(wheat.sold_quantity), 5);
  assert.equal(Number(wheat.reserved_quantity), 0);
  const onion = (await db.query("SELECT reserved_quantity, status FROM app.market_listings WHERE pricing_mode='fixed'")).rows[0];
  assert.equal(Number(onion.reserved_quantity), 100);
  assert.equal(onion.status, 'partially_reserved');
  const offerStates = (await db.query('SELECT status, current_revision FROM app.market_offers ORDER BY created_at')).rows;
  assert.ok(offerStates.some((o) => o.status === 'countered' && o.current_revision === 2)); // Ravi's turn
  assert.ok(offerStates.some((o) => o.status === 'open')); // waiting for Ravi
  assert.equal(await count(db, 'SELECT count(*)::int n FROM app.market_ratings'), 6);

  // running it again changes nothing
  await seedMarketDemo(pool, { env: ENV });
  assert.deepEqual(await snap(), first);
});

test('market demo reset removes all demo market data and it can be seeded again', async () => {
  const { db, pool } = await setup();
  await seedMarketDemo(pool, { env: ENV });
  await resetMarketDemo(pool);
  for (const t of ['market_listings', 'market_buy_requests', 'market_offers', 'market_offer_revisions', 'market_deals', 'market_ratings', 'market_events', 'market_request_ids']) {
    assert.equal(await count(db, `SELECT count(*)::int n FROM app.${t}`), 0, t);
  }
  assert.equal(await count(db, "SELECT count(*)::int n FROM app.notifications WHERE type LIKE 'market_%'"), 0);
  await seedMarketDemo(pool, { env: ENV });
  assert.equal(await count(db, 'SELECT count(*)::int n FROM app.market_deals'), 4);
});
