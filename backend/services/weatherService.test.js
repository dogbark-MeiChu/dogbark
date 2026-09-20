import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWeather, normalize, advise, buildUrl, _clearCache } from './weatherService.js';
import { assessSprayConditions } from './sprayAssessment.js';

const raw = {
  current: { time:'2026-09-19T09:00',temperature_2m: 27.6,relative_humidity_2m:72, precipitation: 0, weather_code: 1,wind_speed_10m:8.2,wind_gusts_10m:12.5 },
  hourly:{time:['2026-09-19T09:00','2026-09-19T10:00','2026-09-19T11:00','2026-09-19T12:00'],precipitation_probability:[5,10,15,20]},
  daily: {
    time: ['2026-09-19', '2026-09-20', '2026-09-21'],
    weather_code: [1, 61, 95],
    temperature_2m_max: [31.2, 29, 28],
    temperature_2m_min: [22, 21, 20],
    precipitation_probability_max: [10, 70, 90],
    precipitation_sum: [0, 8, 20],
    et0_fao_evapotranspiration: [4, 3, 2],
  },
};

test('url asks for rain probability, not just current precipitation', () => {
  assert.match(buildUrl(24.14, 120.67), /precipitation_probability_max/);
  assert.match(buildUrl(24.14, 120.67), /relative_humidity_2m/);
});

test('normalize maps 3 days and rounds temps', () => {
  const w = normalize(raw);
  assert.equal(w.current.temp, 28);
  assert.equal(w.daily.length, 3);
  assert.equal(w.daily[1].rain_prob, 70);
  assert.equal(w.current.relativeHumidity,72);
  assert.equal(w.current.rainProbabilityNext4h,20);
});

test('advice uses the same rules as the Today\'s Farm spray assessment', () => {
  const w = normalize(raw);
  assert.equal(advise(w).action, assessSprayConditions(w).overall);
  assert.equal(advise(w).action, 'caution'); // 27.6°C: above 25°C
  assert.match(advise(w).reason, /Above 25°C/);
  const wet = normalize(raw);
  wet.current.rainProbabilityNext4h = 80;
  assert.equal(advise(wet).action, 'unsuitable');
  assert.match(advise(wet).reason, /Rain likely/);
});

test('caches, and serves stale data when upstream fails', async () => {
  _clearCache();
  let calls = 0;
  let t = 0;
  const ok = async () => (calls++, { ok: true, json: async () => raw });
  const bad = async () => { throw new Error('down'); };
  const now = () => t;

  const first = await getWeather(24.14, 120.67, { fetchImpl: ok, now });
  assert.equal(first.daily[0].advice.action, 'caution');
  await getWeather(24.14, 120.67, { fetchImpl: ok, now });
  assert.equal(calls, 1);

  t = 31 * 60 * 1000;
  const r = await getWeather(24.14, 120.67, { fetchImpl: bad, now });
  assert.equal(r.stale, true);

  _clearCache();
  await assert.rejects(getWeather(1, 1, { fetchImpl: bad, now }));
});
