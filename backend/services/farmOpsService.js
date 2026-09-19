import { AppError, validation } from '../middleware/errors.js';
import { assessSprayConditions } from './sprayAssessment.js';
import { marketSnapshot } from './priceService.js';

const ROLES = ['owner', 'manager', 'worker', 'viewer'];
const MANAGE = new Set(['owner', 'manager']);
const TYPES = new Set(['inspection','irrigation','fertilizer','spraying','weeding','planting','harvest','machinery','livestock','transport','market','record','custom']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const TRANSITIONS = {
  draft: ['scheduled'], scheduled: ['assigned', 'cancelled'], assigned: ['accepted', 'delayed', 'cancelled'],
  accepted: ['in_progress', 'delayed'], in_progress: ['completed', 'blocked', 'delayed'],
  completed: ['verified', 'in_progress'], blocked: ['assigned', 'scheduled', 'cancelled'],
  delayed: ['scheduled', 'assigned', 'cancelled'],
};

const fail = (code, message) => { throw new AppError(code, message); };
const dateOnly = (v, field = 'date') => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '') || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw validation(`Invalid ${field}.`, field);
  return v;
};
const text = (v, field, max = 120) => {
  const out = String(v ?? '').trim();
  if (!out || out.length > max) throw validation(`${field} is required (maximum ${max} characters).`, field);
  return out;
};
const json = (v) => v == null ? null : v;

// What the dashboard's weather row shows for the chosen day: the conditions now for today, that
// day's forecast within the next week, and nothing (said plainly) for other days.
export function dayWeather(weather, day) {
  if (!weather) return null;
  const today = weather.current?.time ? String(weather.current.time).slice(0, 10) : null;
  if (!today || day === today) return { basis: 'now', date: day };
  const d = (weather.daily || []).find((x) => x.date === day);
  if (!d) return { basis: day < today ? 'past' : 'beyond', date: day };
  return { basis: 'forecast', date: day, code: d.code, tmin: d.tmin, tmax: d.tmax, rainProb: d.rain_prob, rainMm: d.rain_mm, windMax: d.wind_max ?? null };
}

export function createFarmOpsService(pool, { farmPriceService = null, weatherGetter = null } = {}) {
  async function membership(userId, farmId, roles = ROLES) {
    const r = await pool.query(`SELECT f.*, m.role FROM app.farms f JOIN app.farm_members m ON m.farm_id=f.id
      WHERE f.id=$1 AND m.user_id=$2 AND m.status='active' AND f.status='active'`, [farmId, userId]);
    const row = r.rows[0];
    if (!row) fail('FARM_ACCESS_DENIED', 'You do not have access to this farm.');
    if (!roles.includes(row.role)) fail('ROLE_REQUIRED', 'Your farm role cannot perform this action.');
    return row;
  }

  const taskSelect = `SELECT t.*, f.name field_name, c.crop_code,
      COALESCE(json_agg(json_build_object('userId',a.user_id,'name',p.display_name,'role',a.assignment_role,'status',a.status))
        FILTER (WHERE a.user_id IS NOT NULL), '[]') assignments
    FROM app.farm_tasks t
    LEFT JOIN app.farm_fields f ON f.id=t.field_id
    LEFT JOIN app.crop_cycles c ON c.id=t.crop_cycle_id
    LEFT JOIN app.farm_task_assignments a ON a.task_id=t.id AND a.status <> 'removed'
    LEFT JOIN app.user_profiles p ON p.user_id=a.user_id`;
  const taskGroup = ' GROUP BY t.id, f.name, c.crop_code';
  const isoDate = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const shapeTask = (t) => ({ ...t, localDate: isoDate(t.local_date), fieldName: t.field_name, cropCode: t.crop_code });

  async function farms(user) {
    const r = await pool.query(`SELECT f.id,f.name,f.timezone,f.country_code,f.region_code,m.role,
      (SELECT name FROM app.regions WHERE code=f.region_code) region_name,
      (SELECT count(*)::int FROM app.farm_tasks t WHERE t.farm_id=f.id AND t.local_date=(now() AT TIME ZONE f.timezone)::date
       AND t.status NOT IN ('completed','verified','cancelled','skipped')) open_tasks
      FROM app.farms f JOIN app.farm_members m ON m.farm_id=f.id
      WHERE m.user_id=$1 AND m.status='active' AND f.status='active' ORDER BY f.name`, [user.id]);
    return { items: r.rows };
  }

  // A farmer can run several farms (their own plots, a family farm, a cooperative). A farm takes a
  // name and a region (default: the profile's), whose centre point gives it weather and nearby
  // mandis, and the region's country timezone. The same name again returns the existing farm, so a
  // repeated keypad submit never makes a second copy.
  const TIMEZONES = { IN: 'Asia/Kolkata', VN: 'Asia/Ho_Chi_Minh', BD: 'Asia/Dhaka', TW: 'Asia/Taipei' };
  const MAX_OWNED_FARMS = 10;
  async function createFarm(user, body = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`farm-owner:${user.id}`]);
      const profile = (await client.query(`SELECT p.display_name, r.code FROM app.user_profiles p
        JOIN app.regions r ON r.id=p.region_id WHERE p.user_id=$1`, [user.id])).rows[0];
      if (!profile) fail('PROFILE_REQUIRED', 'Complete your profile first.');
      const name = body.name == null || body.name === '' ? `${profile.display_name}'s farm`.slice(0, 80) : text(body.name, 'name', 80);
      const existing = (await client.query(`SELECT id FROM app.farms WHERE owner_user_id=$1 AND status='active' AND lower(name)=lower($2)`, [user.id, name])).rows[0];
      if (existing) { await client.query('COMMIT'); return { id: existing.id, duplicate: true }; }
      const owned = (await client.query(`SELECT count(*)::int n FROM app.farms WHERE owner_user_id=$1 AND status='active'`, [user.id])).rows[0].n;
      if (owned >= MAX_OWNED_FARMS) throw validation(`You can own up to ${MAX_OWNED_FARMS} farms.`, 'name');
      const regionCode = body.regionCode == null || body.regionCode === '' ? profile.code : String(body.regionCode);
      const region = (await client.query('SELECT code, country_code, latitude, longitude FROM app.regions WHERE code=$1', [regionCode])).rows[0];
      if (!region) throw validation('Choose a region.', 'regionCode');
      const farm = (await client.query(`INSERT INTO app.farms(name,owner_user_id,country_code,region_code,timezone,latitude,longitude)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [name, user.id, region.country_code, region.code, TIMEZONES[region.country_code] || 'UTC', region.latitude, region.longitude])).rows[0];
      await client.query(`INSERT INTO app.farm_members(farm_id,user_id,role,status,accepted_at) VALUES ($1,$2,'owner','active',now())`, [farm.id, user.id]);
      await client.query('COMMIT');
      return { id: farm.id, duplicate: false };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }

  async function overview(user, farmId, requestedDate) {
    const farm = await membership(user.id, farmId);
    const day = requestedDate ? dateOnly(requestedDate) : (await pool.query(`SELECT (now() AT TIME ZONE $1)::date::text day`, [farm.timezone])).rows[0].day;
    const rows = (await pool.query(taskSelect + ` WHERE t.farm_id=$1 AND
      (t.local_date=$2::date OR (t.local_date < $2::date AND t.status NOT IN ('completed','verified','cancelled','skipped')))` + taskGroup +
      ` ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.start_at NULLS LAST, t.created_at`, [farmId, day])).rows.map(shapeTask);
    const section = { blocked: [], overdue: [], inProgress: [], due: [], unassigned: [], completed: [] };
    for (const t of rows) {
      // Work someone is still doing is "in progress", even when it started on an earlier day.
      if (t.status === 'blocked') section.blocked.push(t);
      else if (t.status === 'in_progress') section.inProgress.push(t);
      else if (t.localDate < day && !['completed','verified'].includes(t.status)) section.overdue.push(t);
      else if (['completed','verified'].includes(t.status)) section.completed.push(t);
      else if (!t.assignments.length) section.unassigned.push(t);
      else section.due.push(t);
    }
    const todays = rows.filter((t) => t.localDate === day);
    const crops = await farmCrops(farm, user);
    const [weather, prices, communityActivity] = await Promise.all([
      weatherForFarm(farm),
      Promise.all(crops.map((crop) => (farmPriceService ? farmPriceService.getFarmPrices(farm, crop).catch(() => null) : null))),
      communityFor(user, day),
    ]);
    const marketSnapshots = prices.map(marketSnapshot).filter(Boolean);
    const sprayAssessment = todays.some((t) => ['spraying','fertilizer'].includes(t.type)) && weather ? assessSprayConditions(weather, { date: day }) : null;
    return { farm: { id: farm.id, name: farm.name, timezone: farm.timezone, role: farm.role }, date: day,
      weather, weatherDay: dayWeather(weather, day), sprayAssessment, marketSnapshot: marketSnapshots[0] || null, marketSnapshots, communityActivity, alerts: [],
      sections: { ...section, dueToday: section.due, completedToday: section.completed },
      summary: { total: todays.filter((t) => !['cancelled','skipped'].includes(t.status)).length,
        completed: todays.filter((t) => ['completed','verified'].includes(t.status)).length,
        inProgress: todays.filter((t) => t.status === 'in_progress').length,
        blocked: todays.filter((t) => t.status === 'blocked').length,
        pending: todays.filter((t) => !['completed','verified','cancelled','skipped','in_progress','blocked'].includes(t.status)).length } };
  }

  // The crops this farm grows (its planned and active crop cycles, earliest planted first); a farm
  // with no cycles yet uses the member's own crops, and rice when there are none. At most three.
  async function farmCrops(farm, user) {
    const r = await pool.query(`SELECT crop_code FROM app.crop_cycles WHERE farm_id=$1 AND status IN ('planned','active')
      GROUP BY crop_code ORDER BY min(planting_date) NULLS LAST, crop_code`, [farm.id]);
    const list = r.rows.map((x) => x.crop_code);
    if (!list.length) list.push(...(user.cropCodes || []));
    if (!list.length) list.push('rice');
    return [...new Set(list)].slice(0, 3);
  }

  async function weatherForFarm(farm) {
    if (weatherGetter && farm.latitude != null && farm.longitude != null) {
      try {
        const weather = await weatherGetter(Number(farm.latitude), Number(farm.longitude));
        await pool.query(`INSERT INTO app.farm_weather_snapshots(farm_id,provider,payload,fetched_at,expires_at)
          SELECT $1,'open-meteo',$2,now(),now()+interval '30 minutes'
          WHERE NOT EXISTS (SELECT 1 FROM app.farm_weather_snapshots WHERE farm_id=$1 AND provider='open-meteo' AND fetched_at>now()-interval '25 minutes')`,
        [farm.id, weather]);
        return weather;
      } catch { /* use persisted snapshot */ }
    }
    // Upstream failed: the last stored forecast, marked stale with its age.
    const row = (await pool.query(`SELECT payload,fetched_at FROM app.farm_weather_snapshots WHERE farm_id=$1
      ORDER BY fetched_at DESC LIMIT 1`, [farm.id])).rows[0];
    return row ? { ...row.payload, stale: true, fetchedAt: new Date(row.fetched_at).toISOString() } : null;
  }

  async function communityFor(user, day) {
    const row = (await pool.query(`SELECT
      (SELECT count(*)::int FROM app.forum_replies r JOIN app.forum_posts p ON p.id=r.post_id
       WHERE p.author_id=$1 AND r.author_id<>$1 AND r.created_at>COALESCE((SELECT notifications_seen_at FROM app.forum_user_state WHERE user_id=$1),'-infinity')) unread_replies,
      (SELECT count(*)::int FROM app.forum_posts WHERE created_at >= $2::date AND created_at < $2::date + interval '1 day') new_posts_today`, [user.id, day])).rows[0];
    return { unreadReplies: row.unread_replies, newPostsToday: row.new_posts_today };
  }

  async function prices(user, farmId, crop = 'rice') {
    const farm = await membership(user.id, farmId);
    if (!farmPriceService) return { item: null };
    return { item: await farmPriceService.getFarmPrices(farm, crop) };
  }

  async function sprayAssessment(user, farmId, requestedDate) {
    const farm = await membership(user.id, farmId);
    const day = requestedDate ? dateOnly(requestedDate) : new Date().toISOString().slice(0, 10);
    const exists = (await pool.query(`SELECT 1 FROM app.farm_tasks WHERE farm_id=$1 AND local_date=$2::date
      AND type IN ('spraying','fertilizer') AND status NOT IN ('cancelled','skipped') LIMIT 1`, [farmId, day])).rowCount;
    if (!exists) return null;
    const weather = await weatherForFarm(farm);
    const assessment = weather ? assessSprayConditions(weather, { date: day }) : null;
    return assessment ? { sprayAssessment: assessment, weather } : null;
  }

  async function calendar(user, farmId, q) {
    await membership(user.id, farmId);
    const from = dateOnly(q.from, 'from'); const to = dateOnly(q.to, 'to');
    const params = [farmId, from, to];
    let mine = '';
    if (q.mine === 'true') { params.push(user.id); mine = ` AND EXISTS (SELECT 1 FROM app.farm_task_assignments a WHERE a.task_id=t.id AND a.user_id=$4 AND a.status<>'removed')`; }
    const r = await pool.query(`SELECT t.local_date::text date, count(*)::int total,
      count(*) FILTER (WHERE t.status IN ('completed','verified'))::int completed,
      count(*) FILTER (WHERE t.status='blocked')::int blocked,
      count(*) FILTER (WHERE t.priority='urgent')::int urgent,
      COALESCE(sum(t.estimated_minutes),0)::int estimated_minutes
      FROM app.farm_tasks t WHERE t.farm_id=$1 AND t.local_date BETWEEN $2::date AND $3::date ${mine}
      GROUP BY t.local_date ORDER BY t.local_date`, params);
    return { days: r.rows };
  }

  async function listTasks(user, farmId, q = {}) {
    await membership(user.id, farmId);
    const params = [farmId]; const where = ['t.farm_id=$1'];
    if (q.from) { params.push(dateOnly(q.from, 'from')); where.push(`t.local_date >= $${params.length}::date`); }
    if (q.to) { params.push(dateOnly(q.to, 'to')); where.push(`t.local_date <= $${params.length}::date`); }
    if (q.mine === 'true') { params.push(user.id); where.push(`EXISTS (SELECT 1 FROM app.farm_task_assignments ma WHERE ma.task_id=t.id AND ma.user_id=$${params.length} AND ma.status<>'removed')`); }
    if (q.status) { params.push(q.status); where.push(`t.status=$${params.length}`); }
    // One member's or one field's work, e.g. for the Team and Fields detail screens.
    if (q.assignee) { params.push(String(q.assignee)); where.push(`EXISTS (SELECT 1 FROM app.farm_task_assignments aa WHERE aa.task_id=t.id AND aa.user_id::text=$${params.length} AND aa.status<>'removed')`); }
    if (q.field) { params.push(String(q.field)); where.push(`t.field_id::text=$${params.length}`); }
    if (q.open === 'true') where.push(`t.status NOT IN ('completed','verified','cancelled','skipped')`);
    const rows = (await pool.query(taskSelect + ` WHERE ${where.join(' AND ')}` + taskGroup + ` ORDER BY t.local_date,t.start_at NULLS LAST`, params)).rows.map(shapeTask);
    return { items: rows };
  }

  async function getTask(user, id) {
    const r = await pool.query(taskSelect + ' WHERE t.id=$1' + taskGroup, [id]);
    if (!r.rows[0]) fail('NOT_FOUND', 'Task not found.');
    const farm = await membership(user.id, r.rows[0].farm_id);
    const [checklist, events, result] = await Promise.all([
      pool.query('SELECT * FROM app.farm_task_checklist_items WHERE task_id=$1 ORDER BY sort_order', [id]),
      pool.query(`SELECT e.*, p.display_name actor_name FROM app.farm_task_events e LEFT JOIN app.user_profiles p ON p.user_id=e.actor_user_id WHERE task_id=$1 ORDER BY created_at`, [id]),
      pool.query('SELECT * FROM app.farm_task_results WHERE task_id=$1', [id]),
    ]);
    const weather = ['spraying','fertilizer'].includes(r.rows[0].type) ? await weatherForFarm(farm) : null;
    return { item: shapeTask(r.rows[0]), checklist: checklist.rows, events: events.rows, result: result.rows[0] || null,
      sprayAssessment: weather ? assessSprayConditions(weather, { date: isoDate(r.rows[0].local_date) }) : null };
  }

  async function createTask(user, farmId, b) {
    const farm = await membership(user.id, farmId, ['owner', 'manager']);
    const title = text(b.title, 'title'); const type = b.type || 'custom'; const priority = b.priority || 'normal';
    if (!TYPES.has(type)) throw validation('Unknown task type.', 'type');
    if (!PRIORITIES.has(priority)) throw validation('Unknown priority.', 'priority');
    const localDate = dateOnly(b.localDate, 'localDate');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (b.requestId) {
        const old = (await client.query('SELECT id FROM app.farm_tasks WHERE farm_id=$1 AND created_by=$2 AND request_id=$3', [farmId, user.id, b.requestId])).rows[0];
        if (old) { await client.query('COMMIT'); return { id: old.id, duplicate: true }; }
      }
      const assignees = Array.isArray(b.assignees) ? b.assignees : [];
      for (const a of assignees) {
        const ok = await client.query(`SELECT 1 FROM app.farm_members WHERE farm_id=$1 AND user_id=$2 AND status='active'`, [farmId, a.userId]);
        if (!ok.rows[0]) fail('FARM_ACCESS_DENIED', 'An assignee is not an active farm member.');
      }
      const status = assignees.length ? 'assigned' : 'scheduled';
      const r = await client.query(`INSERT INTO app.farm_tasks
        (request_id,farm_id,field_id,crop_cycle_id,created_by,title,description,type,priority,status,is_all_day,local_date,start_at,due_at,timezone,estimated_minutes,verification_required,weather_constraints)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [b.requestId || null, farmId, b.fieldId || null, b.cropCycleId || null, user.id, title, b.description || null, type, priority, status,
        Boolean(b.isAllDay), localDate, b.startAt || null, b.dueAt || null, farm.timezone, b.estimatedMinutes || null, Boolean(b.verificationRequired), json(b.weatherConstraints)]);
      const id = r.rows[0].id;
      for (const [i, c] of (Array.isArray(b.checklist) ? b.checklist : []).entries()) await client.query(
        `INSERT INTO app.farm_task_checklist_items(task_id,label,sort_order,is_required) VALUES ($1,$2,$3,$4)`, [id, text(c.label, 'checklist label', 160), i, c.required !== false]);
      for (const a of assignees) await client.query(`INSERT INTO app.farm_task_assignments(task_id,user_id,assignment_role,assigned_by) VALUES ($1,$2,$3,$4)`, [id, a.userId, a.role === 'helper' ? 'helper' : 'primary', user.id]);
      await client.query(`INSERT INTO app.farm_task_events(task_id,actor_user_id,event_type,to_status,data) VALUES ($1,$2,'created',$3,$4)`, [id, user.id, status, { requestId: b.requestId || null }]);
      await client.query('COMMIT'); return { id, duplicate: false };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }

  async function transition(user, id, requested, body = {}) {
    let to = requested;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const task = (await client.query('SELECT * FROM app.farm_tasks WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!task) fail('NOT_FOUND', 'Task not found.');
      const farm = await membership(user.id, task.farm_id);
      const manager = MANAGE.has(farm.role);
      const assigned = (await client.query(`SELECT 1 FROM app.farm_task_assignments WHERE task_id=$1 AND user_id=$2 AND status<>'removed'`, [id, user.id])).rows[0];
      if (!manager && !assigned) fail('ROLE_REQUIRED', 'This task is not assigned to you.');
      // Unblocking hands the work back to whoever had it, or to the schedule when no one did.
      if (task.status === 'blocked' && to === 'assigned' && !(await client.query(
        `SELECT 1 FROM app.farm_task_assignments WHERE task_id=$1 AND status<>'removed' LIMIT 1`, [id])).rows[0]) to = 'scheduled';
      const allowed = TRANSITIONS[task.status] || [];
      if (!allowed.includes(to)) fail('INVALID_STATUS_TRANSITION', `Cannot change ${task.status} to ${to}.`);
      if (['verified','cancelled','assigned','scheduled'].includes(to) && !manager) fail('ROLE_REQUIRED', 'A manager is required for this action.');
      if (to === 'in_progress') {
        const blocked = await client.query(`SELECT d.depends_on_task_id FROM app.farm_task_dependencies d JOIN app.farm_tasks t ON t.id=d.depends_on_task_id WHERE d.task_id=$1 AND t.status NOT IN ('completed','verified') LIMIT 1`, [id]);
        if (blocked.rows[0]) fail('TASK_DEPENDENCY_BLOCKED', 'Finish the blocking task before starting this task.');
      }
      if (to === 'completed') {
        const incomplete = await client.query(`SELECT 1 FROM app.farm_task_checklist_items WHERE task_id=$1 AND is_required AND completed_at IS NULL LIMIT 1`, [id]);
        if (incomplete.rows[0]) fail('CHECKLIST_INCOMPLETE', 'Complete all required checklist items first.');
        let weatherSnapshot = body.weatherSnapshot || null;
        if (['spraying','fertilizer'].includes(task.type)) weatherSnapshot = (await client.query(
          'SELECT payload FROM app.farm_weather_snapshots WHERE farm_id=$1 ORDER BY fetched_at DESC LIMIT 1', [task.farm_id])).rows[0]?.payload || weatherSnapshot;
        await client.query(`INSERT INTO app.farm_task_results(task_id,completed_by,result_code,result,note,actual_start_at,actual_finish_at,labor_minutes,weather_snapshot,problem_flag)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(task_id) DO NOTHING`, [id, user.id, body.resultCode || 'done', body.result || {}, body.note || null, body.actualStartAt || null, body.actualFinishAt || new Date(), body.laborMinutes || null, weatherSnapshot, Boolean(body.problemFlag)]);
        await client.query(`INSERT INTO app.farm_records(farm_id,field_id,crop_cycle_id,task_id,actor_user_id,record_type,occurred_at,local_date,data)
          VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8)`, [task.farm_id, task.field_id, task.crop_cycle_id, id, user.id, task.type, task.local_date, { resultCode: body.resultCode || 'done', result: body.result || {}, note: body.note || null }]);
      }
      const reasonColumn = to === 'blocked' ? 'blocked_reason' : to === 'delayed' ? 'delayed_reason' : to === 'cancelled' ? 'cancelled_reason' : null;
      const sets = [`status=$2`, 'version=version+1', 'updated_at=now()']; const params = [id, to];
      if (to === 'completed') sets.push('completed_at=now()');
      if (to === 'verified') { sets.push('verified_at=now()'); params.push(user.id); sets.push(`verified_by=$${params.length}`); }
      if (reasonColumn) { params.push(text(body.reason, 'reason', 300)); sets.push(`${reasonColumn}=$${params.length}`); }
      // A reason describes the current state only; the event log keeps the history.
      if (task.status === 'blocked' && to !== 'blocked') sets.push('blocked_reason=NULL');
      if (task.status === 'delayed' && to !== 'delayed') sets.push('delayed_reason=NULL');
      await client.query(`UPDATE app.farm_tasks SET ${sets.join(',')} WHERE id=$1`, params);
      await client.query(`INSERT INTO app.farm_task_events(task_id,actor_user_id,event_type,from_status,to_status,data) VALUES ($1,$2,'status_changed',$3,$4,$5)`, [id, user.id, task.status, to, body]);
      if (to === 'accepted') await client.query(`UPDATE app.farm_task_assignments SET status='accepted',responded_at=now() WHERE task_id=$1 AND user_id=$2`, [id, user.id]);
      if (to === 'completed') await client.query(`UPDATE app.farm_task_assignments SET status='completed',responded_at=now() WHERE task_id=$1 AND user_id=$2`, [id, user.id]);
      await client.query('COMMIT'); return { id, status: to };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }

  const CLOSED = ['completed', 'verified', 'cancelled', 'skipped'];

  // Owners and managers hand a task to one member (the primary assignee). A new assignee has to
  // accept again, so accepted or delayed work goes back to "assigned"; blocked work stays blocked.
  async function assign(user, id, body = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const task = (await client.query('SELECT * FROM app.farm_tasks WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!task) fail('NOT_FOUND', 'Task not found.');
      await membership(user.id, task.farm_id, ['owner', 'manager']);
      if (CLOSED.includes(task.status)) fail('INVALID_STATUS_TRANSITION', `A ${task.status} task cannot be reassigned.`);
      const to = String(body.userId || '');
      const member = (await client.query(`SELECT role FROM app.farm_members WHERE farm_id=$1 AND user_id::text=$2 AND status='active'`, [task.farm_id, to])).rows[0];
      if (!member) throw validation('Choose a member of this farm.', 'userId');
      if (member.role === 'viewer') throw validation('Viewers cannot be given tasks.', 'userId');
      await client.query(`UPDATE app.farm_task_assignments SET status='removed' WHERE task_id=$1 AND assignment_role='primary' AND user_id<>$2 AND status<>'removed'`, [id, to]);
      await client.query(`INSERT INTO app.farm_task_assignments(task_id,user_id,assignment_role,assigned_by) VALUES ($1,$2,'primary',$3)
        ON CONFLICT(task_id,user_id) DO UPDATE SET assignment_role='primary',status='assigned',assigned_by=EXCLUDED.assigned_by,assigned_at=now(),responded_at=NULL`, [id, to, user.id]);
      const status = task.status === 'blocked' ? 'blocked' : task.status === 'in_progress' ? 'in_progress' : 'assigned';
      const clear = task.status === 'delayed' ? ',delayed_reason=NULL' : '';
      await client.query(`UPDATE app.farm_tasks SET status=$2,version=version+1,updated_at=now()${clear} WHERE id=$1`, [id, status]);
      await client.query(`INSERT INTO app.farm_task_events(task_id,actor_user_id,event_type,from_status,to_status,data) VALUES ($1,$2,'assigned',$3,$4,$5)`,
        [id, user.id, task.status, status, { userId: to }]);
      await client.query('COMMIT'); return { id, status };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }

  // Moves a task to another farm day, keeping its time of day. Delayed work is back on the plan.
  async function reschedule(user, id, body = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const task = (await client.query('SELECT *, local_date::text AS local_day FROM app.farm_tasks WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!task) fail('NOT_FOUND', 'Task not found.');
      await membership(user.id, task.farm_id, ['owner', 'manager']);
      if (CLOSED.includes(task.status)) fail('INVALID_STATUS_TRANSITION', `A ${task.status} task cannot be moved.`);
      const day = dateOnly(body.localDate, 'localDate');
      const shift = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${task.local_day}T00:00:00Z`)) / 86400000);
      let status = task.status;
      if (status === 'delayed') {
        status = (await client.query(`SELECT 1 FROM app.farm_task_assignments WHERE task_id=$1 AND status<>'removed' LIMIT 1`, [id])).rows[0] ? 'assigned' : 'scheduled';
      }
      await client.query(`UPDATE app.farm_tasks SET local_date=$2::date, start_at=start_at + make_interval(days => $3::int),
        due_at=due_at + make_interval(days => $3::int), status=$4, delayed_reason=CASE WHEN $4='delayed' THEN delayed_reason END,
        version=version+1, updated_at=now() WHERE id=$1`, [id, day, shift, status]);
      await client.query(`INSERT INTO app.farm_task_events(task_id,actor_user_id,event_type,from_status,to_status,data) VALUES ($1,$2,'rescheduled',$3,$4,$5)`,
        [id, user.id, task.status, status, { from: task.local_day, to: day }]);
      await client.query('COMMIT'); return { id, status, localDate: day };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }

  async function checklist(user, taskId, itemId, completed) {
    const task = (await pool.query('SELECT farm_id FROM app.farm_tasks WHERE id=$1', [taskId])).rows[0];
    if (!task) fail('NOT_FOUND', 'Task not found.');
    await membership(user.id, task.farm_id);
    const r = await pool.query(`UPDATE app.farm_task_checklist_items SET completed_at=CASE WHEN $3 THEN now() ELSE NULL END,completed_by=CASE WHEN $3 THEN $4::uuid ELSE NULL END WHERE id=$1 AND task_id=$2 RETURNING *`, [itemId, taskId, Boolean(completed), user.id]);
    if (!r.rows[0]) fail('NOT_FOUND', 'Checklist item not found.');
    return { item: r.rows[0] };
  }

  async function fields(user, farmId) {
    await membership(user.id, farmId);
    const r = await pool.query(`SELECT f.*, COALESCE(json_agg(json_build_object('id',c.id,'cropCode',c.crop_code,'variety',c.variety,'stage',c.stage,'plantingDate',c.planting_date,'targetHarvestDate',c.target_harvest_date,'status',c.status)) FILTER (WHERE c.id IS NOT NULL),'[]') cycles
      FROM app.farm_fields f LEFT JOIN app.crop_cycles c ON c.field_id=f.id AND c.status IN ('planned','active') WHERE f.farm_id=$1 GROUP BY f.id ORDER BY f.name`, [farmId]);
    return { items: r.rows };
  }
  async function members(user, farmId) {
    await membership(user.id, farmId);
    const r = await pool.query(`SELECT m.user_id,m.role,m.status,p.display_name,p.village,
      count(a.task_id) FILTER (WHERE t.status NOT IN ('completed','verified','cancelled','skipped'))::int open_tasks,
      COALESCE(sum(t.estimated_minutes) FILTER (WHERE t.status NOT IN ('completed','verified','cancelled','skipped')),0)::int workload_minutes
      FROM app.farm_members m JOIN app.user_profiles p ON p.user_id=m.user_id LEFT JOIN app.farm_task_assignments a ON a.user_id=m.user_id AND a.status<>'removed' LEFT JOIN app.farm_tasks t ON t.id=a.task_id AND t.farm_id=m.farm_id
      WHERE m.farm_id=$1 AND m.status='active' GROUP BY m.user_id,m.role,m.status,p.display_name,p.village ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,p.display_name`, [farmId]);
    return { items: r.rows };
  }
  async function records(user, farmId, q = {}) {
    await membership(user.id, farmId);
    const params = [farmId]; const where = ['r.farm_id=$1'];
    if (q.from) { params.push(dateOnly(q.from, 'from')); where.push(`r.local_date >= $${params.length}::date`); }
    if (q.to) { params.push(dateOnly(q.to, 'to')); where.push(`r.local_date <= $${params.length}::date`); }
    const r = await pool.query(`SELECT r.*,f.name field_name,p.display_name actor_name,t.title task_title FROM app.farm_records r LEFT JOIN app.farm_fields f ON f.id=r.field_id LEFT JOIN app.user_profiles p ON p.user_id=r.actor_user_id LEFT JOIN app.farm_tasks t ON t.id=r.task_id WHERE ${where.join(' AND ')} ORDER BY r.occurred_at DESC LIMIT 100`, params);
    return { items: r.rows };
  }
  return { farms, createFarm, membership, overview, prices, sprayAssessment, calendar, listTasks, getTask, createTask, transition, assign, reschedule, checklist, fields, members, records };
}
