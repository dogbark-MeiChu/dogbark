import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgPool } from './helpers.js';
import { arrivalDate, mandiRow, createMandiClient, RateLimited, SAMPLE_KEY } from '../services/mandiClient.js';
import { syncMandi, marketCode, marketName } from '../db/syncMandi.js';
import { createPriceService } from '../services/priceService.js';
import { pgRepo } from '../services/priceRepo.js';

const migration = (name) => fs.readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');
// A record as data.gov.in returns it.
const rec = (market, district, modal, over = {}) => ({
  state: 'Uttar Pradesh', district, market, commodity: 'Rice', variety: 'Common', grade: 'FAQ',
  arrival_date: '19/09/2026', min_price: modal - 100, max_price: modal + 100, modal_price: modal, ...over,
});
const json = (status, body) => new Response(JSON.stringify(body), { status });

test('records parse to stored rows; unusable ones are dropped', () => {
  assert.equal(arrivalDate('19/09/2026'), '2026-09-19');
  assert.equal(arrivalDate('2026-09-19'), null);
  assert.deepEqual(mandiRow(rec('Shamli APMC', 'Shamli', 2500)), {
    state: 'Uttar Pradesh', district: 'Shamli', market: 'Shamli APMC', commodity: 'Rice', variety: 'Common',
    date: '2026-09-19', min: 2400, max: 2600, modal: 2500,
  });
  assert.equal(mandiRow(rec('X APMC', 'X', 0)), null);
  assert.equal(mandiRow(rec('X APMC', 'X', 2500, { arrival_date: '' })), null);
  assert.equal(mandiRow(rec('X APMC', 'X', 2500, { min_price: 3000, max_price: 2000 })).min, null); // inconsistent range
  assert.equal(marketName('Shamli APMC'), 'Shamli');
  assert.equal(marketCode({ state: 'Uttar Pradesh', district: 'Gonda', market: 'Nawabganj APMC' }), 'agm-uttar-pradesh-gonda-nawabganj-apmc');
});

test('the client pages 10 at a time with the sample key and waits out rate limits', async () => {
  const calls = [];
  let limited = 2;
  const all = Array.from({ length: 15 }, (_, i) => rec(`M${i} APMC`, `D${i}`, 2000 + i));
  const fetchImpl = async (url) => {
    const q = new URL(url).searchParams;
    calls.push(q.get('offset'));
    if (limited-- > 0) return json(429, { error: 'Rate limit exceeded' });
    assert.equal(q.get('api-key'), SAMPLE_KEY);
    assert.equal(q.get('filters[state.keyword]'), 'Uttar Pradesh');
    const o = Number(q.get('offset'));
    return json(200, { total: 15, records: all.slice(o, o + Number(q.get('limit'))) });
  };
  const slept = [];
  const client = createMandiClient({ fetchImpl, sleep: async (ms) => { slept.push(ms); } });
  const rows = await client.all({ state: 'Uttar Pradesh', commodity: 'Rice' });
  assert.equal(rows.length, 15);
  assert.deepEqual(slept, [20000, 40000]);
  assert.deepEqual(calls, ['0', '0', '0', '10']);

  const stuck = createMandiClient({ fetchImpl: async () => json(429, { error: 'Rate limit exceeded' }), sleep: async () => {}, maxWaitMs: 60000 });
  await assert.rejects(stuck.all({ state: 'Uttar Pradesh', commodity: 'Rice' }), RateLimited);
});

async function db() {
  const pg = new PGlite();
  await pg.exec('CREATE ROLE agrilink_app; CREATE ROLE agrilink_migrator;');
  await pg.exec(migration('001_foundation.sql').replace(/CREATE EXTENSION[^;]*;/, ''));
  await pg.exec(migration('003_market_prices.sql'));
  await pg.exec(migration('010_up_districts.sql'));
  await pg.exec(migration('013_market_district.sql'));
  return { pg, pool: pgPool(pg) };
}

test('sync stores mandis under the state, geocodes them, resumes after a rate limit', async () => {
  const { pg, pool } = await db();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mandi-'));
  const progressFile = path.join(dir, 'progress.json');
  const byCrop = {
    Rice: [rec('Rampur APMC', 'Rampur', 3000), rec('Rampur APMC', 'Rampur', 8000, { variety: 'Basmati' }), rec('Milak APMC', 'Rampur', 3100), rec('Meerut APMC', 'Meerut', 2900)],
    Wheat: [rec('Rampur APMC', 'Rampur', 2400, { commodity: 'Wheat' })],
  };
  let wheatLimited = true;
  const client = {
    async all({ commodity }) {
      if (commodity === 'Wheat' && wheatLimited) throw new RateLimited();
      return byCrop[commodity];
    },
  };
  const points = { Rampur: { lat: 28.81, lng: 79.03 }, Meerut: { lat: 28.98, lng: 77.71 } };
  const geocode = async ({ district }) => points[district] || null;
  const crops = { Rice: ['rice', 'Rice'], Wheat: ['wheat', 'Wheat'] };
  try {
    const first = await syncMandi({ pool, client, geocode, crops, progressFile, log: () => {} });
    assert.deepEqual([first.complete, first.pairs, first.written], [false, 1, 4]);
    wheatLimited = false;
    const second = await syncMandi({ pool, client, geocode, crops, progressFile, log: () => {} });
    assert.deepEqual([second.complete, second.pairs], [true, 1]); // rice was not fetched again
    const markets = (await pg.query(`SELECT m.code, m.name, m.district_name, m.latitude::float8 lat, r.code region FROM app.markets m JOIN app.regions r ON r.id = m.region_id ORDER BY m.code`)).rows;
    assert.deepEqual(markets.map((m) => [m.name, m.district_name, m.region, m.lat]),
      [['Meerut', 'Meerut', 'IN-UP', 28.98], ['Milak', 'Rampur', 'IN-UP', 28.81], ['Rampur', 'Rampur', 'IN-UP', 28.81]]);

    // A member in Meerut district gets live state prices, Meerut first, and one price per mandi/day.
    const prices = createPriceService(pgRepo(pool));
    const d = await prices.getPrices({ crop: 'rice', region: 'IN-UP-MRT', lat: 28.9845, lng: 77.7064 });
    assert.equal(d.region, 'IN-UP');
    assert.equal(d.markets[0].name, 'Meerut');
    assert.equal(d.markets[0].district, 'Meerut');
    assert.equal(d.coverage.state_fallback, true);
    assert.equal(d.markets.find((m) => m.name === 'Rampur').price, 3000); // Common, not Basmati
    assert.equal(d.sample, false);
    const crops2 = await prices.getCrops({ region: 'IN-UP-AGR' });
    assert.deepEqual(crops2.items.map((c) => c.code), ['rice', 'wheat']);
  } finally { await pg.close(); fs.rmSync(dir, { recursive: true }); }
});

test('a district with only sample prices uses its state\'s live prices; stale mandis drop out', async () => {
  const history = {
    'IN-UP-01': [{ market_code: 'rampur', market_name: 'Rampur (sample)', lat: 28.8, lng: 79.03, date: '2026-09-19', modal: 2000, currency: 'INR', unit: 'quintal', source: 'seed', sample: true }],
    'IN-UP': [
      { market_code: 'agm-a', market_name: 'Rampur', lat: 28.81, lng: 79.03, date: '2026-09-19', modal: 3000, currency: 'INR', unit: 'quintal', source: 'agmarknet', sample: false },
      { market_code: 'agm-b', market_name: 'Old', lat: 28.9, lng: 79.1, date: '2026-08-01', modal: 2800, currency: 'INR', unit: 'quintal', source: 'agmarknet', sample: false },
    ],
  };
  const svc = createPriceService({ async history(_c, r) { return history[r] || []; }, async crops() { return []; } });
  const d = await svc.getPrices({ crop: 'rice', region: 'IN-UP-01', lat: 28.8, lng: 79.03 });
  assert.equal(d.region, 'IN-UP');
  assert.deepEqual(d.markets.map((m) => m.name), ['Rampur']);
});

test('the home mandi reports how far it is from the member', async () => {
  const row = (code, name, lat, lng) => ({ market_code: code, market_name: name, lat, lng, date: '2026-09-19', modal: 3000, currency: 'INR', unit: 'quintal', source: 'agmarknet', sample: false, variety: 'Common' });
  const svc = createPriceService({ async history() { return [row('hapur', 'Hapur', 28.665, 77.439), row('unnao', 'Unnao', 26.547, 80.488)]; }, async crops() { return []; } });
  const rampur = await svc.getPrices({ crop: 'rice', region: 'IN-UP', lat: 28.8, lng: 79.03 });
  assert.equal(rampur.markets[0].name, 'Hapur');
  assert.ok(rampur.home_from_you_km > 150 && rampur.home_from_you_km < 250);
  assert.equal((await svc.getPrices({ crop: 'rice', region: 'IN-UP' })).home_from_you_km, null);
});
