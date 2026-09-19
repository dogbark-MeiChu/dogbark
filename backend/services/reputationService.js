import { AppError, validation } from '../middleware/errors.js';

export const REPUTATION_POLICY_VERSION = 1;
export const ADVERSE_OUTCOME_DATA_STATUS = 'not_available';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const safeId = (value) => {
  if (typeof value !== 'string' || !UUID.test(value)) throw new AppError('NOT_FOUND', 'User not found.');
  return value.toLowerCase();
};
const safeRole = (role) => {
  if (!['buyer', 'seller'].includes(role)) throw validation('Choose buyer or seller.', 'role');
  return role;
};

// Repeated trades remain visible in completedDeals, but the same two accounts can add at most
// one threshold deal in a rolling 30-day window. That makes a three-account ring harder to fake
// without hiding the account's actual history.
export function countQualifyingDeals(deals) {
  const lastByCounterparty = new Map();
  let count = 0;
  for (const deal of [...deals].sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))) {
    const at = new Date(deal.completedAt).getTime();
    const last = lastByCounterparty.get(deal.counterpartyId);
    if (last == null || at - last >= THIRTY_DAYS_MS) {
      count += 1;
      lastByCounterparty.set(deal.counterpartyId, at);
    }
  }
  return count;
}

export function deriveEvidenceBand(stats) {
  if (stats.restricted) return 'restricted';
  // P0 has no authoritative adjudication table. A null count is allowed only when the
  // response explicitly says that confirmed-outcome data is unavailable; once P1 enables
  // adjudication, a non-zero count blocks the established band.
  const adverseOutcomeGate = stats.confirmedAdverseOutcomes90d === 0
    || (stats.confirmedAdverseOutcomes90d == null && stats.adverseOutcomeDataStatus === ADVERSE_OUTCOME_DATA_STATUS);
  return stats.qualifyingDeals >= 3
    && stats.distinctCounterparties >= 3
    && stats.verifiedHandovers >= 1
    && adverseOutcomeGate ? 'established' : 'new';
}

export function buildEvidenceSummary({ role, deals = [], ratings = [], accountStatus = 'active' }) {
  role = safeRole(role);
  const completedDeals = deals.length;
  const stats = {
    role,
    reputationPolicyVersion: REPUTATION_POLICY_VERSION,
    band: 'new',
    completedDeals,
    qualifyingDeals: countQualifyingDeals(deals),
    distinctCounterparties: new Set(deals.map((d) => d.counterpartyId)).size,
    verifiedHandovers: deals.filter((d) => d.handoverVerified).length,
    ratingCount: ratings.length,
    averageRating: ratings.length >= 5
      ? Math.round((ratings.reduce((sum, n) => sum + Number(n), 0) / ratings.length) * 10) / 10
      : null,
    // market_reports contains allegations, not an immutable finding or responsible user.
    // Keep these values unknown until the P1 market_report_reviews workflow exists; never
    // turn an unreviewed report into a reputation penalty.
    adverseOutcomeDataStatus: ADVERSE_OUTCOME_DATA_STATUS,
    confirmedAdverseOutcomes90d: null,
    underReview: null,
    bandBasis: 'transaction_evidence_only',
    restricted: accountStatus !== 'active',
  };
  stats.band = deriveEvidenceBand(stats);
  stats.historyLabel = completedDeals === 0 ? 'No completed history yet'
    : `${completedDeals} completed ${role === 'buyer' ? 'purchase' : 'sale'}${completedDeals === 1 ? '' : 's'}`;
  return stats;
}

export function createReputationService({ pool }) {
  const q = (text, params) => pool.query(text, params);

  async function getForUser(userId, role) {
    userId = safeId(userId);
    role = safeRole(role);
    const account = (await q('SELECT status FROM app.users WHERE id=$1', [userId])).rows[0];
    if (!account) throw new AppError('NOT_FOUND', 'User not found.');
    const actor = role === 'buyer' ? 'buyer_id' : 'seller_id';
    const other = role === 'buyer' ? 'seller_id' : 'buyer_id';
    const rows = (await q(
      `SELECT d.id, d.${other} AS counterparty_id, d.completed_at, d.handover_verified_at
       FROM app.market_deals d
       LEFT JOIN app.market_listings l ON l.id=d.listing_id
       LEFT JOIN app.market_buy_requests br ON br.id=d.buy_request_id
       WHERE d.${actor}=$1 AND d.status='completed'
         AND NOT COALESCE(l.is_demo, br.is_demo, false)
       ORDER BY d.completed_at`, [userId])).rows;
    const ratingRows = (await q(
      `SELECT r.stars
       FROM app.market_ratings r
       JOIN app.market_deals d ON d.id=r.deal_id
       LEFT JOIN app.market_listings l ON l.id=d.listing_id
       LEFT JOIN app.market_buy_requests br ON br.id=d.buy_request_id
       WHERE r.ratee_id=$1 AND d.${actor}=$1 AND d.status='completed'
         AND NOT COALESCE(l.is_demo, br.is_demo, false)`, [userId])).rows;
    return buildEvidenceSummary({
      role,
      accountStatus: account.status,
      deals: rows.map((row) => ({
        counterpartyId: row.counterparty_id,
        completedAt: row.completed_at,
        handoverVerified: Boolean(row.handover_verified_at),
      })),
      ratings: ratingRows.map((row) => Number(row.stars)),
    });
  }

  const getBoth = async (userId) => ({
    buyer: await getForUser(userId, 'buyer'),
    seller: await getForUser(userId, 'seller'),
  });

  return { getForUser, getBoth };
}
