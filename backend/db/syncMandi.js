// Sync today's Agmarknet mandi prices from data.gov.in into app.markets / app.market_prices.
//   set -a; . ./.env; set +a; node db/syncMandi.js
// Runs every 30 minutes on the VM (deploy/agrilink-mandi-sync.timer). The shared sample key is
// often rate limited, so a run stops when it has waited long enough and the next run resumes:
// finished state x crop pairs are remembered for RESYNC_MS (mandis keep reporting during the day).
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPool } from './pool.js';
import { createMandiClient, mandiRow, RateLimited } from '../services/mandiClient.js';
import { createPriceAlertService } from '../services/priceAlertService.js';
import { createPriceService } from '../services/priceService.js';
import { pgRepo } from '../services/priceRepo.js';

// Uttar Pradesh: India's largest farm state and the densest Agmarknet reporting (on 2026-09-19:
// wheat 73 mandis, potato 24, rice 15, tomato 13, onion 11). Members pick one of its districts
// (migration 010); prices list the mandis nearest to them across the state.
export const STATES = { 'Uttar Pradesh': 'IN-UP' };
// data.gov.in commodity name -> our crop code and display name.
export const CROPS = {
  Rice: ['rice', 'Rice'], Wheat: ['wheat', 'Wheat'], Onion: ['onion', 'Onion'],
  Tomato: ['tomato', 'Tomato'], Potato: ['potato', 'Potato'],
};
const RESYNC_MS = 3 * 60 * 60_000;

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const marketCode = (r) => `agm-${slug(r.state)}-${slug(r.district)}-${slug(r.market)}`.slice(0, 80);
// "Shamli APMC" -> "Shamli": the suffix is on every row and costs a line on a 240 px screen.
export const marketName = (name) => name.replace(/\s+(APMC|Mandi|Market Yard|Market)$/i, '').trim() || name;

// "Farrukhābād District" and "Farukhabad" compare equal: no diacritics, no "district", no
// doubled letters (Agmarknet and the gazetteer spell names differently).
export const placeKey = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\bdistrict\b/g, '').replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');

// Uttar Pradesh districts as Agmarknet spells them (placeKey) -> the gazetteer's name.
export const DISTRICT_ALIASES = {
  bulandshahar: 'Bulandshahr', raebareli: 'Rae Bareli', badaun: 'Budaun', lakhimpur: 'Lakhimpur Kheri',
  khiri: 'Lakhimpur Kheri', kanpur: 'Kanpur Nagar', farukhabad: 'Farrukhabad', ambedkarnagar: 'Ambedkar Nagar',
};

/**
 * Open-Meteo geocoding (the Weather provider; no key), so transport can be estimated. A result
 * only counts when it lies in the market's own district: town names repeat across a state (UP has
 * several Gonda and Nawabganj), and a wrong point is worse than "transport unknown".
 */
export function createGeocoder({ fetchImpl = fetch } = {}) {
  async function lookup(name, state, district) {
    const q = new URLSearchParams({ name, count: '50', countryCode: 'IN', language: 'en', format: 'json' });
    const res = await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?${q}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const inDistrict = ((await res.json()).results || [])
      .filter((r) => placeKey(r.admin1) === placeKey(state) && placeKey(r.admin2) === placeKey(district));
    // The district seat first, then the largest place.
    const hit = inDistrict.find((r) => String(r.feature_code).startsWith('PPLA'))
      || inDistrict.sort((a, b) => (b.population || 0) - (a.population || 0))[0];
    return hit ? { lat: Math.round(hit.latitude * 1e5) / 1e5, lng: Math.round(hit.longitude * 1e5) / 1e5 } : null;
  }
  return async function geocode({ market, district, state }) {
    // Agmarknet district spellings the gazetteer does not use; both the query and the admin2 check
    // use the gazetteer's name.
    const place = DISTRICT_ALIASES[placeKey(district)] || district;
    for (const name of [place, market && marketName(market)].filter(Boolean)) {
      const point = await lookup(name, state, place);
      if (point) return point;
    }
    return null;
  };
}

async function readProgress(file, now) {
  try {
    const p = JSON.parse(await fs.readFile(file, 'utf8'));
    return Object.fromEntries(Object.entries(p.done || {}).filter(([, t]) => now - t < RESYNC_MS));
  } catch { return {}; }
}

/** Upserts one state x crop worth of API records. Returns the number of price rows written. */
export async function storeRows(pool, { stateName, regionCode, cropCode, cropName, records, geocode, log = () => {} }) {
  const rows = records.map(mandiRow).filter(Boolean);
  if (!rows.length) return 0;
  const db = await pool.connect();
  let count = 0;
  try {
    await db.query('BEGIN');
    await db.query(`INSERT INTO app.regions (code, country_code, name) VALUES ($1, 'IN', $2) ON CONFLICT (code) DO NOTHING`, [regionCode, stateName]);
    await db.query(`INSERT INTO app.crops (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`, [cropCode, cropName]);
    for (const r of rows) {
      const code = marketCode(r);
      await db.query(
        `INSERT INTO app.markets (region_id, code, name, district_name) SELECT id, $2, $3, $4 FROM app.regions WHERE code = $1
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, district_name = EXCLUDED.district_name`,
        [regionCode, code, marketName(r.market), r.district]);
      const result = await db.query(
        `INSERT INTO app.market_prices (market_id, crop_id, variety, price_date, min_price, max_price, modal_price, currency_code, price_unit, source, is_sample)
         SELECT m.id, c.id, $3, $4::date, $5, $6, $7, 'INR', 'quintal', 'agmarknet', false
         FROM app.markets m, app.crops c WHERE m.code = $1 AND c.code = $2
         ON CONFLICT (market_id, crop_id, variety, price_date) DO UPDATE SET
           min_price = EXCLUDED.min_price, max_price = EXCLUDED.max_price, modal_price = EXCLUDED.modal_price,
           source = EXCLUDED.source, is_sample = false, fetched_at = now()`,
        [code, cropCode, r.variety, r.date, r.min, r.max, r.modal]);
      count += result.rowCount;
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { db.release(); }

  // Coordinates outside the transaction: a slow or failed lookup never loses prices.
  if (geocode) {
    const missing = (await pool.query(
      `SELECT DISTINCT m.code FROM app.markets m WHERE m.latitude IS NULL AND m.code = ANY($1)`, [rows.map(marketCode)])).rows.map((x) => x.code);
    for (const code of missing) {
      const r = rows.find((x) => marketCode(x) === code);
      try {
        const point = await geocode({ market: r.market, district: r.district, state: r.state });
        if (point) await pool.query('UPDATE app.markets SET latitude = $2, longitude = $3 WHERE code = $1 AND latitude IS NULL', [code, point.lat, point.lng]);
      } catch (err) { log(`geocode ${r.district}: ${err.message}`); }
    }
  }
  return count;
}

export async function syncMandi({ pool, client, geocode, states = STATES, crops = CROPS, progressFile, now = Date.now(), log = console.log }) {
  const done = progressFile ? await readProgress(progressFile, now) : {};
  const save = () => (progressFile ? fs.mkdir(path.dirname(progressFile), { recursive: true }).then(() => fs.writeFile(progressFile, JSON.stringify({ done }))) : null);
  let written = 0, pairs = 0, complete = true;
  try {
    for (const [stateName, regionCode] of Object.entries(states)) {
      for (const [commodity, [cropCode, cropName]] of Object.entries(crops)) {
        const key = `${stateName}|${commodity}`;
        if (done[key]) continue;
        try {
          const records = await client.all({ state: stateName, commodity });
          written += await storeRows(pool, { stateName, regionCode, cropCode, cropName, records, geocode, log });
          pairs += 1;
          done[key] = now;
          await save();
          log(`${stateName} / ${commodity}: ${records.length} records`);
        } catch (err) {
          if (err instanceof RateLimited) throw err;
          complete = false;
          log(`${stateName} / ${commodity} failed: ${err.message}`); // retried on the next run
        }
      }
    }
  } catch (err) {
    if (!(err instanceof RateLimited)) throw err;
    complete = false;
    log('rate limited for too long; stopping, the next run resumes');
  }
  await save();
  return { written, pairs, complete };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool();
  if (!pool) throw new Error('DATABASE_URL is required.');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const client = createMandiClient({
    apiKey: process.env.MANDI_API_KEY || undefined,
    maxWaitMs: (Number(process.env.MANDI_MAX_WAIT_MIN) || 20) * 60_000,
    log: console.log,
  });
  try {
    const r = await syncMandi({ pool, client, geocode: createGeocoder(), progressFile: path.join(here, '..', 'tmp', 'mandi-sync-progress.json') });
    console.log(`mandi sync ${r.complete ? 'complete' : 'paused'}: ${r.pairs} state/crop pairs, ${r.written} price rows`);
    // New prices are in: fire the price alerts they reach (the farmer sees them on Home).
    try {
      const fired = await createPriceAlertService({ pool, prices: createPriceService(pgRepo(pool)) }).check();
      console.log(`price alerts: ${fired} fired`);
    } catch (err) { console.warn(`price alerts: not checked (${err.message})`); }
  } finally { await pool.end(); }
}
