# AgriLink

AgriLink is a Cloud Phone web app for smallholder farmers using feature phones. It brings official mandi prices, local trading, community support, AI-assisted agricultural guidance and daily farm operations into a keypad-first interface designed for 240×320 screens.

Built for the [CloudMosa](https://cloudmosa.com/) Cloud Phone platform, AgriLink keeps computation on the server while the handset renders a lightweight HTML/CSS/JavaScript interface. The current live-price pilot covers Uttar Pradesh, India, and five crops. The interface supports English, Hindi, Bengali and Vietnamese; price coverage outside the pilot is not claimed.

## Features

- **Market Prices** — Latest official mandi prices from Agmarknet via [data.gov.in](https://data.gov.in/), synchronized every 30 minutes. Each record can show location, variety, distance, observation date and an A/B/C confidence grade. TruePrice estimates net proceeds after transport, commission and spoilage, without pretending to predict the future.
- **Local Market** — Buyer and seller listings, offers, counter-offers, deal tracking, evidence-based reputation and reporting. Payments stay outside the platform; AgriLink records the agreement and handover workflow.
- **Today's Farm** — Multi-farm tasks, assignments, checklists, crop cycles, weather-aware spray-window assessment and farm records.
- **Farmer Circle** — Community posts, tags, replies, collections and moderation.
- **Ask AI** — Gemini-backed agricultural guidance with text, photo and voice input, text-to-speech responses and deterministic provider fallbacks when Gemini is unavailable.
- **Weather** — Location-based forecasts used as decision inputs for farm planning.
- **Identity** — Phone-and-PIN authentication, multilingual onboarding and user profiles with regional and crop preferences.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 22, Express 4 (ESM), PostgreSQL |
| Frontend | Vanilla JavaScript, keypad-navigated SPA |
| AI | Google Gemini API, called server-side |
| Price data | Agmarknet / data.gov.in production sync; CEDA optional legacy importer |
| Testing | Node.js test runner, PGlite database tests |
| Deployment | systemd, nginx reverse proxy, HTTPS |
| CI | GitHub Actions test and smoke checks |

## Languages

English, Hindi (हिन्दी), Bengali (বাংলা) and Vietnamese (Tiếng Việt).

Language support applies to the interface. It does not imply that official market-price feeds are live in every language or country.

## Project Structure

```text
backend/
  server.js              # Express entry point
  routes/
    ai.js                # /api/ai — Ask AI
    auth.js              # /api/auth — phone+PIN identity
    admin.js             # /api/admin — administration
    farmOps.js           # /api/farms — Today's Farm
    forum.js             # /api/forum — Farmer Circle
    market.js            # /api/market — Local Market
    prices.js            # /api/prices — Market Prices
    tts.js               # /api/tts — text-to-speech
    weather.js           # /api/weather — forecasts
  services/              # Business logic using factory/DI patterns
  middleware/            # Authentication, rate limiting, errors, CSP
  db/
    migrations/          # 001–013 SQL migrations
    pool.js              # PostgreSQL connection pool
    migrate.js           # Migration runner
    syncMandi.js         # Production Agmarknet/data.gov.in importer
  repositories/          # Data-access layer
frontend/
  index.html             # SPA shell
  js/
    main.js              # Router and screen registry
    keypad.js            # Keypad navigation engine
    router.js            # Hash-based SPA router
    i18n/                # Translation dictionaries
    screens/             # Feature screens
    market/              # Marketplace UI modules
  css/                   # Base, layout and feature styles
deploy/                  # systemd units, nginx configuration, setup script
docs/                    # Specifications, engineering plans and runbooks
devlog/                  # Development logs
```

## Getting Started

### Prerequisites

- Node.js 22 or newer
- PostgreSQL for persistent production data; the app can start in an in-memory demo mode without it

### Install and Run

```bash
cd backend
npm ci
```

**Without PostgreSQL** — uses in-memory sample data and deterministic AI provider fallbacks:

```bash
npm start
```

**With PostgreSQL:**

```bash
cp .env.example .env

# Add DATABASE_URL and an AUTH_LOOKUP_SECRET of at least 32 random characters.
# GEMINI_API_KEY is optional.
npm run db:migrate
npm start
```

To seed demo records, follow the guarded demo-data settings in `.env.example`; do not enable demo seeding in a real production dataset.

The server starts on `http://localhost:3000` and serves the frontend as static files.

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Production | PostgreSQL connection string. Omit only for in-memory demo mode. |
| `AUTH_LOOKUP_SECRET` | With PostgreSQL | Secret used for protected authentication lookup data; use at least 32 random characters. |
| `GEMINI_API_KEY` | No | Gemini API key. If absent or unavailable, the server uses deterministic provider fallbacks. |
| `MANDI_API_KEY` | For official price sync | data.gov.in API key used by the Agmarknet importer. |
| `PORT` | No | Server port; defaults to `3000`. |
| `SEED_DEMO_DATA` | No | Enables demo seeding only when its additional safeguards are satisfied. |

Never commit secrets or a populated `.env` file.

### Tests

```bash
cd backend
npm test
npm run smoke
```

The test suite includes unit and integration coverage with PGlite. The smoke check starts the server without PostgreSQL and verifies critical endpoints.

## Market Price Data

The primary production pipeline is:

```text
Agmarknet / data.gov.in
        ↓
backend/db/syncMandi.js
        ↓
PostgreSQL app.market_prices
        ↓
Price service
        ↓
Market Prices, TruePrice and price alerts
```

Run the production importer manually with:

```bash
npm run mandi:sync
```

The deployment configuration schedules this sync every 30 minutes. Prices are therefore the latest synchronized official observations, not a real-time exchange feed.

CEDA is retained as a legacy, optional importer for development or historical compatibility:

```bash
npm run ceda:sync
```

CEDA is not the primary production price source.

## Deployment

```bash
# Ubuntu server with DNS and HTTPS configured
bash deploy/setup.sh
```

The setup script installs dependencies and configures the application service, nginx reverse proxy and mandi synchronization timer. Review the deployment files and environment values before running them on a new server.

## Architecture Notes

- **Keypad-first UI** — D-pad, number keys, Enter and softkeys drive navigation; touch is not required.
- **Primary device target** — 240×320 is the supported target. Compact 128×160 CSS rules are present as a bonus path and still require device-by-device verification.
- **Graceful feature gating** — Features backed by unavailable tables can be disabled without taking down the entire app.
- **Factory and dependency injection** — Services receive dependencies through factory functions, supporting isolated tests and PGlite integration tests.
- **Server-side AI** — Gemini credentials and requests remain on the backend.
- **Security controls** — Content Security Policy, authentication, validation, rate limiting and centralized error handling protect the public endpoints.

## Scope and Safety

AgriLink is a hackathon prototype, not a regulated financial, medical or pesticide-label authority. Market confidence grades describe the available evidence; they are not guarantees. Weather and AI guidance should be checked against local conditions, product labels and qualified agricultural advice.

## License

This repository is publicly visible for hackathon review. No open-source license is granted; all rights are reserved.
