// The trade confirm screen's price check (frontend/js/market/priceGap.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, againstMe } from '../../frontend/js/market/priceGap.js';

const mandi = { price: 2537, currency: 'INR' };

test('converts kg, quintal and ton prices to per quintal before comparing', () => {
  assert.deepEqual(compare({ unit: 'quintal', unitPrice: 2200, currency: 'INR' }, mandi), { perQuintal: 2200, pct: -13 });
  assert.equal(compare({ unit: 'kg', unitPrice: 25.37, currency: 'INR' }, mandi).pct, 0);
  assert.equal(compare({ unit: 'ton', unitPrice: 30000, currency: 'INR' }, mandi).pct, 18);
});

test('bags, crates, other currencies and a missing mandi price are not compared', () => {
  assert.equal(compare({ unit: 'bag', unitPrice: 900, currency: 'INR' }, mandi), null);
  assert.equal(compare({ unit: 'kg', unitPrice: 25, currency: 'VND' }, mandi), null);
  assert.equal(compare({ unit: 'kg', unitPrice: 25, currency: 'INR' }, null), null);
});

test('warns the seller about low prices and the buyer about high ones', () => {
  assert.equal(againstMe('seller', -13), true);
  assert.equal(againstMe('seller', -9), false);
  assert.equal(againstMe('seller', 20), false);
  assert.equal(againstMe('buyer', 12), true);
  assert.equal(againstMe('buyer', -30), false);
});
