// Price alerts (services/priceAlertService.js): the cloud checks them against the mandi price
// while the farmer's phone is off; an alert fires once, and sample prices never fire one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeDb } from './helpers.js';
import { createAuthService } from '../services/authService.js';
import { ensureForumReference } from '../db/forumReference.js';
import { seedDemo } from '../db/forumSeed.js';
import { createPriceAlertService, reached } from '../services/priceAlertService.js';

async function setup() {
  const { db, pool } = await makeDb();
  await db.exec(fs.readFileSync(new URL('../db/migrations/012_price_alerts.sql', import.meta.url), 'utf8'));
  await db.exec("INSERT INTO app.crops (code, name) VALUES ('rice','Rice') ON CONFLICT (code) DO NOTHING");
  await ensureForumReference(pool);
  const auth = createAuthService(pool, { AUTH_LOOKUP_SECRET: 'x'.repeat(40), NODE_ENV: 'test' });
  await seedDemo(pool, { auth, pin: '246810' });
  const { user } = await auth.login({ phone: '9100000013', pin: '246810' }); // Lucknow
  let market = { name: 'Banthara', price: 2400, date: '2026-09-19' };
  let sample = false;
  const asked = [];
  const prices = { async getPrices(q) { asked.push(q); return { sample, date: market.date, markets: [market] }; } };
  const service = createPriceAlertService({ pool, prices });
  return { db, user, service, asked, setMarket: (m) => { market = { ...market, ...m }; }, setSample: (v) => { sample = v; } };
}

test('reached: above fires at or over the price, below at or under', () => {
  assert.equal(reached('above', 2500, 2500), true);
  assert.equal(reached('above', 2499, 2500), false);
  assert.equal(reached('below', 2000, 2000), true);
  assert.equal(reached('below', 2001, 2000), false);
});

test('an alert waits, fires once when the mandi reaches it, and is marked seen', async () => {
  const t = await setup();
  try {
    const { item } = await t.service.create(t.user, { crop: 'rice', direction: 'above', price: 2500 });
    assert.equal(item.status, 'active');
    assert.equal(t.asked[0].region, t.user.regionCode, 'no farm: watches the profile region');

    assert.equal(await t.service.check(), 0, 'still below the target');
    t.setMarket({ price: 2537 });
    assert.equal(await t.service.check(), 1);
    assert.equal(await t.service.check(), 0, 'fires only once');

    const [a] = (await t.service.list(t.user)).items;
    assert.deepEqual(a.triggered, { price: 2537, market: 'Banthara', at: a.triggered.at, date: '2026-09-19' });
    assert.equal(a.seen, false);
    await t.service.markSeen(t.user);
    assert.equal((await t.service.list(t.user)).items[0].seen, true);
  } finally { await t.db.close(); }
});

test('sample prices never fire an alert, and bad input is refused', async () => {
  const t = await setup();
  try {
    t.setSample(true); t.setMarket({ price: 9999 });
    await t.service.create(t.user, { crop: 'rice', direction: 'above', price: 100 });
    assert.equal((await t.service.list(t.user)).items[0].status, 'active');
    await assert.rejects(t.service.create(t.user, { crop: 'rice', direction: 'sideways', price: 100 }), { code: 'VALIDATION_ERROR' });
    await assert.rejects(t.service.create(t.user, { crop: 'gold', direction: 'above', price: 100 }), { code: 'VALIDATION_ERROR' });
    await assert.rejects(t.service.create(t.user, { crop: 'rice', direction: 'below', price: -5 }), { code: 'VALIDATION_ERROR' });
    await assert.rejects(t.service.remove(t.user, 'nope'), { code: 'NOT_FOUND' });
  } finally { await t.db.close(); }
});
