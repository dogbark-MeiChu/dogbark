import { getJSON } from '../api.js';
import { identity, user } from '../state.js';
import * as farmApi from '../farmOps/farmOpsApi.js';

export { compare, againstMe, WARN_PCT } from './priceGap.js';

// Checks a trade price against today's government mandi price, so a buyer who quotes far below
// the market (or a seller far above it) is visible before the farmer commits. Facts only: the
// screen shows the gap, it never says "do not sell".
//
// The reference mandi is the one nearest the member's farm (the same one Home shows), else the
// one nearest their profile region. Mandi prices are per quintal (100 kg).

const cache = new Map(); // crop -> { at, ref }
const TTL = 10 * 60 * 1000;

async function where() {
  try {
    const f = (await farmApi.farms()).items[0];
    if (f?.region_code) return { region: f.region_code, lat: f.latitude, lng: f.longitude };
  } catch { /* no farm or Today's Farm off: fall back to the profile */ }
  const p = identity.profile;
  return { region: p?.regionCode || user.region, lat: p?.regionLat, lng: p?.regionLng };
}

/** Today's nearest mandi price for `crop`: { price, currency, market, date, source, sample } or null. */
export async function mandiReference(crop) {
  const hit = cache.get(crop);
  if (hit && Date.now() - hit.at < TTL) return hit.ref;
  const { region, lat, lng } = await where();
  const at = lat != null && lng != null ? `&lat=${lat}&lng=${lng}` : '';
  let ref = null;
  try {
    const data = await getJSON(`/api/prices?crop=${encodeURIComponent(crop)}&region=${encodeURIComponent(region)}${at}`);
    const m = data?.markets?.[0];
    if (m) ref = { price: m.price, currency: data.currency, market: m.name, date: m.date || data.date, source: data.source, sample: data.sample };
  } catch { /* no prices for this crop here */ }
  cache.set(crop, { at: Date.now(), ref });
  return ref;
}
