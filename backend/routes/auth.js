import express from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { coded } from '../services/authService.js';
import { AppError, errorHandler } from '../middleware/errors.js';

const COOKIE = 'agrilink_session';

function cookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split(/=(.*)/s)).filter(([key]) => key));
}

function setSession(res, session, secure) {
  res.cookie(COOKIE, session.token, { httpOnly: true, secure, sameSite: 'lax', path: '/', expires: session.expiresAt });
}

export function sessionFromRequest(req) { return cookies(req.headers.cookie)[COOKIE]; }

export function requireUser(auth) {
  return async (req, res, next) => {
    try {
      const user = await auth.session(sessionFromRequest(req));
      if (!user) throw coded('AUTH_REQUIRED', 'Sign in to continue.', 401);
      req.user = user;
      next();
    } catch (err) { next(err); }
  };
}

export function authRouter({ auth, pool }) {
  const router = express.Router();
  // These supplement the per-account PIN lock. All Cloud Phone handsets share CloudMosa's egress
  // IPs, so the real limit is per phone number; the per-IP cap stays only as a guard against one
  // source walking through many account numbers.
  const tooMany = (_req, _res, next) => next(new AppError('RATE_LIMITED', 'Try again in a few minutes.'));
  router.use('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false, handler: tooMany }));
  router.use('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: false, legacyHeaders: false, handler: tooMany,
    keyGenerator: (req) => {
      const phone = String(req.body?.phone ?? '').replace(/\D/g, '');
      return phone ? `phone:${phone}` : `ip:${ipKeyGenerator(req.ip)}`;
    },
  }));
  router.get('/options', async (_req, res, next) => {
    try {
      const [regions, crops] = await Promise.all([
        pool.query('SELECT id, code, name FROM app.regions ORDER BY name'),
        pool.query('SELECT id, code, name FROM app.crops WHERE active=true ORDER BY name'),
      ]);
      res.json({ ok: true, regions: regions.rows, crops: crops.rows });
    } catch (err) { next(err); }
  });
  router.post('/signup', async (req, res, next) => {
    try {
      const result = await auth.signup(req.body || {});
      setSession(res, result.session, auth.secureCookies);
      res.status(201).json({ ok: true, user: result.user });
    } catch (err) { next(err); }
  });
  router.post('/login', async (req, res, next) => {
    try {
      const result = await auth.login(req.body || {});
      setSession(res, result.session, auth.secureCookies);
      res.json({ ok: true, user: result.user });
    } catch (err) { next(err); }
  });
  router.get('/session', async (req, res, next) => {
    try { res.json({ ok: true, user: await auth.session(sessionFromRequest(req)) }); } catch (err) { next(err); }
  });
  router.post('/logout', async (req, res, next) => {
    try {
      await auth.logout(sessionFromRequest(req));
      res.clearCookie(COOKIE, { httpOnly: true, secure: auth.secureCookies, sameSite: 'lax', path: '/' });
      res.json({ ok: true });
    } catch (err) { next(err); }
  });
  router.post('/logout-others', requireUser(auth), async (req, res, next) => {
    try { res.json({ ok: true, ended: await auth.logoutOthers(sessionFromRequest(req)) }); } catch (err) { next(err); }
  });
  router.patch('/profile', requireUser(auth), async (req, res, next) => {
    try {
      const { displayName, village, language, regionId, cropIds } = req.body || {};
      if (!String(displayName ?? '').trim() || String(displayName).trim().length > 60) throw coded('INVALID_NAME', 'Name must be 1–60 characters.');
      if (!String(village ?? '').trim() || String(village).trim().length > 80) throw coded('INVALID_VILLAGE', 'Village must be 1–80 characters.');
      if (!['en', 'hi', 'bn', 'vi'].includes(language)) throw coded('INVALID_LANGUAGE', 'Choose a supported language.');
      const validRegion = await pool.query('SELECT 1 FROM app.regions WHERE id=$1', [regionId]);
      if (!validRegion.rowCount) throw coded('INVALID_REGION', 'Choose your region.');
      if (!Array.isArray(cropIds) || cropIds.length > 12) throw coded('INVALID_CROPS', 'Choose up to 12 crops.');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE app.user_profiles SET display_name=$2,village=$3,language=$4,region_id=$5,updated_at=now() WHERE user_id=$1', [req.user.id, String(displayName).trim(), String(village).trim(), language, regionId]);
        const validCrops = await client.query('SELECT id FROM app.crops WHERE active=true AND id=ANY($1::uuid[])', [cropIds]);
        if (validCrops.rowCount !== cropIds.length) throw coded('INVALID_CROPS', 'One or more selected crops are unavailable.');
        await client.query('DELETE FROM app.user_crops WHERE user_id=$1', [req.user.id]);
        if (cropIds.length) await client.query('INSERT INTO app.user_crops (user_id,crop_id) SELECT $1,unnest($2::uuid[])', [req.user.id, cropIds]);
        await client.query('COMMIT');
      } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
      res.json({ ok: true, user: await auth.profileFor(pool, req.user.id) });
    } catch (err) { next(err); }
  });
  router.use(errorHandler);
  return router;
}
