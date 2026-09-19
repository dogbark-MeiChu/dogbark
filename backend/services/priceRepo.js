import { MARKETS, CROPS, generatePrices } from '../db/seedData.js';

// Both repos return the same row shape:
// { market_code, market_name, district, lat, lng, date, modal, currency, unit, source, sample }
export function memoryRepo(now = Date.now) {
  const rows = (regionCode) => {
    const markets = new Map(MARKETS.filter((m) => m.region === regionCode).map((m) => [m.code, m]));
    return generatePrices(now()).filter((p) => markets.has(p.market)).map((p) => ({ ...p, m: markets.get(p.market) }));
  };
  return {
    async history(cropCode, regionCode) {
      return rows(regionCode).filter((p) => p.crop === cropCode).map(({ m, ...p }) => ({
        market_code: m.code, market_name: m.name, district: m.district, lat: m.lat, lng: m.lng, date: p.date,
        modal: p.modal, currency: p.currency, unit: p.unit, source: 'seed', sample: p.sample,
      }));
    },
    async crops(regionCode) {
      const seen = new Map();
      for (const p of rows(regionCode)) {
        const c = CROPS.find((x) => x.code === p.crop);
        const prev = seen.get(p.crop);
        seen.set(p.crop, { code: p.crop, name: c?.name || p.crop, latest: !prev || p.date > prev.latest ? p.date : prev.latest, sample: true });
      }
      return [...seen.values()];
    },
  };
}

export function pgRepo(pool) {
  return {
    // Every variety is returned; the price service compares one variety at a time.
    async history(cropCode, regionCode) {
      const { rows } = await pool.query(
        `SELECT m.code AS market_code, m.name AS market_name, m.district_name AS district,
                m.latitude::float8 AS lat, m.longitude::float8 AS lng,
                p.price_date::text AS date, p.modal_price::float8 AS modal, p.variety,
                p.currency_code AS currency, p.price_unit AS unit, p.source, p.is_sample AS sample
         FROM app.market_prices p
         JOIN app.markets m ON m.id = p.market_id AND m.active
         JOIN app.regions r ON r.id = m.region_id
         JOIN app.crops c ON c.id = p.crop_id
         -- Imported datasets can be historical. Do not filter relative to the
         -- server clock, so a valid older dataset remains visible.
         WHERE c.code = $1 AND r.code = $2
         ORDER BY m.code, p.price_date`,
        [cropCode, regionCode]);
      return rows;
    },
    /** Crops with prices in a region, with their newest price date. */
    async crops(regionCode) {
      const { rows } = await pool.query(
        `SELECT c.code, c.name, max(p.price_date)::text AS latest, bool_and(p.is_sample) AS sample
         FROM app.market_prices p
         JOIN app.markets m ON m.id = p.market_id AND m.active
         JOIN app.regions r ON r.id = m.region_id
         JOIN app.crops c ON c.id = p.crop_id AND c.active
         WHERE r.code = $1 GROUP BY c.code, c.name ORDER BY c.name`, [regionCode]);
      return rows;
    },
  };
}
