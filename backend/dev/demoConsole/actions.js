// The scenario catalog. Each action declares the fields the GUI should render and a run() that
// performs it. Market moves go through marketService, so the handset sees a real negotiation;
// mandi prices are written directly because the app has no write path for them.
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ctxOrThrow, query, resetPool } from './context.js';
import { seedMarketDemo, resetMarketDemo } from '../../db/marketSeed.js';
import { config } from './config.js';

const run = promisify(execFile);
const rid = (kind) => `demo-console-${kind}-${crypto.randomUUID()}`;
const user = (id) => ({ id });
const day = (offset = 1) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Price edits are reversible for the length of the session, so a bad nudge during a rehearsal is
// one click away from the number the audience saw a moment ago.
const priceUndo = [];

function terms(p, extra = {}) {
  return {
    quantity: Number(p.quantity),
    unitPrice: Number(p.unitPrice),
    pickupDate: p.pickupDate || day(1),
    pickupWindowStart: p.pickupWindowStart || '09:00',
    pickupWindowEnd: p.pickupWindowEnd || '11:00',
    paymentMethod: p.paymentMethod || 'cash_on_pickup',
    note: p.note || undefined,
    ...extra,
  };
}

async function offerRow(id) {
  const r = await query(
    `SELECT o.id, o.status, o.current_revision, o.proposer_id, o.recipient_id, rv.proposed_by
     FROM app.market_offers o
     JOIN app.market_offer_revisions rv ON rv.offer_id=o.id AND rv.revision_number=o.current_revision
     WHERE o.id=$1`, [id]);
  if (!r.rowCount) throw new Error('Offer not found.');
  const row = r.rows[0];
  row.responder_id = row.proposed_by === row.proposer_id ? row.recipient_id : row.proposer_id;
  return row;
}

const dealRow = async (id) => {
  const r = await query('SELECT * FROM app.market_deals WHERE id=$1', [id]);
  if (!r.rowCount) throw new Error('Deal not found.');
  return r.rows[0];
};

export const actions = [
  // ------------------------------------------------------------------ offers
  {
    id: 'offer.create',
    group: 'Offer',
    label: 'Send an offer',
    hint: 'A buyer offers on a listing. The seller gets the notification the handset shows.',
    fields: [
      { name: 'buyerId', label: 'Buyer', type: 'select', source: 'users' },
      { name: 'listingId', label: 'Listing', type: 'select', source: 'listings' },
      { name: 'quantity', label: 'Quantity', type: 'number', step: '0.001' },
      { name: 'unitPrice', label: 'Unit price', type: 'number', step: '0.01' },
      { name: 'note', label: 'Note (max 160)', type: 'text', optional: true },
    ],
    async run(p) {
      const { market } = await ctxOrThrow();
      const r = await market.offerOnListing(user(p.buyerId), p.listingId, { requestId: rid('offer'), ...terms(p) });
      return { message: `Offer sent (${r.id}).`, offerId: r.id };
    },
  },
  {
    id: 'offer.onRequest',
    group: 'Offer',
    label: 'Offer on a buy request',
    hint: 'The mirror of the one above: a seller answers a buyer\'s request, so the offer lands in the buyer\'s inbox.',
    fields: [
      { name: 'sellerId', label: 'Seller', type: 'select', source: 'users' },
      { name: 'requestId', label: 'Buy request', type: 'select', source: 'buyRequests' },
      { name: 'quantity', label: 'Quantity', type: 'number', step: '0.001' },
      { name: 'unitPrice', label: 'Unit price', type: 'number', step: '0.01' },
      { name: 'note', label: 'Note (max 160)', type: 'text', optional: true },
    ],
    async run(p) {
      const { market } = await ctxOrThrow();
      const r = await market.offerOnRequest(user(p.sellerId), p.requestId, { requestId: rid('offer'), ...terms(p) });
      return { message: `Offer sent (${r.id}).`, offerId: r.id };
    },
  },
  {
    id: 'offer.counter',
    group: 'Offer',
    label: 'Counter-offer',
    hint: 'The side whose turn it is counters. A new immutable revision, never an edit.',
    fields: [
      { name: 'offerId', label: 'Offer', type: 'select', source: 'liveOffers' },
      { name: 'quantity', label: 'Quantity', type: 'number', step: '0.001' },
      { name: 'unitPrice', label: 'Unit price', type: 'number', step: '0.01' },
      { name: 'note', label: 'Note', type: 'text', optional: true },
    ],
    async run(p) {
      const { market } = await ctxOrThrow();
      const offer = await offerRow(p.offerId);
      const r = await market.counter(user(offer.responder_id), p.offerId, terms(p));
      return { message: `Countered — now revision ${r.revision}.` };
    },
  },
  {
    id: 'offer.accept',
    group: 'Offer',
    label: 'Accept the offer',
    hint: 'Creates the deal and reserves the quantity on the listing.',
    fields: [{ name: 'offerId', label: 'Offer', type: 'select', source: 'liveOffers' }],
    async run(p) {
      const { market } = await ctxOrThrow();
      const offer = await offerRow(p.offerId);
      const r = await market.accept(user(offer.responder_id), p.offerId);
      return { message: `Accepted — deal ${r.dealId} is awaiting both confirmations.`, dealId: r.dealId };
    },
  },
  {
    id: 'offer.decline',
    group: 'Offer',
    label: 'Decline the offer',
    fields: [
      { name: 'offerId', label: 'Offer', type: 'select', source: 'liveOffers' },
      { name: 'reason', label: 'Reason', type: 'text', optional: true },
    ],
    async run(p) {
      const { market } = await ctxOrThrow();
      const offer = await offerRow(p.offerId);
      await market.decline(user(offer.responder_id), p.offerId, p.reason || 'Not this time');
      return { message: 'Offer declined.' };
    },
  },
  {
    id: 'deal.advance',
    group: 'Offer',
    label: 'Advance the deal one step',
    hint: 'awaiting_confirmation -> agreed -> pickup_scheduled -> handed_over -> completed.',
    fields: [{ name: 'dealId', label: 'Deal', type: 'select', source: 'deals' }],
    async run(p) {
      const { market } = await ctxOrThrow();
      return { message: await advanceDeal(market, p.dealId) };
    },
  },
  {
    id: 'deal.complete',
    group: 'Offer',
    label: 'Run the deal to completed',
    hint: 'Every remaining step at once, for the "a trade that already worked" slide.',
    fields: [{ name: 'dealId', label: 'Deal', type: 'select', source: 'deals' }],
    async run(p) {
      const { market } = await ctxOrThrow();
      const steps = [];
      for (let i = 0; i < 6; i += 1) {
        const deal = await dealRow(p.dealId);
        if (['completed', 'cancelled', 'no_show', 'disputed'].includes(deal.status)) break;
        steps.push(await advanceDeal(market, p.dealId));
      }
      return { message: steps.join(' → ') || 'Nothing left to do.' };
    },
  },
  {
    id: 'deal.cancel',
    group: 'Offer',
    label: 'Cancel the deal',
    fields: [
      { name: 'dealId', label: 'Deal', type: 'select', source: 'deals' },
      { name: 'byId', label: 'Cancelled by', type: 'select', source: 'users' },
      { name: 'reason', label: 'Reason', type: 'text' },
    ],
    async run(p) {
      const { market } = await ctxOrThrow();
      await market.cancel(user(p.byId), p.dealId, p.reason || 'Plans changed');
      return { message: 'Deal cancelled; the reserved quantity is back on the listing.' };
    },
  },

  // ------------------------------------------------------------------ accounts
  {
    id: 'account.setPin',
    group: 'Accounts',
    label: 'Set a member\'s PIN',
    hint: 'Six digits. Also clears any lockout from failed attempts, so a stuck handset can sign in again.',
    fields: [
      { name: 'userId', label: 'Member', type: 'select', source: 'users' },
      { name: 'pin', label: 'New PIN', type: 'text', placeholder: '6 digits' },
      { name: 'revoke', label: 'Other devices', type: 'select', options: [
        ['keep', 'stay signed in'],
        ['revoke', 'sign out everywhere'],
      ] },
    ],
    async run(p) {
      const { auth } = await ctxOrThrow();
      const out = await auth.setPin({ userId: p.userId, pin: String(p.pin).trim(), revokeSessions: p.revoke === 'revoke' });
      return {
        message: out.revokedSessions
          ? `PIN set. ${out.revokedSessions} session(s) signed out — sign in again on the handset.`
          : 'PIN set. Devices already signed in stay signed in.',
      };
    },
  },

  // ------------------------------------------------------------------ prices
  {
    id: 'price.nudge',
    group: 'Prices',
    label: 'Move a crop price by %',
    hint: 'Updates the newest stored mandi rows in place, so Market Prices and TruePrice both move.',
    fields: [
      { name: 'crop', label: 'Crop', type: 'select', source: 'crops' },
      { name: 'percent', label: 'Change (%)', type: 'number', step: '0.5', placeholder: '+12' },
      { name: 'regionCode', label: 'Region (blank = all)', type: 'select', source: 'regions', optional: true },
    ],
    async run(p) {
      const pct = Number(p.percent);
      if (!Number.isFinite(pct) || pct === 0) throw new Error('Enter a non-zero percentage.');
      const factor = 1 + pct / 100;
      const rows = await latestPriceRows(p.crop, p.regionCode);
      if (!rows.length) throw new Error('No stored prices for that crop / region.');
      const before = rows.map((r) => ({ id: r.id, modal: r.modal, min: r.min, max: r.max }));
      for (const r of rows) {
        await query(
          `UPDATE app.market_prices SET modal_price=$2::numeric,
             min_price = $3::numeric, max_price = $4::numeric, fetched_at = now()
           WHERE id=$1`,
          [r.id, round2(r.modal * factor), r.min == null ? null : round2(r.min * factor), r.max == null ? null : round2(r.max * factor)]);
      }
      priceUndo.push({ at: new Date().toISOString(), what: `${p.crop} ${pct > 0 ? '+' : ''}${pct}%`, before });
      return { message: `${rows.length} mandi row(s) moved ${pct > 0 ? '+' : ''}${pct}%. Undo is available.` };
    },
  },
  {
    id: 'price.set',
    group: 'Prices',
    label: 'Set one mandi price',
    hint: 'Exact modal price for one crop in one market — for hitting a number on a slide.',
    fields: [
      { name: 'priceId', label: 'Mandi row', type: 'select', source: 'priceRows' },
      { name: 'modal', label: 'Modal price', type: 'number', step: '0.01' },
    ],
    async run(p) {
      const r = await query('SELECT id, modal_price::float8 modal, min_price::float8 min, max_price::float8 max FROM app.market_prices WHERE id=$1', [p.priceId]);
      if (!r.rowCount) throw new Error('Price row not found.');
      const row = r.rows[0];
      const modal = round2(p.modal);
      if (!Number.isFinite(modal) || modal < 0) throw new Error('Enter a price.');
      // Keep min <= modal <= max so the row still satisfies the table's CHECKs and reads sanely.
      const min = row.min == null ? null : Math.min(row.min, modal);
      const max = row.max == null ? null : Math.max(row.max, modal);
      await query('UPDATE app.market_prices SET modal_price=$2, min_price=$3, max_price=$4, fetched_at=now() WHERE id=$1', [row.id, modal, min, max]);
      priceUndo.push({ at: new Date().toISOString(), what: `set ${modal}`, before: [{ id: row.id, modal: row.modal, min: row.min, max: row.max }] });
      return { message: `Modal price set to ${modal}.` };
    },
  },
  {
    id: 'price.undo',
    group: 'Prices',
    label: 'Undo the last price change',
    hint: 'Restores the values from before the most recent price action of this session.',
    fields: [],
    async run() {
      const last = priceUndo.pop();
      if (!last) throw new Error('Nothing to undo in this session.');
      for (const b of last.before) {
        await query('UPDATE app.market_prices SET modal_price=$2, min_price=$3, max_price=$4 WHERE id=$1', [b.id, b.modal, b.min, b.max]);
      }
      return { message: `Reverted: ${last.what} (${last.before.length} row(s)).` };
    },
  },

  {
    id: 'price.markLive',
    group: 'Prices',
    label: 'Mark a crop\'s prices as live',
    hint: 'Sample rows are shown as "Sample data" and never fire a price alert. Clear the flag to make a rehearsal behave like the real feed.',
    fields: [
      { name: 'crop', label: 'Crop', type: 'select', source: 'crops' },
      { name: 'sample', label: 'Flag', type: 'select', options: [['false', 'live'], ['true', 'sample']] },
    ],
    async run(p) {
      const sample = p.sample === 'true';
      const r = await query(
        `UPDATE app.market_prices mp SET is_sample=$2 FROM app.crops c WHERE c.id=mp.crop_id AND c.code=$1`,
        [p.crop, sample]);
      return { message: `${r.rowCount} row(s) marked ${sample ? 'sample' : 'live'}.` };
    },
  },

  // ------------------------------------------------------------------ alerts
  {
    id: 'alert.create',
    group: 'Alerts',
    label: 'Arm a price alert',
    hint: 'Uses the app\'s own service, so it fires exactly the way a farmer\'s alert would.',
    fields: [
      { name: 'userId', label: 'Member', type: 'select', source: 'users' },
      { name: 'crop', label: 'Crop', type: 'select', source: 'crops' },
      { name: 'direction', label: 'Direction', type: 'select', options: [['above', 'rises to'], ['below', 'falls to']] },
      { name: 'price', label: 'Threshold', type: 'number', step: '0.01' },
    ],
    async run(p) {
      const { alerts } = await ctxOrThrow();
      const r = await alerts.create(user(p.userId), { crop: p.crop, direction: p.direction, price: Number(p.price) });
      return { message: `Alert armed (${r.item?.status || 'active'}).` };
    },
  },
  {
    id: 'alert.check',
    group: 'Alerts',
    label: 'Run the alert check now',
    hint: 'What the server does after a mandi sync. Pair it with a price nudge to fire an alert on cue.',
    fields: [],
    async run() {
      const { alerts } = await ctxOrThrow();
      const fired = await alerts.check({});
      return { message: fired ? `${fired} alert(s) fired.` : 'No alert reached its threshold.' };
    },
  },
  {
    id: 'alert.rearm',
    group: 'Alerts',
    label: 'Re-arm a fired alert',
    hint: 'Back to active and unseen, so the same alert can be shown again in the next run-through.',
    fields: [{ name: 'alertId', label: 'Alert', type: 'select', source: 'alerts' }],
    async run(p) {
      const r = await query(
        `UPDATE app.price_alerts SET status='active', triggered_at=NULL, triggered_price=NULL,
           triggered_market=NULL, triggered_date=NULL, seen_at=NULL WHERE id=$1`, [p.alertId]);
      if (!r.rowCount) throw new Error('Alert not found.');
      return { message: 'Alert is active again.' };
    },
  },

  // ------------------------------------------------------------------ demo state
  {
    id: 'demo.reseed',
    group: 'State',
    label: 'Refresh the demo data',
    hint: 'Idempotent: re-runs db/marketSeed.js, which also pushes demo expiry dates forward.',
    fields: [],
    async run() {
      const { pool } = await ctxOrThrow();
      const out = await seedMarketDemo(pool, { env: { AUTH_LOOKUP_SECRET: config.codeSecret } });
      return { message: `Demo data refreshed: ${out.listings} listings, ${out.requests} requests.` };
    },
  },
  {
    id: 'market.expire',
    group: 'State',
    label: 'Sweep expired posts',
    hint: 'The housekeeping pass, so nothing stale is on screen.',
    fields: [],
    async run() {
      const { market } = await ctxOrThrow();
      const out = await market.expireStale();
      return { message: `Expired ${out.listings} listings, ${out.requests} requests, ${out.offers} offers.` };
    },
  },
  {
    id: 'demo.reset',
    group: 'State',
    label: 'Delete all demo market data',
    hint: 'Destructive. Needs DEMO_RESET_DATABASE_URL (a superuser: the append-only triggers must be bypassed).',
    danger: true,
    confirm: 'This deletes every is_demo listing, request, offer and deal. Continue?',
    fields: [],
    async run() {
      const pool = await resetPool();
      try { await resetMarketDemo(pool); } finally { await pool.end().catch(() => {}); }
      return { message: 'Demo market data removed. Run "Refresh the demo data" to rebuild it.' };
    },
  },
  {
    id: 'snapshot.save',
    group: 'State',
    label: 'Snapshot the database (on the VM)',
    hint: 'Runs sudo -u postgres pg_dump over ssh and leaves the file on the VM.',
    fields: [{ name: 'name', label: 'Name', type: 'text', placeholder: 'before-rehearsal' }],
    async run(p) {
      const name = String(p.name || 'snapshot').replace(/[^a-zA-Z0-9._-]/g, '-');
      const file = `${config.snapshotDir}/${name}-$(date +%Y%m%d-%H%M%S).dump`;
      const cmd = `mkdir -p ${config.snapshotDir} && sudo -n -u postgres pg_dump -Fc ${config.dbName} > ${file} && ls -la ${file}`;
      const { stdout } = await ssh(cmd);
      return { message: `Snapshot written:\n${stdout.trim()}` };
    },
  },
  {
    id: 'snapshot.list',
    group: 'State',
    label: 'List snapshots on the VM',
    fields: [],
    async run() {
      const { stdout } = await ssh(`ls -la ${config.snapshotDir} 2>/dev/null || echo "no snapshots yet"`);
      return { message: stdout.trim() };
    },
  },
  {
    id: 'sync.status',
    group: 'State',
    label: 'Mandi sync timer status',
    hint: 'The 30-minute Agmarknet sync can overwrite a hand-set price. Check it before a demo.',
    fields: [],
    async run() {
      const { stdout } = await ssh('systemctl is-active agrilink-mandi-sync.timer; systemctl list-timers agrilink-mandi-sync.timer --no-pager 2>/dev/null | head -3');
      return { message: stdout.trim() };
    },
  },
];

async function ssh(command) {
  try {
    return await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', config.sshHost, command], { timeout: 120000 });
  } catch (err) {
    throw new Error(`ssh failed: ${String(err.stderr || err.message).trim().slice(0, 400)}`);
  }
}

async function latestPriceRows(crop, regionCode) {
  const r = await query(
    `SELECT DISTINCT ON (mp.market_id) mp.id, mp.modal_price::float8 modal, mp.min_price::float8 min, mp.max_price::float8 max
     FROM app.market_prices mp
     JOIN app.crops c ON c.id = mp.crop_id
     JOIN app.markets m ON m.id = mp.market_id
     JOIN app.regions r ON r.id = m.region_id
     WHERE c.code = $1 AND ($2::text IS NULL OR r.code = $2)
     ORDER BY mp.market_id, mp.price_date DESC`, [crop, regionCode || null]);
  return r.rows;
}

/** One step of the deal state machine, using the same calls the two handsets would make. */
async function advanceDeal(market, dealId) {
  const deal = await dealRow(dealId);
  const buyer = user(deal.buyer_id);
  const seller = user(deal.seller_id);
  switch (deal.status) {
    case 'awaiting_confirmation': {
      if (!deal.buyer_confirmed_at) await market.confirm(buyer, dealId);
      if (!deal.seller_confirmed_at) await market.confirm(seller, dealId);
      return 'both sides confirmed → agreed';
    }
    case 'agreed':
      await market.schedule(seller, dealId, {
        pickupDate: day(0), pickupWindowStart: '09:00', pickupWindowEnd: '11:00', location: 'Market gate',
      });
      return 'pickup scheduled for today';
    case 'pickup_scheduled':
      await market.verifyPickup(seller, dealId, market.pickupCode(dealId));
      return 'pickup code verified → handed over';
    case 'handed_over':
      await market.received(buyer, dealId);
      await market.paymentStatus(seller, dealId, 'received');
      return 'goods received and payment marked → completed';
    default:
      throw new Error(`Deal is ${deal.status}; there is no next step.`);
  }
}

export const actionById = new Map(actions.map((a) => [a.id, a]));
