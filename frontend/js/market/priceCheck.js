import { getJSON } from '../api.js';
import { pricePlace, pointQuery } from '../place.js';

export { compare, againstMe, WARN_PCT } from './priceGap.js';

// Checks a trade price against today's government mandi price, so a buyer who quotes far below
// the market (or a seller far above it) is visible before the farmer commits. Facts only: the
// screen shows the gap, it never says "do not sell".
//
// The reference mandi is the one nearest the member's farm, else their profile region (place.js).
// Mandi prices are per quintal (100 kg).

const cache = new Map(); // crop -> { at, ref }
const TTL = 10 * 60 * 1000;

/** Today's nearest mandi price for `crop`: { price, currency, market, date, source, sample } or null. */
export async function mandiReference(crop) {
  const hit = cache.get(crop);
  if (hit && Date.now() - hit.at < TTL) return hit.ref;
  const pl = await pricePlace();
  const region = pl.region, at = pointQuery(pl);
  let ref = null;
  try {
    const data = await getJSON(`/api/prices?crop=${encodeURIComponent(crop)}&region=${encodeURIComponent(region)}${at}`);
    const m = data?.markets?.[0];
    if (m) ref = { price: m.price, currency: data.currency, market: m.name, date: m.date || data.date, source: data.source, sample: data.sample };
  } catch { /* no prices for this crop here */ }
  cache.set(crop, { at: Date.now(), ref });
  return ref;
}
