# AgriLink

A cloud-phone widget that connects smallholder farmers on feature phones — real-time marketplace, community forum, AI advisory, farm management and verified price data, all navigated by keypad on 240x320 screens.

Built for the [CloudMosa](https://cloudmosa.com/) Cloud Phone platform, where full computation runs in the cloud and the handset renders only HTML/CSS/JS. Targets top Cloud Phone markets: India, Vietnam and Bangladesh.

## Features

- **Verified Prices** — Live mandi (wholesale market) prices synced from [data.gov.in](https://data.gov.in/) and CEDA, with TruePrice net-income calculator (transport, commission, spoilage, break-even)
- **Local Market** — Peer-to-peer buy/sell listings with offers, deals, counterparty reputation and evidence bands
- **Today's Farm** — Multi-farm task management: scheduling, assignments, checklists, crop cycles, spray-window assessment, weather integration, records
- **Farmer Circle** — Community forum with posts, tags, replies, collections and moderation
- **Ask AI** — Gemini-backed agricultural advisor with photo/voice input, offline fallbacks and TTS responses
- **Weather** — Location-based forecasts for farm planning
- **Identity** — Phone+PIN auth, multilingual onboarding, user profiles with region and crop preferences

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js 22, Express 4 (ESM), PostgreSQL |
| Frontend | Vanilla JS (no framework), keypad-navigated SPA |
| AI | Google Gemini API (server-side) |
| Price Data | AgMarkNet / CEDA sync (systemd timer) |
| Testing | Node.js built-in test runner, PGlite for DB tests |
| Deploy | systemd + nginx reverse proxy |
| CI | GitHub Actions (test + smoke) |

## Languages

English, Hindi (हिन्दी), Bengali (বাংলা), Vietnamese (Tiếng Việt)

## Project Structure

```
backend/
  server.js              # Express entry point
  routes/                # API route handlers
    ai.js                #   /api/ai — Ask AI
    auth.js              #   /api/auth — phone+PIN identity
    admin.js             #   /api/admin — admin panel
    farmOps.js           #   /api/farms — Today's Farm
    forum.js             #   /api/forum — Farmer Circle
    market.js            #   /api/market — Local Market
    prices.js            #   /api/prices — verified prices
    tts.js               #   /api/tts — text-to-speech
    weather.js           #   /api/weather — forecasts
  services/              # Business logic (factory+DI pattern)
  middleware/            # Auth, rate limiting, errors, CSP
  db/
    migrations/          # 001–011 sequential SQL migrations
    pool.js              # PostgreSQL connection pool
    migrate.js           # Migration runner
  repositories/          # Data access layer
frontend/
  index.html             # SPA shell
  js/
    main.js              # Router and screen registry
    keypad.js            # Keypad navigation engine
    router.js            # Hash-based SPA router
    i18n/                # Translation dictionaries
    screens/             # UI screens (one file per screen)
    market/              # Marketplace UI modules
  css/                   # Stylesheets (base, layout, per-feature)
deploy/                  # systemd units, nginx config, setup script
docs/                    # Specs and runbooks
devlog/                  # Development logs
```

## Getting Started

### Prerequisites

- Node.js >= 22
- PostgreSQL (optional — runs in demo mode without it)

### Install and Run

```bash
cd backend
npm install
```

**Without a database** (demo mode — in-memory seed data, AI offline fallbacks):

```bash
npm start
```

**With PostgreSQL:**

```bash
# Set up .env
cp .env.example .env   # then fill in DATABASE_URL, JWT_SECRET, GEMINI_API_KEY

# Run migrations
npm run db:migrate

# Seed demo data (optional)
SEED_DEMO_DATA=true npm start
```

The server starts on `http://localhost:3000` and serves the frontend as static files.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | No | PostgreSQL connection string. Omit for demo mode. |
| `JWT_SECRET` | With DB | Secret for session tokens |
| `GEMINI_API_KEY` | No | Google Gemini API key. Omit for offline AI fallbacks. |
| `PORT` | No | Server port (default: 3000) |
| `SEED_DEMO_DATA` | No | Set `true` to seed forum and farm demo data |

### Tests

```bash
cd backend
npm test        # unit + integration tests (PGlite, no external DB needed)
npm run smoke   # boots server without DB, checks endpoints
```

### Data Sync

Mandi price data is synced from government sources:

```bash
npm run mandi:sync       # AgMarkNet (data.gov.in)
npm run ceda:sync        # CEDA prices
```

In production these run on a systemd timer (see `deploy/`).

## Deployment

```bash
# On the server (Ubuntu, nginx already configured with HTTPS)
bash deploy/setup.sh
```

This clones the repo, installs dependencies, sets up the systemd service and mandi sync timer, and configures the nginx reverse proxy.

## Architecture Notes

- **Keypad-first UI**: All navigation works with d-pad and number keys (no touch required). Softkey bar at the bottom shows context-sensitive actions.
- **Progressive feature loading**: Each feature (forum, market, farm ops) is independently gated by its migration. Missing tables disable the feature gracefully, not the whole app.
- **Factory + DI**: Services are created via factory functions (`createPriceService`, `createMarketRouter`) that receive their dependencies, making them testable with PGlite.
- **Dual resolution**: CSS adapts between 240x320 and 128x160 Cloud Phone viewports.
- **CSP hardened**: No inline scripts, no remote resources. Gemini calls are server-side only.

## License

Private repository — all rights reserved.
