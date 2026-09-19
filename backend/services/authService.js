import crypto from 'node:crypto';

const PHONE_RE = /^\d{8,15}$/;
const PIN_RE = /^\d{6}$/;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

export function normalizePhone(value) {
  const phone = String(value ?? '').replace(/[\s()+-]/g, '');
  if (!PHONE_RE.test(phone)) throw coded('INVALID_PHONE', 'Enter an 8–15 digit phone number.');
  return phone;
}

export function validatePin(value) {
  const pin = String(value ?? '');
  if (!PIN_RE.test(pin)) throw coded('INVALID_PIN', 'PIN must be exactly 6 digits.');
  return pin;
}

export function coded(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function scrypt(value, salt = crypto.randomBytes(16).toString('base64url')) {
  return new Promise((resolve, reject) => crypto.scrypt(value, salt, 64, (err, key) => {
    if (err) reject(err); else resolve(`scrypt$${salt}$${key.toString('base64url')}`);
  }));
}

async function matchesPin(pin, stored) {
  const [algorithm, salt, encoded] = String(stored).split('$');
  if (algorithm !== 'scrypt' || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, 'base64url');
  const actual = await new Promise((resolve, reject) => crypto.scrypt(pin, salt, expected.length, (err, key) => err ? reject(err) : resolve(key)));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function config(env) {
  const pepper = env.AUTH_LOOKUP_SECRET;
  if (!pepper || pepper.length < 32) throw new Error('AUTH_LOOKUP_SECRET must be set to at least 32 random characters.');
  return { pepper, secureCookies: env.NODE_ENV === 'production' };
}

export function createAuthService(pool, env = process.env) {
  const { pepper, secureCookies } = config(env);
  const lookup = (phone) => hmac(pepper, normalizePhone(phone));

  async function makeSession(client, userId) {
    const id = crypto.randomUUID();
    const secret = crypto.randomBytes(32).toString('base64url');
    await client.query(
      `INSERT INTO app.auth_sessions (id, user_id, secret_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '30 days')`,
      [id, userId, digest(secret)],
    );
    return { token: `${id}.${secret}`, expiresAt: new Date(Date.now() + SESSION_TTL_MS) };
  }

  async function signup({ phone, pin, displayName, village, regionId, language = 'en', cropIds = [] }) {
    const cleanPhone = normalizePhone(phone);
    const cleanPin = validatePin(pin);
    const name = String(displayName ?? '').trim();
    const home = String(village ?? '').trim();
    if (!name || name.length > 60) throw coded('INVALID_NAME', 'Name must be 1–60 characters.');
    if (!home || home.length > 80) throw coded('INVALID_VILLAGE', 'Village must be 1–80 characters.');
    if (!['en', 'hi', 'bn', 'vi'].includes(language)) throw coded('INVALID_LANGUAGE', 'Choose a supported language.');
    if (!Array.isArray(cropIds) || cropIds.length > 12) throw coded('INVALID_CROPS', 'Choose up to 12 crops.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const region = await client.query('SELECT id FROM app.regions WHERE id=$1', [regionId]);
      if (!region.rowCount) throw coded('INVALID_REGION', 'Choose your region.');
      const existing = await client.query('SELECT 1 FROM app.auth_credentials WHERE login_hash=$1', [lookup(cleanPhone)]);
      if (existing.rowCount) throw coded('ACCOUNT_EXISTS', 'This phone number already has an account.', 409);
      const created = await client.query("INSERT INTO app.users DEFAULT VALUES RETURNING id, role, status");
      const user = created.rows[0];
      await client.query(
        `INSERT INTO app.auth_credentials (user_id, login_hash, pin_hash) VALUES ($1,$2,$3)`,
        [user.id, lookup(cleanPhone), await scrypt(cleanPin)],
      );
      await client.query(
        `INSERT INTO app.user_profiles (user_id, display_name, village, region_id, language)
         VALUES ($1,$2,$3,$4,$5)`, [user.id, name, home, regionId, language],
      );
      if (cropIds.length) {
        const valid = await client.query('SELECT id FROM app.crops WHERE active=true AND id = ANY($1::uuid[])', [cropIds]);
        if (valid.rowCount !== cropIds.length) throw coded('INVALID_CROPS', 'One or more selected crops are unavailable.');
        await client.query('INSERT INTO app.user_crops (user_id,crop_id) SELECT $1, unnest($2::uuid[])', [user.id, cropIds]);
      }
      const session = await makeSession(client, user.id);
      await client.query('COMMIT');
      return { user: await profileFor(pool, user.id), session };
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally { client.release(); }
  }

  async function login({ phone, pin }) {
    const cleanPin = validatePin(pin);
    const res = await pool.query(
      `SELECT u.id, u.status, c.pin_hash, c.failed_attempts, c.locked_until
       FROM app.auth_credentials c JOIN app.users u ON u.id=c.user_id WHERE c.login_hash=$1`, [lookup(phone)],
    );
    const row = res.rows[0];
    if (!row) throw coded('INVALID_LOGIN', 'Phone number or PIN is incorrect.', 401);
    if (row.status !== 'active') throw coded('ACCOUNT_UNAVAILABLE', 'This account is unavailable.', 403);
    if (row.locked_until && new Date(row.locked_until) > new Date()) throw coded('ACCOUNT_LOCKED', 'Try again in 15 minutes.', 429);
    if (!await matchesPin(cleanPin, row.pin_hash)) {
      const failures = Number(row.failed_attempts) + 1;
      await pool.query(
        `UPDATE app.auth_credentials SET failed_attempts=$2::smallint, locked_until=CASE WHEN $2::smallint >= $3::smallint THEN now() + interval '15 minutes' ELSE NULL END, updated_at=now() WHERE user_id=$1`,
        [row.id, failures, MAX_FAILURES],
      );
      throw coded('INVALID_LOGIN', failures >= MAX_FAILURES ? 'Too many attempts. Try again in 15 minutes.' : 'Phone number or PIN is incorrect.', failures >= MAX_FAILURES ? 429 : 401);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE app.auth_credentials SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1', [row.id]);
      await client.query('UPDATE app.users SET last_seen_at=now(), updated_at=now() WHERE id=$1', [row.id]);
      const session = await makeSession(client, row.id);
      await client.query('COMMIT');
      return { user: await profileFor(pool, row.id), session };
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  }

  async function session(token) {
    if (!token) return null;
    const [id, secret] = token.split('.');
    if (!id || !secret || !/^[0-9a-f-]{36}$/.test(id)) return null;
    const result = await pool.query(
      `SELECT s.user_id FROM app.auth_sessions s WHERE s.id=$1 AND s.secret_hash=$2
       AND s.revoked_at IS NULL AND s.expires_at > now()`, [id, digest(secret)],
    );
    if (!result.rowCount) return null;
    await pool.query('UPDATE app.auth_sessions SET last_seen_at=now() WHERE id=$1', [id]);
    return profileFor(pool, result.rows[0].user_id);
  }

  async function logout(token) {
    const id = String(token ?? '').split('.')[0];
    if (/^[0-9a-f-]{36}$/.test(id)) await pool.query('UPDATE app.auth_sessions SET revoked_at=now() WHERE id=$1', [id]);
  }

  // Lost or stolen phone: from the phone in hand, end every other session of this member.
  // The session making the request stays signed in. Returns how many were ended.
  async function logoutOthers(token) {
    const [id, secret] = String(token ?? '').split('.');
    if (!id || !secret || !/^[0-9a-f-]{36}$/.test(id)) return 0;
    const r = await pool.query(
      `UPDATE app.auth_sessions SET revoked_at=now()
       WHERE revoked_at IS NULL AND id<>$1
         AND user_id=(SELECT user_id FROM app.auth_sessions WHERE id=$1 AND secret_hash=$2 AND revoked_at IS NULL AND expires_at > now())`,
      [id, digest(secret)],
    );
    return r.rowCount;
  }

  async function profileFor(db, userId) {
    const result = await db.query(
      `SELECT u.id, u.role, u.status, p.display_name AS "displayName", p.village, p.region_id AS "regionId", r.name AS "regionName", p.language,
              r.code AS "regionCode", r.latitude::float8 AS "regionLat", r.longitude::float8 AS "regionLng",
              COALESCE(array_agg(uc.crop_id) FILTER (WHERE uc.crop_id IS NOT NULL), '{}') AS "cropIds",
              COALESCE(array_agg(c.code ORDER BY c.code) FILTER (WHERE c.code IS NOT NULL), '{}') AS "cropCodes"
       FROM app.users u JOIN app.user_profiles p ON p.user_id=u.id JOIN app.regions r ON r.id=p.region_id
       LEFT JOIN app.user_crops uc ON uc.user_id=u.id LEFT JOIN app.crops c ON c.id=uc.crop_id WHERE u.id=$1
       GROUP BY u.id, p.user_id, r.id`, [userId],
    );
    return result.rows[0] || null;
  }

  return { signup, login, session, logout, logoutOthers, profileFor, secureCookies };
}
