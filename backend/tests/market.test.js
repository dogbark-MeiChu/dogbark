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
import { requestId } from '../middleware/requestId.js';

const migration = (name) => fs.readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');
const ENV = { AUTH_LOOKUP_SECRET: 'x'.repeat(40), NODE_ENV: 'test' };
let n = 0;
const rid = () => `req-${Date.now()}-${++n}-abcdef`;
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
  const gaya = await region('IN-BR-GAYA', 'Gaya', 24.7914, 85.0002);
  await db.query("INSERT INTO app.crops (code, name) VALUES ('tomato','Tomato'), ('rice','Rice')");

  const auth = createAuthService(pool, ENV);
  const market = createMarketRouter({ pool, auth, env: ENV });
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(requestId);
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
  let phone = 9200000000;
  const member = async (name, regionId = patna) => {
    const p = String(++phone);
    await auth.signup({ phone: p, pin: '246810', displayName: name, village: 'Village', regionId });
    const c = client();
    const r = await c.post('/api/auth/login', { phone: p, pin: '246810' });
    assert.equal(r.status, 200, r.text);
    const id = (await db.query('SELECT user_id FROM app.user_profiles WHERE display_name=$1', [name])).rows[0].user_id;
    return Object.assign(c, { id });
  };
  const close = async () => { market.close(); server.closeAllConnections(); server.close(); await db.close(); };
  return { db, patna, gaya, member, client, market, close };
}

const listingBody = (over = {}) => ({
  crop: 'tomato', quantity: 120, unit: 'kg', pricingMode: 'negotiable', askingPrice: 28, grade: 'A',
  availableDate: tomorrow(), fulfillment: 'pickup', requestId: rid(), ...over,
});
const offerBody = (over = {}) => ({
  quantity: 100, unitPrice: 27, pickupDate: tomorrow(), pickupWindowStart: '09:00', pickupWindowEnd: '11:00',
  paymentMethod: 'cash_on_pickup', note: 'Buyer brings crates', requestId: rid(), ...over,
});

// seller posts, buyer offers; returns ids
async function offered(t, over = {}) {
  const seller = await t.member('Seller');
  const buyer = await t.member('Buyer');
  const l = await seller.post('/api/market/listings', listingBody(over.listing));
  assert.equal(l.status, 201, l.text);
  const o = await buyer.post(`/api/market/listings/${l.body.id}/offers`, offerBody(over.offer));
  assert.equal(o.status, 201, o.text);
  return { seller, buyer, listingId: l.body.id, offerId: o.body.id };
}

async function agreed(t, over) {
  const s = await offered(t, over);
  const a = await s.seller.post(`/api/market/offers/${s.offerId}/accept`);
  assert.equal(a.status, 200, a.text);
  await s.seller.post(`/api/market/deals/${a.body.dealId}/confirm`);
  const c = await s.buyer.post(`/api/market/deals/${a.body.dealId}/confirm`);
  assert.equal(c.body.status, 'agreed');
  return { ...s, dealId: a.body.dealId };
}

test('market requires sign-in', async () => {
  const t = await start();
  try {
    const r = await t.client().get('/api/market/listings');
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, 'AUTH_REQUIRED');
    const rep = await t.client().get('/api/market/users/00000000-0000-4000-8000-000000000000/reputation?role=buyer');
    assert.equal(rep.status, 401);
  } finally { await t.close(); }
});

test('listing feed is regional, public cards hide coordinates, requestId is idempotent', async () => {
  const t = await start();
  try {
    const seller = await t.member('Seller');
    const body = listingBody();
    const a = await seller.post('/api/market/listings', body);
    const b = await seller.post('/api/market/listings', body);
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(a.body.id, b.body.id);

    const local = await t.member('Local');
    const far = await t.member('Far', t.gaya);
    const feed = await local.get('/api/market/listings');
    assert.equal(feed.body.items.length, 1);
    assert.equal(feed.body.items[0].location.label, 'Patna');
    assert.doesNotMatch(feed.text, /latitude|longitude|25\.59|85\.13/);
    assert.equal((await far.get('/api/market/listings')).body.items.length, 0); // other district
    const near = await far.get('/api/market/listings?radiusKm=200');
    assert.equal(near.body.items.length, 1);
    assert.equal(near.body.items[0].location.approxDistanceKm % 5, 0);
    assert.equal((await far.get('/api/market/listings?radiusKm=20')).body.items.length, 0);
  } finally { await t.close(); }
});

test('validation: bad units, missing price, past dates, oversized quantity precision', async () => {
  const t = await start();
  try {
    const s = await t.member('Seller');
    const post = (o) => s.post('/api/market/listings', listingBody(o));
    assert.equal((await post({ unit: 'bushel' })).body.error.field, 'unit');
    assert.equal((await post({ pricingMode: 'fixed', askingPrice: undefined })).body.error.field, 'askingPrice');
    assert.equal((await post({ availableDate: '2020-01-01' })).body.error.field, 'availableDate');
    assert.equal((await post({ quantity: 0 })).body.error.field, 'quantity');
    assert.equal((await post({ quantity: 1.2345 })).body.error.field, 'quantity');
    assert.equal((await post({ crop: 'unobtainium' })).body.error.field, 'crop');
  } finally { await t.close(); }
});

test('offer → counter → accept → both confirm → schedule → code → received → paid → completed', async () => {
  const t = await start();
  try {
    const { seller, buyer, listingId, offerId } = await offered(t);

    // seller counters; buyer must accept the seller's counter
    assert.equal((await buyer.post(`/api/market/offers/${offerId}/accept`)).body.error.code, 'FORBIDDEN'); // own proposal
    const c = await seller.post(`/api/market/offers/${offerId}/counter`, offerBody({ quantity: 90, unitPrice: 27.5 }));
    assert.equal(c.status, 201, c.text);
    assert.equal(c.body.revision, 2);
    assert.equal((await seller.post(`/api/market/offers/${offerId}/accept`)).body.error.code, 'FORBIDDEN');
    const history = await buyer.get(`/api/market/offers/${offerId}`);
    assert.equal(history.body.revisions.length, 2);
    assert.equal(history.body.revisions[0].unitPrice, 27); // first revision untouched
    assert.equal(history.body.item.awaitingMyResponse, true);

    const acc = await buyer.post(`/api/market/offers/${offerId}/accept`);
    assert.equal(acc.status, 200, acc.text);
    const { dealId } = acc.body;
    let deal = (await buyer.get(`/api/market/deals/${dealId}`)).body.item;
    assert.equal(deal.status, 'awaiting_confirmation');
    assert.equal(deal.terms.estimatedTotal, 2475); // 90 * 27.5, computed by the server
    assert.equal((await seller.get(`/api/market/listings/${listingId}`)).body.item.availableQuantity, 30);

    // schedule / verify are refused before both sides confirm
    assert.equal((await seller.post(`/api/market/deals/${dealId}/schedule`, { pickupDate: tomorrow(), location: 'Patna Central Market' })).body.error.code, 'INVALID_STATE');
    assert.equal((await buyer.post(`/api/market/deals/${dealId}/confirm`)).body.status, 'awaiting_confirmation');
    assert.equal((await seller.post(`/api/market/deals/${dealId}/confirm`)).body.status, 'agreed');

    const sch = await buyer.post(`/api/market/deals/${dealId}/schedule`, { pickupDate: tomorrow(), pickupWindowStart: '09:00', pickupWindowEnd: '11:00', location: 'Patna Central Market' });
    assert.equal(sch.body.status, 'pickup_scheduled');
    const bView = (await buyer.get(`/api/market/deals/${dealId}`)).body.item;
    const sView = (await seller.get(`/api/market/deals/${dealId}`)).body.item;
    assert.equal(bView.counterpartyEvidence.role, 'seller');
    assert.equal(sView.counterpartyEvidence.role, 'buyer');
    assert.match(bView.pickupCode, /^\d{4}$/);
    assert.equal(sView.pickupCode, undefined); // the seller never sees the code
    assert.equal(sView.pickup.location, 'Patna Central Market');

    // wrong code, then right code
    const wrong = bView.pickupCode === '0000' ? '1111' : '0000';
    assert.equal((await seller.post(`/api/market/deals/${dealId}/verify-pickup`, { code: wrong })).status, 400);
    assert.equal((await buyer.post(`/api/market/deals/${dealId}/verify-pickup`, { code: bView.pickupCode })).body.error.code, 'FORBIDDEN');
    assert.equal((await seller.post(`/api/market/deals/${dealId}/verify-pickup`, { code: bView.pickupCode })).body.status, 'handed_over');

    // completion needs BOTH: buyer received and seller payment received
    assert.equal((await buyer.post(`/api/market/deals/${dealId}/received`)).body.status, 'handed_over');
    assert.equal((await seller.post(`/api/market/deals/${dealId}/payment-status`, { status: 'pending' })).body.status, 'handed_over');
    assert.equal((await seller.post(`/api/market/deals/${dealId}/payment-status`, { status: 'received' })).body.status, 'completed');

    const l = (await seller.get(`/api/market/listings/${listingId}`)).body.item;
    assert.equal(l.availableQuantity, 30);
    assert.equal(l.ownerEvidence.role, 'seller');
    assert.equal(l.ownerEvidence.completedDeals, 1);
    const row = (await t.db.query('SELECT reserved_quantity, sold_quantity FROM app.market_listings WHERE id=$1', [listingId])).rows[0];
    assert.equal(Number(row.reserved_quantity), 0);
    assert.equal(Number(row.sold_quantity), 90);

    // rating: once each, only after completion
    assert.equal((await buyer.get(`/api/market/deals/${dealId}`)).body.item.ratedByMe, false);
    assert.equal((await buyer.post(`/api/market/deals/${dealId}/rating`, { stars: 5 })).status, 200);
    assert.equal((await buyer.get(`/api/market/deals/${dealId}`)).body.item.ratedByMe, true);
    assert.equal((await seller.get(`/api/market/deals/${dealId}`)).body.item.ratedByMe, false);
    assert.equal((await buyer.post(`/api/market/deals/${dealId}/rating`, { stars: 4 })).body.error.code, 'CONFLICT');

    // Reputation is server-derived, role-separated and contains no private deal fields.
    const buyerRep = await seller.get(`/api/market/users/${buyer.id}/reputation?role=buyer`);
    const sellerRep = await buyer.get(`/api/market/users/${seller.id}/reputation?role=seller`);
    const buyerAsSeller = await buyer.get(`/api/market/users/${buyer.id}/reputation?role=seller`);
    assert.equal(buyerRep.body.completedDeals, 1);
    assert.equal(sellerRep.body.completedDeals, 1);
    assert.equal(buyerAsSeller.body.completedDeals, 0);
    assert.equal(buyerRep.body.averageRating, null); // one five-star review is not shown as a perfect average
    assert.doesNotMatch(JSON.stringify(buyerRep.body), /phone|latitude|longitude|pickup|internal|secret/i);
    const myRep = await buyer.get('/api/market/me/reputation');
    assert.equal(myRep.body.buyer.completedDeals, 1);
    assert.equal(myRep.body.seller.completedDeals, 0);

    // Demo transactions can drive the visible walkthrough but never formal reputation.
    await t.db.query('UPDATE app.market_listings SET is_demo=true WHERE id=$1', [listingId]);
    assert.equal((await seller.get(`/api/market/users/${buyer.id}/reputation?role=buyer`)).body.completedDeals, 0);

    // audit trail exists
    const ev = await t.db.query("SELECT count(*)::int n FROM app.market_events WHERE entity_type='deal'");
    assert.ok(ev.rows[0].n >= 6);
  } finally { await t.close(); }
});

test('cannot oversell: a second accept beyond the remaining quantity is refused', async () => {
  const t = await start();
  try {
    const seller = await t.member('Seller');
    const b1 = await t.member('B1');
    const b2 = await t.member('B2');
    const l = (await seller.post('/api/market/listings', listingBody({ quantity: 120 }))).body.id;
    const o1 = (await b1.post(`/api/market/listings/${l}/offers`, offerBody({ quantity: 80 }))).body.id;
    const o2 = (await b2.post(`/api/market/listings/${l}/offers`, offerBody({ quantity: 80 }))).body.id;
    assert.equal((await seller.post(`/api/market/offers/${o1}/accept`)).status, 200);
    const second = await seller.post(`/api/market/offers/${o2}/accept`);
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'QUANTITY_UNAVAILABLE');
    // new offers are capped to what is left
    const b3 = await t.member('B3');
    assert.equal((await b3.post(`/api/market/listings/${l}/offers`, offerBody({ quantity: 41 }))).body.error.code, 'QUANTITY_UNAVAILABLE');
    assert.equal((await b3.post(`/api/market/listings/${l}/offers`, offerBody({ quantity: 40 }))).status, 201);
  } finally { await t.close(); }
});

test('offer rules: no self-offer, one live offer, fixed price, authorization', async () => {
  const t = await start();
  try {
    const seller = await t.member('Seller');
    const buyer = await t.member('Buyer');
    const stranger = await t.member('Stranger');
    const fixed = (await seller.post('/api/market/listings', listingBody({ pricingMode: 'fixed', askingPrice: 30 }))).body.id;
    assert.equal((await seller.post(`/api/market/listings/${fixed}/offers`, offerBody())).body.error.code, 'FORBIDDEN');
    assert.equal((await buyer.post(`/api/market/listings/${fixed}/offers`, offerBody({ unitPrice: 25 }))).body.error.field, 'unitPrice');
    assert.equal((await buyer.get(`/api/market/listings/${fixed}`)).body.item.myOfferId, null);
    const o = await buyer.post(`/api/market/listings/${fixed}/offers`, offerBody({ unitPrice: 30 }));
    assert.equal(o.status, 201);
    assert.equal((await buyer.get(`/api/market/offers/${o.body.id}`)).body.item.counterpartyEvidence.role, 'seller');
    assert.equal((await buyer.post(`/api/market/listings/${fixed}/offers`, offerBody({ unitPrice: 30 }))).body.error.code, 'CONFLICT');
    // the detail tells the buyer where their live offer is (the owner never gets myOfferId)
    assert.equal((await buyer.get(`/api/market/listings/${fixed}`)).body.item.myOfferId, o.body.id);
    assert.equal((await stranger.get(`/api/market/listings/${fixed}`)).body.item.myOfferId, null);
    assert.equal((await seller.get(`/api/market/listings/${fixed}`)).body.item.myOfferId, undefined);
    // outsiders cannot see or act on the offer / deal
    assert.equal((await stranger.get(`/api/market/offers/${o.body.id}`)).status, 404);
    assert.equal((await stranger.post(`/api/market/offers/${o.body.id}/accept`)).status, 404);
    assert.equal((await stranger.get('/api/market/deals/00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await stranger.get('/api/market/deals/not-a-uuid')).status, 404);
    const badRep = await stranger.get('/api/market/users/not-a-uuid/reputation?role=buyer');
    assert.equal(badRep.status, 404);
    assert.ok(badRep.body.error.requestId);
    // decline frees the slot for a fresh offer
    assert.equal((await seller.post(`/api/market/offers/${o.body.id}/decline`, {})).status, 200);
    assert.equal((await buyer.post(`/api/market/listings/${fixed}/offers`, offerBody({ unitPrice: 30 }))).status, 201);
    // incoming/outgoing views
    const incoming = (await seller.get('/api/market/offers?role=incoming')).body.items;
    assert.equal(incoming.length, 2); // history keeps the declined one
    assert.equal(incoming.filter((i) => i.awaitingMyResponse).length, 1);
    assert.equal((await buyer.get('/api/market/offers?role=outgoing')).body.items.length, 2);
  } finally { await t.close(); }
});

test('buyer requests: seller responds, buyer accepts and becomes the deal buyer', async () => {
  const t = await start();
  try {
    const buyer = await t.member('Buyer');
    const seller = await t.member('Seller');
    const r = await buyer.post('/api/market/buy-requests', {
      crop: 'rice', quantity: 500, unit: 'kg', targetPriceMin: 32, targetPriceMax: 35, neededBy: tomorrow(), fulfillment: 'buyer_pickup', requestId: rid() });
    assert.equal(r.status, 201, r.text);
    assert.equal((await buyer.post('/api/market/buy-requests', { crop: 'rice', quantity: 5, unit: 'kg', targetPriceMin: 40, targetPriceMax: 30, neededBy: tomorrow(), fulfillment: 'negotiable' })).body.error.field, 'targetPriceMax');
    assert.equal((await seller.get('/api/market/buy-requests')).body.items.length, 1);
    const o = await seller.post(`/api/market/buy-requests/${r.body.id}/offers`, offerBody({ quantity: 500, unitPrice: 33 }));
    assert.equal(o.status, 201, o.text);
    const acc = await buyer.post(`/api/market/offers/${o.body.id}/accept`);
    assert.equal(acc.status, 200, acc.text);
    assert.equal((await buyer.get(`/api/market/deals/${acc.body.dealId}`)).body.item.role, 'buyer');
    assert.equal((await seller.get(`/api/market/deals/${acc.body.dealId}`)).body.item.role, 'seller');
    const item = (await buyer.get(`/api/market/buy-requests/${r.body.id}`)).body.item;
    assert.equal(item.status, 'matched');
  } finally { await t.close(); }
});

test('cancelling a deal releases the reserved quantity; removing a post needs no live deals', async () => {
  const t = await start();
  try {
    const { seller, buyer, listingId, dealId } = await agreed(t);
    assert.equal((await seller.get(`/api/market/listings/${listingId}`)).body.item.availableQuantity, 20);
    assert.equal((await seller.del(`/api/market/listings/${listingId}`)).body.error.code, 'INVALID_STATE');
    assert.equal((await buyer.post(`/api/market/deals/${dealId}/cancel`, { reason: '' })).status, 400);
    assert.equal((await buyer.post(`/api/market/deals/${dealId}/cancel`, { reason: 'Changed plans' })).body.status, 'cancelled');
    assert.equal((await seller.get(`/api/market/listings/${listingId}`)).body.item.availableQuantity, 120);
    assert.equal((await seller.post(`/api/market/deals/${dealId}/confirm`)).body.error.code, 'INVALID_STATE');
    assert.equal((await seller.del(`/api/market/listings/${listingId}`)).status, 200);
    assert.equal((await buyer.get(`/api/market/listings/${listingId}`)).status, 404);
  } finally { await t.close(); }
});

test('pickup code is locked after repeated wrong attempts, even with the right code', async () => {
  const t = await start();
  try {
    const { seller, buyer, dealId } = await agreed(t);
    await seller.post(`/api/market/deals/${dealId}/schedule`, { pickupDate: tomorrow(), location: 'Village gate' });
    const code = (await buyer.get(`/api/market/deals/${dealId}`)).body.item.pickupCode;
    const wrong = code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i += 1) assert.equal((await seller.post(`/api/market/deals/${dealId}/verify-pickup`, { code: wrong })).status, 400);
    const locked = await seller.post(`/api/market/deals/${dealId}/verify-pickup`, { code });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, 'PICKUP_LOCKED');
  } finally { await t.close(); }
});

test('blocks hide posts both ways and stop offers; reports are deduplicated', async () => {
  const t = await start();
  try {
    const seller = await t.member('Seller');
    const buyer = await t.member('Buyer');
    const l = (await seller.post('/api/market/listings', listingBody())).body.id;
    assert.equal((await buyer.get('/api/market/listings')).body.items.length, 1);
    assert.equal((await buyer.post('/api/market/blocks', { userId: seller.id })).status, 201);
    assert.equal((await buyer.get('/api/market/listings')).body.items.length, 0);
    assert.equal((await seller.get('/api/market/listings')).body.items.length, 1); // own post still visible
    assert.equal((await buyer.post(`/api/market/listings/${l}/offers`, offerBody())).status, 404);
    assert.equal((await buyer.post('/api/market/blocks', { userId: buyer.id })).status, 400);

    const stranger = await t.member('Stranger');
    const rep = { targetType: 'listing', targetId: l, reason: 'spam' };
    assert.equal((await stranger.post('/api/market/reports', rep)).status, 201);
    assert.equal((await stranger.post('/api/market/reports', rep)).body.error.code, 'ALREADY_REPORTED');
    assert.equal((await stranger.post('/api/market/reports', { ...rep, targetType: 'deal', targetId: l })).status, 404); // not a party
  } finally { await t.close(); }
});

test('expired listings drop out of the feed and refuse offers; expireStale sweeps them', async () => {
  const t = await start();
  try {
    const seller = await t.member('Seller');
    const buyer = await t.member('Buyer');
    const l = (await seller.post('/api/market/listings', listingBody())).body.id;
    await t.db.query("UPDATE app.market_listings SET created_at = now() - interval '3 days', expires_at = now() - interval '1 hour' WHERE id=$1", [l]);
    assert.equal((await buyer.get('/api/market/listings')).body.items.length, 0);
    assert.equal((await buyer.post(`/api/market/listings/${l}/offers`, offerBody())).body.error.code, 'INVALID_STATE');
    assert.equal((await t.market.service.expireStale()).listings, 1);
  } finally { await t.close(); }
});

test('sync replays my offer/deal events and regional posts, never someone else\'s', async () => {
  const t = await start();
  try {
    const seller = await t.member('Seller');
    const buyer = await t.member('Buyer');
    const far = await t.member('Far', t.gaya);
    const start0 = (await buyer.get('/api/market/sync')).body;
    assert.deepEqual(start0.events, []);
    assert.equal(typeof start0.cursor, 'number');
    const since = (c, n) => c.get(`/api/market/sync?since=${n}`).then((r) => r.body);

    const l = (await seller.post('/api/market/listings', listingBody())).body.id;
    let b = await since(buyer, start0.cursor);
    assert.deepEqual(b.events.map((e) => [e.kind, e.itemId]), [['listing.created', l]]); // same region
    assert.equal((await since(seller, start0.cursor)).events.length, 0); // not the poster
    assert.equal((await since(far, start0.cursor)).events.length, 0); // other district

    const o = (await buyer.post(`/api/market/listings/${l}/offers`, offerBody())).body.id;
    const s1 = await since(seller, start0.cursor);
    assert.deepEqual(s1.events.map((e) => e.kind), ['offer.created']);
    assert.equal(s1.events[0].offerId, o);
    assert.equal((await since(far, start0.cursor)).events.length, 0);
    assert.ok(!JSON.stringify(s1).includes('ownerId'));

    // cursor advances: nothing new until the next action
    assert.equal((await since(seller, s1.cursor)).events.length, 0);
    const a = await seller.post(`/api/market/offers/${o}/accept`);
    const b2 = await since(buyer, b.cursor);
    assert.deepEqual(b2.events.map((e) => e.kind), ['deal.awaiting_confirmation']);
    assert.equal(b2.events[0].dealId, a.body.dealId);

    // replay from the start returns the history; junk cursors are rejected
    assert.ok((await since(buyer, 0)).events.length >= 2);
    assert.equal((await buyer.get('/api/market/sync?since=abc')).status, 400);

    // blocked users' posts do not notify
    await buyer.post('/api/market/blocks', { userId: seller.id });
    const mark = (await buyer.get('/api/market/sync')).body.cursor;
    await seller.post('/api/market/listings', listingBody());
    assert.equal((await since(buyer, mark)).events.length, 0);
    // housekeeping keeps recent events
    await t.market.service.expireStale();
    // the block also hides the seller's earlier listing event; the deal event (addressed to me) remains
    assert.deepEqual((await since(buyer, 0)).events.map((e) => e.kind), ['deal.awaiting_confirmation']);
  } finally { await t.close(); }
});

test('offers on seeded demo posts say so, so a buyer does not wait for a reply', async () => {
  const t = await start();
  try {
    const s = await offered(t);
    assert.equal((await s.buyer.get(`/api/market/offers/${s.offerId}`)).body.item.onDemoPost, false);
    await t.db.query('UPDATE app.market_listings SET is_demo = true WHERE id = $1', [s.listingId]);
    assert.equal((await s.buyer.get(`/api/market/offers/${s.offerId}`)).body.item.onDemoPost, true);
    assert.equal((await s.buyer.get('/api/market/offers?role=outgoing')).body.items[0].onDemoPost, true);
    assert.equal((await s.buyer.get(`/api/market/listings/${s.listingId}`)).body.item.isDemo, true);
  } finally { await t.close(); }
});
