// Single source of demo data: used by the in-memory fallback AND by db/seed.js (writes to Postgres).
// All generated rows are flagged sample=true; real rows come from the Agmarknet job.
export const REGIONS = [
  { code: 'IN-UP-01', country: 'IN', name: 'Rampur, Uttar Pradesh', lat: 28.8, lng: 79.03 },
];

export const CROPS = [
  { code: 'rice', name: 'Rice', base: 2140 },
  { code: 'wheat', name: 'Wheat', base: 2275 },
  { code: 'onion', name: 'Onion', base: 1500 },
  { code: 'tomato', name: 'Tomato', base: 1800 },
];

// offset = price premium vs the home market; coordinates are approximate.
export const MARKETS = [
  { code: 'rampur', region: 'IN-UP-01', name: 'Rampur', district: 'Rampur', lat: 28.8, lng: 79.03, offset: 0 },
  { code: 'bareilly', region: 'IN-UP-01', name: 'Bareilly', district: 'Bareilly', lat: 28.37, lng: 79.43, offset: 0.09 },
  { code: 'moradabad', region: 'IN-UP-01', name: 'Moradabad', district: 'Moradabad', lat: 28.84, lng: 78.78, offset: 0.03 },
];

const DAY = 86400000;
export const isoDate = (t) => new Date(t).toISOString().slice(0, 10);

// Deterministic 7-day series that drifts upward, so the "wait" advice is demonstrable.
export function generatePrices(now = Date.now(), days = 7) {
  const rows = [];
  for (const c of CROPS) {
    for (const m of MARKETS) {
      for (let back = days - 1; back >= 0; back--) {
        const drift = 1 + 0.01 * (days - 1 - back);
        const wobble = 1 + 0.004 * Math.sin((c.code.length + m.code.length + back) * 1.7);
        const modal = Math.round(c.base * (1 + m.offset) * drift * wobble);
        rows.push({
          crop: c.code, market: m.code, date: isoDate(now - back * DAY),
          min: Math.round(modal * 0.96), max: Math.round(modal * 1.04), modal,
          currency: 'INR', unit: 'quintal', source: 'seed', sample: true,
        });
      }
    }
  }
  return rows;
}
