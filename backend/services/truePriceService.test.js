import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBreakEven, calculateNetPrice, scorePriceConfidence } from './truePriceService.js';

test('TruePrice deducts every mandi cost and returns an auditable breakdown', () => {
  const out = calculateNetPrice({ marketPrice: 2180, quantity: 5, distanceKm: 15, crop: 'rice' });
  assert.ok(out.estimatedNetPerQt < out.grossPerQt);
  assert.equal(out.breakdown.commission.pct, 2.5);
  assert.equal(out.breakdown.marketFee.pct, 1);
  assert.equal(out.grossTotal - out.estimatedCostsTotal, out.totalEstimatedNet);
});

test('buyer pickup has no transport, commission or market fee', () => {
  const out = calculateNetPrice({ marketPrice: 2180, quantity: 5, transportMode: 'buyer_pickup', channel: 'direct_buyer' });
  assert.equal(out.breakdown.transport.total, 0);
  assert.equal(out.breakdown.commission.perQt, 0);
  assert.equal(out.breakdown.marketFee.perQt, 0);
});

test('transport grows with distance and respects a minimum total', () => {
  const near = calculateNetPrice({ marketPrice: 2000, quantity: 100, distanceKm: 0.1 });
  const far = calculateNetPrice({ marketPrice: 2000, quantity: 100, distanceKm: 30 });
  assert.equal(near.breakdown.transport.total, 50);
  assert.ok(far.breakdown.transport.total > near.breakdown.transport.total);
});

test('perishable crops have a higher waiting threshold', () => {
  const rice = calculateBreakEven({ todayNetPerQt: 2000, crop: 'rice', quantity: 5 });
  const tomato = calculateBreakEven({ todayNetPerQt: 2000, crop: 'tomato', quantity: 5 });
  assert.ok(tomato.breakEvenPerQt > rice.breakEvenPerQt);
  assert.match(tomato.disclaimer, /not a prediction/i);
});

test('fresh official matched data earns A confidence', () => {
  const out = scorePriceConfidence({ hoursOld: 3, source: 'agmarknet', observationCount: 12, varietyMatch: true,
    minPrice: 2100, maxPrice: 2180, modalPrice: 2150 });
  assert.equal(out.grade, 'A');
  assert.equal(out.decisionEligible, true);
});

test('stale sample data earns C and cannot be promoted', () => {
  const out = scorePriceConfidence({ hoursOld: 120, source: 'agmarknet', sample: true, observationCount: 0 });
  assert.equal(out.grade, 'C');
  assert.equal(out.decisionEligible, false);
});

test('invalid inputs fail closed instead of producing NaN', () => {
  assert.throws(() => calculateNetPrice({ marketPrice: 'x', quantity: 5 }), /marketPrice/);
  assert.throws(() => calculateNetPrice({ marketPrice: 5, quantity: 0 }), /quantity/);
  assert.throws(() => calculateNetPrice({ marketPrice: 5, quantity: 1, transportMode: 'teleport' }), /transportMode/);
});
