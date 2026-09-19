import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { startForum } from './helpers.js';
import { seedDemo } from '../db/forumSeed.js';

// Ask AI and Weather personalise from these profile fields.
test('the profile carries region code, coordinates and crop codes', async () => {
  const t = await startForum();
  try {
    const { user } = await t.auth.login({ phone: '9100000001', pin: '246810' }); // Ravi, Bihar
    assert.equal(user.regionCode, 'IN-BR');
    assert.equal(user.regionLat, 25.5941);
    assert.equal(user.regionLng, 85.1376);
    assert.deepEqual(user.cropCodes, []);
    await t.pool.query("INSERT INTO app.crops (code, name) VALUES ('wheat','Wheat'), ('rice','Rice') ON CONFLICT DO NOTHING");
    await t.pool.query("INSERT INTO app.user_crops (user_id, crop_id) SELECT $1, id FROM app.crops WHERE code IN ('wheat','rice')", [user.id]);
    assert.deepEqual((await t.auth.profileFor(t.pool, user.id)).cropCodes, ['rice', 'wheat']);
  } finally { await t.close(); }
});

// These members exist so every live-price district has someone to sign in as (docs/CODEBASE_STATUS.md).
test('Uttar Pradesh demo members have a live-price district and crops, and keep edited crops', async () => {
  const t = await startForum();
  try {
    const districts = {};
    for (const n of ['11', '12', '13', '14', '15']) {
      const { user } = await t.auth.login({ phone: `91000000${n}`, pin: '246810' });
      districts[n] = [user.regionCode, user.cropCodes];
      assert.ok(user.regionLat != null && user.regionLng != null, 'Weather and nearest-mandi need coordinates');
    }
    assert.deepEqual(districts, {
      11: ['IN-UP-MRT', ['potato', 'wheat']], 12: ['IN-UP-AGR', ['onion', 'potato']], 13: ['IN-UP-LKO', ['rice', 'tomato']],
      14: ['IN-UP-VNS', ['rice', 'wheat']], 15: ['IN-UP-LKO', ['onion', 'potato']],
    });
    const { user } = await t.auth.login({ phone: '9100000013', pin: '246810' });
    await t.pool.query("DELETE FROM app.user_crops WHERE user_id = $1 AND crop_id = (SELECT id FROM app.crops WHERE code = 'tomato')", [user.id]);
    await seedDemo(t.pool, { auth: t.auth, pin: '246810' });
    assert.deepEqual((await t.auth.profileFor(t.pool, user.id)).cropCodes, ['rice']);
  } finally { await t.close(); }
});

test('migration 008 fills missing region coordinates and leaves existing ones', async () => {
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA app; CREATE TABLE app.regions (code text UNIQUE, latitude numeric(8,5), longitude numeric(8,5));
    INSERT INTO app.regions VALUES ('BD-RAJ', NULL, NULL), ('IN-UP-01', 1, 2), ('XX-OTHER', NULL, NULL);`);
  await db.exec(fs.readFileSync(new URL('../db/migrations/008_region_coordinates.sql', import.meta.url), 'utf8'));
  const rows = Object.fromEntries((await db.query('SELECT code, latitude::float8 lat, longitude::float8 lon FROM app.regions')).rows.map((r) => [r.code, [r.lat, r.lon]]));
  assert.deepEqual(rows, { 'BD-RAJ': [24.3745, 88.6042], 'IN-UP-01': [1, 2], 'XX-OTHER': [null, null] });
  await db.close();
});

// A lost phone: signing out the others from the phone in hand ends every other session, not this one.
test('logoutOthers ends the other sessions and keeps the current one', async () => {
  const t = await startForum();
  try {
    const a = await t.auth.login({ phone: '9100000002', pin: '246810' }); // the lost phone
    const b = await t.auth.login({ phone: '9100000002', pin: '246810' }); // the phone in hand
    const other = await t.auth.login({ phone: '9100000003', pin: '246810' }); // someone else
    assert.ok(await t.auth.logoutOthers(b.session.token) >= 1); // the seed signed this member in too
    assert.equal(await t.auth.session(a.session.token), null);
    assert.ok(await t.auth.session(b.session.token));
    assert.ok(await t.auth.session(other.session.token), 'other members are untouched');
    assert.equal(await t.auth.logoutOthers('not-a-token'), 0);
  } finally { await t.close(); }
});
