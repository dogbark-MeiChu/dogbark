import { farmOps, identity, user } from './state.js';
import * as farmApi from './farmOps/farmOpsApi.js';
import { choosePriceFarm, placeFromFarm } from './pricePlaceModel.js';

// Where prices are for: the member's farm (its region and point, so "your area" is the mandi
// nearest the farm), else their profile region. Home, Market Prices, Net Profit, the trade
// price check and price alerts all use this, so they always talk about the same mandi.
let cached = null; // { key, at, place }
const TTL = 5 * 60 * 1000;

const fromProfile = () => {
  const p = identity.profile;
  const region = p?.regionCode || user.region;
  return {
    region,
    lat: p?.regionLat ?? null,
    lng: p?.regionLng ?? null,
    name: p?.regionName || region,
    basis: 'profile',
  };
};

/** { region, lat, lng } — lat/lng may be null. */
export async function pricePlace() {
  // The farm selected in Today's Farm is also the price location. If no farm has been selected,
  // use the first farm returned by the server (alphabetical by name) consistently across Home and
  // Market Prices. Including the active farm in the cache key makes a farm switch take effect now.
  const key = `${identity.profile?.id || ''}:${farmOps.activeFarmId || ''}`;
  if (cached && cached.key === key && Date.now() - cached.at < TTL) return cached.place;
  let place = fromProfile();
  try {
    const f = choosePriceFarm((await farmApi.farms()).items, farmOps.activeFarmId);
    if (f) place = placeFromFarm(f);
  } catch { /* no farm, or Today's Farm off: the profile region */ }
  cached = { key, at: Date.now(), place };
  return place;
}

/** "&lat=..&lng=.." for price URLs, or '' without a point. */
export const pointQuery = (pl) => (pl?.lat != null && pl?.lng != null ? `&lat=${pl.lat}&lng=${pl.lng}` : '');
