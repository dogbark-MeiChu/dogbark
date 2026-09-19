// Open-Meteo proxy with a per-coordinate cache. Free tier is non-commercial only
// (10k calls/day) and requires CC-BY attribution.
import { assessSprayConditions } from './sprayAssessment.js';
const TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 5000;
const cache = new Map(); // key -> { at, data }

const FIELDS = {
  current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
  hourly: 'precipitation_probability,precipitation,temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m',
  daily: [
    'weather_code',
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_probability_max',
    'precipitation_sum',
    'et0_fao_evapotranspiration',
    'wind_speed_10m_max',
  ].join(','),
};

export function buildUrl(lat, lng) {
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: FIELDS.current,
    hourly: FIELDS.hourly,
    daily: FIELDS.daily,
    forecast_days: '7', // Today's Farm plans a week ahead; the Weather screen shows the first three
    timezone: 'auto',
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

export function normalize(raw) {
  const d = raw.daily;
  const hour = raw.hourly || {};
  const currentHour = String(raw.current.time || '').slice(0, 13);
  const start = Math.max(0, (hour.time || []).findIndex((x) => String(x).startsWith(currentHour)));
  const next4Rain = (hour.precipitation_probability || []).slice(start, start + 4);
  const at = (key, i) => hour[key]?.[i] ?? null;
  return {
    current: {
      time: raw.current.time ?? null, // local time at the location (timezone=auto)
      temp: Math.round(raw.current.temperature_2m),
      temperatureC: raw.current.temperature_2m,
      relativeHumidity: raw.current.relative_humidity_2m,
      precip_mm: raw.current.precipitation,
      precipitationMm: raw.current.precipitation,
      windSpeedKph: raw.current.wind_speed_10m,
      windGustKph: raw.current.wind_gusts_10m,
      rainProbabilityNext4h: next4Rain.length ? Math.max(...next4Rain) : raw.daily.precipitation_probability_max[0],
      code: raw.current.weather_code,
    },
    daily: d.time.map((date, i) => ({
      date,
      code: d.weather_code[i],
      tmax: Math.round(d.temperature_2m_max[i]),
      tmin: Math.round(d.temperature_2m_min[i]),
      rain_prob: d.precipitation_probability_max[i],
      rain_mm: d.precipitation_sum[i],
      et0: d.et0_fao_evapotranspiration[i],
      wind_max: d.wind_speed_10m_max?.[i] ?? null,
    })),
    // Local hours, for spray windows on any forecast day (services/sprayAssessment.js).
    hourly: (hour.time || []).map((time, i) => ({
      time, temperatureC: at('temperature_2m', i), relativeHumidity: at('relative_humidity_2m', i),
      windSpeedKph: at('wind_speed_10m', i), windGustKph: at('wind_gusts_10m', i),
      rainProbability: at('precipitation_probability', i), precipitationMm: at('precipitation', i),
    })),
    attribution: 'Weather data by Open-Meteo.com',
  };
}

// Spray advice for the Weather screen: the same rules as Today's Farm (services/sprayAssessment.js),
// so the two screens can never disagree. The worst factor decides; its reason is the one shown.
export function advise(w) {
  const a = assessSprayConditions(w);
  const worstFactor = a.factors.find((f) => f.status === 'unsuitable') || a.factors.find((f) => f.status === 'caution');
  return {
    action: a.overall,
    reason: worstFactor?.reason || 'All readings in the good range.',
    bestWindow: a.bestWindow ? { from: a.bestWindow.from, to: a.bestWindow.to, hours: a.bestWindow.hours } : null,
  };
}

export async function getWeather(lat, lng, { fetchImpl = fetch, now = Date.now } = {}) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cache.get(key);
  const at = (t) => new Date(t).toISOString(); // when the data was fetched, so screens can say how old it is
  if (hit && now() - hit.at < TTL_MS) return { ...hit.data, stale: false, fetchedAt: at(hit.at) };

  try {
    const res = await fetchImpl(buildUrl(lat, lng), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const data = normalize(await res.json());
    data.advice = advise(data);
    const fetched = now();
    cache.set(key, { at: fetched, data });
    return { ...data, stale: false, fetchedAt: at(fetched) };
  } catch (err) {
    if (hit) return { ...hit.data, stale: true, fetchedAt: at(hit.at) }; // last known good
    throw err;
  }
}

export function _clearCache() {
  cache.clear();
}
