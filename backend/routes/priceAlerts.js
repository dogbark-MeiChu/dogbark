import express, { Router } from 'express';
import { sessionFromRequest } from './auth.js';
import { AppError, asyncHandler } from '../middleware/errors.js';
import { sameOriginWrites } from '../middleware/sameOrigin.js';
import { createPriceAlertService } from '../services/priceAlertService.js';

// /api/price-alerts — a member's price alerts (services/priceAlertService.js).
export function createPriceAlertRouter({ pool, auth, prices }) {
  const router = Router();
  const service = createPriceAlertService({ pool, prices });
  const json = express.json({ limit: '4kb' });
  router.use(sameOriginWrites);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(asyncHandler(async (req, _res, next) => {
    const token = sessionFromRequest(req);
    const user = token ? await auth.session(token) : null;
    if (!user) return next(new AppError('AUTH_REQUIRED', 'Sign in to use price alerts.'));
    req.user = user; next();
  }));
  const send = (fn, status = 200) => asyncHandler(async (req, res) => res.status(status).json({ ok: true, ...(await fn(req)) }));

  router.get('/', send((req) => service.list(req.user)));
  router.post('/', json, send((req) => service.create(req.user, req.body || {}), 201));
  router.post('/seen', send((req) => service.markSeen(req.user)));
  router.delete('/:id', send((req) => service.remove(req.user, req.params.id)));
  router.use((_req, _res, next) => next(new AppError('NOT_FOUND', 'Not found.')));
  return { router, service };
}
