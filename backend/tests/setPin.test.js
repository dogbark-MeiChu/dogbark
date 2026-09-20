import test from 'node:test';
import assert from 'node:assert/strict';
import { startForum } from './helpers.js';

const PIN = '246810';

async function rejects(fn, code) {
  await assert.rejects(fn, (err) => { assert.equal(err.code, code); return true; });
}

test('an operator reset replaces the PIN and revokes the old sessions', async () => {
  const t = await startForum();
  try {
    const before = await t.auth.login({ phone: '9100000001', pin: PIN });
    assert.ok(await t.auth.session(before.session.token), 'the old session starts out valid');

    const out = await t.auth.setPin({ phone: '9100000001', pin: '135790' });
    assert.equal(out.userId, before.user.id);
    // The seed signs in as this member too, so the count is "at least ours", not exactly one.
    assert.ok(out.revokedSessions >= 1, `expected a revoked session, got ${out.revokedSessions}`);

    assert.equal(await t.auth.session(before.session.token), null, 'the old session no longer works');
    await rejects(() => t.auth.login({ phone: '9100000001', pin: PIN }), 'INVALID_LOGIN');
    const after = await t.auth.login({ phone: '9100000001', pin: '135790' });
    assert.equal(after.user.id, before.user.id);
  } finally { await t.close(); }
});

test('keeping the sessions leaves the member signed in on the handset', async () => {
  const t = await startForum();
  try {
    const before = await t.auth.login({ phone: '9100000002', pin: PIN });
    const out = await t.auth.setPin({ userId: before.user.id, pin: '111222', revokeSessions: false });
    assert.equal(out.revokedSessions, 0);
    assert.ok(await t.auth.session(before.session.token), 'the handset stays signed in');
    await t.auth.login({ phone: '9100000002', pin: '111222' });
  } finally { await t.close(); }
});

test('a member changing their own PIN must know the current one', async () => {
  const t = await startForum();
  try {
    await rejects(() => t.auth.setPin({ phone: '9100000003', pin: '555666', currentPin: '000000' }), 'INVALID_LOGIN');
    await t.auth.login({ phone: '9100000003', pin: PIN }); // unchanged
    await t.auth.setPin({ phone: '9100000003', pin: '555666', currentPin: PIN });
    await t.auth.login({ phone: '9100000003', pin: '555666' });
  } finally { await t.close(); }
});

test('a reset clears a lockout, so a locked-out member can sign in again', async () => {
  const t = await startForum();
  try {
    for (let i = 0; i < 5; i += 1) {
      await assert.rejects(() => t.auth.login({ phone: '9100000004', pin: '999999' }));
    }
    await rejects(() => t.auth.login({ phone: '9100000004', pin: PIN }), 'ACCOUNT_LOCKED');
    await t.auth.setPin({ phone: '9100000004', pin: '424242' });
    await t.auth.login({ phone: '9100000004', pin: '424242' });
  } finally { await t.close(); }
});

test('the PIN is validated, the account must exist, and a no-op is refused', async () => {
  const t = await startForum();
  try {
    await rejects(() => t.auth.setPin({ phone: '9100000005', pin: '12345' }), 'INVALID_PIN');
    await rejects(() => t.auth.setPin({ phone: '9100000005', pin: 'abcdef' }), 'INVALID_PIN');
    await rejects(() => t.auth.setPin({ phone: '9999999999', pin: '135790' }), 'NOT_FOUND');
    await rejects(() => t.auth.setPin({ pin: '135790' }), 'INVALID_TARGET');
    await rejects(() => t.auth.setPin({ phone: '9100000005', pin: PIN }), 'PIN_UNCHANGED');
  } finally { await t.close(); }
});

test('the signed-in change-PIN route verifies the old PIN, keeps this phone, and ends other sessions', async () => {
  const t = await startForum();
  try {
    const current = await t.login('10000001');
    const other = await t.login('10000001');
    const denied = await current.post('/api/auth/change-pin', { currentPin: '000000', pin: '135790' });
    assert.equal(denied.status, 401);
    assert.equal(denied.body.error.code, 'INVALID_LOGIN');

    const changed = await current.post('/api/auth/change-pin', { currentPin: PIN, pin: '135790' });
    assert.equal(changed.status, 200);
    assert.ok(changed.body.ended >= 1);
    assert.ok((await current.get('/api/auth/session')).body.user, 'the phone changing the PIN stays signed in');
    assert.equal((await other.get('/api/auth/session')).body.user, null, 'other phones are signed out');
    await rejects(() => t.auth.login({ phone: '9100000001', pin: PIN }), 'INVALID_LOGIN');
    await t.auth.login({ phone: '9100000001', pin: '135790' });
  } finally { await t.close(); }
});
