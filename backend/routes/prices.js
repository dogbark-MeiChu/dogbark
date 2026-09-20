import { Router } from 'express';
import { AppError, errorHandler, validation } from '../middleware/errors.js';

const CODE = /^[a-z0-9_-]{1,80}$/i; // synced mandi codes are agm-<state>-<district>-<market>
const REGION = /^[A-Z0-9-]{2,20}$/;

export function pricesRouter(service) {
  const router = Router();

  // Optional lat/lng (the selected farm, else the member's region centre) pick the nearest mandi.
  const point = (q) => {
    const lat = Number(q.lat), lng = Number(q.lng);
    return q.lat != null && q.lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : {};
  };

  router.get('/crops', async (req, res, next) => {
    const { region } = req.query;
    if (!REGION.test(region || '')) return next(validation('region required', 'region'));
    try { res.json({ ok: true, ...await service.getCrops({ region }) }); } catch (err) { next(unavailable(err)); }
  });

  router.get('/', async (req, res, next) => {
    const { crop, region, home } = req.query;
    if (!CODE.test(crop || '') || !REGION.test(region || '')) return next(validation('crop and region required'));
    let data;
    try {
      data = await service.getPrices({ crop, region, home: CODE.test(home || '') ? home : undefined, ...point(req.query) });
    } catch (err) { return next(unavailable(err)); }
    if (!data) return next(new AppError('NO_DATA', 'No prices for this crop/area'));
    res.json({ ok: true, ...data });
  });

  router.get('/net-profit', async (req, res, next) => {
    const { crop, region, from, to } = req.query;
    const qty = Number(req.query.qty ?? 1);
    const transportMode = req.query.transportMode || 'hired';
    const channel = req.query.channel || 'mandi';
    const alreadyPacked = req.query.alreadyPacked === 'true';
    const transitDays = req.query.transitDays == null ? null : Number(req.query.transitDays);
    if (![crop, from, to].every((v) => CODE.test(v || '')) || !REGION.test(region || '') || !(qty > 0 && qty <= 10000)) {
      return next(validation('crop, region, from, to, qty required'));
    }
    if (!['hired', 'own', 'buyer_pickup'].includes(transportMode)) return next(validation('Choose a transport mode.', 'transportMode'));
    if (!['mandi', 'direct_buyer'].includes(channel)) return next(validation('Choose a sale channel.', 'channel'));
    if (req.query.alreadyPacked != null && !['true', 'false'].includes(req.query.alreadyPacked)) return next(validation('alreadyPacked must be true or false.', 'alreadyPacked'));
    if (transitDays != null && (!Number.isInteger(transitDays) || transitDays < 0 || transitDays > 7)) return next(validation('Transit days must be 0–7.', 'transitDays'));
    let data;
    try {
      data = await service.getNetProfit({ crop, region, from, to, qty, transportMode, channel, alreadyPacked, transitDays, ...point(req.query) });
    } catch (err) { return next(unavailable(err)); }
    if (!data) return next(new AppError('NO_DATA', 'Unknown market'));
    res.json({ ok: true, ...data });
  });

  router.use(errorHandler);
  return router;
}

// A failing price lookup is an outage for the member, not a bug report: 503 and retryable.
function unavailable(err) {
  console.error('prices error:', err.message);
  return new AppError('PRICES_UNAVAILABLE', 'Prices unavailable', { retryable: true });
}
