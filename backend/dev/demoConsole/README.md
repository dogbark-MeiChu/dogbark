# Demo console

A local operator GUI for driving the demo. It runs on the laptop, forwards the VM's PostgreSQL
port over ssh, and makes the handset show what the next slide needs: an offer arriving, a
counter-offer, a deal completing, a mandi price moving, a price alert firing.

```bash
cp dev/demoConsole/.env.example dev/demoConsole/.env   # then fill in DEMO_DB_PASSWORD
npm run demo:console                                   # http://localhost:4180
```

## How it works

```
laptop                                     VM (sh17-devel-mc-hackathon-04)
┌────────────────────────┐   ssh -L        ┌──────────────────────────────┐
│ browser  →  console    │ ══════════════► │ 127.0.0.1:5432  PostgreSQL   │
│             node-pg ───┼─ 127.0.0.1:6543 │                               │
└────────────────────────┘                 └──────────────────────────────┘
```

ssh only carries the TCP port; no SQL is piped through a shell. Writes then take one of two paths:

* **Market moves go through the app's own `marketService`** — the same code path `db/marketSeed.js`
  uses. An offer sent from the console produces the revision row, the `market_events` entry, the
  recipient's notification and the reservation arithmetic, so the handset sees a real negotiation
  rather than rows that merely look like one. The deal state machine is advanced with the same
  `confirm` / `schedule` / `verifyPickup` / `received` calls the two phones would make.
* **Mandi prices are written with SQL**, because the app has no write path for them (they arrive
  from the Agmarknet sync). Every price action is recorded in an in-session undo stack.

## Actions

| Group | What it does |
|---|---|
| Offer | Send an offer on a listing · offer on a buy request · counter · accept · decline · advance a deal one step · run a deal to completed · cancel |
| Prices | Move a crop's price by % · set one mandi price exactly · undo the last price change · flip the sample/live flag |
| Accounts | Set a member's PIN (also clears a lockout) |
| Alerts | Arm a price alert · run the alert check · re-arm a fired alert |
| State | Refresh the demo data · sweep expired posts · delete all demo market data · snapshot the VM database · list snapshots · mandi sync timer status |

The forms are filled from the rows that exist on the VM right now, and whoever's turn it is in a
negotiation is worked out from the standing revision — the console picks the right actor for you.

## The ssh key

The console passes `DEMO_SSH_KEY` to ssh as `-i` (default `~/.ssh/id_ed25519`) with
`IdentitiesOnly=yes`, and checks before connecting that the file exists and is mode 600 — the
status bar says `key ok` or `key unusable` with the reason, instead of failing silently for 12
seconds. `~/.ssh/config` also carries the same `IdentityFile` for the host, so a plain
`ssh sh17-devel-mc-hackathon-04` works too. Set `DEMO_SSH_KEY=` (empty) to fall back to ssh's own
defaults.

If the key ever moves, update both `DEMO_SSH_KEY` here and the `IdentityFile` line in
`~/.ssh/config`.

### If ssh suddenly times out on port 22

The VM stays reachable over HTTPS while port 22 is refused — that is a fail2ban ban, usually from
a burst of failed logins (a wrong or missing key retried in a loop). Wait it out; bans are
typically 10–60 minutes. The tunnel backs off exponentially and never retries a rejected key
precisely so a demo cannot trigger this.

## Signing in on the test handset

`account.setPin` goes through the app's own `authService.setPin`, so the new PIN is hashed exactly
the way login checks it. It also clears `failed_attempts` and any lockout — five wrong PINs lock an
account for 15 minutes, and a reset is the way out. Choose "sign out everywhere" to invalidate
existing sessions (the handset then has to sign in again), or "stay signed in" to leave them alone.

Members are addressed by user id from the dropdown, so `AUTH_LOOKUP_SECRET` is **not** needed here
— it only peppers the phone-number lookup, which the console does not use.

Demo phone numbers are `9100000001`–`9100000015`, in the order listed in `db/forumSeedData.js`
(`9100000001` is Ravi K., the account with the most complete data across every feature). The
seeded PIN is `DEMO_USER_PIN` in the VM's `~/dogbark/backend/.env`.

## Before a demo

1. **The mandi sync can overwrite a hand-set price.** `agrilink-mandi-sync.timer` runs every 30
   minutes and rewrites the rows the price actions edit. Check it with the *Mandi sync timer
   status* action, and on the VM run `sudo systemctl stop agrilink-mandi-sync.timer` for the
   duration of the demo if you are going to show a specific number.
2. **Sample prices never fire an alert** and are labelled "Sample data" on the handset — that is
   the app's own rule. If the VM is serving seeded prices, use *Mark a crop's prices as live*
   first, or the alert check will correctly report that nothing fired.
3. **A price alert needs a mandi near the member.** The alert watches the member's farm region,
   else their profile region. A member whose region has no markets will never see one fire.
4. Take a snapshot (*Snapshot the database*) before a rehearsal you intend to undo.

## Configuration

See `.env.example`. `DEMO_DB_PASSWORD` (or a whole `DEMO_DATABASE_URL`) is the only required value.
It is the password out of the VM's own `DATABASE_URL`, which systemd loads from
`~/dogbark/backend/.env` (`EnvironmentFile=` in `deploy/agrilink.service`) — not `/etc`, and no
sudo needed, the file belongs to `ubuntu`:

```bash
ssh sh17-devel-mc-hackathon-04 'grep DATABASE_URL ~/dogbark/backend/.env'
```

Take the password out of that URL and note that the host/port become `127.0.0.1:6543` here, because
the console reaches Postgres through the tunnel rather than from the VM itself. `.env` is gitignored.

`DEMO_RESET_DATABASE_URL` is only needed for *Delete all demo market data*: `market_events` and
`market_offer_revisions` are append-only, and only a superuser can bypass those triggers.

`MARKET_CODE_SECRET` is optional. The four-digit pickup code is `HMAC(secret, dealId)`; the console
derives and verifies it with the same value, so any 32+ character string lets deals be advanced.
Set the VM's real secret only if you want a code you can read off the handset to match.

## Testing it without the VM

The console talks to any AgriLink database. To rehearse against a local one:

```bash
export DATABASE_URL=postgres://…/agrilink AUTH_LOOKUP_SECRET=<32+ chars> DEMO_USER_PIN=246810
npm run db:migrate && node db/seed.js && npm run forum:seed && npm run market:seed
# then in dev/demoConsole/.env:  DEMO_AUTO_TUNNEL=0  and DEMO_DATABASE_URL=<the same URL>
```
