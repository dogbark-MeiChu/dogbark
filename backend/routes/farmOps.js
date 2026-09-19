import express, { Router } from 'express';
import { sessionFromRequest } from './auth.js';
import { AppError, asyncHandler } from '../middleware/errors.js';
import { sameOriginWrites } from '../middleware/sameOrigin.js';
import { createFarmOpsService } from '../services/farmOpsService.js';

export function createFarmOpsRouter({ pool, auth, farmPriceService, weatherGetter }) {
  const router = Router();
  const service = createFarmOpsService(pool, { farmPriceService, weatherGetter });
  const json = express.json({ limit: '16kb' });
  router.use(sameOriginWrites);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(asyncHandler(async (req, _res, next) => {
    const token = sessionFromRequest(req);
    const user = token ? await auth.session(token) : null;
    if (!user) return next(new AppError('AUTH_REQUIRED', 'Sign in to use Today\'s Farm.'));
    req.user = user; next();
  }));
  const send = (fn, status = 200) => asyncHandler(async (req, res) => {
    const out = await fn(req);
    res.status(typeof status === 'function' ? status(out) : status).json({ ok: true, ...out });
  });

  router.get('/', send((req) => service.farms(req.user)));
  router.get('/sync', send((req) => service.sync(req.user, req.query.since))); // polled by frontend/js/farmOps/farmSync.js
  router.post('/', json, send((req) => service.createFarm(req.user, req.body || {}), (o) => (o.duplicate ? 200 : 201)));
  router.get('/:farmId/today', send((req) => service.overview(req.user, req.params.farmId, req.query.date)));
  router.get('/:farmId/prices', send((req) => service.prices(req.user, req.params.farmId, String(req.query.crop || 'rice').toLowerCase())));
  router.get('/:farmId/spray-assessment', asyncHandler(async (req, res) => {
    const out = await service.sprayAssessment(req.user, req.params.farmId, req.query.date);
    if (!out) return res.status(204).end();
    res.json({ ok: true, ...out });
  }));
  router.get('/:farmId/calendar', send((req) => service.calendar(req.user, req.params.farmId, req.query)));
  router.get('/:farmId/tasks', send((req) => service.listTasks(req.user, req.params.farmId, req.query)));
  router.get('/:farmId/upcoming', send((req) => {
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const end = new Date(`${from}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + Math.min(30, Math.max(1, Number(req.query.days) || 7)));
    return service.listTasks(req.user, req.params.farmId, { ...req.query, from, to: end.toISOString().slice(0, 10) });
  }));
  router.post('/:farmId/tasks', json, send((req) => service.createTask(req.user, req.params.farmId, req.body || {}), (o) => o.duplicate ? 200 : 201));
  router.get('/:farmId/fields', send((req) => service.fields(req.user, req.params.farmId)));
  router.get('/:farmId/members', send((req) => service.members(req.user, req.params.farmId)));
  router.get('/:farmId/records', send((req) => service.records(req.user, req.params.farmId, req.query)));

  router.get('/tasks/:taskId/detail', send((req) => service.getTask(req.user, req.params.taskId)));
  for (const [action, status] of Object.entries({ accept: 'accepted', start: 'in_progress', complete: 'completed', verify: 'verified', delay: 'delayed', block: 'blocked', unblock: 'assigned', cancel: 'cancelled' })) {
    router.post(`/tasks/:taskId/${action}`, json, send((req) => service.transition(req.user, req.params.taskId, status, req.body || {})));
  }
  router.post('/tasks/:taskId/assign', json, send((req) => service.assign(req.user, req.params.taskId, req.body || {})));
  router.post('/tasks/:taskId/reschedule', json, send((req) => service.reschedule(req.user, req.params.taskId, req.body || {})));
  router.put('/tasks/:taskId/checklist/:itemId', json, send((req) => service.checklist(req.user, req.params.taskId, req.params.itemId, req.body?.completed)));
  router.use((_req, _res, next) => next(new AppError('NOT_FOUND', 'Not found.')));
  return { router, service, close() {} };
}
