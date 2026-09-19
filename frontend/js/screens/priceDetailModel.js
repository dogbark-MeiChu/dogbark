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
