import { t } from '../i18n/index.js';
const ITEMS = [
  { label: 'Market Prices', to: 'MarketPrices' },
  { label: 'Sell / Buy', to: 'MarketHome' },
  { label: 'Farmer Circle', to: 'FarmerCircleHome' },
  { label: 'Ask AI', to: 'AskAIHome' },
  { label: "Today's Farm", to: 'FarmGate' },
  { label: 'Weather', to: 'Weather' },
  { label: 'Settings', to: 'Settings' },
];

export default {
  name: 'MainMenu',
  title: 'AgriLink',
  numericSelect: true,
  softLeft: { label: '', handler() {} },
  render() {
    const list = document.createElement('div');
    list.className = 'list';
    ITEMS.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'item';
      row.textContent = `${i + 1}  ${t(it.label)}`;
      list.appendChild(row);
    });
    return list;
  },
  onEnter(_el, ctx, i) {
    const it = ITEMS[i];
    ctx.router.push(it.to, { title: t(it.label) });
  },
};
