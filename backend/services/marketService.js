import crypto from 'node:crypto';
import { AppError, validation } from '../middleware/errors.js';
import { cleanBody } from './forumValidation.js';

// Local Market (docs/buysell_exchange.md). The database enforces row-level invariants (migration 006);
// this service owns who may do what and every state transition, each inside one transaction.
// Location never comes from the request IP: listings use the poster's profile region/coordinates.

const HOUR = 3600000;
const UNITS = ['kg', 'bag', 'crate', 'quintal', 'ton'];
const GRADES = ['A', 'B', 'C', 'not_graded'];
const PRICING = ['fixed', 'negotiable', 'request_offers'];
const LISTING_FULFILLMENT = ['pickup', 'seller_delivery', 'negotiable'];
const REQUEST_FULFILLMENT = ['buyer_pickup', 'seller_delivery', 'negotiable'];
const PAYMENT = ['cash_on_pickup', 'external_mobile_money', 'external_bank_transfer', 'pay_after_delivery'];
const REPORT_REASONS = ['spam', 'scam', 'prohibited_item', 'fake_price', 'harassment', 'no_show', 'other'];
const CURRENCY = { IN: 'INR', BD: 'BDT', VN: 'VND' };
const LIVE_DEAL = ['awaiting_confirmation', 'agreed', 'pickup_scheduled', 'handed_over'];
const OFFER_TTL_MS = 48 * HOUR;
const CODE_MAX_FAILURES = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (d) => (d instanceof Date ? d.toISOString() : d);
const num = (v) => (v == null ? null : Number(v));
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);
const notFound = (what) => new AppError('NOT_FOUND', `${what} not found.`);
const uuid = (v, what) => { if (typeof v !== 'string' || !UUID.test(v)) throw notFound(what); return v.toLowerCase(); };

// ---- input validation (small, explicit; nothing from the client is trusted for totals or ownership)
function number(v, field, { min = 0, max = 1e9, decimals = 2, positive = false } = {}) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw validation('Enter a number.', field);
  if (positive ? n <= 0 : n < min) throw validation(positive ? 'Must be more than 0.' : `Must be at least ${min}.`, field);
  if (n > max) throw validation('Number is too large.', field);
  if (Math.round(n * 10 ** decimals) / 10 ** decimals !== n) throw validation(`At most ${decimals} decimal places.`, field);
  return n;
}
function oneOf(v, list, field) {
  if (!list.includes(v)) throw validation(`Choose one of: ${list.join(', ')}.`, field);
  return v;
}
function day(v, field) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))
      || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) throw validation('Use a date like 2026-09-22.', field);
  return v;
}
function futureDay(v, field) {
  const d = day(v, field);
  if (Date.parse(`${d}T00:00:00Z`) < Date.now() - 36 * HOUR) throw validation('Date is in the past.', field);
  return d;
}
function clock(v, field) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw validation('Use a time like 09:00.', field);
  return v;
}
function window(start, end) {
  const s = clock(start, 'pickupWindowStart');
  const e = clock(end, 'pickupWindowEnd');
  if (s && e && e <= s) throw validation('Window must end after it starts.', 'pickupWindowEnd');
  return [s, e];
}
const note = (v) => (v == null || v === '' ? null : cleanBody(v, { field: 'note', min: 1, max: 160, paragraphs: 1 }));
const variety = (v) => (v == null || v === '' ? null : cleanBody(v, { field: 'variety', min: 1, max: 40, paragraphs: 1 }));
const requestId = (v) => {
  if (v == null) return null;
  if (typeof v !== 'string' || v.length < 8 || v.length > 80) throw validation('requestId must be 8–80 characters.', 'requestId');
  return v;
};
const hours = (v, dflt = 48) => (v == null ? dflt : number(v, 'expiresInHours', { min: 1, max: 168, decimals: 0 }));

// Haversine in SQL. $1/$2 are the viewer's latitude/longitude; either may be NULL (no distance).
const lat = (a) => `COALESCE(${a}.latitude, r.latitude)::float8`;
const lon = (a) => `COALESCE(${a}.longitude, r.longitude)::float8`;
const distanceSql = (a) => `CASE WHEN $1::float8 IS NULL OR $2::float8 IS NULL OR ${lat(a)} IS NULL OR ${lon(a)} IS NULL THEN NULL
  ELSE 2 * 6371 * asin(sqrt(power(sin(radians(${lat(a)} - $1::float8) / 2), 2)
     + cos(radians($1::float8)) * cos(radians(${lat(a)})) * power(sin(radians(${lon(a)} - $2::float8) / 2), 2))) END`;
// Public cards show an approximate distance only (never the coordinates).
const approxKm = (d) => (d == null ? null : Math.max(5, Math.ceil(d / 5) * 5));

const KINDS = {
  listing: {
    table: 'app.market_listings', owner: 'seller_id', done: 'sold_quantity', dateCol: 'available_date',
    fulfillment: LISTING_FULFILLMENT, allDone: 'sold', allReserved: 'reserved', offerCol: 'listing_id', label: 'Listing',
  },
  request: {
    table: 'app.market_buy_requests', owner: 'buyer_id', done: 'fulfilled_quantity', dateCol: 'needed_by',
    fulfillment: REQUEST_FULFILLMENT, allDone: 'matched', allReserved: 'matched', offerCol: 'buy_request_id', label: 'Buyer request',
  },
};

export function createMarketService({ pool, limiter, env = process.env, config = {}, reputation = null }) {
  const cfg = { listingsPerHour: 10, offersPerHour: 30, reportsPerDay: 10, ...config };
  const codeSecret = env.MARKET_CODE_SECRET || env.AUTH_LOOKUP_SECRET;
  if (!codeSecret || codeSecret.length < 32) throw new Error('MARKET_CODE_SECRET (or AUTH_LOOKUP_SECRET) must be at least 32 characters.');
  const q = (text, params) => pool.query(text, params);

  async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { client.release(); }
  }

  // The four-digit handover code is derived, never stored (see migration 006).
  const pickupCode = (dealId) =>
    String(crypto.createHmac('sha256', codeSecret).update(`pickup:${dealId}`).digest().readUInt32BE(0) % 10000).padStart(4, '0');

  const event = (c, entityType, entityId, actorId, type, payload = {}) => c.query(
    'INSERT INTO app.market_events (entity_type, entity_id, actor_id, event_type, payload) VALUES ($1,$2,$3,$4,$5)',
    [entityType, entityId, actorId, type, JSON.stringify(payload)]);

  async function notify(c, userId, type, payload, dedupeKey) {
    await c.query(
      `INSERT INTO app.notifications (user_id, type, payload, dedupe_key) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [userId, type, JSON.stringify(payload), dedupeKey]);
    await c.query('INSERT INTO app.outbox_events (topic, recipient_id, payload) VALUES ($1,$2,$3)',
      [`market.${payload.kind}`, userId, JSON.stringify(payload)]);
  }

  // Client retries carry a requestId; the first result wins.
  async function firstUse(c, user, rid, kind, id) {
    if (!rid) return null;
    const ins = await c.query(
      'INSERT INTO app.market_request_ids (user_id, request_id, kind, result_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING result_id',
      [user.id, rid, kind, id]);
    if (ins.rows.length) return null;
    const prior = (await c.query('SELECT kind, result_id FROM app.market_request_ids WHERE user_id=$1 AND request_id=$2', [user.id, rid])).rows[0];
    if (prior.kind !== kind) throw new AppError('DUPLICATE_REQUEST', 'This requestId was used for something else.');
    return prior.result_id;
  }

  async function origin(user) {
    const r = (await q(
      `SELECT COALESCE(p.latitude, r.latitude)::float8 AS lat, COALESCE(p.longitude, r.longitude)::float8 AS lon,
              r.id AS region_id, r.name AS region_name, r.country_code
       FROM app.user_profiles p JOIN app.regions r ON r.id = p.region_id WHERE p.user_id = $1`, [user.id])).rows[0];
    if (!r) throw new AppError('FORBIDDEN', 'Complete your profile first.');
    return r;
  }

  const isBlocked = async (c, a, b) => (await c.query(
    `SELECT 1 FROM app.market_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`, [a, b])).rows.length > 0;

  // ================= listings & buyer requests =================
  const CARD = (kind) => {
    const k = KINDS[kind];
    return `SELECT x.*, x.${k.dateCol}::text AS date_text, x.quantity - x.reserved_quantity - x.${k.done} AS available_quantity,
       c.code AS crop_code, c.name AS crop_name, r.code AS region_code, r.name AS region_name, r.country_code,
       up.display_name AS owner_name, ${distanceSql('x')} AS distance_km
     FROM ${k.table} x JOIN app.crops c ON c.id = x.crop_id JOIN app.regions r ON r.id = x.region_id
     JOIN app.user_profiles up ON up.user_id = x.${k.owner}`;
  };

  function card(kind, row, user) {
    const k = KINDS[kind];
    const out = {
      id: row.id, type: kind === 'listing' ? 'selling' : 'buying',
      crop: { code: row.crop_code, name: row.crop_name }, variety: row.variety,
      quantity: num(row.quantity), availableQuantity: num(row.available_quantity), unit: row.unit, currency: row.currency_code,
      fulfillment: row.fulfillment, status: row.status, expiresAt: iso(row.expires_at), createdAt: iso(row.created_at),
      isDemo: row.is_demo, isMine: row[k.owner] === user.id,
      owner: { id: row[k.owner], displayName: row.owner_name },
      location: { regionCode: row.region_code, label: row.public_location_label, approxDistanceKm: approxKm(row.distance_km) },
    };
    if (kind === 'listing') {
      Object.assign(out, { pricingMode: row.pricing_mode, askingPrice: num(row.asking_price), grade: row.grade, availableDate: row.date_text });
    } else {
      Object.assign(out, { desiredGrade: row.desired_grade, targetPriceMin: num(row.target_price_min), targetPriceMax: num(row.target_price_max), neededBy: row.date_text });
    }
    return out;
  }

  async function browse(kind, user, query) {
    const k = KINDS[kind];
    const me = await origin(user);
    const params = [me.lat, me.lon, user.id];
    const where = [`x.status IN ('open','partially_reserved')`, 'x.expires_at > now()',
      `NOT EXISTS (SELECT 1 FROM app.market_blocks b WHERE (b.blocker_id=$3 AND b.blocked_id=x.${k.owner}) OR (b.blocker_id=x.${k.owner} AND b.blocked_id=$3))`];
    const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    const radius = query.radiusKm != null && query.radiusKm !== '' ? number(query.radiusKm, 'radiusKm', { positive: true, max: 500, decimals: 0 }) : null;
    if (radius == null) {
      if (query.scope === 'country') add('r.country_code = ?', me.country_code);
      else add('x.region_id = ?', me.region_id); // default: my district
    } else add('r.country_code = ?', me.country_code);
    if (query.crop) add('c.code = ?', String(query.crop));
    if (query.fulfillment) add('x.fulfillment = ?', oneOf(query.fulfillment, k.fulfillment, 'fulfillment'));
    if (kind === 'listing') {
      if (query.minPrice != null) add('x.asking_price >= ?', number(query.minPrice, 'minPrice'));
      if (query.maxPrice != null) add('x.asking_price <= ?', number(query.maxPrice, 'maxPrice'));
    }
    if (query.readyBy) add(`x.${k.dateCol} <= ?::date`, day(query.readyBy, 'readyBy'));
    const order = {
      nearest: 'distance_km ASC NULLS LAST, created_at DESC',
      newest: 'created_at DESC',
      price: 'asking_price ASC NULLS LAST, created_at DESC',
      ready: `${k.dateCol} ASC, created_at DESC`,
    }[query.sort || (radius == null ? 'newest' : 'nearest')];
    if (!order || (query.sort === 'price' && kind !== 'listing')) throw validation('Unknown sort.', 'sort');
    const limit = query.limit == null ? 20 : number(query.limit, 'limit', { positive: true, max: 30, decimals: 0 });
    const offset = query.cursor == null ? 0 : number(query.cursor, 'cursor', { min: 0, max: 100000, decimals: 0 });
    if (radius != null) params.push(radius);
    const rows = (await q(
      `SELECT * FROM (${CARD(kind)} WHERE ${where.join(' AND ')}) t
       ${radius != null ? `WHERE t.distance_km <= $${params.length}` : ''}
       ORDER BY ${order} LIMIT ${limit + 1} OFFSET ${offset}`, params)).rows;
    return {
      items: rows.slice(0, limit).map((r) => card(kind, r, user)),
      nextCursor: rows.length > limit ? String(offset + limit) : null,
    };
  }

  async function detail(kind, user, id) {
    const k = KINDS[kind];
    id = uuid(id, k.label);
    const me = await origin(user);
    const row = (await q(`${CARD(kind)} WHERE x.id = $3`, [me.lat, me.lon, id])).rows[0];
    if (!row || (row.status === 'removed' && row[k.owner] !== user.id)) throw notFound(k.label);
    if (row[k.owner] !== user.id && await isBlocked(pool, user.id, row[k.owner])) throw notFound(k.label);
    const out = card(kind, row, user);
    if (out.isMine) {
      out.openOffers = (await q(
        `SELECT count(*)::int n FROM app.market_offers WHERE ${k.offerCol} = $1 AND status IN ('open','countered')`, [id])).rows[0].n;
    } else {
      out.myOfferId = (await q(
        `SELECT id FROM app.market_offers WHERE ${k.offerCol} = $1 AND proposer_id = $2 AND status IN ('open','countered')`,
        [id, user.id])).rows[0]?.id ?? null;
    }
    if (reputation) {
      const ownerRole = kind === 'listing' ? 'seller' : 'buyer';
      out.owner.evidence = await reputation.getEvidenceSummary(out.owner.id, ownerRole);
    }
    return { item: out };
  }

  async function createPost(kind, user, body) {
    const k = KINDS[kind];
    limiter.hit(`market:post:${user.id}`, cfg.listingsPerHour, HOUR, 'posts');
    const me = await origin(user);
    const crop = (await q('SELECT id FROM app.crops WHERE code = $1 AND active', [String(body.crop ?? '')])).rows[0];
    if (!crop) throw validation('Choose a crop.', 'crop');
    const quantity = number(body.quantity, 'quantity', { positive: true, max: 1e7, decimals: 3 });
    const unit = oneOf(body.unit, UNITS, 'unit');
    const fulfillment = oneOf(body.fulfillment, k.fulfillment, 'fulfillment');
    const currency = body.currency == null ? (CURRENCY[me.country_code] || 'USD') : body.currency;
    if (!/^[A-Z]{3}$/.test(currency)) throw validation('Use a 3-letter currency code.', 'currency');
    const rid = requestId(body.requestId);
    const expires = new Date(Date.now() + hours(body.expiresInHours) * HOUR);
    const id = crypto.randomUUID();
    const common = [id, user.id, crop.id, variety(body.variety), quantity, unit];
    const place = [currency, me.region_id, me.lat, me.lon, me.region_name, expires];
    return tx(async (c) => {
      const prior = await firstUse(c, user, rid, kind, id);
      if (prior) return { id: prior, duplicate: true };
      if (kind === 'listing') {
        const mode = oneOf(body.pricingMode, PRICING, 'pricingMode');
        const asking = body.askingPrice == null ? null : number(body.askingPrice, 'askingPrice', { max: 1e9 });
        if (mode !== 'request_offers' && asking == null) throw validation('Enter an asking price.', 'askingPrice');
        await c.query(
          `INSERT INTO app.market_listings (id, seller_id, crop_id, variety, quantity, unit, pricing_mode, asking_price, grade,
             available_date, fulfillment, currency_code, region_id, latitude, longitude, public_location_label, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [...common, mode, asking, oneOf(body.grade ?? 'not_graded', GRADES, 'grade'), futureDay(body.availableDate, 'availableDate'), fulfillment, ...place]);
      } else {
        const min = body.targetPriceMin == null ? null : number(body.targetPriceMin, 'targetPriceMin');
        const max = body.targetPriceMax == null ? null : number(body.targetPriceMax, 'targetPriceMax');
        if (min != null && max != null && max < min) throw validation('Max price must be at least the min price.', 'targetPriceMax');
        await c.query(
          `INSERT INTO app.market_buy_requests (id, buyer_id, crop_id, variety, quantity, unit, desired_grade, target_price_min,
             target_price_max, needed_by, fulfillment, currency_code, region_id, latitude, longitude, public_location_label, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [...common, oneOf(body.desiredGrade ?? 'not_specified', ['A', 'B', 'C', 'not_specified'], 'desiredGrade'), min, max,
            futureDay(body.neededBy, 'neededBy'), fulfillment, ...place]);
      }
      await event(c, kind === 'listing' ? 'listing' : 'buy_request', id, user.id, 'created', { quantity, unit });
      const evKind = kind === 'listing' ? 'listing.created' : 'buy_request.created';
      await c.query('INSERT INTO app.outbox_events (topic, region_id, payload) VALUES ($1,$2,$3)',
        [`market.${evKind}`, me.region_id, JSON.stringify({ kind: evKind, id, ownerId: user.id })]);
      return { id, duplicate: false };
    });
  }

  async function removePost(kind, user, id) {
    const k = KINDS[kind];
    id = uuid(id, k.label);
    return tx(async (c) => {
      const row = (await c.query(`SELECT * FROM ${k.table} WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!row || row[k.owner] !== user.id) throw notFound(k.label);
      if (row.status === 'removed') return { id };
      const live = await c.query(`SELECT 1 FROM app.market_deals WHERE ${k.offerCol}=$1 AND status = ANY($2)`, [id, LIVE_DEAL]);
      if (live.rows.length) throw new AppError('INVALID_STATE', 'Finish or cancel the deals on this post first.');
      await c.query(`UPDATE ${k.table} SET status='removed', updated_at=now() WHERE id=$1`, [id]);
      await c.query(`UPDATE app.market_offers SET status='expired', updated_at=now() WHERE ${k.offerCol}=$1 AND status IN ('open','countered')`, [id]);
      await event(c, kind === 'listing' ? 'listing' : 'buy_request', id, user.id, 'removed');
      return { id };
    });
  }

  // ================= offers =================
  const OFFER_SELECT = `
    SELECT o.*, rv.quantity AS rv_quantity, rv.unit_price AS rv_unit_price, rv.currency_code AS rv_currency,
           rv.pickup_date::text AS rv_pickup_date, rv.pickup_window_start AS rv_start, rv.pickup_window_end AS rv_end,
           rv.payment_method AS rv_payment, rv.note AS rv_note, rv.proposed_by AS rv_by,
           ROUND(rv.quantity * rv.unit_price, 2) AS rv_total,
           COALESCE(l.unit, br.unit) AS unit, c.code AS crop_code, c.name AS crop_name,
           pp.display_name AS proposer_name, rp.display_name AS recipient_name,
           (SELECT d.id FROM app.market_deals d WHERE d.offer_id = o.id) AS deal_id,
           COALESCE(l.is_demo, br.is_demo, false) AS on_demo_post
    FROM app.market_offers o
    JOIN app.market_offer_revisions rv ON rv.offer_id = o.id AND rv.revision_number = o.current_revision
    LEFT JOIN app.market_listings l ON l.id = o.listing_id
    LEFT JOIN app.market_buy_requests br ON br.id = o.buy_request_id
    JOIN app.crops c ON c.id = COALESCE(l.crop_id, br.crop_id)
    JOIN app.user_profiles pp ON pp.user_id = o.proposer_id
    JOIN app.user_profiles rp ON rp.user_id = o.recipient_id`;

  function offerView(row, user) {
    const mine = row.proposer_id === user.id;
    return {
      id: row.id, status: row.status, revision: row.current_revision, expiresAt: iso(row.expires_at), updatedAt: iso(row.updated_at),
      target: { type: row.listing_id ? 'listing' : 'buy_request', id: row.listing_id || row.buy_request_id },
      crop: { code: row.crop_code, name: row.crop_name },
      counterparty: { displayName: mine ? row.recipient_name : row.proposer_name },
      terms: {
        quantity: num(row.rv_quantity), unit: row.unit, unitPrice: num(row.rv_unit_price), currency: row.rv_currency,
        estimatedTotal: num(row.rv_total), pickupDate: row.rv_pickup_date,
        pickupWindowStart: hhmm(row.rv_start), pickupWindowEnd: hhmm(row.rv_end), paymentMethod: row.rv_payment, note: row.rv_note,
      },
      proposedByMe: row.rv_by === user.id,
      awaitingMyResponse: ['open', 'countered'].includes(row.status) && row.rv_by !== user.id,
      dealId: row.deal_id || null,
      onDemoPost: row.on_demo_post, // seeded post: its account is not monitored, so nobody will answer
    };
  }

  function offerTerms(body, target, kind) {
    const quantity = number(body.quantity, 'quantity', { positive: true, max: 1e7, decimals: 3 });
    const unitPrice = number(body.unitPrice, 'unitPrice', { max: 1e9 });
    const [ws, we] = window(body.pickupWindowStart, body.pickupWindowEnd);
    return {
      quantity, unitPrice, pickupDate: futureDay(body.pickupDate, 'pickupDate'), ws, we,
      payment: oneOf(body.paymentMethod, PAYMENT, 'paymentMethod'), note: note(body.note),
      // A fixed-price listing is take-it-or-leave-it: the offer must match the asking price.
      fixed: kind === 'listing' && target.pricing_mode === 'fixed' && unitPrice !== num(target.asking_price),
    };
  }

  const insertRevision = (c, offerId, n, by, t, currency) => c.query(
    `INSERT INTO app.market_offer_revisions (offer_id, revision_number, proposed_by, quantity, unit_price, currency_code,
       pickup_date, pickup_window_start, pickup_window_end, payment_method, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [offerId, n, by, t.quantity, t.unitPrice, currency, t.pickupDate, t.ws, t.we, t.payment, t.note]);

  const offerExpiry = (target) => new Date(Math.min(Date.now() + OFFER_TTL_MS, new Date(target.expires_at).getTime()));

  async function lockTarget(c, offer) {
    const kind = offer.listing_id ? 'listing' : 'request';
    const row = (await c.query(`SELECT * FROM ${KINDS[kind].table} WHERE id=$1 FOR UPDATE`, [offer.listing_id || offer.buy_request_id])).rows[0];
    return { kind, row };
  }

  const isOpenTarget = (row) => ['open', 'partially_reserved'].includes(row.status) && new Date(row.expires_at) > new Date();

  async function createOffer(user, kind, targetId, body) {
    const k = KINDS[kind];
    limiter.hit(`market:offer:${user.id}`, cfg.offersPerHour, HOUR, 'offers');
    targetId = uuid(targetId, k.label);
    const rid = requestId(body.requestId);
    const id = crypto.randomUUID();
    return tx(async (c) => {
      const prior = await firstUse(c, user, rid, 'offer', id);
      if (prior) return { id: prior, duplicate: true };
      const target = (await c.query(`SELECT * FROM ${k.table} WHERE id=$1 FOR SHARE`, [targetId])).rows[0];
      if (!target || target.status === 'removed') throw notFound(k.label);
      const ownerId = target[k.owner];
      if (ownerId === user.id) throw new AppError('FORBIDDEN', 'You cannot make an offer on your own post.');
      if (await isBlocked(c, user.id, ownerId)) throw notFound(k.label);
      if (!isOpenTarget(target)) throw new AppError('INVALID_STATE', 'This post is no longer open.');
      const t = offerTerms(body, target, kind);
      if (t.fixed) throw validation('This listing has a fixed price.', 'unitPrice');
      const available = num(target.quantity) - num(target.reserved_quantity) - num(target[k.done]);
      if (t.quantity > available + 1e-9) throw new AppError('QUANTITY_UNAVAILABLE', `Only ${available} ${target.unit} left.`, { field: 'quantity' });
      try {
        await c.query('SAVEPOINT offer');
        await c.query(
          `INSERT INTO app.market_offers (id, ${k.offerCol}, proposer_id, recipient_id, expires_at) VALUES ($1,$2,$3,$4,$5)`,
          [id, targetId, user.id, ownerId, offerExpiry(target)]);
      } catch (e) {
        if (e.code === '23505') { await c.query('ROLLBACK TO SAVEPOINT offer'); throw new AppError('CONFLICT', 'You already have an open offer here.'); }
        throw e;
      }
      await insertRevision(c, id, 1, user.id, t, target.currency_code);
      await event(c, 'offer', id, user.id, 'created', { target: targetId, quantity: t.quantity, unitPrice: t.unitPrice });
      await notify(c, ownerId, 'market_offer', { kind: 'offer.created', offerId: id }, `offer:${id}:1`);
      return { id, duplicate: false };
    });
  }

  // Locks the offer, checks the caller is a party and that the standing proposal is the other side's.
  async function respondable(c, user, offerId, what) {
    const offer = (await c.query('SELECT * FROM app.market_offers WHERE id=$1 FOR UPDATE', [uuid(offerId, 'Offer')])).rows[0];
    if (!offer || ![offer.proposer_id, offer.recipient_id].includes(user.id)) throw notFound('Offer');
    if (!['open', 'countered'].includes(offer.status)) throw new AppError('INVALID_STATE', `This offer is ${offer.status}.`);
    if (offer.expires_at && new Date(offer.expires_at) <= new Date()) throw new AppError('INVALID_STATE', 'This offer has expired.');
    const rev = (await c.query('SELECT * FROM app.market_offer_revisions WHERE offer_id=$1 AND revision_number=$2', [offer.id, offer.current_revision])).rows[0];
    if (what === 'other' && rev.proposed_by === user.id) throw new AppError('FORBIDDEN', 'Wait for the other side to respond to your proposal.');
    if (what === 'own' && rev.proposed_by !== user.id) throw new AppError('FORBIDDEN', 'Only the person who made the proposal can withdraw it.');
    return { offer, rev };
  }

  const otherParty = (offer, user) => (offer.proposer_id === user.id ? offer.recipient_id : offer.proposer_id);

  async function counter(user, offerId, body) {
    limiter.hit(`market:offer:${user.id}`, cfg.offersPerHour, HOUR, 'offers');
    return tx(async (c) => {
      const { offer } = await respondable(c, user, offerId, 'other');
      const { kind, row: target } = await lockTarget(c, offer);
      if (!isOpenTarget(target)) throw new AppError('INVALID_STATE', 'This post is no longer open.');
      const t = offerTerms(body, target, kind);
      if (t.fixed) throw validation('This listing has a fixed price.', 'unitPrice');
      const available = num(target.quantity) - num(target.reserved_quantity) - num(target[KINDS[kind].done]);
      if (t.quantity > available + 1e-9) throw new AppError('QUANTITY_UNAVAILABLE', `Only ${available} ${target.unit} left.`, { field: 'quantity' });
      const n = offer.current_revision + 1;
      await insertRevision(c, offer.id, n, user.id, t, target.currency_code);
      await c.query(`UPDATE app.market_offers SET current_revision=$2, status=$3, expires_at=$4, updated_at=now() WHERE id=$1`,
        [offer.id, n, user.id === offer.proposer_id ? 'open' : 'countered', offerExpiry(target)]);
      await event(c, 'offer', offer.id, user.id, 'countered', { revision: n, quantity: t.quantity, unitPrice: t.unitPrice });
      await notify(c, otherParty(offer, user), 'market_offer', { kind: 'offer.countered', offerId: offer.id, revision: n }, `offer:${offer.id}:${n}`);
      return { id: offer.id, revision: n };
    });
  }

  async function decline(user, offerId, why) {
    return tx(async (c) => {
      const { offer } = await respondable(c, user, offerId, 'other');
      await c.query(`UPDATE app.market_offers SET status='declined', updated_at=now() WHERE id=$1`, [offer.id]);
      await event(c, 'offer', offer.id, user.id, 'declined', { reason: note(why) });
      await notify(c, otherParty(offer, user), 'market_offer', { kind: 'offer.declined', offerId: offer.id }, `offer:${offer.id}:declined`);
      return { id: offer.id };
    });
  }

  async function withdraw(user, offerId) {
    return tx(async (c) => {
      const { offer } = await respondable(c, user, offerId, 'own');
      await c.query(`UPDATE app.market_offers SET status='withdrawn', updated_at=now() WHERE id=$1`, [offer.id]);
      await event(c, 'offer', offer.id, user.id, 'withdrawn');
      return { id: offer.id };
    });
  }

  // Moves reserved/done quantities on the listing or buy request and recomputes its status.
  async function adjust(c, deal, reserved, done) {
    const kind = deal.listing_id ? 'listing' : 'request';
    const k = KINDS[kind];
    await c.query(
      `UPDATE ${k.table} SET reserved_quantity = reserved_quantity + $2::numeric, ${k.done} = ${k.done} + $3::numeric, updated_at = now(),
         status = CASE WHEN status IN ('expired','removed') THEN status
           WHEN ${k.done} + $3::numeric >= quantity THEN '${k.allDone}'
           WHEN reserved_quantity + $2::numeric + ${k.done} + $3::numeric >= quantity THEN '${k.allReserved}'
           WHEN reserved_quantity + $2::numeric + ${k.done} + $3::numeric > 0 THEN 'partially_reserved'
           ELSE 'open' END
       WHERE id = $1`, [deal.listing_id || deal.buy_request_id, reserved, done]);
  }

  async function accept(user, offerId) {
    return tx(async (c) => {
      const { offer, rev } = await respondable(c, user, offerId, 'other');
      const { kind, row: target } = await lockTarget(c, offer);
      const k = KINDS[kind];
      if (!isOpenTarget(target)) throw new AppError('INVALID_STATE', 'This post is no longer open.');
      const available = num(target.quantity) - num(target.reserved_quantity) - num(target[k.done]);
      if (num(rev.quantity) > available + 1e-9) throw new AppError('QUANTITY_UNAVAILABLE', `Only ${available} ${target.unit} left.`);
      // On a listing the proposer is the buyer; on a buyer request the proposer is the seller.
      const buyerId = kind === 'listing' ? offer.proposer_id : offer.recipient_id;
      const sellerId = kind === 'listing' ? offer.recipient_id : offer.proposer_id;
      const dealId = crypto.randomUUID();
      const snapshot = {
        crop: (await c.query('SELECT code, name FROM app.crops WHERE id=$1', [target.crop_id])).rows[0],
        variety: target.variety, grade: target.grade ?? target.desired_grade, unit: target.unit, currency: rev.currency_code,
        quantity: num(rev.quantity), unitPrice: num(rev.unit_price), paymentMethod: rev.payment_method,
        pickupDate: (await c.query('SELECT $1::date::text AS d', [rev.pickup_date])).rows[0].d,
        pickupWindowStart: hhmm(rev.pickup_window_start), pickupWindowEnd: hhmm(rev.pickup_window_end),
        fulfillment: target.fulfillment, offerRevision: rev.revision_number,
      };
      await c.query(
        `INSERT INTO app.market_deals (id, offer_id, offer_revision_id, listing_id, buy_request_id, buyer_id, seller_id, quantity,
           unit_price, currency_code, estimated_total, terms_snapshot, pickup_date, pickup_window_start, pickup_window_end)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, ROUND($8::numeric * $9::numeric, 2), $11, $12,$13,$14)`,
        [dealId, offer.id, rev.id, offer.listing_id, offer.buy_request_id, buyerId, sellerId, rev.quantity, rev.unit_price,
          rev.currency_code, JSON.stringify(snapshot), rev.pickup_date, rev.pickup_window_start, rev.pickup_window_end]);
      await adjust(c, { listing_id: offer.listing_id, buy_request_id: offer.buy_request_id }, rev.quantity, 0);
      await c.query(`UPDATE app.market_offers SET status='accepted', updated_at=now() WHERE id=$1`, [offer.id]);
      await event(c, 'offer', offer.id, user.id, 'accepted', { dealId, revision: rev.revision_number });
      await event(c, 'deal', dealId, user.id, 'created', { offerId: offer.id });
      await notify(c, otherParty(offer, user), 'market_deal', { kind: 'deal.awaiting_confirmation', dealId, offerId: offer.id }, `deal:${dealId}:created`);
      return { dealId };
    });
  }

  async function listOffers(user, { role = 'incoming', cursor } = {}) {
    oneOf(role, ['incoming', 'outgoing'], 'role');
    const offset = cursor == null ? 0 : number(cursor, 'cursor', { min: 0, max: 100000, decimals: 0 });
    // incoming = waiting for me to respond; outgoing = my proposal is the standing one.
    const rows = (await q(
      `${OFFER_SELECT} WHERE (o.proposer_id = $1 OR o.recipient_id = $1) AND ${role === 'incoming' ? 'rv.proposed_by <> $1' : 'rv.proposed_by = $1'}
       ORDER BY o.updated_at DESC LIMIT 21 OFFSET ${offset}`, [user.id])).rows;
    return { items: rows.slice(0, 20).map((r) => offerView(r, user)), nextCursor: rows.length > 20 ? String(offset + 20) : null };
  }

  async function getOffer(user, id) {
    id = uuid(id, 'Offer');
    const row = (await q(`${OFFER_SELECT} WHERE o.id = $1 AND (o.proposer_id = $2 OR o.recipient_id = $2)`, [id, user.id])).rows[0];
    if (!row) throw notFound('Offer');
    const revisions = (await q(
      `SELECT revision_number, proposed_by, quantity, unit_price, pickup_date::text AS pickup_date, payment_method, note, created_at
       FROM app.market_offer_revisions WHERE offer_id = $1 ORDER BY revision_number`, [id])).rows;
    const item = offerView(row, user);
    if (reputation) {
      const cpId = row.proposer_id === user.id ? row.recipient_id : row.proposer_id;
      const cpRole = row.listing_id
        ? (row.proposer_id === user.id ? 'seller' : 'buyer')
        : (row.proposer_id === user.id ? 'buyer' : 'seller');
      item.counterparty.evidence = await reputation.getEvidenceSummary(cpId, cpRole);
    }
    return {
      item,
      revisions: revisions.map((r) => ({
        revision: r.revision_number, byMe: r.proposed_by === user.id, quantity: num(r.quantity), unitPrice: num(r.unit_price),
        pickupDate: r.pickup_date, paymentMethod: r.payment_method, note: r.note, createdAt: iso(r.created_at),
      })),
    };
  }

  // ================= deals =================
  const DEAL_SELECT = `
    SELECT d.*, d.pickup_date::text AS pickup_date_text, COALESCE(l.unit, br.unit) AS unit, c.code AS crop_code, c.name AS crop_name,
           bp.display_name AS buyer_name, sp.display_name AS seller_name,
           COALESCE((SELECT array_agg(r.rater_id) FROM app.market_ratings r WHERE r.deal_id = d.id), '{}') AS rated_by
    FROM app.market_deals d
    LEFT JOIN app.market_listings l ON l.id = d.listing_id
    LEFT JOIN app.market_buy_requests br ON br.id = d.buy_request_id
    JOIN app.crops c ON c.id = COALESCE(l.crop_id, br.crop_id)
    JOIN app.user_profiles bp ON bp.user_id = d.buyer_id
    JOIN app.user_profiles sp ON sp.user_id = d.seller_id`;

  function dealView(row, user) {
    const role = row.buyer_id === user.id ? 'buyer' : 'seller';
    const out = {
      id: row.id, status: row.status, role,
      crop: { code: row.crop_code, name: row.crop_name },
      counterparty: { displayName: role === 'buyer' ? row.seller_name : row.buyer_name },
      terms: { quantity: num(row.quantity), unit: row.unit, unitPrice: num(row.unit_price), currency: row.currency_code,
        estimatedTotal: num(row.estimated_total), paymentMethod: row.terms_snapshot?.paymentMethod },
      confirmedByMe: Boolean(role === 'buyer' ? row.buyer_confirmed_at : row.seller_confirmed_at),
      confirmedByOther: Boolean(role === 'buyer' ? row.seller_confirmed_at : row.buyer_confirmed_at),
      pickup: { date: row.pickup_date_text, windowStart: hhmm(row.pickup_window_start), windowEnd: hhmm(row.pickup_window_end),
        // Revealed only to the two parties, and only once both have confirmed the terms.
        location: ['awaiting_confirmation', 'cancelled'].includes(row.status) ? null : row.pickup_location_private },
      handoverVerified: Boolean(row.handover_verified_at), buyerReceived: Boolean(row.buyer_received_at),
      paymentStatus: row.seller_payment_status, cancelReason: row.cancel_reason, ratedByMe: (row.rated_by || []).includes(user.id),
      updatedAt: iso(row.updated_at), completedAt: iso(row.completed_at),
      disclosure: 'AgriLink connects buyers and sellers. It does not process payments, inspect goods, or guarantee quality or completion.',
    };
    if (role === 'buyer' && row.status === 'pickup_scheduled') out.pickupCode = pickupCode(row.id);
    return out;
  }

  async function lockDeal(c, user, id) {
    const deal = (await c.query('SELECT * FROM app.market_deals WHERE id=$1 FOR UPDATE', [uuid(id, 'Deal')])).rows[0];
    if (!deal || ![deal.buyer_id, deal.seller_id].includes(user.id)) throw notFound('Deal');
    return deal;
  }
  const mustBe = (deal, ...states) => {
    if (!states.includes(deal.status)) throw new AppError('INVALID_STATE', `This deal is ${deal.status.replace(/_/g, ' ')}.`);
  };

  async function confirm(user, id) {
    return tx(async (c) => {
      const deal = await lockDeal(c, user, id);
      mustBe(deal, 'awaiting_confirmation');
      const col = deal.buyer_id === user.id ? 'buyer_confirmed_at' : 'seller_confirmed_at';
      await c.query(`UPDATE app.market_deals SET ${col} = COALESCE(${col}, now()), updated_at = now() WHERE id = $1`, [deal.id]);
      const d = (await c.query('SELECT buyer_confirmed_at, seller_confirmed_at FROM app.market_deals WHERE id=$1', [deal.id])).rows[0];
      const agreed = Boolean(d.buyer_confirmed_at && d.seller_confirmed_at);
      if (agreed) await c.query(`UPDATE app.market_deals SET status='agreed' WHERE id=$1`, [deal.id]);
      await event(c, 'deal', deal.id, user.id, agreed ? 'agreed' : 'confirmed');
      await notify(c, deal.buyer_id === user.id ? deal.seller_id : deal.buyer_id, 'market_deal',
        { kind: agreed ? 'deal.agreed' : 'deal.awaiting_confirmation', dealId: deal.id }, `deal:${deal.id}:${agreed ? 'agreed' : `confirmed:${user.id}`}`);
      return { id: deal.id, status: agreed ? 'agreed' : 'awaiting_confirmation' };
    });
  }

  async function schedule(user, id, body) {
    const date = futureDay(body.pickupDate, 'pickupDate');
    const [ws, we] = window(body.pickupWindowStart, body.pickupWindowEnd);
    const place = cleanBody(body.location, { field: 'location', min: 3, max: 120, paragraphs: 1 });
    return tx(async (c) => {
      const deal = await lockDeal(c, user, id);
      mustBe(deal, 'agreed', 'pickup_scheduled');
      await c.query(
        `UPDATE app.market_deals SET status='pickup_scheduled', pickup_date=$2, pickup_window_start=$3, pickup_window_end=$4,
           pickup_location_private=$5, updated_at=now() WHERE id=$1`, [deal.id, date, ws, we, place]);
      await event(c, 'deal', deal.id, user.id, 'pickup_scheduled', { date });
      await notify(c, deal.buyer_id === user.id ? deal.seller_id : deal.buyer_id, 'market_deal',
        { kind: 'deal.pickup_scheduled', dealId: deal.id }, `deal:${deal.id}:pickup:${Date.now()}`);
      return { id: deal.id, status: 'pickup_scheduled' };
    });
  }

  async function verifyPickup(user, id, code) {
    if (typeof code !== 'string' || !/^\d{4}$/.test(code)) throw validation('Enter the 4-digit code.', 'code');
    const result = await tx(async (c) => {
      const deal = await lockDeal(c, user, id);
      if (deal.seller_id !== user.id) throw new AppError('FORBIDDEN', 'Only the seller enters the pickup code.');
      mustBe(deal, 'pickup_scheduled');
      if (deal.pickup_code_locked_until && new Date(deal.pickup_code_locked_until) > new Date()) {
        throw new AppError('PICKUP_LOCKED', 'Too many wrong codes. Try again later.', { retryable: true });
      }
      const expected = Buffer.from(pickupCode(deal.id));
      if (!crypto.timingSafeEqual(expected, Buffer.from(code))) {
        // All RHS values read the old row, so 5 failures lock for 15 minutes and reset the counter.
        await c.query(
          `UPDATE app.market_deals SET
             pickup_code_locked_until = CASE WHEN pickup_code_attempts + 1 >= ${CODE_MAX_FAILURES} THEN now() + interval '15 minutes' ELSE pickup_code_locked_until END,
             pickup_code_attempts = CASE WHEN pickup_code_attempts + 1 >= ${CODE_MAX_FAILURES} THEN 0 ELSE pickup_code_attempts + 1 END
           WHERE id = $1`, [deal.id]);
        await event(c, 'deal', deal.id, user.id, 'pickup_code_failed');
        return { bad: true }; // commit the counter, then report
      }
      await c.query(`UPDATE app.market_deals SET status='handed_over', handover_verified_at=now(), pickup_code_attempts=0,
        pickup_code_locked_until=NULL, updated_at=now() WHERE id=$1`, [deal.id]);
      await event(c, 'deal', deal.id, user.id, 'handover_verified');
      await notify(c, deal.buyer_id, 'market_deal', { kind: 'deal.handover_verified', dealId: deal.id }, `deal:${deal.id}:handover`);
      return { id: deal.id, status: 'handed_over' };
    });
    if (result.bad) throw validation('That code is not correct.', 'code');
    return result;
  }

  // Completion needs the buyer's "received" AND a seller payment status of received / not applicable.
  async function maybeComplete(c, deal) {
    const d = (await c.query('SELECT * FROM app.market_deals WHERE id=$1', [deal.id])).rows[0];
    if (d.status !== 'handed_over' || !d.buyer_received_at || !['received', 'not_applicable'].includes(d.seller_payment_status)) return d.status;
    await c.query(`UPDATE app.market_deals SET status='completed', completed_at=now(), updated_at=now() WHERE id=$1`, [d.id]);
    await adjust(c, d, -num(d.quantity), num(d.quantity));
    await event(c, 'deal', d.id, null, 'completed');
    await notify(c, d.buyer_id, 'market_deal', { kind: 'deal.completed', dealId: d.id }, `deal:${d.id}:completed`);
    await notify(c, d.seller_id, 'market_deal', { kind: 'deal.completed', dealId: d.id }, `deal:${d.id}:completed`);
    return 'completed';
  }

  async function received(user, id) {
    return tx(async (c) => {
      const deal = await lockDeal(c, user, id);
      if (deal.buyer_id !== user.id) throw new AppError('FORBIDDEN', 'Only the buyer marks goods received.');
      mustBe(deal, 'handed_over');
      await c.query('UPDATE app.market_deals SET buyer_received_at = COALESCE(buyer_received_at, now()), updated_at = now() WHERE id = $1', [deal.id]);
      await event(c, 'deal', deal.id, user.id, 'buyer_received');
      return { id: deal.id, status: await maybeComplete(c, deal) };
    });
  }

  async function paymentStatus(user, id, status) {
    oneOf(status, ['pending', 'received', 'not_applicable'], 'status');
    return tx(async (c) => {
      const deal = await lockDeal(c, user, id);
      if (deal.seller_id !== user.id) throw new AppError('FORBIDDEN', 'Only the seller records payment status.');
      mustBe(deal, 'handed_over');
      await c.query('UPDATE app.market_deals SET seller_payment_status=$2, seller_payment_updated_at=now(), updated_at=now() WHERE id=$1', [deal.id, status]);
      await event(c, 'deal', deal.id, user.id, 'payment_status', { status }); // records a claim only; no money moves here
      return { id: deal.id, status: await maybeComplete(c, deal) };
    });
  }

  async function cancel(user, id, reason) {
    const why = cleanBody(reason, { field: 'reason', min: 3, max: 160, paragraphs: 1 });
    return tx(async (c) => {
      const deal = await lockDeal(c, user, id);
      mustBe(deal, 'awaiting_confirmation', 'agreed', 'pickup_scheduled');
      await c.query(`UPDATE app.market_deals SET status='cancelled', cancelled_by=$2, cancel_reason=$3, updated_at=now() WHERE id=$1`, [deal.id, user.id, why]);
      await adjust(c, deal, -num(deal.quantity), 0); // release the reserved quantity
      await event(c, 'deal', deal.id, user.id, 'cancelled', { reason: why });
      await notify(c, deal.buyer_id === user.id ? deal.seller_id : deal.buyer_id, 'market_deal', { kind: 'deal.cancelled', dealId: deal.id }, `deal:${deal.id}:cancelled`);
      return { id: deal.id, status: 'cancelled' };
    });
  }

  async function rate(user, id, stars) {
    const s = number(stars, 'stars', { min: 1, max: 5, decimals: 0 });
    return tx(async (c) => {
      const deal = await lockDeal(c, user, id);
      mustBe(deal, 'completed');
      try {
        await c.query('SAVEPOINT rate');
        await c.query('INSERT INTO app.market_ratings (deal_id, rater_id, ratee_id, stars) VALUES ($1,$2,$3,$4)',
          [deal.id, user.id, deal.buyer_id === user.id ? deal.seller_id : deal.buyer_id, s]);
      } catch (e) {
        if (e.code === '23505') { await c.query('ROLLBACK TO SAVEPOINT rate'); throw new AppError('CONFLICT', 'You already rated this deal.'); }
        throw e;
      }
      return { id: deal.id };
    });
  }

  async function listDeals(user, { status, cursor } = {}) {
    const offset = cursor == null ? 0 : number(cursor, 'cursor', { min: 0, max: 100000, decimals: 0 });
    const params = [user.id];
    let filter = '';
    if (status) { params.push(oneOf(status, [...LIVE_DEAL, 'completed', 'cancelled', 'no_show', 'disputed'], 'status')); filter = 'AND d.status = $2'; }
    const rows = (await q(`${DEAL_SELECT} WHERE (d.buyer_id = $1 OR d.seller_id = $1) ${filter} ORDER BY d.updated_at DESC LIMIT 21 OFFSET ${offset}`, params)).rows;
    return { items: rows.slice(0, 20).map((r) => dealView(r, user)), nextCursor: rows.length > 20 ? String(offset + 20) : null };
  }

  async function getDeal(user, id) {
    id = uuid(id, 'Deal');
    const row = (await q(`${DEAL_SELECT} WHERE d.id = $1 AND (d.buyer_id = $2 OR d.seller_id = $2)`, [id, user.id])).rows[0];
    if (!row) throw notFound('Deal');
    const item = dealView(row, user);
    if (reputation) {
      const cpId = row.buyer_id === user.id ? row.seller_id : row.buyer_id;
      const cpRole = row.buyer_id === user.id ? 'seller' : 'buyer';
      item.counterparty.evidence = await reputation.getEvidenceSummary(cpId, cpRole);
    }
    return { item };
  }

  // ================= safety =================
  async function report(user, body) {
    limiter.hit(`market:report:${user.id}`, cfg.reportsPerDay, 24 * HOUR, 'reports');
    const type = oneOf(body.targetType, ['listing', 'buy_request', 'offer', 'deal', 'user'], 'targetType');
    const target = uuid(body.targetId, 'Target');
    const reason = oneOf(body.reason, REPORT_REASONS, 'reason');
    const details = body.details == null || body.details === '' ? null : cleanBody(body.details, { field: 'details', min: 1, max: 200, paragraphs: 1 });
    const visible = {
      listing: 'SELECT 1 FROM app.market_listings WHERE id=$1', buy_request: 'SELECT 1 FROM app.market_buy_requests WHERE id=$1',
      offer: 'SELECT 1 FROM app.market_offers WHERE id=$1 AND (proposer_id=$2 OR recipient_id=$2)',
      deal: 'SELECT 1 FROM app.market_deals WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)', user: 'SELECT 1 FROM app.users WHERE id=$1',
    }[type];
    const args = ['offer', 'deal'].includes(type) ? [target, user.id] : [target];
    if (!(await q(visible, args)).rows.length) throw notFound('Target');
    try {
      await q('INSERT INTO app.market_reports (reporter_id, target_type, target_id, reason_code, details) VALUES ($1,$2,$3,$4,$5)',
        [user.id, type, target, reason, details]);
    } catch (e) {
      if (e.code === '23505') throw new AppError('ALREADY_REPORTED', 'You already reported this.');
      throw e;
    }
    return {};
  }

  async function block(user, body) {
    const target = uuid(body.userId, 'User');
    if (target === user.id) throw validation('You cannot block yourself.', 'userId');
    if (!(await q('SELECT 1 FROM app.users WHERE id=$1', [target])).rows.length) throw notFound('User');
    await q('INSERT INTO app.market_blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [user.id, target]);
    return {};
  }

  // Outbox replay: a member's own offer/deal events plus new posts in their region (never their own, never
  // from blocked users). No cursor -> "start from now". The cursor is the last outbox id the client has seen.
  async function sync(user, since) {
    const me = await origin(user);
    if (since == null || since === '') {
      const top = (await q('SELECT COALESCE(MAX(id), 0)::text AS id FROM app.outbox_events')).rows[0].id;
      return { cursor: Number(top), events: [] };
    }
    const from = number(since, 'since', { min: 0, max: 9e15, decimals: 0 });
    const rows = (await q(
      `SELECT o.id::text AS id, o.topic, o.payload, o.created_at FROM app.outbox_events o
       WHERE o.id > $1 AND o.topic LIKE 'market.%'
         AND (o.recipient_id = $2
              OR (o.recipient_id IS NULL AND o.region_id = $3 AND COALESCE(o.payload->>'ownerId', '') <> $2::text
                  AND NOT EXISTS (SELECT 1 FROM app.market_blocks b
                                  WHERE (b.blocker_id = $2 AND b.blocked_id::text = o.payload->>'ownerId')
                                     OR (b.blocked_id = $2 AND b.blocker_id::text = o.payload->>'ownerId'))))
       ORDER BY o.id LIMIT 50`, [from, user.id, me.region_id])).rows;
    return {
      cursor: rows.length ? Number(rows[rows.length - 1].id) : from,
      events: rows.map((r) => ({
        id: Number(r.id), kind: r.payload.kind || r.topic.slice(7), at: iso(r.created_at),
        offerId: r.payload.offerId || null, dealId: r.payload.dealId || null, itemId: r.payload.id || null,
      })),
    };
  }

  // Idempotent housekeeping; safe to run on a timer. Never touches posts that have live deals.
  async function expireStale() {
    const l = await q(`UPDATE app.market_listings SET status='expired', updated_at=now() WHERE status IN ('open','partially_reserved') AND expires_at <= now()
      AND NOT EXISTS (SELECT 1 FROM app.market_deals d WHERE d.listing_id = market_listings.id AND d.status = ANY($1)) RETURNING id`, [LIVE_DEAL]);
    const r = await q(`UPDATE app.market_buy_requests SET status='expired', updated_at=now() WHERE status IN ('open','partially_reserved') AND expires_at <= now()
      AND NOT EXISTS (SELECT 1 FROM app.market_deals d WHERE d.buy_request_id = market_buy_requests.id AND d.status = ANY($1)) RETURNING id`, [LIVE_DEAL]);
    const o = await q(`UPDATE app.market_offers SET status='expired', updated_at=now() WHERE status IN ('open','countered') AND expires_at <= now() RETURNING id`);
    await q(`DELETE FROM app.outbox_events WHERE topic LIKE 'market.%' AND created_at < now() - interval '2 days'`);
    return { listings: l.rows.length, requests: r.rows.length, offers: o.rows.length };
  }

  return {
    browseListings: (u, query) => browse('listing', u, query), browseRequests: (u, query) => browse('request', u, query),
    getListing: (u, id) => detail('listing', u, id), getRequest: (u, id) => detail('request', u, id),
    createListing: (u, b) => createPost('listing', u, b), createRequest: (u, b) => createPost('request', u, b),
    removeListing: (u, id) => removePost('listing', u, id), removeRequest: (u, id) => removePost('request', u, id),
    offerOnListing: (u, id, b) => createOffer(u, 'listing', id, b), offerOnRequest: (u, id, b) => createOffer(u, 'request', id, b),
    listOffers, getOffer, counter, accept, decline, withdraw,
    listDeals, getDeal, confirm, schedule, verifyPickup, received, paymentStatus, cancel, rate,
    report, block, sync, expireStale, pickupCode,
  };
}
