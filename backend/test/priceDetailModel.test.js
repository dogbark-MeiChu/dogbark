import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyTransportModel, truePriceAssumptionQuery, truePriceCostTotals } from '../../frontend/js/screens/priceDetailModel.js';

test('fallback keeps known extra-trip transport instead of calling it unknown', () => {
  assert.deepEqual(legacyTransportModel({
    transport_known: true,
    transport_per_qt: 92,
    distance_km: 77,
    from_distance_km: 6,
  }), {
    kind: 'extra_trip', distanceKm: 77, fromDistanceKm: 6, transportPerQt: 92, gainLabel: 'Net gain',
  });
});

test('fallback distinguishes a known one-way trip from unknown transport', () => {
  assert.deepEqual(legacyTransportModel({
    transport_known: true,
    transport_per_qt: 45,
    distance_km: 30,
    from_distance_km: null,
  }), { kind: 'trip', distanceKm: 30, transportPerQt: 45, gainLabel: 'Net gain' });
  assert.deepEqual(legacyTransportModel({
    transport_known: false,
    transport_per_qt: null,
    distance_km: null,
  }), { kind: 'unknown', gainLabel: 'Gain before transport' });
});

test('TruePrice sends every editable assumption to the server', () => {
  assert.equal(truePriceAssumptionQuery({ transportMode: 'own', channel: 'direct_buyer', alreadyPacked: true, transitDays: 2 }),
    'transportMode=own&channel=direct_buyer&alreadyPacked=true&transitDays=2');
  assert.equal(truePriceAssumptionQuery({ transportMode: 'hired', channel: 'mandi', alreadyPacked: false, transitDays: null }),
    'transportMode=hired&channel=mandi&alreadyPacked=false');
});

test('visible TruePrice costs include spoilage and reconcile to the backend total', () => {
  const costs = truePriceCostTotals({ breakdown: {
    transport: { total: 100 }, commission: { perQt: 10 }, marketFee: { perQt: 5 },
    loading: { perQt: 8 }, weighing: { perQt: 2 }, packaging: { perQt: 15 }, spoilage: { perQt: 20 },
  } }, 5);
  assert.deepEqual(costs, { transport: 100, commissionFee: 75, handlingPacking: 125, spoilage: 100 });
  assert.equal(Object.values(costs).reduce((sum, value) => sum + value, 0), 400);
});
