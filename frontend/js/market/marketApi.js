import { getApi, postApi, deleteJSON } from '../api.js';

const qs = (o = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v != null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
const id = encodeURIComponent;
const T = { timeout: 15000 };

export const marketApi = {
  browse: (kind, query) => getApi(`/api/market/${kind === 'listing' ? 'listings' : 'buy-requests'}${qs(query)}`),
  detail: (kind, itemId) => getApi(`/api/market/${kind === 'listing' ? 'listings' : 'buy-requests'}/${id(itemId)}`),
  create: (kind, body) => postApi(`/api/market/${kind === 'listing' ? 'listings' : 'buy-requests'}`, body, T),
  remove: (kind, itemId) => deleteJSON(`/api/market/${kind === 'listing' ? 'listings' : 'buy-requests'}/${id(itemId)}`),
  offer: (kind, itemId, body) => postApi(`/api/market/${kind === 'listing' ? 'listings' : 'buy-requests'}/${id(itemId)}/offers`, body, T),
  offers: (role) => getApi(`/api/market/offers${qs({ role })}`),
  getOffer: (offerId) => getApi(`/api/market/offers/${id(offerId)}`),
  counter: (offerId, body) => postApi(`/api/market/offers/${id(offerId)}/counter`, body, T),
  accept: (offerId) => postApi(`/api/market/offers/${id(offerId)}/accept`, {}, T),
  decline: (offerId) => postApi(`/api/market/offers/${id(offerId)}/decline`, {}, T),
  withdraw: (offerId) => postApi(`/api/market/offers/${id(offerId)}/withdraw`, {}, T),
  deals: () => getApi('/api/market/deals'),
  deal: (dealId) => getApi(`/api/market/deals/${id(dealId)}`),
  dealAction: (dealId, action, body = {}) => postApi(`/api/market/deals/${id(dealId)}/${action}`, body, T),
  sync: (since) => getApi(`/api/market/sync${qs({ since })}`, { timeout: 6000 }),
  report: (targetType, targetId, reason) => postApi('/api/market/reports', { targetType, targetId, reason }),
  block: (userId) => postApi('/api/market/blocks', { userId }),
  reputation: (userId, role) => getApi(`/api/market/users/${id(userId)}/reputation${qs({ role })}`),
  myReputation: (role) => getApi(`/api/market/me/reputation${qs({ role })}`),
};
