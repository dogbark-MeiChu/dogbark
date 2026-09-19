// Spray conditions from weather numbers only (no AI): fixed thresholds per factor, the worst
// factor decides. Every factor that is not optimal says why, in words a farmer can act on.
const DISCLAIMER = 'Based on weather data only. Always follow product label instructions.';

export function calculateDeltaT(temperatureC, relativeHumidity) {
  const t = temperatureC, h = relativeHumidity;
  const wetBulb = t * Math.atan(0.151977 * Math.sqrt(h + 8.313659)) + Math.atan(t + h)
    - Math.atan(h - 1.676331) + 0.00391838 * h ** 1.5 * Math.atan(0.023101 * h) - 4.686035;
  return Math.round((t - wetBulb) * 10) / 10;
}

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// value -> [status, reason]; thresholds as before this file had reasons.
const RULES = {
  wind: (v) => (v > 15 ? ['unsuitable', 'Wind over 15 km/h: spray will drift. Do not spray.']
    : v > 10 ? ['caution', 'Wind 10–15 km/h: drift risk. Use coarse droplets.']
      : v < 3 ? ['caution', 'Almost no wind: spray can hang in the air and drift later (inversion).'] : ['optimal']),
  humidity: (v) => (v < 45 ? ['unsuitable', 'Very dry air: droplets evaporate before landing.']
    : v > 95 ? ['unsuitable', 'Air is saturated: leaves stay wet and product runs off.']
      : v < 60 ? ['caution', 'Dry air: some droplets evaporate.']
        : v > 85 ? ['caution', 'Humid air: leaves dry slowly.'] : ['optimal']),
  temperature: (v) => (v > 30 ? ['unsuitable', 'Above 30°C: product evaporates and is taken up poorly.']
    : v < 10 ? ['unsuitable', 'Below 10°C: plants take up product poorly.']
      : v > 25 ? ['caution', 'Above 25°C: spray in the cooler morning.'] : ['optimal']),
  deltaT: (v) => (v > 10 ? ['unsuitable', 'Delta-T over 10: droplets evaporate too fast.']
    : v > 8 ? ['caution', 'Delta-T 8–10: droplets evaporate fast.']
      : v < 2 ? ['caution', 'Delta-T under 2: droplets stay wet and drift further.'] : ['optimal']),
  rainRisk: (v) => (v > 25 ? ['unsuitable', 'Rain likely within 4 hours: product will wash off.']
    : v >= 15 ? ['caution', 'Rain possible within 4 hours: product may wash off.'] : ['optimal']),
  gusts: (v) => (v > 20 ? ['unsuitable', 'Gusts over 20 km/h: do not spray.']
    : v >= 15 ? ['caution', 'Gusts 15–20 km/h: watch for drift.'] : ['optimal']),
  precipitation: (v) => (v > 0.1 ? ['unsuitable', 'Raining: do not spray.'] : v > 0 ? ['caution', 'Light drizzle.'] : ['optimal']),
};
const UNITS = { wind: 'km/h', humidity: '%', temperature: '°C', deltaT: '°C', rainRisk: '%', gusts: 'km/h', precipitation: 'mm' };
const LABELS = { wind: 'wind', humidity: 'humidity', temperature: 'temperature', deltaT: 'delta-T', rainRisk: 'rain risk', gusts: 'gusts', precipitation: 'rain' };
const RANK = { optimal: 0, caution: 1, unsuitable: 2 };
const worst = (factors) => factors.reduce((w, f) => (RANK[f.status] > RANK[w] ? f.status : w), 'optimal');

/** Seven factors from one set of conditions; a missing reading is a caution, never a silent pass. */
function factorsFor({ wind, gusts, rain, temp, humidity, precip }) {
  const deltaT = temp != null && humidity != null ? calculateDeltaT(temp, humidity) : null;
  const values = { wind, humidity, temperature: temp, deltaT, rainRisk: rain, gusts: gusts ?? wind, precipitation: precip ?? 0 };
  return Object.entries(values).map(([param, value]) => {
    const [status, reason] = value == null ? ['caution', 'No data for this reading.'] : RULES[param](value);
    return { param, value, unit: UNITS[param], status, ...(reason ? { reason } : {}) };
  });
}

// Rain risk for an hour is the highest probability in it and the next three, like "next 4 hours" now.
function hourConditions(hourly, i) {
  const h = hourly[i];
  const next = hourly.slice(i, i + 4).map((x) => num(x.rainProbability)).filter((x) => x != null);
  return { wind: num(h.windSpeedKph), gusts: num(h.windGustKph), temp: num(h.temperatureC), humidity: num(h.relativeHumidity),
    precip: num(h.precipitationMm), rain: next.length ? Math.max(...next) : null };
}

const FIRST_HOUR = 6, LAST_HOUR = 18; // daylight spraying hours, farm local time
const hourOf = (time) => Number(String(time).slice(11, 13));
const hhmm = (h) => `${String(h).padStart(2, '0')}:00`;

/**
 * The longest run of daylight hours on `date` with no unsuitable factor (ties: more optimal hours,
 * then earlier), from `fromHour` on. null when no hour qualifies.
 */
export function bestSprayWindow(hourly, date, fromHour = FIRST_HOUR) {
  const hours = [];
  hourly.forEach((h, i) => {
    const hr = hourOf(h.time);
    if (String(h.time).startsWith(date) && hr >= Math.max(FIRST_HOUR, fromHour) && hr < LAST_HOUR) {
      const factors = factorsFor(hourConditions(hourly, i));
      hours.push({ hr, i, status: worst(factors), factors });
    }
  });
  let best = null, run = [];
  const close = () => {
    if (!run.length) return;
    const optimal = run.filter((h) => h.status === 'optimal').length;
    if (!best || run.length > best.run.length || (run.length === best.run.length && optimal > best.optimal)) best = { run, optimal };
    run = [];
  };
  for (const h of hours) {
    if (h.status === 'unsuitable' || (run.length && h.hr !== run[run.length - 1].hr + 1)) close();
    if (h.status !== 'unsuitable') run.push(h);
  }
  close();
  if (!best) return null;
  const { run: r } = best;
  // `watch` lists the factors (by param) that are only "caution" somewhere in the window, so the
  // handset can word it in the member's language; `reason` is the same in English.
  const watch = [...new Set(r.flatMap((h) => h.factors.filter((f) => f.status === 'caution').map((f) => f.param)))];
  return {
    from: hhmm(r[0].hr), to: hhmm(r[r.length - 1].hr + 1), hours: r.length, status: worst(r.flatMap((h) => h.factors)), watch,
    reason: watch.length ? `No unsuitable hour; watch ${watch.map((p) => LABELS[p]).join(', ')}.` : 'All readings in the good range.',
    startIndex: r[0].i,
  };
}

/**
 * Today (or no date): the conditions now, and the best window in the hours left today.
 * Another forecast day: the conditions at that day's best window (or at noon when there is none).
 * Returns null for a day the forecast does not cover.
 */
export function assessSprayConditions(weather, { date = null } = {}) {
  const current = weather?.current || {};
  const hourly = Array.isArray(weather?.hourly) && weather.hourly.length ? weather.hourly : null;
  const today = current.time ? String(current.time).slice(0, 10) : null;
  const strip = (w) => (w ? (({ startIndex, ...rest }) => rest)(w) : null);

  if (!date || !hourly || date === today) {
    const factors = factorsFor({
      wind: num(current.windSpeedKph ?? current.wind_speed) ?? 0,
      gusts: num(current.windGustKph ?? current.wind_gust),
      rain: num(current.rainProbabilityNext4h ?? current.rainProbability ?? weather?.daily?.[0]?.rainProbabilityMax ?? weather?.daily?.[0]?.rain_prob) ?? 0,
      temp: num(current.temperatureC ?? current.temp),
      humidity: num(current.relativeHumidity ?? current.humidity),
      precip: num(current.precipitationMm ?? current.precip_mm) ?? 0,
    });
    // Older stored snapshots have no hourly data; they carried their own (demo) window.
    const window = hourly && today ? bestSprayWindow(hourly, today, current.time ? hourOf(current.time) : FIRST_HOUR) : (weather?.bestSprayWindow || null);
    return { overall: worst(factors), basis: 'now', date: date || today, at: current.time ? String(current.time).slice(11, 16) : null,
      factors, bestWindow: strip(window), windowStart: window?.from ?? null, windowEnd: window?.to ?? null, disclaimer: DISCLAIMER };
  }

  if (!hourly.some((h) => String(h.time).startsWith(date))) return null;
  const window = bestSprayWindow(hourly, date);
  const noon = hourly.findIndex((h) => String(h.time).startsWith(`${date}T12`));
  const i = window ? window.startIndex : noon >= 0 ? noon : hourly.findIndex((h) => String(h.time).startsWith(date));
  const factors = factorsFor(hourConditions(hourly, i));
  return { overall: worst(factors), basis: 'forecast', date, at: String(hourly[i].time).slice(11, 16),
    factors, bestWindow: strip(window), windowStart: window?.from ?? null, windowEnd: window?.to ?? null, disclaimer: DISCLAIMER };
}

export { DISCLAIMER as SPRAY_DISCLAIMER };
