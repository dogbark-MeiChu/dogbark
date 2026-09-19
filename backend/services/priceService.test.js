import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPriceService, createFarmPriceService, marketSnapshot, analyze, netProfit, distanceKm } from './priceService.js';
import { memoryRepo } from './priceRepo.js';

const svc = createPriceService(memoryRepo(() => Date.parse('2026-09-19T00:00:00Z')));

test('getPrices returns home market first with 3 markets and flags sample data', async () => {
  const d = await svc.getPrices({ crop: 'rice', region: 'IN-UP-01', home: 'rampur' });
  assert.equal(d.markets.length, 3);
  assert.equal(d.markets[0].code, 'rampur');
  assert.equal(d.markets[0].distance_km, 0);
  assert.equal(d.sample, true);
  assert.equal(d.unit, 'quintal');
  assert.equal(d.markets[0].trend.length, 7);
});

test('unknown crop or region -> null', async () => {
  assert.equal(await svc.getPrices({ crop: 'banana', region: 'IN-UP-01' }), null);
  assert.equal(await svc.getPrices({ crop: 'rice', region: 'XX-00' }), null);
});

test('analyze reports facts without a sell/wait recommendation', () => {
  assert.deepEqual(analyze([100, 101, 103, 106]).trend, 'up');
  assert.deepEqual(analyze([106, 103, 101, 100]).trend, 'down');
  assert.deepEqual(analyze([100, 100, 101, 100]).trend, 'flat');
  assert.equal('recommendation' in analyze([100,106]),false);
  assert.ok(analyze([100, 130]).reason.length <= 80);
});

test('demo data reports an upward trend without advice', async () => {
  const d = await svc.getPrices({ crop: 'rice', region: 'IN-UP-01', home: 'rampur' });
  assert.equal(d.analysis.trend, 'up');
  assert.equal('recommendation' in d.analysis,false);
});

test('netProfit subtracts transport and scales by qty', () => {
  const from = { name: 'A', price: 2140, lat: 28.8, lng: 79.03 };
  const to = { name: 'B', price: 2280, lat: 28.37, lng: 79.43 };
  const n = netProfit({ from, to, qty: 5 });
  assert.equal(n.gain_per_qt, 2280 - 2140 - n.transport_per_qt);
  assert.equal(n.gain_total, n.gain_per_qt * 5);
  assert.ok(n.distance_km > 40 && n.distance_km < 100);
});

test('getNetProfit rejects unknown market', async () => {
  assert.equal(await svc.getNetProfit({ crop: 'rice', region: 'IN-UP-01', from: 'rampur', to: 'nowhere', qty: 1 }), null);
  const n = await svc.getNetProfit({ crop: 'rice', region: 'IN-UP-01', from: 'rampur', to: 'bareilly', qty: 5 });
  assert.equal(n.qty, 5);
  assert.equal(n.truePrice.highestNet, null); // sample/C-confidence data is never promoted
});

test('distanceKm is ~0 for same point', () => {
  assert.equal(Math.round(distanceKm({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })), 0);
});

test('home market comes first even if the repo returns rows in a different order', async () => {
  const shuffled = createPriceService({
    async history(c, r) { return (await memoryRepo(() => Date.parse('2026-09-19T00:00:00Z')).history(c, r)).reverse(); },
  });
  const d = await shuffled.getPrices({ crop: 'rice', region: 'IN-UP-01', home: 'rampur' });
  assert.equal(d.markets[0].code, 'rampur');
  assert.equal(d.home, 'rampur');
  assert.equal(d.markets[0].distance_km, 0);
  assert.equal(d.markets[0].trend.length, 7);
  assert.ok(d.markets[0].trend[6] > d.markets[0].trend[0]); // oldest -> newest despite reversed input
});

test('historical database rows retain their latest date and source', async () => {
  const historical = createPriceService({
    async history() {
      return [
        { market_code: 'ceda-680', market_name: 'Rampur', lat: null, lng: null, date: '2025-10-29', modal: 3260, currency: 'INR', unit: 'quintal', source: 'agmarknet', sample: false },
        { market_code: 'ceda-680', market_name: 'Rampur', lat: null, lng: null, date: '2025-10-30', modal: 3290, currency: 'INR', unit: 'quintal', source: 'agmarknet', sample: false },
      ];
    },
  });
  const d = await historical.getPrices({ crop: 'rice', region: 'IN-CEDA-S9-D136', home: 'ceda-680' });
  assert.equal(d.date, '2025-10-30');
  assert.equal(d.source, 'agmarknet');
  assert.equal(d.sample, false);
});

// Mirrors the CEDA import on the VM: markets without coordinates, latest prices on different days,
// and an old previous price.
const ceda = createPriceService({
  async history() {
    const row = (market_code, market_name, date, modal) => ({ market_code, market_name, lat: null, lng: null, date, modal, currency: 'INR', unit: 'quintal', source: 'agmarknet', sample: false });
    return [
      row('ceda-680', 'Rampur', '2025-06-01', 3000), row('ceda-680', 'Rampur', '2025-10-29', 3260), row('ceda-680', 'Rampur', '2025-10-30', 3290),
      row('ceda-3452', 'Milak', '2025-10-29', 3300),
    ];
  },
});

test('net profit without market coordinates reports unknown transport, not a free trip', async () => {
  const n = await ceda.getNetProfit({ crop: 'rice', region: 'IN-CEDA-S9-D136', from: 'ceda-680', to: 'ceda-3452', qty: 5 });
  assert.equal(n.transport_known, false);
  assert.equal(n.distance_km, null);
  assert.equal(n.transport_per_qt, null);
  assert.equal(n.gain_per_qt, 10); // before transport
  assert.equal(n.truePrice.highestNet, null);
});

test('net profit uses the "from" market as home and reports each side\'s date', async () => {
  const n = await ceda.getNetProfit({ crop: 'rice', region: 'IN-CEDA-S9-D136', from: 'ceda-680', to: 'ceda-3452', qty: 1 });
  assert.equal(n.price_date, '2025-10-30');
  assert.deepEqual([n.from_date, n.to_date, n.same_day], ['2025-10-30', '2025-10-29', false]);
});

test('price change and the analysis ignore prices older than the recent window', async () => {
  const d = await ceda.getPrices({ crop: 'rice', region: 'IN-CEDA-S9-D136', home: 'ceda-680' });
  const rampur = d.markets[0];
  assert.equal(rampur.change_pct, 0.9); // vs 2025-10-29, not the June price
  assert.equal(d.markets.find((m) => m.code === 'ceda-3452').change_pct, null); // no recent previous price
  assert.equal(d.markets.find((m) => m.code === 'ceda-3452').days_from_home, 1);
  assert.equal(d.analysis.trend, 'up'); // June's 3000 is outside the two-week window
  assert.equal('recommendation' in d.analysis, false);
});

test('farm prices come from the synced mandi data, measured from the farm', async () => {
  const row = (market_code, market_name, lat, lng, modal, date = '2026-09-19') => ({ market_code, market_name, lat, lng, date, modal,
    variety: 'Common', currency: 'INR', unit: 'quintal', source: 'agmarknet', sample: false });
  const prices = createPriceService({
    async history(_crop, region) {
      if (region !== 'IN-UP') return [];
      return [row('lko', 'Lucknow', 26.85, 80.95, 2100, '2026-09-18'), row('lko', 'Lucknow', 26.85, 80.95, 2180),
        row('bbk', 'Barabanki', 26.93, 81.19, 2260), row('knp', 'Kanpur', 26.45, 80.33, 2400)];
    },
    async crops() { return []; },
  });
  const cache = { latest: async () => { throw new Error('not used when live data exists'); } };
  const farm = { id: 'farm-1', region_code: 'IN-UP-LKO', latitude: '26.84670', longitude: '80.94620' };
  const out = await createFarmPriceService({ prices, cache, now: () => new Date('2026-09-19T03:34:12Z') }).getFarmPrices(farm, 'rice');
  assert.equal(out.source, 'live');
  assert.equal(out.localMarket.name, 'Lucknow');
  assert.deepEqual(out.sevenDayTrend, [2100, 2180]);
  assert.deepEqual(out.nearbyMarkets.map((m) => m.name), ['Barabanki', 'Kanpur']);
  // same formula as Market Prices: (price there - trip there) - (local price - trip to local)
  const kanpur = out.nearbyMarkets[1];
  const n = netProfit({ from: { name: 'Lucknow', price: 2180, lat: 26.85, lng: 80.95 }, to: { name: 'Kanpur', price: 2400, lat: 26.45, lng: 80.33 }, qty: 1, here: { lat: 26.8467, lng: 80.9462 } });
  assert.equal(kanpur.netGainPerUnit, n.gain_per_qt);
  const summary = marketSnapshot(out);
  assert.equal(summary.bestNearbyMarket, out.nearbyMarkets.slice().sort((a, b) => b.netGainPerUnit - a.netGainPerUnit)[0].name);
  assert.equal(summary.trend7d, '+3.8%');
  assert.equal('recommendation' in summary, false);
});

test('a farm without synced prices gets its stored snapshot, marked stale', async () => {
  const prices = createPriceService({ async history() { return []; }, async crops() { return []; } });
  const cached = { farmId: 'farm-1', crop: 'rice', provider: 'agmarknet', source: 'demo', localMarket: { modalPrice: 2000 }, nearbyMarkets: [], sevenDayTrend: [1900, 2000] };
  const out = await createFarmPriceService({ prices, cache: { latest: async () => cached } }).getFarmPrices({ id: 'farm-1', region_code: 'VN-AG' }, 'rice');
  assert.deepEqual([out.source, out.stale], ['demo', true]);
});

test('with the member\'s location both trips start from the member', () => {
  const here = { lat: 28.8, lng: 79.03 };                       // Rampur
  const near = { name: 'Near', price: 2500, lat: 28.84, lng: 79.0 };  // ~6 km
  const far = { name: 'Far', price: 2700, lat: 28.37, lng: 79.43 };   // Bareilly-ish, ~77 km
  const n = netProfit({ from: near, to: far, qty: 2, here });
  assert.ok(n.from_distance_km < 10 && n.distance_km > 60);
  const extra = Math.round(n.distance_km * 1.5) - Math.round(n.from_distance_km * 1.5);
  assert.ok(Math.abs(n.transport_per_qt - extra) <= 2);
  assert.equal(n.gain_per_qt, 200 - n.transport_per_qt);
  assert.equal(n.gain_total, n.gain_per_qt * 2);
});
