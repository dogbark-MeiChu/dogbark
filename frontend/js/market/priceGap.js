// Pure price-gap maths for the trade confirm screen (no DOM, no fetch: unit-tested in backend/test).
// Mandi prices are per quintal (100 kg); a trade can be priced per kg, quintal or ton.

export const WARN_PCT = 10; // a gap this large is highlighted
const PER_QUINTAL = { kg: 100, quintal: 1, ton: 0.1 }; // price per unit × factor = price per quintal

/**
 * Compares a trade's unit price with the mandi price: { perQuintal, pct } where pct is how far the
 * trade price is above (+) or below (-) the mandi. null when the unit (bag, crate) cannot be
 * converted or the currencies differ.
 */
export function compare(terms, ref) {
  const factor = PER_QUINTAL[terms.unit];
  if (!ref || !factor || !ref.price || (ref.currency && terms.currency && ref.currency !== terms.currency)) return null;
  const perQuintal = Number(terms.unitPrice) * factor;
  return { perQuintal, pct: Math.round(((perQuintal - ref.price) / ref.price) * 100) };
}

/** Whether the gap works against this side of the trade: a seller paid below, a buyer paying above. */
export const againstMe = (role, pct) => (role === 'buyer' ? pct >= WARN_PCT : pct <= -WARN_PCT);
