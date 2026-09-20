// Demo console: a local operator GUI that drives the VM's PostgreSQL through an ssh tunnel.
//
//   npm run demo:console            -> http://localhost:4180
//
// Configure dev/demoConsole/.env first (see README.md in this folder). Nothing here is mounted by
// the deployed app; it runs on the operator's laptop only.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, redact } from './config.js';
import { startTunnel, stopTunnel, tunnelState } from './tunnel.js';
import { connect, reconnect, describeConnection, disconnect } from './context.js';
import { snapshot } from './state.js';
import { actions, actionById } from './actions.js';
import { resolveSteps } from './runsheet.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(here, 'public')));

const log = [];
const record = (entry) => { log.unshift({ at: new Date().toISOString(), ...entry }); log.length = Math.min(log.length, 50); };

const send = (handler) => async (req, res) => {
  try {
    res.json({ ok: true, ...(await handler(req)) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
};

// The action forms are filled from the same snapshot the dashboard shows.
const optionSources = (s) => ({
  users: s.users.map((u) => [u.id, `${u.name} — ${u.village || u.region}`]),
  crops: s.crops.map((c) => [c.code, c.name]),
  regions: s.regions.map((r) => [r.code, r.name]),
  listings: s.listings.map((l) => [l.id, `${l.seller}: ${l.quantity - l.reserved - l.sold}/${l.quantity} ${l.unit} ${l.cropName} @ ${l.askingPrice ?? 'offers'} (${l.status})`]),
  buyRequests: s.buyRequests.map((b) => [b.id, `${b.buyer} wants ${b.quantity - b.reserved} ${b.unit} ${b.cropName} @ ${b.min ?? '—'}-${b.max ?? '—'} (${b.status})`]),
  liveOffers: s.offers.filter((o) => ['open', 'countered'].includes(o.status))
    .map((o) => [o.id, `${o.proposer} → ${o.recipient}: ${o.quantity} ${o.unit} ${o.cropName} @ ${o.unitPrice} — ${o.responder}'s turn`]),
  deals: s.deals.filter((d) => !['completed', 'cancelled'].includes(d.status))
    .map((d) => [d.id, `${d.buyer} ← ${d.seller}: ${d.quantity} @ ${d.unitPrice} (${d.status})`]),
  alerts: s.alerts.map((a) => [a.id, `${a.user}: ${a.crop} ${a.direction} ${a.threshold} (${a.status})`]),
  priceRows: s.prices.map((p) => [p.id, `${p.cropName} @ ${p.market} (${p.region}) — ${p.modal} ${p.currency}/${p.unit}, ${p.date}`]),
});

app.get('/api/status', send(async () => ({
  tunnel: await tunnelState(),
  db: describeConnection(),
  sshHost: config.sshHost,
  log,
})));

app.post('/api/tunnel/start', send(async (req) => {
  const tunnel = await startTunnel({ force: Boolean(req.body?.force) });
  return { tunnel };
}));
app.post('/api/tunnel/stop', send(async () => { await disconnect(); stopTunnel(); return { tunnel: await tunnelState() }; }));

app.post('/api/connect', send(async () => { await reconnect(); return { db: describeConnection() }; }));

app.get('/api/state', send(async () => {
  const s = await snapshot();
  return {
    state: s,
    options: optionSources(s),
    actions: actions.map(({ id, group, label, hint, fields, danger, confirm }) => ({ id, group, label, hint, fields, danger, confirm })),
  };
}));

// The run sheet is the same actions in demo order, with their targets already filled in.
app.get('/api/runsheet', send(async () => ({ steps: resolveSteps(await snapshot()) })));

app.post('/api/action/:id', send(async (req) => {
  const action = actionById.get(req.params.id);
  if (!action) throw new Error(`Unknown action: ${req.params.id}`);
  const params = req.body || {};
  for (const f of action.fields) {
    if (!f.optional && (params[f.name] === undefined || params[f.name] === '')) throw new Error(`${f.label} is required.`);
  }
  try {
    const out = await action.run(params);
    record({ action: action.id, label: action.label, ok: true, message: out.message });
    return out;
  } catch (err) {
    record({ action: action.id, label: action.label, ok: false, message: err.message });
    throw err;
  }
}));

app.listen(config.port, '127.0.0.1', async () => {
  console.log(`demo console  http://localhost:${config.port}`);
  console.log(`  ssh host    ${config.sshHost}`);
  console.log(`  database    ${redact(config.databaseUrl) || '(not configured — see dev/demoConsole/README.md)'}`);
  if (config.autoTunnel) {
    const t = await startTunnel();
    console.log(`  tunnel      ${t.status}${t.lastError ? ` (${t.lastError})` : ''}`);
    if (config.databaseUrl) {
      try { await connect(); console.log('  database    connected'); } catch (err) { console.log(`  database    ${err.message}`); }
    }
  }
});
