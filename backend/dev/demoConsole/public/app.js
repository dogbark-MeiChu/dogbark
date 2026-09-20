// Operator GUI. Everything is rendered from /api/state, so the option lists in the forms are always
// the rows that exist right now on the VM.
const $ = (sel) => document.querySelector(sel);
let snap = null;          // { state, options, actions }
let tab = 'listings';
let timer = null;
let renderedOptions = '';   // the option lists the action forms were last built from
let mode = 'console';
let sheet = [];
let stepRunning = false;
// Ticks are the operator's place in the script, so they survive a reload mid-demo.
const ticked = new Set(JSON.parse(localStorage.getItem('agrilink.runsheet') || '[]'));
const saveTicks = () => {
  try { localStorage.setItem('agrilink.runsheet', JSON.stringify([...ticked])); } catch { /* private window */ }
};

const api = async (url, body) => {
  const res = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const json = await res.json().catch(() => ({ ok: false, error: 'Bad response' }));
  if (!json.ok) throw new Error(json.error || 'Request failed');
  return json;
};

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tag = (v) => `<span class="tag ${esc(v)}">${esc(v)}</span>`;
const short = (id) => String(id || '').slice(0, 8);
const money = (n, c) => (n == null ? '—' : `${n} ${c || ''}`.trim());

// ---------------------------------------------------------------- status bar
async function refreshStatus() {
  try {
    const { tunnel, db, sshHost, log } = await api('/api/status');
    const t = $('#tunnel');
    t.textContent = tunnel.status + (tunnel.lastError && tunnel.status !== 'up' ? ` — ${tunnel.lastError.split('\n')[0]}` : '');
    t.className = `pill ${tunnel.status}`;
    t.title = tunnel.target + (tunnel.lastError ? `\n${tunnel.lastError}` : '');
    const k = $('#key');
    const key = tunnel.key || { ok: true, note: '' };
    k.textContent = key.ok ? 'ok' : 'unusable';
    k.className = `pill ${key.ok ? 'up' : 'down'}`;
    k.title = `${key.path || '(ssh defaults)'}\n${key.note || ''}`;
    const d = $('#db');
    d.textContent = db.connected ? 'connected' : (db.configured ? 'not connected' : 'not configured');
    d.className = `pill ${db.connected ? 'up' : 'down'}`;
    d.title = db.url || '';
    $('#host').textContent = sshHost;
    $('#btn-tunnel').textContent = ['up', 'external'].includes(tunnel.status) ? 'Restart tunnel' : 'Start tunnel';
    renderLog(log);
  } catch { /* the console itself is local; a blip here is not worth a banner */ }
}

function renderLog(log) {
  const el = $('#log');
  if (!log?.length) { el.innerHTML = '<li class="empty">Nothing yet.</li>'; return; }
  el.innerHTML = log.map((e) => `<li class="${e.ok ? '' : 'bad'}">
    ${esc(e.at.slice(11, 19))} <b>${esc(e.label)}</b> — ${esc(e.message || (e.ok ? 'done' : 'failed'))}</li>`).join('');
}

// ---------------------------------------------------------------- actions
function renderActions() {
  const groups = new Map();
  for (const a of snap.actions) {
    if (!groups.has(a.group)) groups.set(a.group, []);
    groups.get(a.group).push(a);
  }
  $('#actions').innerHTML = [...groups].map(([group, list]) => `
    <section>
      <h2>${esc(group)}</h2>
      ${list.map(renderAction).join('')}
    </section>`).join('');
  for (const form of document.querySelectorAll('form[data-action]')) form.addEventListener('submit', submitAction);
}

function renderAction(a) {
  return `<details class="act">
    <summary><strong>${esc(a.label)}</strong><span class="tag">${esc(a.id)}</span></summary>
    <form data-action="${esc(a.id)}" ${a.confirm ? `data-confirm="${esc(a.confirm)}"` : ''}>
      ${a.hint ? `<div class="hint">${esc(a.hint)}</div>` : ''}
      ${a.fields.map(renderField).join('')}
      <button class="${a.danger ? 'danger' : 'primary'}" type="submit">${esc(a.danger ? 'Run (destructive)' : 'Run')}</button>
      <div class="result" hidden></div>
    </form>
  </details>`;
}

function renderField(f) {
  const id = `f-${Math.random().toString(36).slice(2)}`;
  let input;
  if (f.type === 'select') {
    const opts = f.options || snap.options[f.source] || [];
    input = `<select name="${esc(f.name)}" id="${id}">
      ${f.optional ? '<option value="">(all / none)</option>' : ''}
      ${opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}
    </select>`;
  } else {
    input = `<input name="${esc(f.name)}" id="${id}" type="${esc(f.type)}"
      ${f.step ? `step="${esc(f.step)}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>`;
  }
  return `<div class="field"><label for="${id}">${esc(f.label)}</label>${input}</div>`;
}

async function submitAction(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) return;
  const button = form.querySelector('button[type=submit]');
  const result = form.querySelector('.result');
  const payload = Object.fromEntries(new FormData(form).entries());
  button.disabled = true;
  result.hidden = false;
  result.className = 'result';
  result.textContent = 'Running…';
  try {
    const out = await api(`/api/action/${form.dataset.action}`, payload);
    result.className = 'result ok';
    result.textContent = out.message || 'Done.';
    await load();            // the option lists just changed
  } catch (err) {
    result.className = 'result err';
    result.textContent = err.message;
  } finally {
    button.disabled = false;
    refreshStatus();
  }
}

// ---------------------------------------------------------------- live state
const VIEWS = {
  listings: { title: 'Listings', cols: ['seller', 'cropName', 'qty', 'price', 'status'], row: (l) => [
    l.seller, `${esc(l.cropName)}${l.isDemo ? ' <span class="tag">demo</span>' : ''}`,
    `${l.quantity - l.reserved - l.sold} / ${l.quantity} ${l.unit}`,
    money(l.askingPrice, l.currency) + (l.pricingMode === 'fixed' ? ' (fixed)' : ''), tag(l.status)] },
  buyRequests: { title: 'Buy requests', cols: ['buyer', 'crop', 'qty', 'target', 'status'], row: (b) => [
    b.buyer, b.cropName, `${b.quantity} ${b.unit}`, `${b.min ?? '—'}–${b.max ?? '—'} ${b.currency}`, tag(b.status)] },
  offers: { title: 'Offers', cols: ['id', 'from → to', 'terms', 'turn', 'status'], row: (o) => [
    short(o.id), `${esc(o.proposer)} → ${esc(o.recipient)}`,
    `${o.quantity} ${o.unit} ${esc(o.cropName)} @ ${o.unitPrice} ${o.currency}`,
    ['open', 'countered'].includes(o.status) ? esc(o.responder) : '—',
    `${tag(o.status)} r${o.revision}`] },
  deals: { title: 'Deals', cols: ['id', 'buyer ← seller', 'terms', 'status', 'updated'], row: (d) => [
    short(d.id), `${esc(d.buyer)} ← ${esc(d.seller)}`, `${d.quantity} @ ${d.unitPrice} = ${d.total} ${d.currency}`,
    tag(d.status), String(d.updatedAt).slice(5, 16).replace('T', ' ')] },
  prices: { title: 'Mandi prices', cols: ['crop', 'market', 'modal', 'range', 'date'], row: (p) => [
    `${esc(p.cropName)}${p.variety ? ` <span class="tag">${esc(p.variety)}</span>` : ''}`,
    `${esc(p.market)} <span class="tag">${esc(p.region)}</span>`,
    `<b>${p.modal}</b> ${esc(p.currency)}/${esc(p.unit)}`,
    `${p.min ?? '—'}–${p.max ?? '—'}`,
    `${esc(p.date)} ${p.sample ? '<span class="tag">sample</span>' : ''}${p.source === 'manual' ? '<span class="tag">manual</span>' : ''}`] },
  alerts: { title: 'Price alerts', cols: ['member', 'watch', 'status', 'fired at', 'seen'], row: (a) => [
    a.user, `${esc(a.crop)} ${esc(a.direction)} ${a.threshold} ${esc(a.currency)}`, tag(a.status),
    a.triggeredPrice ? `${a.triggeredPrice} @ ${esc(a.triggeredMarket || '')}` : '—', a.seenAt ? 'yes' : 'no'] },
  notifications: { title: 'Notifications', cols: ['member', 'type', 'payload', 'read', 'at'], row: (n) => [
    n.user, tag(n.type), `<code>${esc(JSON.stringify(n.payload))}</code>`, n.readAt ? 'yes' : 'no',
    String(n.createdAt).slice(5, 16).replace('T', ' ')] },
  users: { title: 'Demo members', cols: ['name', 'village', 'region', 'id', ''], row: (u) => [
    u.name, u.village || '—', u.region, `<code>${short(u.id)}</code>`, ''] },
};

function renderTabs() {
  $('#tabs').innerHTML = Object.entries(VIEWS).map(([key, v]) =>
    `<button data-tab="${key}" class="${key === tab ? 'on' : ''}">${esc(v.title)} (${snap.state[key]?.length ?? 0})</button>`).join('');
  for (const b of document.querySelectorAll('#tabs button')) {
    b.addEventListener('click', () => { tab = b.dataset.tab; renderTabs(); renderTable(); });
  }
}

function renderTable() {
  const view = VIEWS[tab];
  const rows = snap.state[tab] || [];
  if (!rows.length) { $('#table').innerHTML = `<div class="empty">No ${view.title.toLowerCase()}.</div>`; return; }
  $('#table').innerHTML = `<table><thead><tr>${view.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${view.row(r).map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

// ---------------------------------------------------------------- run sheet
const PHASES = [['setup', 'Before you walk on'], ['act', 'The five minutes'], ['teardown', 'After / reset for another run']];

async function loadSheet() {
  try {
    sheet = (await api('/api/runsheet')).steps;
  } catch (err) {
    $('#rs-steps').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    return;
  }
  renderSheet();
}

function renderSheet() {
  const acts = sheet.filter((s) => s.phase === 'act');
  const done = acts.filter((s) => ticked.has(s.id)).length;
  $('#rs-progress').textContent = `${done}/${acts.length} through the script`;
  $('#rs-steps').innerHTML = PHASES.map(([phase, label]) => {
    const list = sheet.filter((s) => s.phase === phase);
    if (!list.length) return '';
    return `<div class="phase">${esc(label)}</div>${list.map(renderStep).join('')}`;
  }).join('');

  for (const el of document.querySelectorAll('#rs-steps .tick')) {
    el.addEventListener('click', () => {
      const { id } = el.closest('.step').dataset;
      if (ticked.has(id)) ticked.delete(id); else ticked.add(id);
      saveTicks(); renderSheet();
    });
  }
  for (const el of document.querySelectorAll('#rs-steps button[data-run]')) {
    el.addEventListener('click', () => runStep(el.dataset.run, el));
  }
}

function renderStep(s) {
  const done = ticked.has(s.id);
  const runnable = Boolean(s.action);
  return `<div class="step ${done ? 'done' : ''}" data-id="${esc(s.id)}">
    <button class="tick" title="tick this step">${done ? '✓' : ''}</button>
    <div class="at">${esc(s.at || '')}</div>
    <div>
      <div class="title">${esc(s.title)} <span class="where ${esc(s.where)}">${esc(s.where)}</span>${s.optional ? ' <span class="tag">optional</span>' : ''}</div>
      ${s.say ? `<div class="say">${esc(s.say)}</div>` : ''}
      ${s.note ? `<div class="stepnote">${esc(s.note)}</div>` : ''}
      ${runnable ? `<div class="row">
        <button data-run="${esc(s.id)}" class="${s.blocked ? '' : 'primary'}" ${s.blocked ? 'disabled' : ''}>Run</button>
        <span class="tag">${esc(s.action)}</span>
        <span class="result" hidden></span>
      </div>` : ''}
      ${s.blocked ? `<div class="blocked">Cannot run: ${esc(s.blocked)}</div>` : ''}
    </div>
  </div>`;
}

async function runStep(id, button) {
  const step = sheet.find((s) => s.id === id);
  const result = button.parentElement.querySelector('.result');
  stepRunning = true;
  button.disabled = true;
  result.hidden = false;
  result.className = 'result';
  result.textContent = 'Running…';
  try {
    const out = await api(`/api/action/${step.action}`, step.params);
    result.className = 'result ok';
    result.textContent = out.message || 'Done.';
    ticked.add(id); saveTicks();          // a step that ran is a step that happened
    await loadSheet();                     // targets moved; re-resolve the rest
  } catch (err) {
    result.className = 'result err';
    result.textContent = err.message;
    button.disabled = false;
  } finally {
    stepRunning = false;
  }
  refreshStatus();
}

function setMode(next) {
  mode = next;
  $('#mode-console').classList.toggle('on', mode === 'console');
  $('#mode-runsheet').classList.toggle('on', mode === 'runsheet');
  $('#view-console').hidden = mode !== 'console';
  $('#view-runsheet').hidden = mode !== 'runsheet';
  if (mode === 'runsheet') loadSheet();
}

$('#mode-console').addEventListener('click', () => setMode('console'));
$('#mode-runsheet').addEventListener('click', () => setMode('runsheet'));
$('#rs-reset').addEventListener('click', () => { ticked.clear(); saveTicks(); renderSheet(); });

// ---------------------------------------------------------------- boot
async function load({ keepForms = false } = {}) {
  try {
    snap = await api('/api/state');
    // The action panel is where the operator is typing. An auto-refresh must never take a
    // half-filled form away mid-demo, so it only re-renders when nothing there is focused, and
    // it puts the open sections and the typed values back.
    const typing = document.activeElement?.closest?.('form[data-action]');
    // Re-rendering on every tick would close an open dropdown under the operator's cursor, so the
    // action panel is rebuilt only when the rows it offers have actually changed.
    const fingerprint = JSON.stringify(snap.options);
    const stale = fingerprint !== renderedOptions;
    if (stale && !(keepForms && typing)) {
      renderedOptions = fingerprint;
      const open = new Set([...document.querySelectorAll('details.act[open]')].map((d) => d.querySelector('form')?.dataset.action));
      const values = formValues();
      renderActions();
      for (const d of document.querySelectorAll('details.act')) {
        if (open.has(d.querySelector('form')?.dataset.action)) d.open = true;
      }
      restoreValues(values);
    }
    renderTabs();
    renderTable();
    // Never re-render the sheet out from under a step that is still running.
    if (mode === 'runsheet' && !stepRunning) await loadSheet();
  } catch (err) {
    $('#actions').innerHTML = `<section><h2>Not connected</h2><div class="empty">${esc(err.message)}<br><br>
      Start the tunnel, then press Connect DB. Configuration lives in <code>dev/demoConsole/.env</code>.</div></section>`;
  }
}

$('#btn-tunnel').addEventListener('click', async function () {
  this.disabled = true;
  try { await api('/api/tunnel/start', { force: true }); await refreshStatus(); } finally { this.disabled = false; }
});
$('#btn-connect').addEventListener('click', async function () {
  this.disabled = true;
  try { await api('/api/connect'); await load(); } catch (err) { alert(err.message); } finally { this.disabled = false; refreshStatus(); }
});
$('#btn-refresh').addEventListener('click', () => { load(); refreshStatus(); });

function formValues() {
  const out = {};
  for (const form of document.querySelectorAll('form[data-action]')) {
    out[form.dataset.action] = Object.fromEntries(new FormData(form).entries());
  }
  return out;
}

function restoreValues(values) {
  for (const form of document.querySelectorAll('form[data-action]')) {
    const saved = values[form.dataset.action];
    if (!saved) continue;
    for (const [name, value] of Object.entries(saved)) {
      const field = form.elements[name];
      if (!field || value === '') continue;
      // A select only keeps its value if that row still exists; otherwise fall back to the default.
      if (field.tagName === 'SELECT' && ![...field.options].some((o) => o.value === value)) continue;
      field.value = value;
    }
  }
}
$('#auto').addEventListener('change', setAuto);

function setAuto() {
  clearInterval(timer);
  if ($('#auto').checked) timer = setInterval(() => { refreshStatus(); if (snap) load({ keepForms: true }); }, 5000);
}

refreshStatus();
load();
setAuto();
