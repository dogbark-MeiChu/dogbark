import { t } from '../i18n/index.js';
import { getJSON } from '../api.js';
import { user, identity } from '../state.js';
import { pointQuery } from '../place.js';
import { money, signed, bars, h } from '../fmt.js';
import { legacyTransportModel, truePriceAssumptionQuery, truePriceCostTotals } from './priceDetailModel.js';

let qty = 5, calc = null, error = null, loading = false, focusIndex = 0;
let assumptions = { transportMode: 'hired', channel: 'mandi', alreadyPacked: false, transitDays: null };
const TRANSPORT = ['hired', 'own', 'buyer_pickup'];
const CHANNEL = ['mandi', 'direct_buyer'];
const TRANSIT_DAYS = [null, 0, 1, 2, 3];
const cycle = (items, value, delta) => items[(items.indexOf(value) + delta + items.length) % items.length];

function dataDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value || t('Unknown date');
  const [year, month, day] = value.split('-');
  return `${day} ${t(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1])} ${year}`;
}

async function load(ctx) {
  loading = true; error = null;
  const { crop, market, home, region } = ctx.params;
  try {
    const p = identity.profile;
    // The same point Market Prices used for "your area" (the farm's, else the profile's).
    const at = ctx.params.place ? pointQuery(ctx.params.place) : p?.regionLat != null && p?.regionLng != null ? `&lat=${p.regionLat}&lng=${p.regionLng}` : '';
    calc = await getJSON(`/api/prices/net-profit?crop=${crop}&region=${region || user.region}&from=${home || user.homeMarket}&to=${market.code}&qty=${qty}${at}&${truePriceAssumptionQuery(assumptions)}`);
  } catch {
    calc = null; error = t('Calculation unavailable');
  }
  loading = false;
  ctx.rerender();
}

export default {
  name: 'PriceDetail',
  title: 'TruePrice',
  softCenter: { label: '' },
  initialFocus: () => focusIndex,
  onShow(ctx) { if (!calc && !loading && !error) load(ctx); },
  onHide() {
    calc = null; error = null; qty = 5; focusIndex = 0;
    assumptions = { transportMode: 'hired', channel: 'mandi', alreadyPacked: false, transitDays: null };
  },
  render(ctx) {
    const wrap = h('list');
    const { cropLabel, market } = ctx.params;
    const head = h('', null);
    head.style.padding = 'var(--pad)';
    // Daily sync builds the history one day at a time; a one-point "trend" would be noise.
    const trend = market.trend.length > 1 ? t('{bars} last {n} prices', { bars: bars(market.trend), n: market.trend.length }) : t('Trend appears after a few days of prices');
    head.append(h('', `${t(cropLabel)} @ ${market.name}${market.district && market.district !== market.name ? ` · ${market.district}` : ''}`), h('dim', trend));
    wrap.appendChild(head);
    if (!calc) { wrap.appendChild(h('msg', error || t('Loading…'))); return wrap; }

    const best = calc.truePrice?.highestNet;
    const legacyTransport = legacyTransportModel(calc);
    const legacyTransportRow = legacyTransport.kind === 'unknown'
      ? [t('Transport'), t('not known')]
      : legacyTransport.kind === 'extra_trip'
        ? [t('Extra trip {a} vs {b}km', { a: legacyTransport.distanceKm, b: legacyTransport.fromDistanceKm }),
          `${signed(-legacyTransport.transportPerQt, calc.currency)}/${t('qt')}`]
        : [t('Transport ~{km}km', { km: legacyTransport.distanceKm }),
          `${signed(-legacyTransport.transportPerQt, calc.currency)}/${t('qt')}`];
    const actualDays = best?.economics?.assumptions?.transitDays;
    const visibleCosts = best ? truePriceCostTotals(best.economics, calc.qty) : null;
    const rows = calc.truePrice?.options?.length && best ? [
      ...calc.truePrice.options.map((option) => [
        `${option === best ? t('HIGHEST NET · ') : ''}${option.market}`,
        `${money(option.economics.estimatedNetPerQt, calc.currency)}/${t('qt')} · ${option.confidence.grade}`,
      ]),
      [t('Quantity  ◄ ►'), `${calc.qty} ${t('qt')}`, 'quantity'],
      [t('Sale channel  ◄ ►'), t(assumptions.channel === 'mandi' ? 'Mandi' : 'Direct buyer'), 'channel'],
      [t('Transport  ◄ ►'), t({ hired: 'Hired vehicle', own: 'Own vehicle', buyer_pickup: 'Buyer pickup' }[assumptions.transportMode]), 'transportMode'],
      [t('Already packed  ◄ ►'), t(assumptions.alreadyPacked ? 'Yes' : 'No'), 'alreadyPacked'],
      [t('Transit days  ◄ ►'), assumptions.transitDays == null ? `${t('Auto')} (${actualDays})` : String(assumptions.transitDays), 'transitDays'],
      [t('Gross total'), money(best.economics.grossTotal, calc.currency)],
      [t('Transport'), signed(-visibleCosts.transport, calc.currency)],
      [t('Commission + fee'), signed(-visibleCosts.commissionFee, calc.currency)],
      [t('Handling + packing'), signed(-visibleCosts.handlingPacking, calc.currency)],
      [t('Transit spoilage'), signed(-visibleCosts.spoilage, calc.currency)],
      [t('EST. NET TOTAL'), money(best.economics.totalEstimatedNet, calc.currency)],
      [t('Tomorrow net break-even'), `${money(calc.truePrice.breakEven.breakEvenPerQt, calc.currency)}/${t('qt')}`],
    ] : [
      [t('{name} market', { name: calc.to }), `${money(calc.price_to, calc.currency)}/${t('qt')}`],
      [calc.from_distance_km > 25 ? `${t('Nearest')} · ${calc.from}` : t('Your area'), `${money(calc.price_from, calc.currency)}/${t('qt')}`],
      legacyTransportRow,
      [t(legacyTransport.gainLabel), `${signed(calc.gain_per_qt, calc.currency)}/${t('qt')}`],
      [`${t('For {n} qt', { n: calc.qty })}  ◄ ►`, signed(calc.gain_total, calc.currency), 'quantity'],
    ];
    rows.forEach(([a, b, setting], i) => {
      const r = h('item');
      if (setting) r.dataset.setting = setting;
      r.append(h('', a), h(i >= rows.length - 2 ? '' : 'dim', b));
      wrap.appendChild(r);
    });
    wrap.appendChild(h('msg dim', `${t('Price data:')} ${dataDate(calc.price_date)} · ${calc.source === 'agmarknet' ? t('Agmarknet (Govt of India)') : calc.source || t('Database')}`));
    if (!calc.same_day) wrap.appendChild(h('msg', t('Prices are from different days: {a} vs {b}.', { a: dataDate(calc.to_date), b: dataDate(calc.from_date) })));
    wrap.appendChild(h('msg dim hide-small', calc.truePrice?.disclaimer || `${calc.transport_known ? t('Transport is an estimate.') + ' ' : ''}${t('Before market fees and commission.')}`));
    if (calc.truePrice?.breakEven) wrap.appendChild(h('msg dim', t('Required net after costs; not a mandi price forecast.')));
    return wrap;
  },
  onKey(action, ctx) {
    if (action === 'LEFT' || action === 'RIGHT') {
      const setting = ctx.focus?.current?.dataset.setting;
      if (!setting) return false;
      const delta = action === 'LEFT' ? -1 : 1;
      if (setting === 'quantity') qty = Math.max(1, Math.min(100, qty + delta));
      else if (setting === 'channel') {
        assumptions.channel = cycle(CHANNEL, assumptions.channel, delta);
        if (assumptions.channel === 'mandi' && assumptions.transportMode === 'buyer_pickup') assumptions.transportMode = 'hired';
      } else if (setting === 'transportMode') {
        assumptions.transportMode = cycle(TRANSPORT, assumptions.transportMode, delta);
        if (assumptions.transportMode === 'buyer_pickup') assumptions.channel = 'direct_buyer';
      } else if (setting === 'alreadyPacked') assumptions.alreadyPacked = !assumptions.alreadyPacked;
      else if (setting === 'transitDays') assumptions.transitDays = cycle(TRANSIT_DAYS, assumptions.transitDays, delta);
      focusIndex = ctx.focus.index;
      calc = null; error = null;
      ctx.rerender();
      return true;
    }
    return false;
  },
};
