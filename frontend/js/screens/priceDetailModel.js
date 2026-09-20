// Pure view-model helper so the legacy/fallback economics remain testable without a DOM.
// A C-confidence TruePrice response intentionally falls back to these factual rows instead
// of promoting an option; known transport must still be shown rather than labelled unknown.
export function legacyTransportModel(calc) {
  if (!calc?.transport_known || !Number.isFinite(Number(calc.transport_per_qt))) {
    return { kind: 'unknown', gainLabel: 'Gain before transport' };
  }
  if (calc.from_distance_km != null) {
    return {
      kind: 'extra_trip',
      distanceKm: calc.distance_km,
      fromDistanceKm: calc.from_distance_km,
      transportPerQt: Number(calc.transport_per_qt),
      gainLabel: 'Net gain',
    };
  }
  return {
    kind: 'trip',
    distanceKm: calc.distance_km,
    transportPerQt: Number(calc.transport_per_qt),
    gainLabel: 'Net gain',
  };
}

/** Query parameters that make every TruePrice assumption explicit and server-authoritative. */
export function truePriceAssumptionQuery(assumptions) {
  const q = new URLSearchParams({
    transportMode: assumptions.transportMode,
    channel: assumptions.channel,
    alreadyPacked: String(assumptions.alreadyPacked),
  });
  if (assumptions.transitDays != null) q.set('transitDays', String(assumptions.transitDays));
  return q.toString();
}

/** Every cost deducted from net must also have a visible row in the UI. */
export function truePriceCostTotals(economics, quantity) {
  const b = economics.breakdown;
  const qty = Number(quantity);
  return {
    transport: b.transport.total,
    commissionFee: (b.commission.perQt + b.marketFee.perQt) * qty,
    handlingPacking: (b.loading.perQt + b.weighing.perQt + b.packaging.perQt) * qty,
    spoilage: b.spoilage.perQt * qty,
  };
}
