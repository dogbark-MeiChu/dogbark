import { identity, user } from './state.js';
import * as farmApi from './farmOps/farmOpsApi.js';

// Where prices are for: the member's farm (its region and point, so "your area" is the mandi
// nearest the farm), else their profile region. Home, Market Prices, Net Profit, the trade
// price check and price alerts all use this, so they always talk about the same mandi.
let cached = null; // { key, at, place }
const TTL = 5 * 60 * 1000;

const fromProfile = () => {
  const p = identity.profile;
  return { region: p?.regionCode || user.region, lat: p?.regionLat ?? null, lng: p?.regionLng ?? null };
};

/** { region, lat, lng } — lat/lng may be null. */
export async function pricePlace() {
  const key = identity.profile?.id || '';
  if (cached && cached.key === key && Date.now() - cached.at < TTL) return cached.place;
  let place = fromProfile();
  try {
    const f = (await farmApi.farms()).items.find((x) => x.region_code);
    if (f) place = { region: f.region_code, lat: f.latitude ?? null, lng: f.longitude ?? null };
  } catch { /* no farm, or Today's Farm off: the profile region */ }
  cached = { key, at: Date.now(), place };
  return place;
}

/** "&lat=..&lng=.." for price URLs, or '' without a point. */
export const pointQuery = (pl) => (pl?.lat != null && pl?.lng != null ? `&lat=${pl.lat}&lng=${pl.lng}` : '');
