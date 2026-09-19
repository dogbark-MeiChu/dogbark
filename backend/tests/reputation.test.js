import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { pgPool } from './helpers.js';
import { createAuthService } from '../services/authService.js';
import { authRouter } from '../routes/auth.js';
import { createMarketRouter } from '../routes/market.js';
import { forumErrorHandler } from '../middleware/errors.js';

const migration = (name) => fs.readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');
const ENV = { AUTH_LOOKUP_SECRET: 'x'.repeat(40), NODE_ENV: 'test' };
let n = 0;
const rid = () => `req-${Date.now()}-${++n}-rep`;
const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

async function start() {
  const db = new PGlite();
  await db.exec('CREATE ROLE agrilink_app; CREATE ROLE agrilink_migrator;');
  await db.exec(migration('001_foundation.sql').replace(/CREATE EXTENSION[^;]*;/, ''));
  await db.exec(migration('002_marketplace.sql'));
  await db.exec(migration('004_identity_admin.sql'));
  await db.exec(migration('006_market_exchange.sql'));
  const pool = pgPool(db);
  const region = async (code, name, lat, lon) => (await db.query(
    "INSERT INTO app.regions (code, country_code, name, latitude, longitude) VALUES ($1,'IN',$2,$3,$4) RETURNING id", [code, name, lat, lon])).rows[0].id;
  const patna = await region('IN-BR-PATNA', 'Patna', 25.5941, 85.1376);
  await db.query("INSERT INTO app.crops (code, name) VALUES ('tomato','Tomato'), ('rice','Rice'), ('wheat','Wheat')");

  const auth = createAuthService(pool, ENV);
  const market = createMarketRouter({ pool, auth, env: ENV });
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '8kb' }));
  app.use('/api/auth', authRouter({ auth, pool }));
  app.use('/api/market', market.router);
  app.use(forumErrorHandler);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const client = () => {
    let cookie = '';
    const call = async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      for (const c of res.headers.getSetCookie?.() || []) cookie = c.split(';')[0].endsWith('=') ? '' : c.split(';')[0];
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null, text };
    };
    return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), del: (p) => call('DELETE', p) };
  };
  let phone = 9300000000;
  const member = async (name) => {
    const p = String(++phone);
    await auth.signup({ phone: p, pin: '246810', displayName: name, village: 'Village', regionId: patna });
    const c = client();
    const r = await c.post('/api/auth/login', { phone: p, pin: '246810' });
    assert.equal(r.status, 200, r.text);
    const id = (await db.query('SELECT user_id FROM app.user_profiles WHERE display_name=$1', [name])).rows[0].user_id;
    return Object.assign(c, { id });
  };
  const close = async () => { market.close(); server.closeAllConnections(); server.close(); await db.close(); };
  return { db, pool, member, market, close };
}

const listingBody = (over = {}) => ({
  crop: 'tomato', quantity: 120, unit: 'kg', pricingMode: 'negotiable', askingPrice: 28, grade: 'A',
  availableDate: tomorrow(), fulfillment: 'pickup', requestId: rid(), ...over,
});
const offerBody = (over = {}) => ({
  quantity: 100, unitPrice: 27, pickupDate: tomorrow(), pickupWindowStart: '09:00', pickupWindowEnd: '11:00',
  paymentMethod: 'cash_on_pickup', requestId: rid(), ...over,
});

async function completeDeal(t, seller, buyer) {
  const l = (await seller.post('/api/market/listings', listingBody())).body.id;
  const o = (await buyer.post(`/api/market/listings/${l}/offers`, offerBody())).body.id;
  await seller.post(`/api/market/offers/${o}/accept`);
  const dealId = (await seller.get(`/api/market/offers/${o}`)).body.item.dealId;
  await seller.post(`/api/market/deals/${dealId}/confirm`);
  await buyer.post(`/api/market/deals/${dealId}/confirm`);
  await seller.post(`/api/market/deals/${dealId}/schedule`, {
    pickupDate: tomorrow(), pickupWindowStart: '09:00', pickupWindowEnd: '11:00', location: 'Market gate',
  });
  const code = (await buyer.get(`/api/market/deals/${dealId}`)).body.item.pickupCode;
  await seller.post(`/api/market/deals/${dealId}/verify-pickup`, { code });
  await buyer.post(`/api/market/deals/${dealId}/received`);
  await seller.post(`/api/market/deals/${dealId}/payment-status`, { status: 'received' });
  const deal = (await buyer.get(`/api/market/deals/${dealId}`)).body.item;
  assert.equal(deal.status, 'completed', 'deal must be completed');
  return dealId;
}

test('new user has "new" evidence band with zero deals', async () => {
  const t = await start();
  try {
    const user = await t.member('NewUser');
    const r = await user.get('/api/market/me/reputation?role=seller');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.band, 'new');
    assert.equal(r.body.summary.completedDeals, 0);
    assert.equal(r.body.summary.distinctCounterparties, 0);
    assert.equal(r.body.summary.verifiedHandovers, 0);
    assert.equal(r.body.summary.ratingsCount, 0);
    assert.equal(r.body.summary.avgStars, null);
    assert.ok(r.body.thresholds);

    const buyerRep = await user.get('/api/market/me/reputation?role=buyer');
    assert.equal(buyerRep.body.band, 'new');
  } finally { await t.close(); }
});

test('completing deals with distinct counterparties progresses to established band', async () => {
  const t = await start();
  try {
    const seller = await t.member('EstSeller');
    const b1 = await t.member('Buyer1');
    const b2 = await t.member('Buyer2');
    const b3 = await t.member('Buyer3');

    await completeDeal(t, seller, b1);
    let rep = (await seller.get('/api/market/me/reputation?role=seller')).body;
    assert.equal(rep.band, 'new');
    assert.equal(rep.summary.completedDeals, 1);

    await completeDeal(t, seller, b2);
    rep = (await seller.get('/api/market/me/reputation?role=seller')).body;
    assert.equal(rep.band, 'new');
    assert.equal(rep.summary.completedDeals, 2);

    await completeDeal(t, seller, b3);
    rep = (await seller.get('/api/market/me/reputation?role=seller')).body;
    assert.equal(rep.band, 'established');
    assert.equal(rep.summary.completedDeals, 3);
    assert.equal(rep.summary.distinctCounterparties, 3);
    assert.ok(rep.summary.verifiedHandovers >= 1);
  } finally { await t.close(); }
});

test('30-day dedup: same counterparty within 30 days counts as 1 distinct', async () => {
  const t = await start();
  try {
    const seller = await t.member('DedupSeller');
    const buyer = await t.member('DedupBuyer');
    const b2 = await t.member('B2Dedup');
    const b3 = await t.member('B3Dedup');

    await completeDeal(t, seller, buyer);
    await completeDeal(t, seller, buyer);
    let rep = (await seller.get('/api/market/me/reputation?role=seller')).body;
    assert.equal(rep.summary.completedDeals, 2);
    assert.equal(rep.summary.distinctCounterparties, 1);
    assert.equal(rep.band, 'new');

    await completeDeal(t, seller, b2);
    await completeDeal(t, seller, b3);
    rep = (await seller.get('/api/market/me/reputation?role=seller')).body;
    assert.equal(rep.summary.completedDeals, 4);
    assert.equal(rep.summary.distinctCounterparties, 3);
    assert.equal(rep.band, 'established');
  } finally { await t.close(); }
});

test('role separation: seller deals do not count toward buyer reputation', async () => {
  const t = await start();
  try {
    const user = await t.member('DualRole');
    const b1 = await t.member('DR1');
    const b2 = await t.member('DR2');
    const b3 = await t.member('DR3');

    await completeDeal(t, user, b1);
    await completeDeal(t, user, b2);
    await completeDeal(t, user, b3);

    const sellerRep = (await user.get('/api/market/me/reputation?role=seller')).body;
    assert.equal(sellerRep.band, 'established');

    const buyerRep = (await user.get('/api/market/me/reputation?role=buyer')).body;
    assert.equal(buyerRep.band, 'new');
    assert.equal(buyerRep.summary.completedDeals, 0);
  } finally { await t.close(); }
});

test('demo listings do not count toward reputation', async () => {
  const t = await start();
  try {
    const seller = await t.member('DemoSeller');
    const buyer = await t.member('DemoBuyer');

    await completeDeal(t, seller, buyer);
    const dealRows = (await t.db.query("SELECT d.id FROM app.market_deals d WHERE d.seller_id = $1 AND d.status='completed'", [seller.id])).rows;
    assert.equal(dealRows.length, 1);

    // Mark the listing as demo
    await t.db.query('UPDATE app.market_listings SET is_demo = true WHERE seller_id = $1', [seller.id]);

    const rep = (await seller.get('/api/market/me/reputation?role=seller')).body;
    assert.equal(rep.band, 'new');
    assert.equal(rep.summary.completedDeals, 0);
  } finally { await t.close(); }
});

test('evidence summary is embedded in listing detail', async () => {
  const t = await start();
  try {
    const seller = await t.member('ListSeller');
    const buyer = await t.member('ListBuyer');
    const l = (await seller.post('/api/market/listings', listingBody())).body.id;
    const detail = await buyer.get(`/api/market/listings/${l}`);
    assert.equal(detail.status, 200, detail.text);
    assert.ok(detail.body.item.owner.evidence);
    assert.equal(detail.body.item.owner.evidence.band, 'new');
    assert.equal(detail.body.item.owner.evidence.completedDeals, 0);
  } finally { await t.close(); }
});

test('evidence summary is embedded in offer detail', async () => {
  const t = await start();
  try {
    const seller = await t.member('OfferSeller');
    const buyer = await t.member('OfferBuyer');
    const l = (await seller.post('/api/market/listings', listingBody())).body.id;
    const o = (await buyer.post(`/api/market/listings/${l}/offers`, offerBody())).body.id;
    const detail = await buyer.get(`/api/market/offers/${o}`);
    assert.equal(detail.status, 200, detail.text);
    assert.ok(detail.body.item.counterparty.evidence);
    assert.equal(detail.body.item.counterparty.evidence.band, 'new');
  } finally { await t.close(); }
});

test('evidence summary is embedded in deal detail', async () => {
  const t = await start();
  try {
    const seller = await t.member('DealSeller');
    const buyer = await t.member('DealBuyer');
    await completeDeal(t, seller, buyer);
    const deals = (await buyer.get('/api/market/deals')).body.items;
    assert.ok(deals.length > 0);
    const deal = (await buyer.get(`/api/market/deals/${deals[0].id}`)).body.item;
    assert.ok(deal.counterparty.evidence);
    assert.equal(deal.counterparty.evidence.band, 'new');
    assert.equal(deal.counterparty.evidence.completedDeals, 1);
  } finally { await t.close(); }
});

test('reputation endpoint for other users works', async () => {
  const t = await start();
  try {
    const a = await t.member('UserA');
    const b = await t.member('UserB');
    const r = await a.get(`/api/market/users/${b.id}/reputation?role=seller`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.band, 'new');
    assert.equal(r.body.userId, b.id);
  } finally { await t.close(); }
});

test('price sorting is purely by price, never reordered by reputation', async () => {
  const t = await start();
  try {
    const s1 = await t.member('CheapSeller');
    const s2 = await t.member('ExpSeller');
    const b1 = await t.member('PB1');
    const b2 = await t.member('PB2');
    const b3 = await t.member('PB3');
    const viewer = await t.member('PriceViewer');

    // Make s2 established
    await completeDeal(t, s2, b1);
    await completeDeal(t, s2, b2);
    await completeDeal(t, s2, b3);
    const rep = (await s2.get('/api/market/me/reputation?role=seller')).body;
    assert.equal(rep.band, 'established');

    // s1 posts cheaper, s2 posts more expensive
    await s1.post('/api/market/listings', listingBody({ askingPrice: 20, requestId: rid() }));
    await s2.post('/api/market/listings', listingBody({ askingPrice: 30, requestId: rid() }));

    const feed = await viewer.get('/api/market/listings?sort=price');
    assert.equal(feed.status, 200, feed.text);
    const items = feed.body.items;
    assert.ok(items.length >= 2);
    assert.ok(items[0].askingPrice <= items[1].askingPrice, 'price sort must be by price, not reputation');
  } finally { await t.close(); }
});

test('adverse outcomes affect evidence band', async () => {
  const t = await start();
  try {
    const seller = await t.member('AdvSeller');
    const b1 = await t.member('Adv1');
    const b2 = await t.member('Adv2');
    const b3 = await t.member('Adv3');

    await completeDeal(t, seller, b1);
    await completeDeal(t, seller, b2);
    await completeDeal(t, seller, b3);

    let rep = (await seller.get('/api/market/me/reputation?role=seller')).body;
    assert.equal(rep.band, 'established');

    // Admin-confirmed adverse outcome (simulated by inserting an actioned report)
    await t.db.query(
      "INSERT INTO app.market_reports (reporter_id, target_type, target_id, reason_code, status) VALUES ($1, 'user', $2, 'scam', 'actioned')",
      [b1.id, seller.id]
    );

    rep = (await seller.get('/api/market/me/reputation?role=seller')).body;
    assert.equal(rep.band, 'new');
    assert.equal(rep.summary.confirmedAdverseOutcomesLast90Days, 1);
  } finally { await t.close(); }
});
