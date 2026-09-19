import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyTransportModel } from '../../frontend/js/screens/priceDetailModel.js';

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
