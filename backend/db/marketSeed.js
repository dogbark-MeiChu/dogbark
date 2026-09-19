import { createPool } from './pool.js';
import { createLimiter } from '../middleware/rateLimits.js';
import { createMarketService } from '../services/marketService.js';

// Demo data for Local Market. Everything goes through marketService (so it is exactly what the app would
// create: reservations, events, notifications) and is then flagged is_demo, which the UI shows as "DEMO".
// Safe to run repeatedly: every entity has a fixed requestId, and each step only runs if it has not happened.
// Requires the Farmer Circle demo members (their demo_key) and migration 006.
//
//   npm run market:seed            add / refresh demo data
//   npm run market:seed -- --reset remove all demo market data (needs a superuser: RESET_DATABASE_URL)

const DAY = 86400000;
const dayOffset = (n, now = Date.now()) => new Date(now + n * DAY).toISOString().slice(0, 10);
const CROPS = [['rice', 'Rice'], ['wheat', 'Wheat'], ['onion', 'Onion'], ['tomato', 'Tomato'], ['potato', 'Potato']];

// [name in DEMO_USERS] -> Ravi and Meena share a region, so they are the two-phone demo pair.
const LISTINGS = [
  // key, seller, crop, quantity, unit, mode, price, grade, readyInDays, fulfillment
  ['meena-tomato', 'Meena S.', 'tomato', 120, 'kg', 'negotiable', 28, 'A', 1, 'pickup'],
  ['meena-onion', 'Meena S.', 'onion', 300, 'kg', 'fixed', 18, 'B', 2, 'pickup'],
  ['meena-wheat', 'Meena S.', 'wheat', 20, 'quintal', 'negotiable', 2250, 'A', 1, 'negotiable'],
  ['ravi-rice', 'Ravi K.', 'rice', 5, 'quintal', 'negotiable', 2250, 'A', 1, 'pickup'],
  ['asha-wheat', 'Asha P.', 'wheat', 15, 'quintal', 'negotiable', 2300, 'A', 2, 'pickup'],
  ['minh-rice', 'Minh Tran', 'rice', 2, 'ton', 'negotiable', 8500000, 'not_graded', 3, 'seller_delivery'],
  ['rahim-onion', 'Rahim U.', 'onion', 200, 'kg', 'negotiable', 45, 'not_graded', 1, 'pickup'],
  // Uttar Pradesh districts. Browsing defaults to the member's own district. Prices sit near the
  // live mandi prices of 2026-09-19 (Market Prices), so the two screens do not contradict each other.
  ['imran-tomato', 'Imran Ali', 'tomato', 150, 'kg', 'negotiable', 17, 'A', 1, 'pickup'],
  ['pooja-potato', 'Pooja Rawat', 'potato', 8, 'quintal', 'negotiable', 650, 'B', 2, 'pickup'],
  ['rakesh-wheat', 'Rakesh Tyagi', 'wheat', 25, 'quintal', 'negotiable', 2425, 'A', 3, 'negotiable'],
  ['rakesh-potato', 'Rakesh Tyagi', 'potato', 40, 'bag', 'negotiable', 340, 'not_graded', 1, 'pickup'],
  ['kavita-potato', 'Kavita Chauhan', 'potato', 12, 'quintal', 'negotiable', 600, 'A', 2, 'pickup'],
  ['sunita-rice', 'Sunita Maurya', 'rice', 12, 'quintal', 'negotiable', 2750, 'A', 5, 'seller_delivery'],
];
const REQUESTS = [
  // key, buyer, crop, quantity, unit, min, max, neededInDays, fulfillment
  ['ravi-tomato', 'Ravi K.', 'tomato', 500, 'kg', 24, 30, 3, 'buyer_pickup'],
  ['meena-rice', 'Meena S.', 'rice', 10, 'quintal', 2100, 2300, 4, 'buyer_pickup'],
  ['asha-onion', 'Asha P.', 'onion', 250, 'kg', 15, 20, 3, 'buyer_pickup'],
  ['pooja-tomato', 'Pooja Rawat', 'tomato', 200, 'kg', 14, 18, 2, 'buyer_pickup'],
  ['rakesh-onion', 'Rakesh Tyagi', 'onion', 3, 'quintal', 1800, 2200, 4, 'buyer_pickup'],
];

export async function seedMarketDemo(pool, { env = process.env, now = Date.now(), log = () => {} } = {}) {
  const limiter = createLimiter();
  const market = createMarketService({ pool, limiter, env, config: { listingsPerHour: 1e6, offersPerHour: 1e6, reportsPerDay: 1e6 } });
  const q = (text, params) => pool.query(text, params);

  for (const [code, name] of CROPS) await q('INSERT INTO app.crops (code, name) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING', [code, name]);
  const rows = (await q(
    `SELECT s.user_id AS id, p.display_name AS name FROM app.forum_user_state s JOIN app.user_profiles p ON p.user_id = s.user_id
     WHERE s.demo_key IS NOT NULL`)).rows;
  const users = Object.fromEntries(rows.map((r) => [r.name, { id: r.id }]));
  for (const n of new Set([...LISTINGS.map((l) => l[1]), ...REQUESTS.map((r) => r[1])])) {
    if (!users[n]) throw new Error(`Demo member "${n}" not found. Run the Farmer Circle seed first (SEED_DEMO_DATA / npm run forum:seed).`);
  }

  // -- posts
  const ids = {};
  for (const [key, who, crop, quantity, unit, mode, price, grade, ready, fulfillment] of LISTINGS) {
    const r = await market.createListing(users[who], {
      requestId: `seed-mkt-listing-${key}`, crop, quantity, unit, pricingMode: mode, askingPrice: price, grade,
      availableDate: dayOffset(ready, now), fulfillment, expiresInHours: 168,
    });
    ids[key] = r.id;
  }
  for (const [key, who, crop, quantity, unit, min, max, needed, fulfillment] of REQUESTS) {
    const r = await market.createRequest(users[who], {
      requestId: `seed-mkt-request-${key}`, crop, quantity, unit, targetPriceMin: min, targetPriceMax: max,
      neededBy: dayOffset(needed, now), fulfillment, expiresInHours: 168,
    });
    ids[key] = r.id;
  }
  await q('UPDATE app.market_listings SET is_demo = true WHERE id = ANY($1::uuid[])', [Object.values(ids)]);
  await q('UPDATE app.market_buy_requests SET is_demo = true WHERE id = ANY($1::uuid[])', [Object.values(ids)]);

  // -- negotiations, each left in a different visible state
  const terms = (quantity, unitPrice, over = {}) => ({ quantity, unitPrice, pickupDate: dayOffset(1, now), pickupWindowStart: '09:00', pickupWindowEnd: '11:00', paymentMethod: 'cash_on_pickup', ...over });
  const offerRow = async (offerId) => (await q('SELECT status, current_revision FROM app.market_offers WHERE id = $1', [offerId])).rows[0];
  const dealOf = async (offerId) => (await q('SELECT id, status FROM app.market_deals WHERE offer_id = $1', [offerId])).rows[0];

  // a) Ravi offers on Meena's tomatoes, Meena counters -> Ravi's turn ("Your turn" in his inbox)
  const a = await market.offerOnListing(users['Ravi K.'], ids['meena-tomato'], { requestId: 'seed-mkt-offer-a', ...terms(60, 26, { note: 'Can pick up in the morning' }) });
  if ((await offerRow(a.id)).current_revision === 1) await market.counter(users['Meena S.'], a.id, terms(60, 27));

  // b) Meena offers on Ravi's rice -> waiting for Ravi to answer
  await market.offerOnListing(users['Meena S.'], ids['ravi-rice'], { requestId: 'seed-mkt-offer-b', ...terms(2, 2200, { paymentMethod: 'external_mobile_money' }) });

  // c) Ravi takes Meena's fixed-price onions; Meena accepts -> a deal waiting for both confirmations
  const c = await market.offerOnListing(users['Ravi K.'], ids['meena-onion'], { requestId: 'seed-mkt-offer-c', ...terms(100, 18) });
  if (['open', 'countered'].includes((await offerRow(c.id)).status)) await market.accept(users['Meena S.'], c.id);

  // d) a finished trade: Ravi bought 5 quintal of wheat (history + a partly sold listing)
  const d = await market.offerOnListing(users['Ravi K.'], ids['meena-wheat'], { requestId: 'seed-mkt-offer-d', ...terms(5, 2250, { pickupDate: dayOffset(0, now) }) });
  if (['open', 'countered'].includes((await offerRow(d.id)).status)) await market.accept(users['Meena S.'], d.id);
  let deal = await dealOf(d.id);
  const ravi = users['Ravi K.'];
  const meena = users['Meena S.'];
  const step = async (when, fn) => { if (deal.status === when) { await fn(); deal = await dealOf(d.id); } };
  await step('awaiting_confirmation', async () => { await market.confirm(ravi, deal.id); await market.confirm(meena, deal.id); });
  await step('agreed', () => market.schedule(meena, deal.id, { pickupDate: dayOffset(0, now), pickupWindowStart: '09:00', pickupWindowEnd: '11:00', location: 'Danapur market gate' }));
  await step('pickup_scheduled', () => market.verifyPickup(meena, deal.id, market.pickupCode(deal.id)));
  await step('handed_over', async () => { await market.received(ravi, deal.id); await market.paymentStatus(meena, deal.id, 'received'); });
  if ((await dealOf(d.id)).status === 'completed') {
    await q(`INSERT INTO app.market_ratings (deal_id, rater_id, ratee_id, stars) VALUES ($1,$2,$3,5), ($1,$3,$2,5) ON CONFLICT DO NOTHING`, [deal.id, ravi.id, meena.id]);
  }

  // e) Lucknow: Pooja offers on Imran's tomatoes -> waiting for Imran to answer
  await market.offerOnListing(users['Pooja Rawat'], ids['imran-tomato'], { requestId: 'seed-mkt-offer-e', ...terms(80, 16, { note: 'For my shop in Bakshi Ka Talab' }) });

  // -- TruePrice v2 personas: build reputation evidence through completed deals.
  // Persona 1: "New buyer" — Pooja Rawat has 0 completed deals (natural state).
  // Persona 2: "Established seller" — Meena S. gets 2 more completed deals (total 3, 3 distinct buyers, all with handover).
  // Persona 3: "Demo verified FPO" — Asha P. is an FPO with verified_business label on profile.
  const asha = users['Asha P.'];
  const pooja = users['Pooja Rawat'];
  const rakesh = users['Rakesh Tyagi'];
  const imran = users['Imran Ali'];

  // Extra completed deals for Meena (seller): she already has 1 with Ravi from deal (d).
  // Add deals with Asha and Imran to reach 3 distinct counterparties.
  for (const [key, buyer, crop, qty, price] of [
    ['meena-rep-asha', asha, 'tomato', 30, 28],
    ['meena-rep-imran', imran, 'tomato', 25, 27],
  ]) {
    const listing = await market.createListing(meena, {
      requestId: `seed-mkt-rep-listing-${key}`, crop, quantity: qty, unit: 'kg',
      pricingMode: 'negotiable', askingPrice: price, grade: 'A',
      availableDate: dayOffset(0, now), fulfillment: 'pickup', expiresInHours: 168,
    });
    await q('UPDATE app.market_listings SET is_demo = true WHERE id = $1', [listing.id]);
    const offer = await market.offerOnListing(buyer, listing.id, {
      requestId: `seed-mkt-rep-offer-${key}`, quantity: qty, unitPrice: price,
      pickupDate: dayOffset(0, now), pickupWindowStart: '09:00', pickupWindowEnd: '11:00',
      paymentMethod: 'cash_on_pickup',
    });
    if (['open', 'countered'].includes((await offerRow(offer.id)).status)) {
      await market.accept(meena, offer.id);
    }
    let repDeal = await dealOf(offer.id);
    const buyerUser = buyer;
    const repStep = async (when, fn) => { if (repDeal.status === when) { await fn(); repDeal = await dealOf(offer.id); } };
    await repStep('awaiting_confirmation', async () => { await market.confirm(buyerUser, repDeal.id); await market.confirm(meena, repDeal.id); });
    await repStep('agreed', () => market.schedule(meena, repDeal.id, { pickupDate: dayOffset(0, now), pickupWindowStart: '09:00', pickupWindowEnd: '11:00', location: 'Danapur market gate' }));
    await repStep('pickup_scheduled', () => market.verifyPickup(meena, repDeal.id, market.pickupCode(repDeal.id)));
    await repStep('handed_over', async () => { await market.received(buyerUser, repDeal.id); await market.paymentStatus(meena, repDeal.id, 'received'); });
    if ((await dealOf(offer.id)).status === 'completed') {
      await q('INSERT INTO app.market_ratings (deal_id, rater_id, ratee_id, stars) VALUES ($1,$2,$3,5), ($1,$3,$2,4) ON CONFLICT DO NOTHING', [repDeal.id, buyerUser.id, meena.id]);
    }
  }

  // Keep the demo fresh: open demo posts and live offers are pushed forward on every run.
  await q(`UPDATE app.market_listings SET expires_at = now() + interval '7 days', available_date = GREATEST(available_date, current_date), updated_at = now()
           WHERE is_demo AND status IN ('open','partially_reserved','reserved')`);
  await q(`UPDATE app.market_buy_requests SET expires_at = now() + interval '7 days', needed_by = GREATEST(needed_by, current_date + 1), updated_at = now()
           WHERE is_demo AND status IN ('open','partially_reserved')`);
  await q(`UPDATE app.market_offers SET expires_at = now() + interval '7 days' WHERE status IN ('open','countered')
           AND (listing_id = ANY($1::uuid[]))`, [Object.values(ids)]);
  log(`market demo: ${LISTINGS.length + 2} listings, ${REQUESTS.length} requests, 7 negotiations (3 completed for reputation)`);
  return { listings: LISTINGS.length, requests: REQUESTS.length };
}

/** Removes demo market data. Offer revisions and events are append-only, so this needs a superuser. */
export async function resetMarketDemo(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica'); // skips the append-only triggers (superuser only)
    const demo = `SELECT id FROM app.market_listings WHERE is_demo UNION SELECT id FROM app.market_buy_requests WHERE is_demo`;
    const offers = `SELECT id FROM app.market_offers WHERE listing_id IN (SELECT id FROM app.market_listings WHERE is_demo)
                    OR buy_request_id IN (SELECT id FROM app.market_buy_requests WHERE is_demo)`;
    const deals = `SELECT id FROM app.market_deals WHERE offer_id IN (${offers})`;
    const users = 'SELECT user_id FROM app.forum_user_state WHERE demo_key IS NOT NULL';
    await client.query(`DELETE FROM app.market_ratings WHERE deal_id IN (${deals})`);
    await client.query(`DELETE FROM app.market_events WHERE entity_id IN (${deals}) OR entity_id IN (${offers}) OR entity_id IN (${demo})`);
    await client.query(`DELETE FROM app.market_deals WHERE id IN (${deals})`);
    await client.query(`DELETE FROM app.market_offer_revisions WHERE offer_id IN (${offers})`);
    await client.query(`DELETE FROM app.market_offers WHERE id IN (${offers})`);
    await client.query(`DELETE FROM app.market_buy_requests WHERE is_demo`);
    await client.query(`DELETE FROM app.market_listings WHERE is_demo`);
    await client.query(`DELETE FROM app.market_request_ids WHERE request_id LIKE 'seed-mkt-%'`);
    await client.query(`DELETE FROM app.notifications WHERE type IN ('market_offer','market_deal') AND user_id IN (${users})`);
    await client.query(`DELETE FROM app.outbox_events WHERE topic LIKE 'market.%' AND (recipient_id IN (${users}) OR payload->>'ownerId' IN (SELECT user_id::text FROM app.forum_user_state WHERE demo_key IS NOT NULL))`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await import('dotenv/config');
  const reset = process.argv.includes('--reset');
  const pool = createPool(reset ? process.env.RESET_DATABASE_URL || process.env.DATABASE_URL : process.env.DATABASE_URL);
  if (!pool) throw new Error('DATABASE_URL is required.');
  try {
    if (reset) { await resetMarketDemo(pool); console.log('market demo data removed'); } else await seedMarketDemo(pool, { log: console.log });
  } finally { await pool.end(); }
}
