import test from 'node:test';
import assert from 'node:assert/strict';
import { startForum } from './helpers.js';
import { seedFarmOps, FARM_DEMO_ID } from '../db/farmOpsSeed.js';
import { createFarmOpsService } from '../services/farmOpsService.js';
import { occurrenceDates } from '../services/recurrenceService.js';

async function setup() {
  const t = await startForum();
  await seedFarmOps(t.pool, { demoDate: '2026-09-19' });
  const users = (await t.pool.query(`SELECT s.demo_key,p.user_id id FROM app.forum_user_state s JOIN app.user_profiles p ON p.user_id=s.user_id WHERE s.demo_key IN ('10000001','10000002','10000003','10000004','10000005') ORDER BY s.demo_key`)).rows;
  const byKey = new Map(users.map((u) => [u.demo_key, u]));
  return { ...t, owner: byKey.get('10000001'), manager: byKey.get('10000005'), worker: byKey.get('10000002'), viewer: byKey.get('10000004'), ops: createFarmOpsService(t.pool) };
}

test('Today groups overdue, active, blocked and completed work with a real summary', async () => {
  const t = await setup();
  try {
    const out = await t.ops.overview(t.owner, FARM_DEMO_ID, '2026-09-19');
    assert.equal(out.summary.total, 5);
    assert.equal(out.summary.completed, 1);
    assert.equal(out.sections.overdue[0].title, 'Inspect pump');
    assert.equal(out.sections.blocked[0].title, 'Spray vegetable plot');
    assert.equal(out.sections.inProgress[0].title, 'Irrigate north section');
    assert.equal(out.sprayAssessment.overall, 'caution');
    assert.match(out.sprayAssessment.disclaimer, /product label/);
    assert.deepEqual(out.sections.dueToday, out.sections.due);
    assert.equal(typeof out.communityActivity.newPostsToday, 'number');
  } finally { await t.close(); }
});

test('demo seed is complete and idempotent', async () => {
  const t = await setup();
  try {
    const second = await seedFarmOps(t.pool, { demoDate: '2026-09-19' });
    assert.deepEqual({ members: second.members, fields: second.fields, cropCycles: second.cropCycles, tasks: second.tasks, records: second.records },
      { members: 7, fields: 3, cropCycles: 3, tasks: 14, records: 6 });
    const counts = (await t.pool.query(`SELECT
      (SELECT count(*)::int FROM app.farm_members WHERE farm_id=$1 AND status='active') members,
      (SELECT count(*)::int FROM app.farm_fields WHERE farm_id=$1) fields,
      (SELECT count(*)::int FROM app.crop_cycles WHERE farm_id=$1) cycles,
      (SELECT count(*)::int FROM app.farm_tasks WHERE farm_id=$1) tasks,
      (SELECT count(*)::int FROM app.farm_records WHERE farm_id=$1) records,
      (SELECT count(*)::int FROM app.farm_task_templates WHERE farm_id=$1) templates,
      (SELECT count(*)::int FROM app.farm_notifications WHERE farm_id=$1) notifications,
      (SELECT count(*)::int FROM app.price_snapshots WHERE farm_id=$1) prices,
      (SELECT count(*)::int FROM app.farm_weather_snapshots WHERE farm_id=$1) weather`, [FARM_DEMO_ID])).rows[0];
    assert.deepEqual(counts, { members: 7, fields: 3, cycles: 3, tasks: 14, records: 6, templates: 3, notifications: 3, prices: 3, weather: 1 });
    const waiting = (await t.pool.query(`SELECT verification_required,status FROM app.farm_tasks WHERE title='Drainage repair review'`)).rows[0];
    assert.equal(waiting.verification_required, true);
    assert.equal(waiting.status, 'completed');
  } finally { await t.close(); }
});

test('existing Test_Admin is added to the demo farm as an active owner', async () => {
  const t = await setup();
  try {
    const phone = `98${String(Date.now()).slice(-8)}`;
    const { user } = await t.auth.signup({ phone, pin: '246810', displayName: 'Test_Admin', village: 'Admin Village', regionId: (await t.pool.query(`SELECT id FROM app.regions WHERE code='IN-BR'`)).rows[0].id });
    await t.pool.query(`UPDATE app.users SET role='admin' WHERE id=$1`, [user.id]);
    const seeded = await seedFarmOps(t.pool, { demoDate: '2026-09-19' });
    const membership = (await t.pool.query(`SELECT role,status FROM app.farm_members WHERE farm_id=$1 AND user_id=$2`, [FARM_DEMO_ID,user.id])).rows[0];
    assert.equal(seeded.testAdminOwner, true);
    assert.deepEqual(membership, { role: 'owner', status: 'active' });
  } finally { await t.close(); }
});

test('task creation is idempotent and manager-only', async () => {
  const t = await setup();
  try {
    const body = { requestId: 'farm-create-abcdef', title: 'Inspect west gate', type: 'inspection', priority: 'normal', localDate: '2026-09-20' };
    const a = await t.ops.createTask(t.manager, FARM_DEMO_ID, body);
    const b = await t.ops.createTask(t.manager, FARM_DEMO_ID, body);
    assert.equal(a.id, b.id); assert.equal(b.duplicate, true);
    await assert.rejects(() => t.ops.createTask(t.viewer, FARM_DEMO_ID, { ...body, requestId: 'farm-create-other' }), (e) => e.code === 'ROLE_REQUIRED');
  } finally { await t.close(); }
});

test('worker lifecycle is server-authoritative and completion creates a farm record', async () => {
  const t = await setup();
  try {
    const task = (await t.pool.query(`SELECT id FROM app.farm_tasks WHERE title='Check tomato supports'`)).rows[0];
    await t.ops.transition(t.worker, task.id, 'accepted');
    await t.ops.transition(t.worker, task.id, 'in_progress');
    await t.ops.transition(t.worker, task.id, 'completed', { resultCode: 'normal', result: { pump: 'ok' } });
    const row = (await t.pool.query('SELECT status FROM app.farm_tasks WHERE id=$1', [task.id])).rows[0];
    const record = (await t.pool.query('SELECT data FROM app.farm_records WHERE task_id=$1', [task.id])).rows[0];
    assert.equal(row.status, 'completed'); assert.equal(record.data.result.pump, 'ok');
  } finally { await t.close(); }
});

test('recurrence expansion supports interval days, weekdays and month-end clamping', () => {
  assert.deepEqual(occurrenceDates('2026-09-19', { frequency: 'daily', interval: 3 }, { horizonDays: 10 }), ['2026-09-19','2026-09-22','2026-09-25','2026-09-28']);
  assert.deepEqual(occurrenceDates('2026-09-21', { frequency: 'weekly', weekdays: [1,4] }, { horizonDays: 10 }), ['2026-09-21','2026-09-24','2026-09-28','2026-10-01']);
  assert.deepEqual(occurrenceDates('2026-01-31', { frequency: 'monthly', day: 31 }, { horizonDays: 65 }), ['2026-01-31','2026-02-28','2026-03-31']);
});

test('a wrong PIN increments failures and returns INVALID_LOGIN instead of a PostgreSQL type error', async () => {
  const t = await setup();
  try {
    await assert.rejects(() => t.auth.login({ phone: '9100000001', pin: '000000' }), (e) => e.code === 'INVALID_LOGIN');
    const row = (await t.pool.query(`SELECT c.failed_attempts FROM app.auth_credentials c JOIN app.forum_user_state s ON s.user_id=c.user_id WHERE s.demo_key='10000001'`)).rows[0];
    assert.equal(Number(row.failed_attempts), 1);
  } finally { await t.close(); }
});

test('a member without a farm can start one, once, and use it', async () => {
  const t = await setup();
  try {
    const regionId = (await t.pool.query("SELECT id FROM app.regions WHERE code='IN-BR'")).rows[0].id;
    const { user } = await t.auth.signup({ phone: '9199999999', pin: '135790', displayName: 'New Farmer', village: 'Hajipur', regionId });
    assert.deepEqual((await t.ops.farms(user)).items, []);
    const created = await t.ops.createFarm(user);
    assert.equal(created.duplicate, false);
    assert.deepEqual(await t.ops.createFarm(user), { id: created.id, duplicate: true });
    const [farm] = (await t.ops.farms(user)).items;
    assert.equal(farm.id, created.id);
    assert.equal(farm.role, 'owner');
    assert.equal(farm.timezone, 'Asia/Kolkata');
    assert.equal(farm.name, "New Farmer's farm");
    const task = await t.ops.createTask(user, farm.id, { title: 'Field inspection', type: 'inspection', localDate: '2026-09-19', isAllDay: true });
    assert.equal((await t.ops.overview(user, farm.id, '2026-09-19')).summary.total, 1, task.id);
  } finally { await t.close(); }
});

test('a farmer can run several farms, each in its own region', async () => {
  const t = await setup();
  try {
    const regionId = (await t.pool.query("SELECT id FROM app.regions WHERE code='IN-BR'")).rows[0].id;
    const { user } = await t.auth.signup({ phone: '9199999998', pin: '135790', displayName: 'Two Farms', village: 'Hajipur', regionId });
    const home = await t.ops.createFarm(user, { name: 'Home plot' });
    const coop = await t.ops.createFarm(user, { name: 'River cooperative', regionCode: 'IN-UP-01' });
    assert.notEqual(home.id, coop.id);
    assert.deepEqual(await t.ops.createFarm(user, { name: '  home PLOT ' }), { id: home.id, duplicate: true }, 'same name again is the same farm');
    const items = (await t.ops.farms(user)).items;
    assert.deepEqual(items.map((f) => [f.name, f.region_code, f.role]), [['Home plot', 'IN-BR', 'owner'], ['River cooperative', 'IN-UP-01', 'owner']]);
    assert.ok(items.every((f) => f.region_name), 'the list names each farm\'s region');
    await assert.rejects(() => t.ops.createFarm(user, { name: 'Nowhere', regionCode: 'XX-NONE' }), (e) => e.code === 'VALIDATION_ERROR' && e.field === 'regionCode');
    await assert.rejects(() => t.ops.createFarm(user, { name: 'x'.repeat(81) }), (e) => e.code === 'VALIDATION_ERROR');
    // Each farm keeps its own work.
    await t.ops.createTask(user, coop.id, { title: 'Canal check', type: 'irrigation', localDate: '2026-09-19', isAllDay: true });
    assert.equal((await t.ops.overview(user, home.id, '2026-09-19')).summary.total, 0);
    assert.equal((await t.ops.overview(user, coop.id, '2026-09-19')).summary.total, 1);
  } finally { await t.close(); }
});

test('the weather row follows the chosen day: now, a forecast, or plainly nothing', async () => {
  const { dayWeather } = await import('../services/farmOpsService.js');
  const weather = { current: { time: '2026-09-19T10:00' }, daily: [
    { date: '2026-09-19', code: 1, tmin: 22, tmax: 31, rain_prob: 10, rain_mm: 0, wind_max: 9 },
    { date: '2026-09-20', code: 61, tmin: 21, tmax: 29, rain_prob: 70, rain_mm: 8, wind_max: 14 }] };
  assert.equal(dayWeather(weather, '2026-09-19').basis, 'now');
  assert.deepEqual(dayWeather(weather, '2026-09-20'), { basis: 'forecast', date: '2026-09-20', code: 61, tmin: 21, tmax: 29, rainProb: 70, rainMm: 8, windMax: 14 });
  assert.equal(dayWeather(weather, '2026-09-18').basis, 'past');
  assert.equal(dayWeather(weather, '2026-10-01').basis, 'beyond');
  assert.equal(dayWeather(null, '2026-09-19'), null);
});

const taskByTitle = async (t, title) => (await t.pool.query(`SELECT id, status, local_date::text AS local_day, start_at, due_at, blocked_reason, delayed_reason
  FROM app.farm_tasks WHERE farm_id=$1 AND title=$2`, [FARM_DEMO_ID, title])).rows[0];

test('unblocking returns work to its assignee, or to the schedule, and clears the reason', async () => {
  const t = await setup();
  try {
    const spray = await taskByTitle(t, 'Spray vegetable plot'); // blocked, assigned to the manager
    await assert.rejects(() => t.ops.transition(t.worker, spray.id, 'assigned'), (e) => ['ROLE_REQUIRED'].includes(e.code));
    assert.equal((await t.ops.transition(t.owner, spray.id, 'assigned')).status, 'assigned');
    assert.equal((await taskByTitle(t, 'Spray vegetable plot')).blocked_reason, null);
    const leaf = await taskByTitle(t, 'Check rice leaf spots'); // assigned to the manager
    await t.pool.query(`UPDATE app.farm_task_assignments SET status='removed' WHERE task_id=$1`, [leaf.id]);
    await t.pool.query(`UPDATE app.farm_tasks SET status='blocked', blocked_reason='Pump broken' WHERE id=$1`, [leaf.id]);
    assert.equal((await t.ops.transition(t.manager, leaf.id, 'assigned')).status, 'scheduled', 'no one had it');
  } finally { await t.close(); }
});

test('owners and managers reassign tasks; the new assignee accepts again', async () => {
  const t = await setup();
  try {
    const water = await taskByTitle(t, 'Irrigate north section'); // in progress
    const leaf = await taskByTitle(t, 'Check rice leaf spots');   // assigned to the manager
    await t.ops.transition(t.manager, leaf.id, 'accepted');
    await assert.rejects(() => t.ops.assign(t.worker, leaf.id, { userId: t.worker.id }), (e) => e.code === 'ROLE_REQUIRED');
    await assert.rejects(() => t.ops.assign(t.owner, leaf.id, { userId: t.viewer.id }), (e) => e.field === 'userId');
    await assert.rejects(() => t.ops.assign(t.owner, leaf.id, { userId: 'nope' }), (e) => e.field === 'userId');
    assert.equal((await t.ops.assign(t.owner, leaf.id, { userId: t.worker.id })).status, 'assigned', 'accepted work must be accepted again');
    const people = (await t.pool.query(`SELECT user_id, status FROM app.farm_task_assignments WHERE task_id=$1 AND status<>'removed'`, [leaf.id])).rows;
    assert.deepEqual(people.map((p) => p.user_id), [t.worker.id], 'the previous assignee is removed');
    assert.equal((await t.ops.getTask(t.worker, leaf.id)).item.assignments[0].userId, t.worker.id);
    assert.equal((await t.ops.assign(t.owner, water.id, { userId: t.worker.id })).status, 'in_progress');
    const done = await taskByTitle(t, 'Record tomato soil moisture');
    await assert.rejects(() => t.ops.assign(t.owner, done.id, { userId: t.worker.id }), (e) => e.code === 'INVALID_STATUS_TRANSITION');
  } finally { await t.close(); }
});

test('moving a task keeps its time of day and puts delayed work back on the plan', async () => {
  const t = await setup();
  try {
    const pump = await taskByTitle(t, 'Inspect pump'); // 2026-09-18, assigned to the owner
    await t.ops.transition(t.owner, pump.id, 'delayed', { reason: 'Waiting for parts' });
    await assert.rejects(() => t.ops.reschedule(t.worker, pump.id, { localDate: '2026-09-21' }), (e) => e.code === 'ROLE_REQUIRED');
    await assert.rejects(() => t.ops.reschedule(t.owner, pump.id, { localDate: '21-09-2026' }), (e) => e.field === 'localDate');
    assert.deepEqual(await t.ops.reschedule(t.owner, pump.id, { localDate: '2026-09-21' }), { id: pump.id, status: 'assigned', localDate: '2026-09-21' });
    const moved = await taskByTitle(t, 'Inspect pump');
    assert.equal(moved.local_day, '2026-09-21');
    assert.equal(moved.delayed_reason, null);
    assert.equal(new Date(moved.start_at) - new Date(pump.start_at), 3 * 86400000);
    assert.equal(new Date(moved.due_at) - new Date(pump.due_at), 3 * 86400000);
    const overview = await t.ops.overview(t.owner, FARM_DEMO_ID, '2026-09-19');
    assert.ok(!overview.sections.overdue.some((x) => x.id === pump.id), 'no longer overdue');
  } finally { await t.close(); }
});

test('work still in progress from an earlier day is "in progress", not overdue', async () => {
  const t = await setup();
  try {
    const next = await t.ops.overview(t.owner, FARM_DEMO_ID, '2026-09-20');
    assert.ok(next.sections.inProgress.some((x) => x.title === 'Irrigate north section'));
    assert.ok(!next.sections.overdue.some((x) => x.title === 'Irrigate north section'));
    assert.ok(next.sections.overdue.some((x) => x.title === 'Inspect pump'), 'not started is still overdue');
  } finally { await t.close(); }
});

test('the market row covers the crops the farm grows, else the member\'s crops', async () => {
  const t = await setup();
  try {
    const asked = [];
    const farmPriceService = { async getFarmPrices(farm, crop) {
      asked.push(crop);
      return crop === 'onion' ? null : { crop, provider: 'agmarknet', source: 'live', stale: false, fetchedAt: 'now',
        localMarket: { modalPrice: 2000 }, nearbyMarkets: [], sevenDayTrend: [1900, 2000] };
    } };
    const ops = createFarmOpsService(t.pool, { farmPriceService });
    const demo = await ops.overview(t.owner, FARM_DEMO_ID, '2026-09-19');
    assert.deepEqual(demo.marketSnapshots.map((m) => m.crop), ['rice', 'tomato'], 'from the crop cycles, earliest planted first');
    assert.equal(demo.marketSnapshot.crop, 'rice');

    const regionId = (await t.pool.query("SELECT id FROM app.regions WHERE code='IN-BR'")).rows[0].id;
    const { user } = await t.auth.signup({ phone: '9199999997', pin: '135790', displayName: 'No Cycles', village: 'Hajipur', regionId });
    const farm = await ops.createFarm(user, { name: 'Bare farm' });
    asked.length = 0;
    const bare = await ops.overview({ ...user, cropCodes: ['onion', 'wheat'] }, farm.id, '2026-09-19');
    assert.deepEqual(asked, ['onion', 'wheat']);
    assert.deepEqual(bare.marketSnapshots.map((m) => m.crop), ['wheat'], 'crops without prices are left out');
    asked.length = 0;
    await ops.overview({ ...user, cropCodes: [] }, farm.id, '2026-09-19');
    assert.deepEqual(asked, ['rice']);
  } finally { await t.close(); }
});

test('tasks can be listed for one member or one field, open ones only', async () => {
  const t = await setup();
  try {
    const q = (query) => t.ops.listTasks(t.owner, FARM_DEMO_ID, query).then((r) => r.items.map((x) => x.title).sort());
    const meena = await q({ assignee: t.manager.id, open: 'true' });
    assert.deepEqual(meena, ['Check rice leaf spots', 'Inspect weeds', 'Spray vegetable plot']);
    const field = (await t.pool.query(`SELECT id FROM app.farm_fields WHERE farm_id=$1 AND name='Vegetable Plot'`, [FARM_DEMO_ID])).rows[0].id;
    assert.ok(!(await q({ field, open: 'true' })).includes('Record tomato soil moisture'), 'completed work is left out');
    assert.ok((await q({ field })).includes('Record tomato soil moisture'));
    assert.deepEqual(await q({ assignee: 'not-a-uuid' }), []);
    const fields = (await t.ops.fields(t.owner, FARM_DEMO_ID)).items;
    assert.equal(fields.find((f) => f.name === 'Field A').cycles[0].variety, 'Swarna');
  } finally { await t.close(); }
});
