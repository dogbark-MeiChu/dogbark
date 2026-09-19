import { t } from '../i18n/index.js';
export default {
  name: 'ComingSoon',
  title: 'AgriLink',
  render(ctx) {
    const d = document.createElement('div');
    d.className = 'msg';
    d.textContent = t('{name} is coming soon.', { name: ctx.params?.title || t('This module') });
    return d;
  },
};
