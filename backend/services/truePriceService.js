// TruePrice is deliberately deterministic. It explains costs and break-even thresholds;
// it does not forecast prices or decide whether a farmer should sell.

export const TRUE_PRICE_POLICY_VERSION = 1;

export const DEFAULT_COSTS = Object.freeze({
  transport: Object.freeze({ hiredPerKmPerQt: 1.8, ownPerKmPerQt: 0.6, minimumTotal: 50 }),
  mandi: Object.freeze({ commissionPct: 2.5, marketFeePct: 1, loadingPerQt: 8, weighingPerQt: 2 }),
  packaging: Object.freeze({ perQt: 15 }),
  spoilagePctPerDay: Object.freeze({ rice: 0.1, wheat: 0.05, onion: 0.8, tomato: 2, potato: 0.3 }),
  storage: Object.freeze({ perQtPerDay: 4, handlingPerQtPerDay: 10 }),
});

const finite = (value, name, { min = 0 } = {}) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) throw new TypeError(`${name} must be a number >= ${min}`);
  return number;
};
const round2 = (value) => Math.round(value * 100) / 100;

export function calculateNetPrice({
  marketPrice,
  quantity,
  distanceKm = 0,
  transportMode = 'hired',
  transitDays = 0,
  crop = 'rice',
  channel = 'mandi',
  alreadyPacked = false,
  costs = DEFAULT_COSTS,
}) {
  const grossPerQt = finite(marketPrice, 'marketPrice');
  const qty = finite(quantity, 'quantity', { min: Number.EPSILON });
  const distance = finite(distanceKm, 'distanceKm');
  const days = finite(transitDays, 'transitDays');
  if (!['hired', 'own', 'buyer_pickup'].includes(transportMode)) throw new TypeError('unknown transportMode');
  if (!['mandi', 'direct_buyer'].includes(channel)) throw new TypeError('unknown channel');

  const rate = transportMode === 'hired' ? costs.transport.hiredPerKmPerQt
    : transportMode === 'own' ? costs.transport.ownPerKmPerQt : 0;
  const transportTotal = rate === 0 || distance === 0 ? 0 : Math.max(rate * distance * qty, costs.transport.minimumTotal);
  const transportPerQt = transportTotal / qty;
  const commissionPerQt = channel === 'mandi' ? grossPerQt * costs.mandi.commissionPct / 100 : 0;
  const marketFeePerQt = channel === 'mandi' ? grossPerQt * costs.mandi.marketFeePct / 100 : 0;
  const loadingPerQt = costs.mandi.loadingPerQt;
  const weighingPerQt = costs.mandi.weighingPerQt;
  const packagingPerQt = alreadyPacked ? 0 : costs.packaging.perQt;
  const spoilagePct = (costs.spoilagePctPerDay[String(crop).toLowerCase()] ?? 0.1) * days;
  const spoilagePerQt = grossPerQt * spoilagePct / 100;
  const deductionsPerQt = transportPerQt + commissionPerQt + marketFeePerQt
    + loadingPerQt + weighingPerQt + packagingPerQt + spoilagePerQt;
  const netPerQt = grossPerQt - deductionsPerQt;

  return {
    policyVersion: TRUE_PRICE_POLICY_VERSION,
    channel,
    assumptions: { transportMode, distanceKm: distance, transitDays: days, alreadyPacked },
    grossPerQt: round2(grossPerQt),
    grossTotal: round2(grossPerQt * qty),
    estimatedCostsPerQt: round2(deductionsPerQt),
    estimatedCostsTotal: round2(deductionsPerQt * qty),
    estimatedNetPerQt: round2(netPerQt),
    totalEstimatedNet: round2(netPerQt * qty),
    breakdown: {
      transport: { perQt: round2(transportPerQt), total: round2(transportTotal) },
      commission: { perQt: round2(commissionPerQt), pct: channel === 'mandi' ? costs.mandi.commissionPct : 0 },
      marketFee: { perQt: round2(marketFeePerQt), pct: channel === 'mandi' ? costs.mandi.marketFeePct : 0 },
      loading: { perQt: round2(loadingPerQt) },
      weighing: { perQt: round2(weighingPerQt) },
      packaging: { perQt: round2(packagingPerQt) },
      spoilage: { perQt: round2(spoilagePerQt), pct: round2(spoilagePct), days },
    },
    disclaimer: 'Estimated costs only. Confirm local fees, transport and quality before selling.',
  };
}

export function calculateBreakEven({
  todayNetPerQt,
  crop = 'rice',
  quantity,
  delayDays = 1,
  storageCostPerQtPerDay = DEFAULT_COSTS.storage.perQtPerDay,
  costs = DEFAULT_COSTS,
}) {
  const today = finite(todayNetPerQt, 'todayNetPerQt');
  const qty = finite(quantity, 'quantity', { min: Number.EPSILON });
  const days = finite(delayDays, 'delayDays', { min: Number.EPSILON });
  const storage = finite(storageCostPerQtPerDay, 'storageCostPerQtPerDay') * days;
  const spoilagePct = (costs.spoilagePctPerDay[String(crop).toLowerCase()] ?? 0.1) * days;
  const spoilage = today * spoilagePct / 100;
  const handling = costs.storage.handlingPerQtPerDay * days;
  const delayCost = storage + spoilage + handling;
  return {
    policyVersion: TRUE_PRICE_POLICY_VERSION,
    todayNetPerQt: round2(today),
    delayDays: days,
    delayCosts: { storage: round2(storage), spoilage: round2(spoilage), handling: round2(handling), total: round2(delayCost) },
    breakEvenPerQt: round2(today + delayCost),
    breakEvenTotal: round2((today + delayCost) * qty),
    disclaimer: 'No price forecast. This is a cost threshold, not a prediction.',
  };
}

export function scorePriceConfidence({
  updatedAt,
  hoursOld,
  source,
  observationCount = 0,
  varietyMatch = false,
  minPrice,
  maxPrice,
  modalPrice,
  sample = false,
  now = Date.now(),
}) {
  const age = hoursOld == null
    ? Math.max(0, (now - Date.parse(updatedAt)) / 3600000)
    : finite(hoursOld, 'hoursOld');
  let score = age <= 6 ? 30 : age <= 24 ? 20 : age <= 72 ? 10 : 0;
  const reasons = [age <= 6 ? 'Updated within 6h' : age <= 24 ? 'Updated within 24h' : age <= 72 ? 'Updated within 3 days' : `Stale: ${Math.ceil(age / 24)} days old`];
  const official = ['agmarknet', 'ceda', 'data.gov.in'].includes(String(source).toLowerCase()) && !sample;
  score += official ? 25 : sample ? 0 : 5;
  reasons.push(official ? 'Official source' : sample ? 'Sample data' : 'Non-official source');
  const observations = Math.max(0, Number(observationCount) || 0);
  if (observations >= 10) { score += 20; reasons.push(`${observations} recent observations`); }
  else if (observations >= 5) { score += 15; reasons.push(`${observations} recent observations`); }
  else if (observations >= 1) { score += 10; reasons.push(`${observations} recent observations`); }
  else reasons.push('No recent observations');
  if (varietyMatch) { score += 15; reasons.push('Same variety'); }
  else reasons.push('Variety not confirmed');
  const min = Number(minPrice), max = Number(maxPrice), modal = Number(modalPrice);
  if (min > 0 && max >= min && modal > 0) {
    const spread = (max - min) / modal;
    if (spread < 0.05) { score += 10; reasons.push('Tight price range'); }
    else if (spread < 0.15) { score += 5; reasons.push('Moderate price range'); }
    else reasons.push('Wide price range');
  }
  // Seed/sample rows are useful for an offline walkthrough but are never "verified" evidence.
  const grade = sample ? 'C' : score >= 75 ? 'A' : score >= 45 ? 'B' : 'C';
  return { grade, score, label: grade === 'A' ? 'High' : grade === 'B' ? 'Medium' : 'Low', reasons, decisionEligible: grade !== 'C' };
}
