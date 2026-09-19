import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSprayConditions, calculateDeltaT } from './sprayAssessment.js';

test('delta-T follows the Stull approximation', () => assert.equal(calculateDeltaT(28, 72), 4));

test('spray assessment exposes every factor and the mandatory disclaimer', () => {
  const out = assessSprayConditions({ current: { temperatureC: 28, relativeHumidity: 72, windSpeedKph: 8.2,
    windGustKph: 12.5, rainProbabilityNext4h: 15, precipitationMm: 0 } });
  assert.equal(out.overall, 'caution');
  assert.deepEqual(out.factors.map((f) => f.param), ['wind','humidity','temperature','deltaT','rainRisk','gusts','precipitation']);
  assert.match(out.disclaimer, /Always follow product label/);
});

// A day of hourly forecasts: `good` hours are calm and mild, the rest windy.
const GOOD = { temperatureC: 22, relativeHumidity: 70, windSpeedKph: 6, windGustKph: 10, rainProbability: 5, precipitationMm: 0 };
const day = (date, good) => Array.from({ length: 24 }, (_, h) => ({ time: `${date}T${String(h).padStart(2, '0')}:00`,
  ...GOOD, ...(good(h) ? {} : { windSpeedKph: 22, windGustKph: 30 }) }));

test('best window is the longest run of daylight hours with nothing unsuitable', async () => {
  const { bestSprayWindow } = await import('./sprayAssessment.js');
  const hourly = day('2026-09-20', (h) => (h >= 7 && h < 9) || (h >= 11 && h < 16));
  const w = bestSprayWindow(hourly, '2026-09-20');
  assert.deepEqual([w.from, w.to, w.hours, w.status], ['11:00', '16:00', 5, 'optimal']);
  assert.deepEqual(w.watch, []);
  // A run that lasts until the end of daylight still gets its end time.
  const late = bestSprayWindow(day('2026-09-20', (h) => h >= 14), '2026-09-20');
  assert.deepEqual([late.from, late.to], ['14:00', '18:00']);
  assert.equal(bestSprayWindow(day('2026-09-20', () => false), '2026-09-20'), null);
});

test('today counts only the hours left; another day is judged by its forecast', () => {
  const hourly = [...day('2026-09-19', (h) => h >= 7 && h < 11), ...day('2026-09-20', (h) => h >= 8 && h < 12)];
  const weather = { current: { time: '2026-09-19T12:15', ...GOOD, windSpeedKph: 22, windGustKph: 30, rainProbabilityNext4h: 5 }, hourly };
  const now = assessSprayConditions(weather, { date: '2026-09-19' });
  assert.equal(now.basis, 'now');
  assert.equal(now.overall, 'unsuitable');
  assert.equal(now.bestWindow, null, 'the morning window has passed');
  const tomorrow = assessSprayConditions(weather, { date: '2026-09-20' });
  assert.deepEqual([tomorrow.basis, tomorrow.overall, tomorrow.at, tomorrow.bestWindow.from, tomorrow.bestWindow.to], ['forecast', 'optimal', '08:00', '08:00', '12:00']);
  const humid = assessSprayConditions({ current: { time: '2026-09-20T06:00' }, hourly: day('2026-09-20', () => true).map((h) => ({ ...h, relativeHumidity: 90 })) });
  // 90% humidity at 22°C also puts delta-T under 2.
  assert.deepEqual(humid.bestWindow.watch, ['humidity', 'deltaT'], 'caution factors by param, for the handset to word');
  assert.match(humid.bestWindow.reason, /watch humidity, delta-T/);
  assert.equal(assessSprayConditions(weather, { date: '2026-09-25' }), null, 'no forecast for that day');
});

test('every factor that is not optimal says why', () => {
  const out = assessSprayConditions({ current: { temperatureC: 31, relativeHumidity: 50, windSpeedKph: 1, windGustKph: 2, rainProbabilityNext4h: 40, precipitationMm: 0 } });
  for (const f of out.factors) assert.equal(Boolean(f.reason), f.status !== 'optimal', f.param);
  assert.match(out.factors.find((f) => f.param === 'wind').reason, /inversion/);
});
