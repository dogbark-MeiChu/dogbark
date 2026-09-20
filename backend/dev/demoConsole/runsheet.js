// The five-minute demo, as an ordered checklist the operator can click through.
//
// Steps never hard-code a uuid: a listing or a price row is described the way a person would
// ("Ravi's rice listing", "the Banthara rice row") and resolved against the live snapshot each
// time the run sheet is loaded. A step whose target no longer exists says so instead of failing
// under the lights.

export const SELLER = 'Ravi K.';      // the handset account: the most complete demo member
export const BUYER = 'Meena S.';      // same region as Ravi, so the trade reads naturally

export const steps = [
  // ---------------------------------------------------------------- before you walk on
  {
    id: 'setup.sync', phase: 'setup', where: 'laptop',
    title: 'Pause the mandi sync',
    say: 'The 30-minute Agmarknet timer would overwrite the price you set in Act 4.',
    action: 'sync.pause',
  },
  {
    id: 'setup.snapshot', phase: 'setup', where: 'laptop', optional: true,
    title: 'Snapshot the database',
    say: 'Optional. A rehearsal you can roll back from.',
    action: 'snapshot.save', params: { name: 'before-demo' },
  },
  {
    id: 'setup.clear', phase: 'setup', where: 'laptop',
    title: 'Clear the seeded offer that blocks Act 3',
    say: `The market seed already leaves a live ${BUYER} → ${SELLER} offer on that rice listing, and `
       + 'one buyer may only have one live offer per listing — Act 3 would be refused as a conflict. '
       + 'Declining it frees the slot; a declined offer does not block a fresh one.',
    note: 'Shows as "no live offer" once it is done, or if you already ran it.',
    action: 'offer.decline',
    params: {
      offerId: { liveOffer: { between: [BUYER, SELLER] } },
      reason: 'Clearing the board before the demo',
    },
  },
  {
    id: 'setup.signin', phase: 'setup', where: 'phone',
    title: `Sign in on the handset as ${SELLER} — 9100000001`,
    say: 'Leave the app open on Home. Do not quit it again.',
    note: 'Sign in BEFORE any offer is sent: the sync poller starts its cursor at "now", so an offer sent while signed out never raises the toast.',
  },
  {
    id: 'setup.check', phase: 'setup', where: 'laptop',
    title: 'Confirm the console is connected',
    say: 'tunnel up · db connected · key ok, all three green in the header.',
  },

  // ---------------------------------------------------------------- 0:00
  {
    id: 'act1', phase: 'act', at: '0:00', where: 'phone',
    title: 'This is a $20 feature phone',
    say: 'No app store, no Play Services, 240×320, a keypad. Everything you are about to see runs '
       + "server-side in CloudMosa's cloud browser; the handset only renders the HTML.",
    note: 'The app is already open. Never open it live — it will not start without network.',
  },

  // ---------------------------------------------------------------- 0:40
  {
    id: 'act2', phase: 'act', at: '0:40', where: 'phone',
    title: 'Market Prices → Rice',
    say: 'These are the official Agmarknet mandi prices from data.gov.in, synced every 30 minutes. '
       + 'Note it says Common: the same feed reports basmati at 8500. Averaging them would be lying '
       + 'to the farmer, so we compare one variety.',
    note: 'Expect roughly 2363–2800 INR/quintal across the mandis nearest the farm. 209 markets, 179 with coordinates.',
  },

  // ---------------------------------------------------------------- 1:40  the money shot
  {
    id: 'act3.offer', phase: 'act', at: '1:40', where: 'laptop',
    title: `Send ${BUYER}'s offer on the rice listing`,
    say: `${SELLER} has 5 quintal of rice listed at 2250. I am playing the buyer on my laptop.`,
    note: 'Within ~4 seconds the handset raises "● New offer on your post" and refreshes itself. Do not touch the phone — let it move on its own.',
    action: 'offer.create',
    params: {
      buyerId: { user: BUYER },
      listingId: { listing: { seller: SELLER, crop: 'rice' } },
      quantity: '3', unitPrice: '2100', note: 'Can collect tomorrow morning',
    },
  },
  {
    id: 'act3.counter', phase: 'act', at: '2:10', where: 'phone',
    title: 'Counter at 2200 on the handset',
    say: 'Open the offer, counter. Every move is a new immutable revision — nothing is ever edited.',
  },
  {
    id: 'act3.accept', phase: 'act', at: '2:40', where: 'laptop',
    title: 'Accept the counter',
    say: 'No payment rails, no escrow. AgriLink records the agreement and the handover; the money '
       + 'stays cash in hand, which is how this market actually works.',
    action: 'offer.accept',
    params: { offerId: { liveOffer: { between: [BUYER, SELLER] } } },
  },

  // ---------------------------------------------------------------- 3:10
  {
    id: 'act4.arm', phase: 'act', at: '3:10', where: 'laptop',
    title: 'Arm a price alert at 2700',
    say: `${SELLER} turns his phone off. It is a feature phone; battery matters.`,
    note: 'The alert compares the mandi NEAREST the farm (about 2585), not the highest one — which is why 2700 is the threshold.',
    action: 'alert.create',
    params: { userId: { user: SELLER }, crop: 'rice', direction: 'above', price: '2700' },
  },
  {
    id: 'act4.price', phase: 'act', at: '3:25', where: 'laptop',
    title: 'Move the nearest mandi to 2900',
    say: 'The market moves while the phone is off.',
    action: 'price.set',
    params: { priceId: { priceRow: { market: 'Banthara', crop: 'rice' } }, modal: '2900' },
  },
  {
    id: 'act4.check', phase: 'act', at: '3:35', where: 'laptop',
    title: 'Run the alert check',
    say: 'This is exactly what the server does after every mandi sync.',
    action: 'alert.check',
  },
  {
    id: 'act4.show', phase: 'act', at: '3:45', where: 'phone',
    title: 'Turn the phone back on — the alert is on Home',
    say: 'The watching happened on the server. That is why we are on Cloud Phone: the intelligence '
       + 'is not in a 240×320 handset, it is in the cloud.',
    note: "One line on Today's Farm: the task due today is \"Pick tomatoes for the Lucknow buyer\" — the trade you just saw.",
  },

  // ---------------------------------------------------------------- 4:10
  {
    id: 'act5', phase: 'act', at: '4:10', where: 'phone',
    title: 'Close',
    say: 'English, Hindi, Bengali and Vietnamese, keypad-first. Deployed and live — everything you '
       + 'just saw came out of the production database.',
  },

  // ---------------------------------------------------------------- after
  {
    id: 'teardown.price', phase: 'teardown', where: 'laptop',
    title: 'Undo the price change',
    action: 'price.undo',
  },
  {
    id: 'teardown.alert', phase: 'teardown', where: 'laptop',
    title: 'Re-arm the fired alert',
    say: 'So the same beat can be played again in the next run-through.',
    action: 'alert.rearm',
    params: { alertId: { alert: { user: SELLER, status: 'triggered' } } },
  },
  {
    id: 'teardown.deal', phase: 'teardown', where: 'laptop',
    title: 'Cancel the demo deal',
    say: 'Frees the reserved quantity. Needed before Act 3 can be run again: one live offer per '
       + 'buyer per listing is allowed, and an accepted one still counts.',
    action: 'deal.cancel',
    params: {
      dealId: { deal: { between: [BUYER, SELLER] } },
      byId: { user: BUYER },
      reason: 'Demo rehearsal reset',
    },
  },
  {
    id: 'teardown.sync', phase: 'teardown', where: 'laptop',
    title: 'Resume the mandi sync',
    action: 'sync.resume',
  },
];

// ---------------------------------------------------------------- resolution against live rows
const norm = (v) => String(v ?? '').toLowerCase();

function resolveOne(spec, s) {
  if (spec === null || typeof spec !== 'object') return { value: spec };
  const [kind] = Object.keys(spec);
  const want = spec[kind];
  const miss = (what) => ({ missing: what });

  switch (kind) {
    case 'user': {
      const row = s.users.find((u) => u.name === want);
      return row ? { value: row.id } : miss(`no demo member named "${want}"`);
    }
    case 'listing': {
      const row = s.listings.find((l) => l.seller === want.seller && norm(l.crop) === norm(want.crop)
        && ['open', 'partially_reserved'].includes(l.status));
      return row ? { value: row.id } : miss(`${want.seller} has no open ${want.crop} listing`);
    }
    case 'request': {
      const row = s.buyRequests.find((b) => b.buyer === want.buyer && norm(b.crop) === norm(want.crop));
      return row ? { value: row.id } : miss(`${want.buyer} has no open ${want.crop} buy request`);
    }
    case 'priceRow': {
      const row = s.prices.find((p) => norm(p.market) === norm(want.market) && norm(p.crop) === norm(want.crop));
      return row ? { value: row.id } : miss(`no ${want.crop} price row for ${want.market}`);
    }
    case 'liveOffer': {
      const [a, b] = want.between;
      const row = s.offers.find((o) => ['open', 'countered'].includes(o.status)
        && ((o.proposer === a && o.recipient === b) || (o.proposer === b && o.recipient === a)));
      return row ? { value: row.id } : miss(`no live offer between ${a} and ${b}`);
    }
    case 'deal': {
      const [a, b] = want.between;
      const row = s.deals.find((d) => !['completed', 'cancelled'].includes(d.status)
        && ((d.buyer === a && d.seller === b) || (d.buyer === b && d.seller === a)));
      return row ? { value: row.id } : miss(`no open deal between ${a} and ${b}`);
    }
    case 'alert': {
      const row = s.alerts.find((x) => x.user === want.user && (!want.status || x.status === want.status));
      return row ? { value: row.id } : miss(`${want.user} has no ${want.status || ''} alert`.replace('  ', ' '));
    }
    default:
      return miss(`unknown reference "${kind}"`);
  }
}

/** Fills each step's params from the current rows; `blocked` explains anything that could not be found. */
export function resolveSteps(state) {
  return steps.map((step) => {
    if (!step.params) return { ...step, params: {}, blocked: null };
    const params = {};
    const blocked = [];
    for (const [name, spec] of Object.entries(step.params)) {
      const { value, missing } = resolveOne(spec, state);
      if (missing) blocked.push(missing); else params[name] = value;
    }
    return { ...step, params, blocked: blocked.length ? blocked.join('; ') : null };
  });
}
