import { t } from '../i18n/index.js';
import { getJSON } from '../api.js';
import { user, identity } from '../state.js';
import { money, signed, bars, h } from '../fmt.js';

let qty = 5, calc = null, error = null, loading = false;

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
    const at = p?.regionLat != null && p?.regionLng != null ? `&lat=${p.regionLat}&lng=${p.regionLng}` : '';
    calc = await getJSON(`/api/prices/net-profit?crop=${crop}&region=${region || user.region}&from=${home || user.homeMarket}&to=${market.code}&qty=${qty}${at}`);
  } catch {
    calc = null; error = t('Calculation unavailable');
  }
  loading = false;
  ctx.rerender();
}

export default {
  name: 'PriceDetail',
  title: 'Net Profit',
  softCenter: { label: '' },
  onShow(ctx) { if (!calc && !loading && !error) load(ctx); },
  onHide() { calc = null; error = null; qty = 5; },
  render(ctx) {
    const wrap = h('list');
    const { cropLabel, market } = ctx.params;
    const head = h('', null);
    head.style.padding = 'var(--pad)';
    // Daily sync builds the history one day at a time; a one-point "trend" would be noise.
    const trend = market.trend.length > 1 ? t('{bars} last {n} prices', { bars: bars(market.trend), n: market.trend.length }) : t('Trend appears after a few days of prices');
    head.append(h('', `${t(cropLabel)} @ ${market.name}`), h('dim', trend));
    wrap.appendChild(head);
    if (!calc) { wrap.appendChild(h('msg', error || t('Loading…'))); return wrap; }

    const rows = [
      [t('{name} market', { name: calc.to }), `${money(calc.price_to, calc.currency)}/${t('qt')}`],
      [calc.from_distance_km > 25 ? `${t('Nearest')} · ${calc.from}` : t('Your area'), `${money(calc.price_from, calc.currency)}/${t('qt')}`],
      // Unknown distance is shown as unknown, never as a free trip.
      !calc.transport_known ? [t('Transport'), t('not known')]
        // Both trips start from the member: the extra cost of the longer one.
        : calc.from_distance_km != null ? [t('Extra trip {a} vs {b}km', { a: calc.distance_km, b: calc.from_distance_km }), `${signed(-calc.transport_per_qt, calc.currency)}/${t('qt')}`]
          : [t('Transport ~{km}km', { km: calc.distance_km }), `${signed(-calc.transport_per_qt, calc.currency)}/${t('qt')}`],
      [t(calc.transport_known ? 'Net gain' : 'Gain before transport'), `${signed(calc.gain_per_qt, calc.currency)}/${t('qt')}`],
      [`${t('For {n} qt', { n: calc.qty })}  ◄ ►`, signed(calc.gain_total, calc.currency)],
    ];
    rows.forEach(([a, b], i) => {
      const r = h('item');
      r.append(h('', a), h(i >= 3 ? '' : 'dim', b));
      wrap.appendChild(r);
    });
    wrap.appendChild(h('msg dim', `${t('Price data:')} ${dataDate(calc.price_date)} · ${calc.source === 'agmarknet' ? t('Agmarknet (Govt of India)') : calc.source || t('Database')}`));
    if (!calc.same_day) wrap.appendChild(h('msg', t('Prices are from different days: {a} vs {b}.', { a: dataDate(calc.to_date), b: dataDate(calc.from_date) })));
    wrap.appendChild(h('msg dim hide-small', `${calc.transport_known ? t('Transport is an estimate.') + ' ' : ''}${t('Before market fees and commission.')}`));
    return wrap;
  },
  onKey(action, ctx) {
    if (action === 'LEFT' || action === 'RIGHT') {
      qty = Math.max(1, Math.min(100, qty + (action === 'LEFT' ? -1 : 1)));
      calc = null; error = null;
      ctx.rerender();
      return true;
    }
    return false;
  },
};
