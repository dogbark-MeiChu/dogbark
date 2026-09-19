import { AppError } from '../middleware/errors.js';

// TruePrice v2 Evidence Engine. Calculates buyer and seller reputation summaries
// from completed deals, ratings, and admin-confirmed adverse outcomes.
//
// Principles (from TRUEPRICE_V2_VERIFICATION_ALIGNMENT1.md):
//  - Evidence bands, not trust scores: "new" vs "established", derived from verifiable data.
//  - Role-separated: same account has independent buyer and seller profiles.
//  - 30-day dedup: same counterparty contributes max 1 threshold transaction per 30 days.
//  - Demo exclusion: is_demo records never count toward reputation.
//  - Report neutrality: unresolved reports don't penalize; only admin-confirmed adverse outcomes.
//  - No forbidden labels: no "Credit Score", "KYC Verified", "Guaranteed", "Fraud-proof".

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

const ESTABLISHED_THRESHOLD = {
  completedDeals: 3,
  distinctCounterparties: 3,
  verifiedHandovers: 1,
  confirmedAdverseOutcomesLast90Days: 0,
};

function deriveBand(summary) {
  const t = ESTABLISHED_THRESHOLD;
  if (summary.completedDeals >= t.completedDeals
      && summary.distinctCounterparties >= t.distinctCounterparties
      && summary.verifiedHandovers >= t.verifiedHandovers
      && summary.confirmedAdverseOutcomesLast90Days === t.confirmedAdverseOutcomesLast90Days) {
    return 'established';
  }
  return 'new';
}

export function createReputationService({ pool }) {
  const q = (text, params) => pool.query(text, params);

  async function getReputation(userId, role) {
    if (role !== 'buyer' && role !== 'seller') {
      throw new AppError('VALIDATION_ERROR', 'Role must be buyer or seller.', { field: 'role' });
    }

    const roleCol = role === 'buyer' ? 'buyer_id' : 'seller_id';
    const counterpartyCol = role === 'buyer' ? 'seller_id' : 'buyer_id';

    // Completed deals (excluding demo posts)
    const dealsResult = await q(`
      SELECT d.id, d.${counterpartyCol} AS counterparty_id,
             d.completed_at, d.handover_verified_at
      FROM app.market_deals d
      LEFT JOIN app.market_listings l ON l.id = d.listing_id
      LEFT JOIN app.market_buy_requests br ON br.id = d.buy_request_id
      WHERE d.${roleCol} = $1
        AND d.status = 'completed'
        AND COALESCE(l.is_demo, br.is_demo, false) = false
      ORDER BY d.completed_at ASC
    `, [userId]);

    const deals = dealsResult.rows;
    const completedDeals = deals.length;

    // 30-day dedup for distinct counterparties: same counterparty contributes
    // at most 1 threshold transaction per 30-day window.
    const counterpartyLastCounted = new Map();
    let distinctCounterparties = 0;
    for (const deal of deals) {
      const cpId = deal.counterparty_id;
      const completedAt = new Date(deal.completed_at).getTime();
      const lastCounted = counterpartyLastCounted.get(cpId);
      if (lastCounted == null || completedAt - lastCounted >= THIRTY_DAYS_MS) {
        distinctCounterparties++;
        counterpartyLastCounted.set(cpId, completedAt);
      }
    }

    const verifiedHandovers = deals.filter(d => d.handover_verified_at != null).length;

    // Ratings received in this role
    const ratingsResult = await q(`
      SELECT r.stars FROM app.market_ratings r
      JOIN app.market_deals d ON d.id = r.deal_id
      LEFT JOIN app.market_listings l ON l.id = d.listing_id
      LEFT JOIN app.market_buy_requests br ON br.id = d.buy_request_id
      WHERE r.ratee_id = $1
        AND d.${roleCol} = $1
        AND COALESCE(l.is_demo, br.is_demo, false) = false
    `, [userId]);

    const ratings = ratingsResult.rows;
    const ratingsCount = ratings.length;
    const avgStars = ratingsCount > 0
      ? Math.round((ratings.reduce((s, r) => s + r.stars, 0) / ratingsCount) * 10) / 10
      : null;

    // Admin-confirmed adverse outcomes in last 90 days
    // Reports with status='actioned' where target is the user
    const adverseResult = await q(`
      SELECT count(*)::int AS n FROM app.market_reports
      WHERE target_type = 'user' AND target_id = $1
        AND status = 'actioned'
        AND created_at > now() - interval '90 days'
    `, [userId]);
    const confirmedAdverseOutcomesLast90Days = adverseResult.rows[0].n;

    // Account age (for display context, not for sorting)
    const accountResult = await q(`
      SELECT created_at FROM app.users WHERE id = $1
    `, [userId]);
    const memberSince = accountResult.rows[0]?.created_at ?? null;

    const summary = {
      completedDeals,
      distinctCounterparties,
      verifiedHandovers,
      ratingsCount,
      avgStars,
      confirmedAdverseOutcomesLast90Days,
      memberSince: memberSince ? new Date(memberSince).toISOString() : null,
    };

    return {
      userId,
      role,
      band: deriveBand(summary),
      summary,
      thresholds: ESTABLISHED_THRESHOLD,
    };
  }

  // Minimal evidence summary for embedding in listing/offer/deal views.
  // Returns just the band and sample counts, no PII or scoring.
  async function getEvidenceSummary(userId, role) {
    const rep = await getReputation(userId, role);
    return {
      band: rep.band,
      completedDeals: rep.summary.completedDeals,
      ratingsCount: rep.summary.ratingsCount,
      avgStars: rep.summary.avgStars,
    };
  }

  return { getReputation, getEvidenceSummary };
}
