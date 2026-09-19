// UI translations (frontend/js/i18n): every language must cover the same English keys,
// keep the {placeholders} the code passes in, and never leave a value empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import hi from '../../frontend/js/i18n/hi.js';
import bn from '../../frontend/js/i18n/bn.js';
import vi from '../../frontend/js/i18n/vi.js';
import { t, LANGUAGES, language } from '../../frontend/js/i18n/index.js';

const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort().join();

test('every language has the same keys', () => {
  const keys = Object.keys(hi).sort();
  assert.ok(keys.length > 500);
  assert.deepEqual(Object.keys(bn).sort(), keys);
  assert.deepEqual(Object.keys(vi).sort(), keys);
});

test('translations are non-empty and keep placeholders', () => {
  for (const [code, dict] of Object.entries({ hi, bn, vi })) {
    for (const [en, text] of Object.entries(dict)) {
      assert.ok(text.trim(), `${code}: empty translation for "${en}"`);
      assert.equal(placeholders(text), placeholders(en), `${code}: placeholders differ for "${en}"`);
    }
  }
});

test('t() falls back to English and fills placeholders', () => {
  assert.equal(language, 'en'); // no localStorage outside the browser
  assert.equal(t('Some text nobody translated'), 'Some text nobody translated');
  assert.equal(t('{n} days left', { n: 3 }), '3 days left');
  assert.deepEqual(LANGUAGES.map(([code]) => code), ['en', 'hi', 'bn', 'vi']);
});
