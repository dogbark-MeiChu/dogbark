import express, { Router } from 'express';
import { sessionFromRequest } from './auth.js';
import { AppError, asyncHandler } from '../middleware/errors.js';
import { sameOriginWrites } from '../middleware/sameOrigin.js';
import { limitByUser, createLimiter } from '../middleware/rateLimits.js';
import { createMarketService } from '../services/marketService.js';
import { createReputationService } from '../services/reputationService.js';

// Local Market API. Every route needs a signed-in member: listings are matched by the poster's
// profile region, never by request IP. Cookie identity comes from routes/auth.js.
export function createMarketRouter({ pool, auth, env = process.env, config }) {
  const limiter = createLimiter();
  const reputation = createReputationService({ pool });
  const market = createMarketService({ pool, limiter, env, config, reputation });
  const json = express.json({ limit: '8kb' });
  const router = Router();

  router.use(sameOriginWrites);
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(asyncHandler(async (req, _res, next) => {
    const token = sessionFromRequest(req);
    const profile = token ? await auth.session(token) : null;
    if (!profile) return next(new AppError('AUTH_REQUIRED', 'Sign in to use the market.'));
    if (profile.status === 'suspended' && req.method !== 'GET') return next(new AppError('ACCOUNT_SUSPENDED', 'This account is suspended.'));
    req.user = profile;
    next();
  }));
  router.use(limitByUser(limiter, 'market', 240, 60000, 'requests'));

  const send = (fn, status = 200) => asyncHandler(async (req, res) => {
    const out = await fn(req);
    res.status(typeof status === 'function' ? status(out) : status).json({ ok: true, ...out });
  });
  const created = (o) => (o.duplicate ? 200 : 201);

  router.get('/listings', send((req) => market.browseListings(req.user, req.query)));
  router.post('/listings', json, send((req) => market.createListing(req.user, req.body || {}), created));
  router.get('/listings/:id', send((req) => market.getListing(req.user, req.params.id)));
  router.delete('/listings/:id', send((req) => market.removeListing(req.user, req.params.id)));
  router.post('/listings/:id/offers', json, send((req) => market.offerOnListing(req.user, req.params.id, req.body || {}), created));

  router.get('/buy-requests', send((req) => market.browseRequests(req.user, req.query)));
  router.post('/buy-requests', json, send((req) => market.createRequest(req.user, req.body || {}), created));
  router.get('/buy-requests/:id', send((req) => market.getRequest(req.user, req.params.id)));
  router.delete('/buy-requests/:id', send((req) => market.removeRequest(req.user, req.params.id)));
  router.post('/buy-requests/:id/offers', json, send((req) => market.offerOnRequest(req.user, req.params.id, req.body || {}), created));

  router.get('/offers', send((req) => market.listOffers(req.user, req.query)));
  router.get('/offers/:id', send((req) => market.getOffer(req.user, req.params.id)));
  router.post('/offers/:id/counter', json, send((req) => market.counter(req.user, req.params.id, req.body || {}), 201));
  router.post('/offers/:id/accept', send((req) => market.accept(req.user, req.params.id)));
  router.post('/offers/:id/decline', json, send((req) => market.decline(req.user, req.params.id, req.body?.reason)));
  router.post('/offers/:id/withdraw', send((req) => market.withdraw(req.user, req.params.id)));

  router.get('/deals', send((req) => market.listDeals(req.user, req.query)));
  router.get('/deals/:id', send((req) => market.getDeal(req.user, req.params.id)));
  router.post('/deals/:id/confirm', send((req) => market.confirm(req.user, req.params.id)));
  router.post('/deals/:id/schedule', json, send((req) => market.schedule(req.user, req.params.id, req.body || {})));
  router.post('/deals/:id/verify-pickup', json, send((req) => market.verifyPickup(req.user, req.params.id, req.body?.code)));
  router.post('/deals/:id/received', send((req) => market.received(req.user, req.params.id)));
  router.post('/deals/:id/payment-status', json, send((req) => market.paymentStatus(req.user, req.params.id, req.body?.status)));
  router.post('/deals/:id/cancel', json, send((req) => market.cancel(req.user, req.params.id, req.body?.reason)));
  router.post('/deals/:id/rating', json, send((req) => market.rate(req.user, req.params.id, req.body?.stars)));

  router.get('/users/:userId/reputation', send((req) => market.getReputation(req.params.userId, req.query.role)));
  router.get('/me/reputation', send((req) => market.getMyReputation(req.user)));

  router.get('/sync', send((req) => market.sync(req.user, req.query.since)));

  router.post('/reports', json, send((req) => market.report(req.user, req.body || {}), 201));
  router.post('/blocks', json, send((req) => market.block(req.user, req.body || {}), 201));

  router.use((_req, _res, next) => next(new AppError('NOT_FOUND', 'Not found.')));

  const timer = setInterval(() => { limiter.sweep(); market.expireStale().catch((e) => console.error('market expiry:', e.message)); }, 300000);
  timer.unref();
  return { router, service: market, close: () => clearInterval(timer) };
}
