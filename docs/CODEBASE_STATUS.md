# AgriLink：程式碼現況盤點

> 寫給組員與組員的 AI agent：開工前先讀這份。截至 **2026-09-19**（`engineering-quality` 分支：CI、統一錯誤格式、北方邦 demo 帳號、Node 22）。
> 程式碼與本文件不一致時，以程式碼為準，並請更新本文件。
> 工程改進計畫見 [`ENGINEERING_QUALITY_PLAN.md`](ENGINEERING_QUALITY_PLAN.md)。

## 1. 這是什麼

**AgriLink** 是給印度等地小農用的 **CloudMosa Cloud Phone widget**：功能機（12 鍵、240×320，加分 128×160）上的市場行情、買賣、農民論壇、Ask AI、農場日常工作與天氣。

- Repo：`github.com/dogbark-MeiChu/dogbark`；線上：CloudMosa 的 Ubuntu VM，nginx + HTTPS → Node `:3000`。
- 前端：Vanilla JS + ES modules，**沒有 build step、沒有框架**。
- 後端：Node + Express 4（ESM），PostgreSQL（`app` schema）。

### Cloud Phone 平台限制（寫程式前必知）

- 頁面在 **CloudMosa 的雲端 Chromium 渲染**，手機只收畫面。**不能離線**，所以不做 Service Worker / 離線快取。
- 所有手機從 CloudMosa 共用的 egress IP 連進來 → **rate limit 一律以會員為單位**，IP 只在未登入時當 fallback。
- 雲端瀏覽器的時鐘 / 時區不是農民的 → 日期用農場時區（`farmToday(tz)`）。
- 按鍵（實機驗證過，見 `frontend/js/keypad.js`）：左軟鍵 = `Escape`；**右軟鍵不會送到頁面**（平台直接當 `history.back()`），所以 router 讓畫面堆疊與 browser history 同步；`#` = 朗讀目前畫面；`*` = 各畫面的切換鍵。加 `?debug=1` 可以看原始按鍵值。
- 能力偵測用 Cloud Phone 的 `navigator.hasFeature`（見 `frontend/js/media.js`）。

## 2. 目錄

```
backend/
  server.js            組裝 app：依 DB / migration / secret 狀態啟用功能，缺的回 503
  routes/              HTTP 層（9 個檔），只做輸入檢查與回應
  services/            業務邏輯，createXxx({ deps }) 工廠 + 依賴注入（方便測試）
  repositories/        priceCacheRepository（農場價格 snapshot）
  middleware/          errors（統一錯誤格式）、requestId、sameOrigin、memberAccess、rateLimits
  db/                  pool、migrate、migrations/001–011、seed、syncMandi（每 30 分鐘行情同步）、syncCeda（舊）
  dev/                 PGlite 本機 dev server（不需要裝 Postgres）
  scripts/smoke.js     不帶 DB 啟動 server.js 的冒煙測試（CI 用）
  tests/ test/         整合測試（PGlite）、t9；services/*.test.js 是單元測試
  admin/               /admin 管理頁（靜態）
frontend/
  index.html           單頁；CSP 禁止 inline script
  js/main.js           註冊所有畫面，啟動 router
  js/router.js         畫面堆疊 + history 同步 + 軟鍵 + 數字鍵選單 + # 朗讀
  js/screens/          各畫面；js/forum|market|farmOps/ 各功能的 API / 狀態 / 元件
  css/                 base / layout / responsive + 各功能 CSS（都有 max-width:160px 規則）
deploy/                systemd（app + mandi sync timer）、nginx snippet、setup.sh
docs/  devlog/         規格與開發紀錄（見第 10 節）
.github/workflows/ci.yml   push / PR → npm ci → npm test → npm run smoke
```

## 3. 功能地圖

登入後的首頁是 **Home**（`frontend/js/screens/home.js`）：1 行情、2 待回覆的出價／進行中的交易、3 農場任務與天氣警示、0 全部功能。每個數字都標出來源與時間（`frontend/js/freshness.js`），上游失敗時顯示伺服器存的舊資料並標橘色。

全部功能（`frontend/js/screens/mainMenu.js`，從 Home 按 0，數字鍵 1–7）：

| # | 功能 | 前端 | API | 後端 | 資料表 / 來源 |
|---|---|---|---|---|---|
| 1 | Market Prices | `screens/marketPrices.js`、`priceDetail.js` | `GET /api/prices`、`/crops`、`/net-profit` | `services/priceService.js`、`priceRepo.js` | `app.market_prices`（Agmarknet，`syncMandi.js` 同步；沒 DB 時用 `seedData.js` 的 in-memory 樣本）|
| 2 | Sell / Buy（Local Market）| `js/market/*` | `/api/market/*`（listings、buy-requests、offers、deals、sync）| `services/marketService.js` | migration 006 `market_*`；即時通知 = 每 4 秒輪詢 `/api/market/sync` |
| 3 | Farmer Circle | `screens/farmerCircleHome.js`、`postDetail.js`、`createPost.js`… | `/api/forum/*` | `services/forumService.js` | migration 005 `forum_*`、011 翻譯快取 |
| 4 | Ask AI | `screens/askAI*.js`、`js/askAI.js`、`js/media.js` | `/api/ai/capabilities`、`/ask`、`/ask-media` | `aiAdapter.js` → `geminiProvider.js`；`aiFallbacks.js` | Gemini（server 端 key）；失敗時回固定的離線清單 |
| 5 | Today's Farm | `screens/farmOps.js` | `/api/farms/*`（一人可有多個農場；任務可 assign／reschedule／delay／cancel／unblock）| `services/farmOpsService.js`、`sprayAssessment.js`（逐時預報算最佳噴藥時段）| migration 007 `farm_*`、011 `price_snapshots` |
| 6 | Weather | `screens/weather.js` | `GET /api/weather?lat&lng` | `services/weatherService.js` | Open-Meteo，30 分鐘快取，失敗時回舊資料（`stale:true`）|
| 7 | Settings / 帳號（含「登出其他手機」）| `screens/identity.js` | `/api/auth/*`（`/logout-others`）| `services/authService.js` | migration 004 |
| — | `#` 朗讀 | `js/tts.js`、`screenText.js` | `POST /api/tts` | `services/ttsService.js` | Google 翻譯取得譯文 → 伺服器產生 MP3（Google，失敗改 Gemini）→ 都失敗時回傳譯文，由手機 `speechSynthesis` 朗讀 |
| — | 管理 | `backend/admin/` | `/api/admin/*` | `routes/admin.js` | `admin_audit_log` |

## 4. 後端慣例（改後端前必讀）

**錯誤格式**（`middleware/errors.js`，全 API 統一）：

```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "field": null, "retryable": false, "requestId": "uuid" } }
```

- 丟 `new AppError(code, message, { field, retryable, status })` 或 `next(err)`；status 由 code 對應（`STATUS` 表），新 code 要加進表或傳 `status`。
- 全域 `errorHandler`：`AppError` 照原樣；`authService.coded()` 的 4xx 原樣；JSON 解析錯誤 → 400；其他 → 500 `INTERNAL_ERROR`，**訊息不外洩**，log 只記訊息（不記 body / PIN / token）。
- 能單獨掛載的 router（auth、admin、prices、weather）最後都有 `router.use(errorHandler)`；forum / market / farms 靠 app 層的 handler。
- Ask AI / TTS 保留自己的 code（`AI_TIMEOUT`、`AI_RATE_LIMIT`、`fallbackAvailable`…），外層格式相同。
- **前端只依 `code` 分支**（目前只用 `AUTH_REQUIRED`、`CANCELLED`），不要依英文訊息分支。
- 成功回應是 `{ ok: true, ... }`。
- 每個回應都有 `X-Request-Id` header，錯誤 body 也有；server log 帶同一個 id。
- `/api` 下不存在的路徑回 JSON 404；某功能缺表或缺 secret 時回 503（`unavailable()`），不讓整個 app 起不來。

**安全**：
- CSP：`script-src 'self'`，**不能用 inline script**；外部圖片 / script 都不行。
- 登入：手機號 + 6 位 PIN；手機號只存 HMAC、PIN 用 scrypt；session 是 HttpOnly cookie（`agrilink_session`），JS 拿不到。
- 寫入 API 經過 `sameOriginWrites`（檢查 Origin）。
- Ask AI / TTS 需要登入（`memberOnly`），加上會員級與全站每日上限（`quotaLimits`）。沒有 DB 的本機 demo 不需登入。
- SQL 一律參數化。

**其他**：
- 服務用工廠 + 注入（`createPriceService(repo)`、`getWeather(lat, lng, { fetchImpl })`）：測試注入假的 fetch / repo，不打外網。
- **行情只有一個來源**：`app.market_prices`。需要價格請用 `createPriceService`，**不要另接 API**（`mandi-api.onrender.com` 已移除且禁止加回）。
- 價格只顯示事實與運費後差額，**不給 sell / wait 建議**。

## 5. 資料庫

- PostgreSQL，schema `app`；migrations 在 `backend/db/migrations/`，用 `npm run db:migrate`，**以 migrator 角色**執行（不是 app 角色）；版本記在 `app.schema_migrations`。
- 001 基礎（regions、users、crops）· 002 早期 marketplace · 003 行情 · 004 身分 / 管理 · 005 論壇 · 006 Local Market · 007 Today's Farm · 008 / 009 地區與市場座標 · 010 北方邦各縣 · 011 價格 snapshot、翻譯快取、專家欄位。
- 新 migration：編號遞增、檔內自己 `BEGIN/COMMIT`、只加不改舊檔；**套用前先備份**（見 devlog 做法）。
- 沒有 `DATABASE_URL` 時 server 仍可啟動：行情用 in-memory 樣本、Ask AI 開放；論壇 / 市場 / 農場 / 登入回 503。

## 6. 如何在本機跑

```bash
cd backend && npm ci
npm test                # 全部測試（約 17 秒，PGlite，不需 Postgres）
npm run smoke           # 不帶 DB 啟動 server.js 並檢查
npm run forum:dev       # :3100 論壇 + 市場 + 行情 + 天氣（PGlite，資料在記憶體）
MANDI_LIVE=1 npm run forum:dev   # 同上，並在背景同步今天的北方邦行情
npm run farm:dev        # Today's Farm
```

- demo 帳號與各帳號看得到什麼：見第 7 節。本機 PIN 一律 `246810`。
- `forum:dev` 會一併建立 Local Market 的 demo 刊登；`farm:dev` 建立 Today's Farm 的 demo 農場（示範日期 2026-09-19）。
- `.claude/launch.json` 有 `agrilink-dev`（3100）、`farm-dev`（3101）、`prices-live`（3102）。
- 用 240×320 的視窗測試；128×160 也要看。

## 7. 有資料的地區、選項與 demo 帳號

> demo 時請用**北方邦（Uttar Pradesh）的帳號**：只有這裡有即時行情。

### 地區（`app.regions`）

| code | 名稱 | 行情 | 天氣 | 來源 |
|---|---|---|---|---|
| `IN-UP` | Uttar Pradesh（邦） | ✅ 所有同步的 mandi 都屬於這裡 | ✅ | migration 010 |
| `IN-UP-01` | Rampur | ✅ 用 `IN-UP` 的資料 | ✅ | `db/seed.js` / demo seed |
| `IN-UP-MRT` | Meerut | ✅ 用 `IN-UP` 的資料 | ✅ | 010 |
| `IN-UP-AGR` | Agra | ✅ 用 `IN-UP` 的資料 | ✅ | 010 |
| `IN-UP-LKO` | Lucknow | ✅ 用 `IN-UP` 的資料 | ✅ | 010 |
| `IN-UP-VNS` | Varanasi | ✅ 用 `IN-UP` 的資料 | ✅ | 010 |
| `IN-BR` | Bihar | ❌ 沒有同步 | ✅ | demo seed / 008 |
| `VN-AG` | An Giang（越南） | ❌ | ✅ | demo seed / 008 |
| `BD-RAJ` | Rajshahi（孟加拉） | ❌ | ✅ | demo seed / 008 |
| `IN-CEDA-S9-D136` | Rampur（舊 CEDA 匯入） | 只有 2025-10-30 以前的舊資料 | ✅ | CEDA 匯入（只在 VM）|

- **行情**：縣（`IN-UP-xxx`）沒有自己的價格時，改用邦（`IN-UP`）的；列表顯示離會員最近的 8 個 mandi，14 天沒回報的排除，只比較同一品種。
- 同步範圍：`db/syncMandi.js` 的 `STATES`（目前只有 Uttar Pradesh）× `CROPS`。要加邦或作物就改這兩個表，並加對應的 `app.regions` 列。
- 2026-09-19 首次同步的覆蓋：wheat 73 個 mandi、potato 24、rice 15、tomato 13、onion 11。歷史每天累積，趨勢要幾天後才有意義。
- 沒有 DB 時（`npm start` 不帶 `DATABASE_URL`）：in-memory 樣本，只有 `IN-UP-01` 的 Rampur / Bareilly / Moradabad × rice、wheat、onion、tomato，標示為 sample。
- **天氣**：任何有座標的地區都可以（上表全部都有）。Weather 畫面預設是會員自己的地區，按 `*` 切換到固定清單 Rampur / Taichung / Hanoi / Dhaka；網址加 `?lat=&lng=` 可指定任意座標。

### 作物（`app.crops`）

| code | 行情 | 備註 |
|---|---|---|
| `rice` `wheat` `onion` `tomato` `potato` | ✅ 北方邦即時 | `syncMandi.js` 同步的五種 |
| 其他（例如 `maize`）| ❌ | 可以選、可以刊登 Local Market，但沒有行情 |

### demo 帳號

本機 PIN `246810`；**VM 上是 VM `.env` 的 `DEMO_USER_PIN`**（production 沒有預設 PIN）。

| 手機 | 名字 | 地區 | 作物 | 看得到的資料 |
|---|---|---|---|---|
| `9100000011` | Rakesh Tyagi | Meerut | wheat, potato | 行情 ✅；Local Market：自己的 wheat、potato 刊登和 onion 收購；論壇：小麥播種問題（已解決）|
| `9100000012` | Kavita Chauhan | Agra | potato, onion | 行情 ✅；Local Market：potato 刊登；論壇：馬鈴薯分級報告 |
| `9100000013` | Imran Ali | Lucknow | rice, tomato | 行情 ✅；**Today's Farm**：Green Field Cooperative 的 worker，明天有一個採番茄任務；Local Market：番茄刊登，Pooja 已出價（等他回應）；論壇：番茄裂果問題（已解決）|
| `9100000014` | Sunita Maurya | Varanasi | rice, wheat | 行情 ✅；Local Market：rice 刊登；論壇：共乘拖車；**沒有農場** → 可示範「Create my farm」（建在 Varanasi，天氣與行情都是即時的）|
| `9100000015` | Pooja Rawat | Lucknow | onion, potato | 行情 ✅；Today's Farm：worker；Local Market：potato 刊登、番茄收購、對 Imran 番茄的出價 |
| `9100000002` | Asha P. | Rampur | rice, wheat | 行情 ✅；Today's Farm worker；Local Market：wheat 刊登、onion 收購 |
| `9100000006`–`08` | Dr. Priya Sharma / Anil Verma / Suresh Yadav | Rampur | — | 行情 ✅；論壇的認證專家（回覆排在最前）|
| `9100000009` / `10` | Agri Government / AgriLink AI | Rampur | — | 論壇的政府公告與 AI 回覆作者，不建議拿來 demo |
| `9100000001` | Ravi K. | Bihar | — | 行情 ❌；Today's Farm **owner**；Local Market 主要的買賣雙人示範（與 Meena）|
| `9100000005` | Meena S. | Bihar | — | 行情 ❌；論壇 moderator；Today's Farm manager |
| `9100000003` / `04` | Minh Tran / Rahim U. | 越南 / 孟加拉 | — | 行情 ❌；Today's Farm worker / viewer |

- **Today's Farm** 的 demo 農場是 Green Field Cooperative（Lucknow，`IN-UP-LKO`）；成員：Ravi（owner）、Meena（manager）、Asha、Minh、Imran、Pooja（worker）、Rahim（viewer），以及名稱為 `Test_Admin` 的帳號（若存在，owner）。示範資料以 2026-09-19 為「今天」，網址加 `?demoDate=2026-09-19` 可固定。
- **Local Market** 預設只顯示自己所在縣的刊登（Lucknow 有 Imran 與 Pooja 兩人，可以互相看到）；篩選畫面可改成 25 km、100 km 或全國（My country），就能看到其他縣的刊登。
- **Farmer Circle** 是全域的，自己地區的貼文排最前；有 5 篇貼文有預先翻好的 Hindi。
- **Ask AI** 需要 `GEMINI_API_KEY`；沒有時回離線清單。會用到會員的地區與作物。

### demo 資料怎麼建立

| 環境 | 論壇 + 帳號 | Today's Farm | Local Market |
|---|---|---|---|
| 本機 `forum:dev` | 自動 | —（沒有掛農場）| 自動 |
| 本機 `farm:dev` | 自動 | 自動 | — |
| VM | `.env` 設 `SEED_DEMO_DATA=true` 後重啟（production 必須設 `DEMO_USER_PIN`）| 同左，自動 | 手動 `npm run market:seed` |

所有 seed 都可以重複執行，不會重複建立資料；demo 帳號在 Settings 改過的作物不會被覆蓋。

## 8. 部署

- VM 上執行 `deploy/setup.sh`：`git pull --ff-only` → `npm ci --omit=dev` → 重啟 `agrilink.service`；安裝 `agrilink-mandi-sync.timer`（每 30 分鐘）；nginx snippet。
- **不要直接在 VM 改程式碼**；改 Mac → push → VM pull。
- secret 只放 VM 的 `backend/.env`（mode 600）：`DATABASE_URL`、`AUTH_LOOKUP_SECRET`、`GEMINI_API_KEY`、`MANDI_API_KEY`（可選）。見 `backend/.env.example`、`docs/AUTH_ADMIN_RUNBOOK.md`。
- 前端改動後，手機端要強制重新整理才會拿到新版（沒有版本號 / cache busting）。
- CI 只測試，**不自動部署**。

### Node 版本

repo 以 **Node 22** 為準：`.nvmrc`、`engines: >=22`、CI 都是 22。VM 目前是 Node 18（2025-04 已停止支援），`setup.sh` 會印出警告。程式在 18 上還能跑，但 `google-translate-api-x` 需要 21 以上（npm 會警告），而且我們只在 22 上測試。

在 VM 上升級（Ubuntu 24.04；用 NodeSource，`node` 會留在 systemd 用的 `/usr/bin/node`，**不要用 nvm**）：

```bash
node -v                                    # 記下舊版本
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt-get install -y nodejs             # 若和 Ubuntu 的 npm 套件衝突：先 sudo apt-get remove -y npm
node -v                                    # 應為 v22.x
cd ~/dogbark/backend && npm ci --omit=dev
sudo systemctl restart agrilink && systemctl status agrilink --no-pager
curl -s https://<host>/api/ai/capabilities  # 應回 {"ok":true,...}
```

退回：移除 `/etc/apt/sources.list.d/nodesource.*`，`sudo apt-get update && sudo apt-get install --allow-downgrades nodejs=<舊版本>`，再重啟服務。

## 9. 已知問題 / 待辦

| 問題 | 位置 | 狀態 |
|---|---|---|
| VM 還是 Node 18；repo 已統一為 22 | VM | 照第 8 節「Node 版本」在 VM 上升級 |
| `server.js` 的功能啟用邏輯沒有測試 | `server.js` | 計畫第 4 項（`createApp`）|
| 前端 fallback 地區還是 CEDA 時期的 `IN-CEDA-S9-D136` / `ceda-680` | `frontend/js/state.js` | 小問題，只影響沒有 profile 的情況 |
| Market Prices 畫面在一次 session 內快取作物清單，同步完成前開過就要重新整理 | `screens/marketPrices.js` | 小問題 |
| 沒有 lint | — | 黑客松後（計畫第 7 項）|
| 128×160 未逐頁實測 | CSS | 計畫第 6 項 |

## 10. 文件地圖

| 文件 | 狀態 |
|---|---|
| `docs/CODEBASE_STATUS.md` | **現況**（本文件）|
| `docs/ENGINEERING_QUALITY_PLAN.md` | **現行**工程改進計畫 |
| `docs/AUTH_ADMIN_RUNBOOK.md` | 現行：帳號、管理、佈建 |
| `docs/FARMER_CIRCLE.md`、`Weather.md` | 功能說明（未逐條核對，可能略舊）|
| `docs/proposal.md` | 原始提案；API 清單、WebSocket、SQLite 等**已與實作不同** |
| `docs/ENGINEERING_QUALITY_UPGRADE.md` | **已過時**，被 PLAN 取代，勿照做 |
| `docs/*_MASTER_PROMPT*.md`、`buysell_exchange.md`、`ASK_AI_PAGE_SPEC.md`、`POSTGRESQL_SCHEMA_PLAN.md` | 各功能的原始規格；實作可能已調整，以程式碼為準 |
| `docs/HACKATHON_PREP.md` | 比賽規則與解析度要求 |
| `devlog/devlog-<名字>.md` | 每人的開發紀錄：時間戳（GMT+8）、發現 / 改動 / 部署與驗證 / 組員注意事項 |

## 11. 給 agent 的規則

1. 改動前先跑 `npm test`；改完要全過，並補測試。能用瀏覽器看的改動，用 240×320 實際看過。
2. 不要引入框架、bundler、Service Worker、WebSocket、SQLite；不要另接行情 API。
3. 錯誤走 `AppError` / `next(err)`，不要自己寫 `res.status(...).json({ error })`。
4. 共用的 middleware 放 `backend/middleware/`，不要在路由檔裡複製。
5. 做完寫進自己的 `devlog/`，影響別人的事寫在「組員注意事項」。
