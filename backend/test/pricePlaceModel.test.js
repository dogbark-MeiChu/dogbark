import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePriceFarm, placeFromFarm } from '../../frontend/js/pricePlaceModel.js';

const farms = [
  { id: 'a', name: 'Alpha Farm', region_code: 'IN-UP-AGR', region_name: 'Agra, Uttar Pradesh', latitude: 27.1767, longitude: 78.0081 },
  { id: 'g', name: 'Green Field Cooperative', region_code: 'IN-UP-LKO', region_name: 'Lucknow, Uttar Pradesh', latitude: 26.8467, longitude: 80.9462 },
];

test('prices follow the farm selected in Today’s Farm', () => {
  assert.equal(choosePriceFarm(farms, 'g').id, 'g');
  assert.equal(choosePriceFarm(farms, null).id, 'a');
});

test('a farm price place carries the correct visible label and coordinates', () => {
  assert.deepEqual(placeFromFarm(farms[1]), {
    region: 'IN-UP-LKO', lat: 26.8467, lng: 80.9462,
    name: 'Lucknow, Uttar Pradesh', farmName: 'Green Field Cooperative', farmId: 'g', basis: 'farm',
  });
});
