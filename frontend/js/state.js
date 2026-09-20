// Placeholder until /api/auth/session exists (profile will supply village + lat/lng).
// Override with ?lat=&lng= for testing.
const q = new URLSearchParams(location.search);

export const LOCATIONS = [
  { name: 'Rampur, IN', lat: 28.8, lng: 79.03 },
  { name: 'Taichung, TW', lat: 24.14, lng: 120.67 },
  { name: 'Hanoi, VN', lat: 21.03, lng: 105.85 },
  { name: 'Dhaka, BD', lat: 23.81, lng: 90.41 },
];

const KEY = 'agrilink.weatherLoc'; // index into locations(), whose first entry is the member's region
function saved() {
  try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; }
}
let index = saved();
const override = q.get('lat') && q.get('lng')
  ? { name: `${Number(q.get('lat')).toFixed(1)}, ${Number(q.get('lng')).toFixed(1)}`, lat: Number(q.get('lat')), lng: Number(q.get('lng')) }
  : null;

// The member's own region comes first in the Weather location list when it has coordinates;
// the fixed list stays as a fallback and for demoing other places with *.
function locations() {
  const p = identity.profile;
  const home = p?.regionLat != null && p?.regionLng != null ? { name: p.regionName, lat: p.regionLat, lng: p.regionLng } : null;
  return home ? [home, ...LOCATIONS] : LOCATIONS;
}
function weatherLocations() { return override ? [override] : locations(); }
function saveIndex(value) {
  index = Math.max(0, Math.min(Number(value) || 0, weatherLocations().length - 1));
  try { localStorage.setItem(KEY, String(index)); } catch { /* private mode etc. */ }
}

export const user = {
  // The configured CEDA import lives in this Postgres region. Profile data will
  // replace these defaults once authentication/location matching is available.
  region: 'IN-CEDA-S9-D136',
  homeMarket: 'ceda-680',
  get locations() { return weatherLocations(); },
  get locationIndex() { return Math.min(index, weatherLocations().length - 1); },
  get location() { const list = weatherLocations(); return list[this.locationIndex]; },
  selectLocation(next) { saveIndex(next); return this.location; },
  nextLocation() {
    saveIndex((this.locationIndex + 1) % weatherLocations().length);
    return this.location;
  },
};

// Identity is server-authoritative. `profile` is only the currently rendered
// copy; the HTTP-only session cookie is the credential and never touches JS.
export const identity = { profile: null, options: null };

export const farmOps = {
  activeFarmId: null,
  activeFarm: null,
  // Set when a farm is chosen, from the farm's own timezone (the cloud browser's clock is not the farmer's).
  activeDate: new URLSearchParams(location.search).get('demoDate') || null,
  calendarView: 'agenda',
  focusedTaskId: null,
  marketIndex: 0, // which of the farm's crops the dashboard market row shows
};
