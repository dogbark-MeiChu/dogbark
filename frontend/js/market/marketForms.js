import { t } from '../i18n/index.js';
import { getJSON } from '../api.js';
import { identity } from '../state.js';
import { marketApi } from './marketApi.js';
import { UNITS, GRADE_LABEL, PRICING_LABEL, FULFILL_LABEL, PAYMENT_LABEL, WINDOWS, dayOptions, fmtNum, money, newRequestId } from './marketUtils.js';

const opts = (map, keys = Object.keys(map)) => keys.map((k) => ({ label: map[k], value: k }));
const unitOptions = UNITS.map((u) => ({ label: t(u), value: u }));
const EXPIRY = [{ label: t('1 day'), value: 24 }, { label: t('2 days'), value: 48 }, { label: t('3 days'), value: 72 }, { label: t('7 days'), value: 168 }];

export async function ensureOptions() {
  if (!identity.options) identity.options = await getJSON('/api/auth/options');
  return identity.options;
}
const cropOptions = () => (identity.options?.crops || []).map((c) => ({ label: t(c.name), value: c.code }));

const windowOf = (start, end) => WINDOWS.find((w) => w.value && w.value[0] === start && w.value[1] === end)?.value ?? null;
const windowLabelFor = (v) => (v ? `${v[0]}–${v[1]}` : t('Any time'));
const windowField = { key: 'window', label: 'Pickup window', type: 'choice', optional: true, options: WINDOWS, fmt: windowLabelFor };
const pickupFields = [
  { key: 'pickupDate', label: 'Pickup date', type: 'date', options: dayOptions() },
  windowField,
];

/** Sell Produce. */
export function listingForm(done) {
  return {
    title: 'Sell produce', submitLabel: 'Post listing', requestId: newRequestId(), done,
    intro: 'Asking prices are not verified market prices.',
    values: { crop: null, quantity: null, unit: 'kg', pricingMode: 'negotiable', askingPrice: null, grade: 'not_graded',
      availableDate: dayOptions()[1].value, fulfillment: 'pickup', expiresInHours: 48 },
    fields: [
      { key: 'crop', label: 'Crop', type: 'choice', options: cropOptions },
      { key: 'quantity', label: 'Quantity', type: 'number', decimals: 3, fmt: (v, all) => (v == null ? '—' : `${fmtNum(v)} ${t(all.unit)}`) },
      { key: 'unit', label: 'Unit', type: 'choice', options: unitOptions },
      { key: 'pricingMode', label: 'Pricing', type: 'choice', options: opts(PRICING_LABEL) },
      { key: 'askingPrice', label: 'Price per unit', type: 'number', decimals: 2, show: (v) => v.pricingMode !== 'request_offers', fmt: (v) => (v == null ? '—' : money(v)) },
      { key: 'grade', label: 'Grade', type: 'choice', options: opts({ A: GRADE_LABEL.A, B: GRADE_LABEL.B, C: GRADE_LABEL.C, not_graded: GRADE_LABEL.not_graded }) },
      { key: 'availableDate', label: 'Ready on', type: 'date', options: dayOptions() },
      { key: 'fulfillment', label: 'Handover', type: 'choice', options: opts(FULFILL_LABEL, ['pickup', 'seller_delivery', 'negotiable']) },
      { key: 'expiresInHours', label: 'Expires in', type: 'choice', options: EXPIRY },
    ],
    submit: (v, requestId) => marketApi.create('listing', {
      requestId, crop: v.crop, quantity: v.quantity, unit: v.unit, pricingMode: v.pricingMode,
      ...(v.pricingMode !== 'request_offers' ? { askingPrice: v.askingPrice } : {}),
      grade: v.grade, availableDate: v.availableDate, fulfillment: v.fulfillment, expiresInHours: v.expiresInHours,
    }),
  };
}

/** Post Buy Request. */
export function requestForm(done) {
  return {
    title: 'Buy request', submitLabel: 'Post request', requestId: newRequestId(), done,
    values: { crop: null, quantity: null, unit: 'kg', targetPriceMin: null, targetPriceMax: null, desiredGrade: 'not_specified',
      neededBy: dayOptions()[3].value, fulfillment: 'buyer_pickup', expiresInHours: 72 },
    fields: [
      { key: 'crop', label: 'Crop', type: 'choice', options: cropOptions },
      { key: 'quantity', label: 'Need', type: 'number', decimals: 3, fmt: (v, all) => (v == null ? '—' : `${fmtNum(v)} ${t(all.unit)}`) },
      { key: 'unit', label: 'Unit', type: 'choice', options: unitOptions },
      { key: 'targetPriceMin', label: 'Budget from', type: 'number', decimals: 2, optional: true, fmt: (v) => (v == null ? t('any') : money(v)) },
      { key: 'targetPriceMax', label: 'Budget up to', type: 'number', decimals: 2, optional: true, fmt: (v) => (v == null ? t('any') : money(v)) },
      { key: 'desiredGrade', label: 'Grade', type: 'choice', options: opts({ not_specified: GRADE_LABEL.not_specified, A: GRADE_LABEL.A, B: GRADE_LABEL.B, C: GRADE_LABEL.C }) },
      { key: 'neededBy', label: 'Needed by', type: 'date', options: dayOptions(14) },
      { key: 'fulfillment', label: 'Handover', type: 'choice', options: opts(FULFILL_LABEL, ['buyer_pickup', 'seller_delivery', 'negotiable']) },
      { key: 'expiresInHours', label: 'Expires in', type: 'choice', options: EXPIRY },
    ],
    submit: (v, requestId) => marketApi.create('request', {
      requestId, crop: v.crop, quantity: v.quantity, unit: v.unit, desiredGrade: v.desiredGrade, neededBy: v.neededBy,
      fulfillment: v.fulfillment, expiresInHours: v.expiresInHours,
      ...(v.targetPriceMin != null ? { targetPriceMin: v.targetPriceMin } : {}), ...(v.targetPriceMax != null ? { targetPriceMax: v.targetPriceMax } : {}),
    }),
  };
}

const termFields = (unit) => [
  { key: 'quantity', label: 'Quantity', type: 'number', decimals: 3, fmt: (v) => (v == null ? '—' : `${fmtNum(v)} ${t(unit)}`) },
  { key: 'unitPrice', label: 'Price per unit', type: 'number', decimals: 2, fmt: (v) => (v == null ? '—' : money(v)) },
  ...pickupFields,
  { key: 'paymentMethod', label: 'Payment', type: 'choice', options: opts(PAYMENT_LABEL) },
  { key: 'note', label: 'Note', type: 'text', optional: true, max: 160 },
];
const termBody = (v) => ({
  quantity: v.quantity, unitPrice: v.unitPrice, pickupDate: v.pickupDate,
  ...(v.window ? { pickupWindowStart: v.window[0], pickupWindowEnd: v.window[1] } : {}),
  paymentMethod: v.paymentMethod, ...(v.note ? { note: v.note } : {}),
});

/** Make Offer on a listing/request card (`item` from the API). */
export function offerForm(kind, item, done) {
  const seller = kind === 'listing';
  return {
    title: 'Make offer', submitLabel: 'Send offer', requestId: newRequestId(), done,
    intro: seller ? t('{crop}: {qty} {unit} left', { crop: t(item.crop.name), qty: fmtNum(item.availableQuantity), unit: t(item.unit) }) : t('Wants {qty} {unit}', { qty: fmtNum(item.availableQuantity), unit: t(item.unit) }),
    values: {
      quantity: Math.min(item.availableQuantity, item.quantity), unitPrice: seller ? item.askingPrice : item.targetPriceMax ?? item.targetPriceMin,
      pickupDate: dayOptions()[1].value, window: null, paymentMethod: 'cash_on_pickup', note: '',
    },
    fields: termFields(item.unit),
    submit: (v, requestId) => marketApi.offer(kind, item.id, { requestId, ...termBody(v) }),
  };
}

/** Counter an offer: starts from the current terms. */
export function counterForm(offer, done) {
  const terms = offer.terms;
  return {
    title: 'Counter offer', submitLabel: 'Send counter', requestId: newRequestId(), done,
    values: { quantity: terms.quantity, unitPrice: terms.unitPrice, pickupDate: terms.pickupDate, window: windowOf(terms.pickupWindowStart, terms.pickupWindowEnd),
      paymentMethod: terms.paymentMethod, note: '' },
    fields: [
      ...termFields(terms.unit).map((f) => (f.key === 'pickupDate' ? { ...f, options: [{ label: t('Keep {date}', { date: terms.pickupDate }), value: terms.pickupDate }, ...dayOptions()] } : f)),
    ],
    submit: (v) => marketApi.counter(offer.id, termBody(v)),
  };
}

/** Schedule / change pickup on an agreed deal. */
export function scheduleForm(deal, done) {
  return {
    title: 'Pickup', submitLabel: 'Save pickup', requestId: newRequestId(), done,
    intro: 'Place is shared only with your trade partner.',
    values: { pickupDate: deal.pickup.date || dayOptions()[1].value, window: windowOf(deal.pickup.windowStart, deal.pickup.windowEnd), location: deal.pickup.location || '' },
    fields: [
      { key: 'pickupDate', label: 'Pickup date', type: 'date', options: [...(deal.pickup.date ? [{ label: t('Keep {date}', { date: deal.pickup.date }), value: deal.pickup.date }] : []), ...dayOptions()] },
      windowField,
      { key: 'location', label: 'Place', type: 'text', max: 120 },
    ],
    submit: (v) => marketApi.dealAction(deal.id, 'schedule', {
      pickupDate: v.pickupDate, ...(v.window ? { pickupWindowStart: v.window[0], pickupWindowEnd: v.window[1] } : {}), location: v.location,
    }),
  };
}
