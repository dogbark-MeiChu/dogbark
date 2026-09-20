// Read side: everything the operator needs to see before pressing a button. Purely SELECTs.
import { query } from './context.js';

export async function demoUsers() {
  const r = await query(
    `SELECT s.user_id AS id, p.display_name AS name, p.village, r.name AS region, r.code AS "regionCode"
     FROM app.forum_user_state s
     JOIN app.user_profiles p ON p.user_id = s.user_id
     JOIN app.regions r ON r.id = p.region_id
     WHERE s.demo_key IS NOT NULL
     ORDER BY p.display_name`);
  return r.rows;
}

export async function listings() {
  const r = await query(
    `SELECT l.id, c.code AS crop, c.name AS "cropName", p.display_name AS seller, l.seller_id AS "sellerId",
            l.quantity::float8, l.reserved_quantity::float8 AS reserved, l.sold_quantity::float8 AS sold,
            l.unit, l.pricing_mode AS "pricingMode", l.asking_price::float8 AS "askingPrice",
            l.currency_code AS currency, l.status, l.is_demo AS "isDemo", l.public_location_label AS "where",
            l.expires_at AS "expiresAt"
     FROM app.market_listings l
     JOIN app.crops c ON c.id = l.crop_id
     JOIN app.user_profiles p ON p.user_id = l.seller_id
     WHERE l.status IN ('open','partially_reserved','reserved')
     ORDER BY l.is_demo DESC, l.created_at DESC LIMIT 60`);
  return r.rows;
}

export async function buyRequests() {
  const r = await query(
    `SELECT b.id, c.code AS crop, c.name AS "cropName", p.display_name AS buyer, b.buyer_id AS "buyerId",
            b.quantity::float8, b.reserved_quantity::float8 AS reserved, b.unit,
            b.target_price_min::float8 AS "min", b.target_price_max::float8 AS "max",
            b.currency_code AS currency, b.status, b.is_demo AS "isDemo"
     FROM app.market_buy_requests b
     JOIN app.crops c ON c.id = b.crop_id
     JOIN app.user_profiles p ON p.user_id = b.buyer_id
     WHERE b.status IN ('open','partially_reserved')
     ORDER BY b.is_demo DESC, b.created_at DESC LIMIT 40`);
  return r.rows;
}

export async function offers() {
  const r = await query(
    `SELECT o.id, o.status, o.current_revision AS revision, o.updated_at AS "updatedAt",
            pp.display_name AS proposer, o.proposer_id AS "proposerId",
            rp.display_name AS recipient, o.recipient_id AS "recipientId",
            rv.proposed_by AS "lastMoveBy", rv.quantity::float8, rv.unit_price::float8 AS "unitPrice",
            rv.currency_code AS currency, rv.pickup_date::text AS "pickupDate", rv.payment_method AS payment,
            rv.note, c.code AS crop, c.name AS "cropName", COALESCE(l.unit, br.unit) AS unit,
            o.listing_id AS "listingId", o.buy_request_id AS "buyRequestId",
            (SELECT d.id FROM app.market_deals d WHERE d.offer_id = o.id) AS "dealId"
     FROM app.market_offers o
     JOIN app.market_offer_revisions rv ON rv.offer_id = o.id AND rv.revision_number = o.current_revision
     LEFT JOIN app.market_listings l ON l.id = o.listing_id
     LEFT JOIN app.market_buy_requests br ON br.id = o.buy_request_id
     JOIN app.crops c ON c.id = COALESCE(l.crop_id, br.crop_id)
     JOIN app.user_profiles pp ON pp.user_id = o.proposer_id
     JOIN app.user_profiles rp ON rp.user_id = o.recipient_id
     ORDER BY (o.status IN ('open','countered')) DESC, o.updated_at DESC LIMIT 40`);
  return r.rows.map((row) => ({
    ...row,
    // Whoever did not make the standing proposal is the one who can counter / accept / decline.
    responderId: row.lastMoveBy === row.proposerId ? row.recipientId : row.proposerId,
    responder: row.lastMoveBy === row.proposerId ? row.recipient : row.proposer,
  }));
}

export async function deals() {
  const r = await query(
    `SELECT d.id, d.status, d.quantity::float8, d.unit_price::float8 AS "unitPrice",
            d.estimated_total::float8 AS total, d.currency_code AS currency, d.pickup_date::text AS "pickupDate",
            bp.display_name AS buyer, d.buyer_id AS "buyerId", sp.display_name AS seller, d.seller_id AS "sellerId",
            d.buyer_confirmed_at AS "buyerConfirmedAt", d.seller_confirmed_at AS "sellerConfirmedAt",
            d.handover_verified_at AS "handoverAt", d.buyer_received_at AS "receivedAt",
            d.seller_payment_status AS "paymentStatus", d.updated_at AS "updatedAt"
     FROM app.market_deals d
     JOIN app.user_profiles bp ON bp.user_id = d.buyer_id
     JOIN app.user_profiles sp ON sp.user_id = d.seller_id
     ORDER BY d.updated_at DESC LIMIT 30`);
  return r.rows;
}

export async function crops() {
  const r = await query('SELECT code, name FROM app.crops WHERE active ORDER BY name');
  return r.rows;
}

/** Latest stored price per crop+market, which is what Market Prices and TruePrice read. */
export async function prices() {
  const r = await query(
    `SELECT DISTINCT ON (mp.crop_id, mp.market_id)
            mp.id, c.code AS crop, c.name AS "cropName", m.code AS "marketCode", m.name AS market,
            r.code AS "regionCode", r.name AS region, mp.variety, mp.price_date::text AS date,
            mp.modal_price::float8 AS modal, mp.min_price::float8 AS min, mp.max_price::float8 AS max,
            mp.currency_code AS currency, mp.price_unit AS unit, mp.source, mp.is_sample AS sample
     FROM app.market_prices mp
     JOIN app.markets m ON m.id = mp.market_id
     JOIN app.regions r ON r.id = m.region_id
     JOIN app.crops c ON c.id = mp.crop_id
     ORDER BY mp.crop_id, mp.market_id, mp.price_date DESC
     LIMIT 300`);
  return r.rows;
}

export async function regions() {
  const r = await query(
    `SELECT DISTINCT r.code, r.name FROM app.regions r
     JOIN app.markets m ON m.region_id = r.id ORDER BY r.name`);
  return r.rows;
}

export async function alerts() {
  const r = await query(
    `SELECT a.id, a.crop_code AS crop, a.region_code AS region, a.direction, a.threshold::float8,
            a.currency, a.status, a.triggered_price::float8 AS "triggeredPrice", a.triggered_market AS "triggeredMarket",
            a.triggered_at AS "triggeredAt", a.seen_at AS "seenAt", p.display_name AS "user", a.user_id AS "userId"
     FROM app.price_alerts a
     JOIN app.user_profiles p ON p.user_id = a.user_id
     ORDER BY a.created_at DESC LIMIT 40`);
  return r.rows;
}

export async function notifications() {
  const r = await query(
    `SELECT n.id, n.type, n.payload, n.read_at AS "readAt", n.created_at AS "createdAt", p.display_name AS "user"
     FROM app.notifications n
     JOIN app.user_profiles p ON p.user_id = n.user_id
     ORDER BY n.created_at DESC LIMIT 25`);
  return r.rows;
}

export async function snapshot() {
  const [users, ls, brs, os, ds, cs, ps, as, ns, rs] = await Promise.all([
    demoUsers(), listings(), buyRequests(), offers(), deals(), crops(), prices(), alerts(), notifications(), regions(),
  ]);
  return { users, listings: ls, buyRequests: brs, offers: os, deals: ds, crops: cs, prices: ps, alerts: as, notifications: ns, regions: rs };
}
