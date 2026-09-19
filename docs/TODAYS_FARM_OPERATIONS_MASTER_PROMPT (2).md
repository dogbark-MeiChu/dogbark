# ADDENDUM — Live Data, Spray Safety, Farmer Circle, Today Integration

> Applies on top of `TODAYS_FARM_OPERATIONS_MASTER_PROMPT`. Sections here override or extend the numbered sections of the base document. If a section number appears here, it supersedes the corresponding section in the base prompt. Unnumbered sections are new additions.

---

## A1. Real Market Price Data Source (NEW — extends §2 "What makes it smart")

### Provider: India Agmarknet via Mandi Price API

AgriLink must display **real government wholesale commodity prices**, not mock data. The primary source is Agmarknet (Agricultural Marketing Information Network), which publishes daily wholesale min/max/modal prices from over 3,000 regulated markets (mandis) in India.

For the hackathon, use the **Mandi Price API** wrapper — a free, keyless REST API that normalizes Agmarknet data for five Indian states:

- Maharashtra
- Uttar Pradesh ← our demo state
- Punjab
- Madhya Pradesh
- Karnataka

Base URL:

```
https://mandi-api.onrender.com/v1
```

Endpoints used:

```
GET /v1/states                          → list supported states
GET /v1/commodities?state=Uttar Pradesh → list crops
GET /v1/markets?state=Uttar Pradesh     → list mandis
GET /v1/prices?state=Uttar Pradesh&commodity=Rice
    → current wholesale prices by market
GET /v1/prices/history?state=Uttar Pradesh&commodity=Rice&market=Lucknow
    → historical trend
```

Sample response shape:

```json
{
  "state": "Uttar Pradesh",
  "commodity": "Rice",
  "data": [
    {
      "market": "Lucknow",
      "district": "Lucknow",
      "min_price": 2100,
      "max_price": 2250,
      "modal_price": 2180,
      "unit": "Quintal",
      "arrival_date": "2026-09-19"
    },
    {
      "market": "Kanpur",
      "district": "Kanpur Nagar",
      "min_price": 2200,
      "max_price": 2350,
      "modal_price": 2280,
      "arrival_date": "2026-09-19"
    }
  ]
}
```

### Server-side price adapter

```text
Widget
  → GET /api/farms/:farmId/prices?crop=rice
  → priceService.getFarmPrices(farmId, crop)
  → mandiPriceProvider.getPrices(state, commodity)
  → normalized price response
```

Files:

```text
backend/services/priceService.js
backend/providers/mandiPriceProvider.js
backend/repositories/priceCacheRepository.js
```

### Normalized price response contract

```json
{
  "farmId": "farm_demo_001",
  "provider": "agmarknet",
  "crop": "rice",
  "currency": "INR",
  "unit": "quintal",
  "date": "2026-09-19",
  "source": "live",
  "stale": false,
  "fetchedAt": "2026-09-19T09:04:12+05:30",
  "localMarket": {
    "name": "Lucknow",
    "district": "Lucknow",
    "minPrice": 2100,
    "maxPrice": 2250,
    "modalPrice": 2180,
    "isLocal": true
  },
  "nearbyMarkets": [
    {
      "name": "Kanpur",
      "district": "Kanpur Nagar",
      "minPrice": 2200,
      "maxPrice": 2350,
      "modalPrice": 2280,
      "distanceKm": 15,
      "transportCostPerQt": 42
    }
  ],
  "sevenDayTrend": [2100, 2110, 2120, 2130, 2140, 2150, 2180]
}
```

### Price cache persistence

```sql
CREATE TABLE IF NOT EXISTS price_snapshots (
  id TEXT PRIMARY KEY,
  farm_id TEXT NOT NULL,
  crop TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'agmarknet',
  state_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_price_snapshots_farm
  ON price_snapshots (farm_id, crop, fetched_at DESC);
```

Cache TTL: 60 minutes (mandi prices update once daily around 14:00 IST, so aggressive caching is safe). Fallback to last cached value on provider error. Never present cached data as live.

### Price display rules

1. **Show facts, not advice.** Display the prices from multiple markets side by side, calculate the net-after-transport difference, and stop there.
2. **Never say "sell now" or "wait".** The previous version's recommendation engine is replaced with factual comparison:

```text
RICE · Lucknow (your area)
Modal: ₹2,180/qt

Kanpur (+15km):  ₹2,280/qt
  Transport:     -₹42/qt
  Net gain:      +₹58/qt (for 5qt = +₹290)

7-day trend: ▁▂▃▄▅▆▇ +3.8%
```

3. **If AI analysis is shown, it must be labelled as estimate and include caveats:**

```text
AI ESTIMATE (not advice)
Trend: prices rising ~3.8% this week.
Note: Does not account for your
storage, crop condition, or cash needs.
```

4. **Display data source and freshness:**

```text
Source: Agmarknet · Updated 2h ago
```

### Fallback

If Mandi API is unreachable:

1. Return last cached snapshot with `source: "cache"`, `stale: true`.
2. If no cache exists, return seeded demo data with `source: "demo"`.
3. The rest of Today's Farm must remain usable regardless of price API status.

During demo, if live data loads, briefly mention: "These are real wholesale prices from India's government Agmarknet system — live, not mocked."

---

## A2. Spray Safety Rules Engine (NEW — extends §12 "Weather-aware operations")

### Rationale

The base prompt's weather constraints are per-task configurable thresholds. This addendum adds a **standardized spray-safety evaluation engine** based on international agricultural spraying guidelines. This is not AI guessing — it is a deterministic rules engine with documented thresholds.

### Spray condition evaluation

When a task has `type: "spraying"` or `type: "fertilizer"`, the server evaluates current and forecast weather against these thresholds:

#### Universal spray thresholds

| Parameter | Optimal | Caution | Unsuitable | Source |
|---|---|---|---|---|
| Wind speed | 3–10 km/h | 10–15 km/h | >15 km/h | AgStack / FAO |
| Wind gusts | <15 km/h | 15–20 km/h | >20 km/h | AgStack |
| Rain probability (next 4h) | <15% | 15–25% | >25% | Profile-dependent |
| Temperature | 10–25°C | 25–30°C | >30°C or <10°C | AgStack |
| Relative humidity | 60–85% | 45–60% or 85–95% | <45% or >95% | AgStack |
| Delta-T | 2–8°C | 0–2 or 8–10 | <0 or >10 | Dry bulb − wet bulb |
| Precipitation (current) | 0 mm | <0.1 mm | >0.1 mm | AgStack |

#### Delta-T calculation

```js
function calculateDeltaT(temperatureC, relativeHumidity) {
  // Simplified wet-bulb approximation (Stull 2011)
  const Tw = temperatureC * Math.atan(0.151977 * Math.sqrt(relativeHumidity + 8.313659))
    + Math.atan(temperatureC + relativeHumidity)
    - Math.atan(relativeHumidity - 1.676331)
    + 0.00391838 * Math.pow(relativeHumidity, 1.5) * Math.atan(0.023101 * relativeHumidity)
    - 4.686035;
  return Math.round((temperatureC - Tw) * 10) / 10;
}
```

#### Evaluation output

```json
{
  "sprayAssessment": {
    "overall": "caution",
    "windowStart": "2026-09-19T06:00:00+05:30",
    "windowEnd": "2026-09-19T10:00:00+05:30",
    "factors": [
      { "param": "wind", "value": 8.2, "unit": "km/h", "status": "optimal" },
      { "param": "humidity", "value": 72, "unit": "%", "status": "optimal" },
      { "param": "temperature", "value": 28, "unit": "°C", "status": "caution", "reason": "Above 25°C — caution for contact products" },
      { "param": "deltaT", "value": 6.2, "status": "optimal" },
      { "param": "rainRisk", "value": 15, "unit": "%", "status": "caution", "reason": "Rain possible after 15:00" },
      { "param": "gusts", "value": 12.5, "unit": "km/h", "status": "optimal" }
    ],
    "bestWindow": {
      "from": "06:00",
      "to": "10:00",
      "reason": "Lowest wind and temperature before noon"
    },
    "disclaimer": "Based on weather data only. Always follow product label instructions."
  }
}
```

#### Status display on Today dashboard and Task detail

```text
SPRAY CONDITIONS

Wind:    8 km/h      ✅ Optimal
Humid:   72%         ✅ Optimal
Temp:    28°C        ⚠️ Caution
Delta-T: 6.2         ✅ Optimal
Rain:    15% (pm)    ⚠️ Caution
Gusts:   12.5 km/h   ✅ Optimal

BEST WINDOW: 6AM–10AM ✅

⚠ Always follow product label.
  This is weather data, not advice.
```

#### Integration with task constraints

The spray-safety engine is invoked automatically for any task with `type` in `['spraying', 'fertilizer']`:

```text
GET /api/farms/:farmId/spray-assessment?date=2026-09-19
```

If no spray tasks exist for the day, the endpoint returns `204 No Content`.

The assessment is included in the Today dashboard response under `sprayAssessment` alongside the existing `weather` and `alerts` fields.

#### Safety rules that must not be violated

1. **Never say "safe to spray" or "good to spray."** Always say "conditions are [optimal/caution/unsuitable] for spraying."
2. **Never hide negative factors.** If temperature is unsuitable but wind is optimal, show both. Never show only the good ones.
3. **Always show the disclaimer.** "Based on weather data only. Always follow product label instructions."
4. **Never auto-cancel a spray task.** The existing `behavior: "warn"` / `behavior: "require_manager_override"` system from §12 applies. The spray engine provides assessment; the human decides.
5. **Log the weather snapshot with every spray task completion.** This creates an auditable safety record.

---

## A3. Today Dashboard Integration (EXTENDS §5 "Today dashboard")

### Today is the unified entry point

The base prompt's §5 defines Today as a task-centric dashboard. This addendum extends it to integrate **weather operations assessment, market prices, and community activity** into a single screen — because these are the same decision flow for a farmer.

### Updated 240×320 layout

```text
┌────────────────────────────┐
│ TODAY'S FARM          2 / 5│
│ Green Field · 19 Sep       │
├────────────────────────────┤
│ ☀ 28°C W:8km/h H:72%      │
│ SPRAY: ✅ 6AM-10AM optimal │
│ FIELD: ✅ Good conditions   │
│ RAIN:  ⚠ 70% after 3PM    │
├────────────────────────────┤
│ 📊 Rice ₹2,180 ▲3.8%       │
│ Kanpur +₹58/qt net         │
│ Source: Agmarknet · Live   │
├────────────────────────────┤
│ ! OVERDUE                  │
│ Inspect pump · Field B     │
│ Ravi · 1 day late          │
├────────────────────────────┤
│ □ Check leaf spots         │
│ Field A · Meena · 09:00    │
├────────────────────────────┤
│ ▶ Irrigate north plot      │
│ In progress · Arjun        │
├────────────────────────────┤
│ 🌾 Circle: 2 new replies   │
├────────────────────────────┤
│ Add       Open     Back    │
└────────────────────────────┘
```

### Sections (updated order)

1. **Weather + spray assessment** — Is it safe to work? Can I spray?
2. **Market snapshot** — What's my crop worth today?
3. **Safety/blocking alerts** — from base §5.
4. **Overdue tasks** — from base §5.
5. **In-progress tasks** — from base §5.
6. **Due today** — from base §5.
7. **Unassigned tasks** — from base §5.
8. **Community activity** — new replies/posts in Farmer Circle (unread count).
9. **Completed today** — collapsed by default, from base §5.

### Today endpoint (updated response)

`GET /api/farms/:farmId/today?date=2026-09-19` now includes:

```json
{
  "weather": { },
  "sprayAssessment": { },
  "marketSnapshot": {
    "crop": "rice",
    "localPrice": 2180,
    "bestNearbyPrice": 2280,
    "bestNearbyMarket": "Kanpur",
    "netGainPerUnit": 58,
    "trend7d": "+3.8%",
    "source": "live",
    "stale": false
  },
  "communityActivity": {
    "unreadReplies": 2,
    "newPostsToday": 3
  },
  "sections": {
    "blocked": [],
    "overdue": [],
    "inProgress": [],
    "dueToday": [],
    "unassigned": [],
    "completedToday": []
  }
}
```

### 128×160 compact layout

At 128×160, the weather row compresses to icon + spray status only, market row shows price + trend only, and community row is hidden (accessible via Farmer Circle menu):

```text
┌──────────────┐
│ TODAY   2/5  │
│☀28°C SPRAY✅│
│Rice ₹2180 ▲ │
├──────────────┤
│! Pump check │
│  Ravi · late│
├──────────────┤
│□ Leaf spots │
│  Meena 09:00│
├──────────────┤
│Add Open Back│
└──────────────┘
```

---

## A4. Farmer Circle Enhancements (NEW)

### A4.1 Verified experts and official feeds

Farmer Circle must not be an empty echo chamber of uninformed users. Three mechanisms solve cold-start and content quality:

#### Expert verification badge

Add to `users` schema:

```sql
ALTER TABLE users ADD COLUMN is_verified_expert INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN expert_title TEXT;
-- e.g. "Agricultural Extension Officer", "Agronomist", "KVK Expert"
```

Display:

```text
✓ Dr. Priya Sharma · KVK Expert
  Nitrogen deficiency is common at
  this stage. Apply 30kg urea/acre.
```

For the hackathon, seed 2-3 expert users with realistic replies. In production, verification would go through agricultural extension officer (KVK / Krishi Vigyan Kendra) partnership.

#### Official government feed

A system-level account `agri_gov_bot` posts formatted government advisories:

```text
[GOV] PM-KISAN Installment
  Dec 2026 disbursement open.
  Apply at pmkisan.gov.in
  or visit nearest CSC center.
  📌 Official · 2h ago
```

For hackathon: seed 3-5 government advisory posts. In production: RSS/API integration with state agriculture department feeds.

#### AI auto-reply for unanswered questions

When a forum post has zero replies after a configurable period (demo: 30 seconds for instant demo effect; production: 24 hours):

1. Server generates an AI reply using the same AI adapter (§11 of base prompt).
2. Reply is posted under account `agrilink_ai` with clear labelling:

```text
🤖 AgriLink AI · Auto-suggestion
  Based on your description, this
  may be nitrogen deficiency.
  Consider soil testing.

  ⚠ This is an AI suggestion.
  Consult a local expert for
  specific advice.

  ✓ Dr. Sharma replied 10m later
    AI is roughly correct. Also
    check water drainage.
```

3. AI replies are always sorted **below** human replies and expert replies.
4. AI reply is tagged `source: "ai"` in the database to distinguish from human posts.

Schema addition:

```sql
ALTER TABLE forum_replies ADD COLUMN source TEXT NOT NULL DEFAULT 'human';
-- values: 'human', 'ai', 'expert', 'official'
```

Display priority in reply list:

```text
1. Expert replies (verified badge)
2. Official/government replies
3. Human community replies (by likes)
4. AI auto-suggestions (always last, clearly labelled)
```

### A4.2 Automatic translation

Every post and reply is stored with its original language. When displayed to a user with a different language preference, the content is translated.

#### Schema additions

```sql
ALTER TABLE forum_posts ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE forum_replies ADD COLUMN language TEXT NOT NULL DEFAULT 'en';

CREATE TABLE translations_cache (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,   -- 'post' or 'reply'
  source_id TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source_id, target_lang)
);
```

#### Translation flow

```text
User (Hindi) views a post written in English:

1. GET /api/forum/:id?lang=hi
2. Server checks translations_cache for (post_id, 'hi')
3. Cache hit → return cached translation
4. Cache miss → call LLM translate(text, 'en', 'hi')
5. Store in cache
6. Return with translation metadata
```

#### Response format

```json
{
  "id": "p1",
  "title": "Bore worm found in rice field",
  "body": "Found small holes in rice stems...",
  "language": "en",
  "translation": {
    "title": "चावल के खेत में तना छेदक मिला",
    "body": "चावल के तनों में छोटे छेद मिले...",
    "targetLang": "hi",
    "isTranslated": true
  }
}
```

#### Display

```text
[PEST] चावल में तना छेदक
  🌐 Translated from English
  [*] View original

  12 replies · ★45 · 3h
```

Pressing `*` toggles between original and translated text.

#### Translation rules

1. **Always show `🌐 Translated from {language}` label.** Never present a translation as original content.
2. **Allow toggle to original text** via `*` key.
3. **Cache aggressively.** A translation of the same text to the same language never needs to be re-computed.
4. **Do not translate user names, numbers, or crop/product names** that have no equivalent.
5. **First version: support English ↔ Hindi.** Bengali and other languages are stretch goals.
6. **AI translation uses the same AI adapter** (Gemini/OpenAI), not a separate API. System prompt:

```text
Translate the following agricultural forum post from {source_lang} to {target_lang}.
Rules:
- Keep crop names, chemical names, and numbers unchanged.
- Use simple, colloquial language appropriate for rural farmers.
- Do not add any information not in the original.
- Return ONLY the translated text, no explanation.
```

---

## A5. Updated Seed Data Requirements (EXTENDS §26 of base prompt)

### Market price seeds

Seed one cached price snapshot per demo crop (rice, wheat, onion) with realistic UP mandi data. Label as `source: "demo"`. When live API is available, it overrides seed data automatically.

### Farmer Circle seeds

Seed at minimum:

- **20 forum posts** across all 4 categories (pest, tips, market, weather)
- **3 expert-verified users** with realistic profiles (KVK officer, district agronomist, experienced farmer)
- **5 expert replies** with verified badges
- **3 government advisory posts** from `agri_gov_bot`
- **2 AI auto-replies** clearly labelled, placed below human replies
- **Hindi translations** for at least 5 posts (pre-cached in `translations_cache`)

All seed data must be realistic and region-appropriate for Uttar Pradesh rice/wheat farming. Use real pest names (stem borer, leaf roller, BPH), real fertilizer practices (urea, DAP), real government schemes (PM-KISAN, PMFBY), and real market names (Lucknow, Kanpur, Varanasi mandis).

### Weather seeds

Keep the existing demo weather snapshot from §12. Add a spray-assessment seed result so the Today dashboard renders correctly even offline.

---

## A6. Demo Talking Points — Live Data (NEW)

### Price demo beat (15 seconds)

> "The prices you see here are real — they come from India's Agmarknet, the government system that publishes daily wholesale prices from over 3,000 regulated markets. This isn't a mockup. When I scroll to Kanpur, the ₹2,280 is what traders paid this morning. And the net-after-transport calculation is personalized to this farm's location."

### Weather/spray demo beat (15 seconds)

> "The spray assessment isn't AI guessing. It's a deterministic rules engine using international agricultural standards — wind under 15 km/h, humidity 60-85%, Delta-T between 2 and 8. The weather data is live from Open-Meteo. The system tells you when conditions are optimal, when to use caution, and when to stop — but it never auto-cancels your task. The farmer decides."

### Community demo beat (10 seconds)

> "When a question gets no reply, AI generates a suggestion — clearly labelled, always sorted below human and expert answers. And everything auto-translates: this Hindi farmer's advice is readable by a Bengali farmer without either of them typing in a foreign language."

### User research citation (10 seconds)

> "These aren't arbitrary design choices. Academic research on 800+ smallholder farmers found that existing digital farm tools fail because they're not localized, they don't respect farmers' existing knowledge, and their content isn't relevant to the specific farm. AgriLink addresses all three: real local prices, weather for your field, and community knowledge from your region."

---

## A7. Implementation Priority (replaces/appends to §33 "Recommended build order")

### Immediate (before next demo)

1. **Create `mandiPriceProvider.js`** — fetch from Mandi Price API, normalize response.
2. **Create `priceService.js`** — cache layer, fallback logic, normalized contract.
3. **Create `sprayAssessment.js`** — deterministic rules engine (thresholds from §A2), Delta-T calculation.
4. **Update `weatherService.js`** — add `relative_humidity_2m` to Open-Meteo query params (needed for spray assessment).
5. **Update Today endpoint** — include `marketSnapshot` and `sprayAssessment` in response.
6. **Update Today dashboard screen** — render weather+spray row, market row, community row.
7. **Update seed.js** — add expert users, government posts, AI auto-replies, price snapshots, Hindi translations.
8. **Add `source` column to `forum_replies`** — distinguish human/ai/expert/official.
9. **Add translation endpoint** — `GET /api/forum/:id?lang=hi` with cache.

### Next priority

10. Update Farmer Circle screens to show verified badges, translation toggle, AI reply labels.
11. Add auto-translation for new posts (on write, pre-cache for common languages).
12. Add AI auto-reply cron/trigger for unanswered posts.

### Low priority / stretch

13. Full Hindi i18n for all UI strings.
14. Bengali language support.
15. Predictive T9 for Hindi input.

---

*Addendum v1.0 · Live Data, Spray Safety, Farmer Circle, Today Integration · dogbark-MeiChu*
