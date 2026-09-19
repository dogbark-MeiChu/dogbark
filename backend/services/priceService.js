import { calculateBreakEven, calculateNetPrice, scorePriceConfidence } from './truePriceService.js';

const TRANSPORT_RS_PER_QT_KM = 1.5; // rough freight estimate (assumption, not measured); shown as approximate in the UI
const ROAD_FACTOR = 1.25;           // road distance vs straight line

export function distanceKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const RECENT_DAYS = 7; // a price change or comparison older than this is not "recent"
const dayGap = (a, b) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

// Factual trend only: prices are never turned into sell/wait advice.
export function analyze(series) {
  const last = series[series.length - 1];
  const first = series[0];
  const changePct = first ? Math.round(((last - first) / first) * 1000) / 10 : 0;
  const trend = changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'flat';
  return { trend, changePct, reason: `7-day price change: ${changePct >= 0 ? '+' : ''}${changePct}%. This is market data, not advice.` };
}

const hasPoint = (m) => m.lat != null && m.lng != null;

// Transport is only estimated when the places involved have coordinates; otherwise the gain is
// shown before transport rather than pretending the trip is free. With the member's location
// (`here`) both trips start from the member: the gain of taking the crop to `to` instead of the
// nearest mandi `from` is (to - trip to it) - (from - trip to it). Without it, the trip is
// from -> to (the older "sell here or move it there" view).
export function netProfit({ from, to, qty, here = null }) {
  const trip = (a, b) => distanceKm(a, b) * ROAD_FACTOR;
  const cost = (km) => Math.round(km * TRANSPORT_RS_PER_QT_KM);
  let known, km, fromKm = null, transport;
  if (here && hasPoint(here)) {
    known = hasPoint(from) && hasPoint(to);
    km = known ? trip(here, to) : null;
    fromKm = known ? trip(here, from) : null;
    transport = known ? cost(km) - cost(fromKm) : null;
  } else {
    known = hasPoint(from) && hasPoint(to);
    km = known ? trip(from, to) : null;
    transport = known ? cost(km) : null;
  }
  const gain = Math.round(to.price - from.price - (transport ?? 0));
  return {
    from: from.name, to: to.name, qty,
    price_from: from.price, price_to: to.price,
    distance_km: known ? Math.round(km) : null, from_distance_km: fromKm == null ? null : Math.round(fromKm),
    transport_per_qt: transport, transport_known: known,
    gain_per_qt: gain, gain_total: gain * qty,
    estimated: true,
  };
}

const MAX_MARKETS = 8;       // home + the nearest others: a 240x320 list, not a state-wide dump
const STALE_DAYS = 14;       // a mandi silent for longer than this is dropped from comparisons

/** 'IN-UP-MRT' -> 'IN-UP': a district's prices come from its state when it has none of its own. */
export const parentRegion = (code) => code.split('-').slice(0, 2).join('-');

export function createPriceService(repo) {
  // A mandi can report several varieties (UP rice: mostly "Common", one "Other" at 3x the price).
  // Only the variety most mandis reported recently is compared, so a basmati price never sits
  // next to common rice in a net-profit sum.
  function oneVariety(rows) {
    const newest = rows.reduce((d, r) => (r.date > d ? r.date : d), '');
    const markets = new Map();
    for (const r of rows) {
      if (dayGap(r.date, newest) > STALE_DAYS) continue;
      const v = r.variety ?? '';
      if (!markets.has(v)) markets.set(v, new Set());
      markets.get(v).add(r.market_code);
    }
    const [variety] = [...markets.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0] || [''];
    return { variety, rows: rows.filter((r) => (r.variety ?? '') === variety) };
  }

  async function load(crop, region) {
    const { variety, rows } = oneVariety(await repo.history(crop, region));
    const byMarket = new Map();
    byMarket.variety = variety;
    rows.sort((a, b) => a.date.localeCompare(b.date)); // oldest -> newest, independent of repo order
    for (const r of rows) {
      if (!byMarket.has(r.market_code)) byMarket.set(r.market_code, []);
      byMarket.get(r.market_code).push(r);
    }
    return byMarket;
  }

  // The member's own region first; its state when the region has no prices, or only sample ones
  // while the state has real data.
  async function resolve(crop, region) {
    const own = await load(crop, region);
    const parent = parentRegion(region);
    const onlySample = own.size && [...own.values()].every((rows) => rows.every((r) => r.sample));
    if (parent !== region && (!own.size || onlySample)) {
      const state = await load(crop, parent);
      if (state.size && (!own.size || [...state.values()].some((rows) => rows.some((r) => !r.sample)))) return { byMarket: state, region: parent };
    }
    return { byMarket: own, region };
  }

  // home = the `home` market code, else the market nearest to lat/lng, else the first one.
  async function getPrices({ crop, region, home, lat, lng }) {
    const resolved = await resolve(crop, region);
    const { byMarket } = resolved;
    if (!byMarket.size) return null;
    let markets = [...byMarket.values()].map((rows) => {
      const last = rows[rows.length - 1], prev = rows[rows.length - 2];
      return {
        code: last.market_code, name: last.market_name, lat: last.lat, lng: last.lng,
        price: last.modal, date: last.date, source: last.source, sample: last.sample,
        // Only against a recent previous price: a months-old one says nothing about today.
        change_pct: prev && dayGap(last.date, prev.date) <= RECENT_DAYS ? Math.round(((last.modal - prev.modal) / prev.modal) * 1000) / 10 : null,
        trend: rows.slice(-7).map((r) => r.modal),
      };
    });
    const newest = markets.reduce((d, m) => (m.date > d ? m.date : d), '');
    markets = markets.filter((m) => dayGap(m.date, newest) <= STALE_DAYS);
    markets.sort((a, b) => a.code.localeCompare(b.code)); // deterministic regardless of repo ordering
    const here = lat != null && lng != null ? { lat, lng } : null;
    const nearest = here && markets.filter(hasPoint).sort((a, b) => distanceKm(here, a) - distanceKm(here, b))[0];
    const homeMarket = markets.find((m) => m.code === home) || nearest || markets[0];
    // Distances are from the member when their location is known, else from the home mandi.
    const origin = here || homeMarket;
    for (const m of markets) {
      m.distance_km = hasPoint(origin) && hasPoint(m) ? Math.round(distanceKm(origin, m) * ROAD_FACTOR) : null;
      // Days between this market's latest price and the home market's: compared prices may not be from the same day.
      m.days_from_home = dayGap(m.date, homeMarket.date);
      m.confidence = scorePriceConfidence({
        updatedAt: `${m.date}T23:59:59+05:30`, source: m.source, sample: m.sample,
        observationCount: m.trend.length, varietyMatch: Boolean(byMarket.variety), modalPrice: m.price,
      });
    }
    // Home first, then by distance (unknown distances last, by name).
    markets.sort((a, b) => (a === homeMarket ? -1 : b === homeMarket ? 1
      : (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity) || a.name.localeCompare(b.name)));
    const homeRows = byMarket.get(homeMarket.code);
    const first = homeRows[0];
    // The average covers the last two weeks of the home market, not "the last 7 rows" of any age.
    const recent = homeRows.filter((r) => dayGap(r.date, homeMarket.date) <= 2 * RECENT_DAYS).map((r) => r.modal);
    return {
      crop, variety: byMarket.variety || null, region: resolved.region, currency: first.currency, unit: first.unit,
      home: homeMarket.code, date: homeMarket.date, newest,
      // How far "your area" really is from the member: the nearest mandi trading this crop today
      // may be in another district.
      home_from_you_km: here && hasPoint(homeMarket) ? Math.round(distanceKm(here, homeMarket) * ROAD_FACTOR) : null,
      source: homeMarket.source,
      sample: markets.some((m) => m.sample),
      markets: markets.slice(0, MAX_MARKETS), analysis: analyze(recent),
    };
  }

  async function getNetProfit({ crop, region, from, to, qty, lat, lng }) {
    const here = lat != null && lng != null ? { lat, lng } : null;
    const data = await getPrices({ crop, region, home: from, lat, lng });
    if (!data) return null;
    const a = data.markets.find((m) => m.code === from), b = data.markets.find((m) => m.code === to);
    if (!a || !b) return null;
    const legacy = netProfit({ from: a, to: b, qty, here });
    const economics = (market) => market.distance_km == null ? null : calculateNetPrice({
      marketPrice: market.price, quantity: qty, distanceKm: market.distance_km,
      transportMode: 'hired', transitDays: market.distance_km > 50 ? 1 : 0,
      crop, channel: 'mandi',
    });
    const localEconomics = economics(a);
    const destinationEconomics = economics(b);
    const ranked = [
      localEconomics && { market: a.name, marketCode: a.code, economics: localEconomics, confidence: a.confidence, updatedAt: a.date },
      destinationEconomics && { market: b.name, marketCode: b.code, economics: destinationEconomics, confidence: b.confidence, updatedAt: b.date },
    ].filter(Boolean).sort((x, y) => y.economics.estimatedNetPerQt - x.economics.estimatedNetPerQt);
    // A low-confidence source stays visible, but is never promoted as the preferred decision input.
    const eligible = ranked.filter((option) => option.confidence.decisionEligible);
    const highestNet = eligible[0] || null;
    const breakEven = highestNet ? calculateBreakEven({
      todayNetPerQt: highestNet.economics.estimatedNetPerQt, crop, quantity: qty, delayDays: 1,
    }) : null;
    return {
      ...legacy,
      currency: data.currency, unit: data.unit, sample: data.sample,
      price_date: data.date, source: data.source,
      from_date: a.date, to_date: b.date, same_day: a.date === b.date,
      truePrice: {
        options: ranked,
        highestNet,
        breakEven,
        transportKnown: legacy.transport_known,
        disclaimer: highestNet
          ? 'Estimated net income, not a guaranteed sale price. Check actual fees and quality at handover.'
          : 'Transport distance is unavailable, so no net-income recommendation is shown.',
      },
    };
  }

  /** Crops that have prices for the member (own region, else its state), newest first by date. */
  async function getCrops({ region }) {
    let list = await repo.crops(region);
    const parent = parentRegion(region);
    if (parent !== region && (!list.length || list.every((c) => c.sample))) {
      const state = await repo.crops(parent);
      if (state.some((c) => !c.sample)) list = state;
    }
    return { region, items: list.map(({ code, name, latest, sample }) => ({ code, name, latest, sample: Boolean(sample) })) };
  }

  return { getPrices, getNetProfit, getCrops };
}

const pct = (series) => series.length > 1 && series[0] ? Math.round(((series.at(-1) - series[0]) / series[0]) * 1000) / 10 : 0;

/**
 * Today's Farm prices, read from the same synced Agmarknet data as Market Prices (one source, the
 * same numbers on both screens): the mandi nearest the farm, the next ones with the gain of taking
 * the crop there instead (both trips from the farm), and the home mandi's recent prices. When the
 * farm's area has no synced prices, the latest stored snapshot (the demo seed) is returned as stale.
 */
export function createFarmPriceService({ prices, cache, now = () => new Date() }) {
  async function live(farm, crop) {
    const lat = farm.latitude == null ? undefined : Number(farm.latitude);
    const lng = farm.longitude == null ? undefined : Number(farm.longitude);
    const data = await prices.getPrices({ crop, region: farm.region_code || 'IN-UP', lat, lng });
    if (!data) return null;
    const [home, ...others] = data.markets;
    const here = lat != null && lng != null ? { lat, lng } : null;
    const nearby = others.slice(0, 5).map((m) => {
      const n = netProfit({ from: home, to: m, qty: 1, here });
      return { name: m.name, district: null, minPrice: null, maxPrice: null, modalPrice: m.price, date: m.date,
        distanceKm: m.distance_km, transportCostPerQt: n.transport_per_qt,
        netGainPerUnit: n.transport_known ? n.gain_per_qt : null };
    });
    return { farmId: farm.id, provider: 'agmarknet', crop, currency: data.currency, unit: data.unit,
      date: data.date, source: data.sample ? 'sample' : 'live', stale: false, fetchedAt: now().toISOString(),
      localMarket: { name: home.name, district: null, minPrice: null, maxPrice: null, modalPrice: home.price,
        distanceKm: data.home_from_you_km, isLocal: true },
      nearbyMarkets: nearby, sevenDayTrend: home.trend };
  }

  async function getFarmPrices(farm, crop = 'rice') {
    try {
      const out = await live(farm, crop);
      if (out) return out;
    } catch { /* fall back to the stored snapshot below */ }
    const fallback = await cache?.latest(farm.id, crop);
    return fallback ? { ...fallback, source: fallback.source === 'demo' ? 'demo' : 'cache', stale: true } : null;
  }
  return { getFarmPrices };
}

export function marketSnapshot(data) {
  if (!data?.localMarket) return null;
  const candidates = data.nearbyMarkets.filter((m) => m.netGainPerUnit != null).sort((a, b) => b.netGainPerUnit - a.netGainPerUnit);
  const best = candidates[0] || data.nearbyMarkets[0];
  return { crop: data.crop, localPrice: data.localMarket.modalPrice,
    bestNearbyPrice: best?.modalPrice ?? null, bestNearbyMarket: best?.name ?? null,
    netGainPerUnit: best?.netGainPerUnit ?? null, trend7d: `${pct(data.sevenDayTrend) >= 0 ? '+' : ''}${pct(data.sevenDayTrend)}%`,
    source: data.source, stale: data.stale, provider: data.provider, fetchedAt: data.fetchedAt, date: data.date ?? null };
}
