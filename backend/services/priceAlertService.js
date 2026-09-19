import { AppError, validation } from '../middleware/errors.js';

// Price alerts: "tell me when rice reaches ₹2,600". The cloud checks them after every mandi sync
// (the phone can be off, which is the point on a handset that has to last days without power)
// and again whenever the member opens the app. An alert fires once; the farmer sees it on Home.
//
// The mandi watched is the one nearest the member's farm (else their profile region), the same
// one Home and the trade price check use. Sample (demo) prices never fire an alert.

const MAX_ACTIVE = 10;
const DIRECTIONS = ['above', 'below'];

const shape = (r) => ({
  id: r.id,
  crop: { code: r.crop_code, name: r.crop_name || r.crop_code },
  direction: r.direction,
  price: Number(r.threshold),
  currency: r.currency,
  status: r.status,
  createdAt: r.created_at,
  triggered: r.status === 'triggered' ? {
    price: Number(r.triggered_price), market: r.triggered_market, at: r.triggered_at,
    date: r.triggered_date instanceof Date ? r.triggered_date.toISOString().slice(0, 10) : r.triggered_date,
  } : null,
  seen: Boolean(r.seen_at),
});

export const reached = (direction, price, threshold) => (direction === 'above' ? price >= threshold : price <= threshold);

export function createPriceAlertService({ pool, prices }) {
  // The farm first (the member's first active farm), else the profile region.
  async function place(userId) {
    const farm = (await pool.query(`SELECT f.region_code, f.latitude::float8 lat, f.longitude::float8 lng
      FROM app.farms f JOIN app.farm_members m ON m.farm_id=f.id
      WHERE m.user_id=$1 AND m.status='active' AND f.status='active' AND f.region_code IS NOT NULL ORDER BY f.name LIMIT 1`, [userId]).catch(() => ({ rows: [] }))).rows[0];
    if (farm) return farm;
    const p = (await pool.query(`SELECT r.code region_code, r.latitude::float8 lat, r.longitude::float8 lng
      FROM app.user_profiles p JOIN app.regions r ON r.id=p.region_id WHERE p.user_id=$1`, [userId])).rows[0];
    if (!p) throw new AppError('VALIDATION_ERROR', 'Set your region in your profile first.');
    return p;
  }

  async function create(user, body = {}) {
    const crop = String(body.crop || '').toLowerCase();
    const direction = String(body.direction || '');
    const threshold = Number(body.price);
    if (!DIRECTIONS.includes(direction)) throw validation('Choose rises to or falls to.', 'direction');
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1e7) throw validation('Enter a price.', 'price');
    if (!(await pool.query('SELECT 1 FROM app.crops WHERE code=$1', [crop])).rowCount) throw validation('Unknown crop.', 'crop');
    const active = (await pool.query("SELECT count(*)::int n FROM app.price_alerts WHERE user_id=$1 AND status='active'", [user.id])).rows[0].n;
    if (active >= MAX_ACTIVE) throw validation(`You can have ${MAX_ACTIVE} price alerts at a time. Delete one first.`);
    const at = await place(user.id);
    const r = await pool.query(`INSERT INTO app.price_alerts(user_id,crop_code,region_code,latitude,longitude,direction,threshold)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [user.id, crop, at.region_code, at.lat, at.lng, direction, Math.round(threshold * 100) / 100]);
    await check({ userId: user.id }); // it may already be true
    return { item: (await list(user, { skipCheck: true })).items.find((a) => a.id === r.rows[0].id) };
  }

  /** Fires every active alert (of one member, or all) whose mandi price has reached it. Returns how many fired. */
  async function check({ userId = null } = {}) {
    const alerts = (await pool.query(`SELECT * FROM app.price_alerts WHERE status='active'${userId ? ' AND user_id=$1' : ''}`,
      userId ? [userId] : [])).rows;
    const byPlace = new Map();
    for (const a of alerts) {
      const key = [a.crop_code, a.region_code, a.latitude, a.longitude].join('|');
      if (!byPlace.has(key)) byPlace.set(key, []);
      byPlace.get(key).push(a);
    }
    let fired = 0;
    for (const group of byPlace.values()) {
      const a0 = group[0];
      let data = null;
      try { data = await prices.getPrices({ crop: a0.crop_code, region: a0.region_code, lat: a0.latitude ?? undefined, lng: a0.longitude ?? undefined }); } catch { /* try next sync */ }
      const m = data?.markets?.[0];
      if (!m || data.sample || m.sample) continue;
      for (const a of group) {
        if (!reached(a.direction, Number(m.price), Number(a.threshold))) continue;
        const r = await pool.query(`UPDATE app.price_alerts SET status='triggered', triggered_at=now(), triggered_price=$2,
          triggered_market=$3, triggered_date=$4 WHERE id=$1 AND status='active'`, [a.id, Math.round(m.price * 100) / 100, m.name, m.date || data.date]);
        fired += r.rowCount;
      }
    }
    return fired;
  }

  async function list(user, { skipCheck = false } = {}) {
    if (!skipCheck) await check({ userId: user.id });
    const r = await pool.query(`SELECT a.*, c.name crop_name FROM app.price_alerts a LEFT JOIN app.crops c ON c.code=a.crop_code
      WHERE a.user_id=$1 ORDER BY (a.status='triggered' AND a.seen_at IS NULL) DESC, a.created_at DESC`, [user.id]);
    return { items: r.rows.map(shape) };
  }

  async function remove(user, id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new AppError('NOT_FOUND', 'Alert not found.');
    const r = await pool.query('DELETE FROM app.price_alerts WHERE id=$1 AND user_id=$2', [id, user.id]);
    if (!r.rowCount) throw new AppError('NOT_FOUND', 'Alert not found.');
    return {};
  }

  async function markSeen(user) {
    await pool.query("UPDATE app.price_alerts SET seen_at=now() WHERE user_id=$1 AND status='triggered' AND seen_at IS NULL", [user.id]);
    return {};
  }

  return { create, check, list, remove, markSeen };
}
