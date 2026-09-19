# Engineering Quality Plan（依 2026-09-19 程式碼現況重寫）

> 取代 `docs/ENGINEERING_QUALITY_UPGRADE.md`。舊文件是照早期 `proposal.md` 寫的，假設 SQLite、單檔 `server.js`、WebSocket hub、沒有測試；這些都不是現況，照抄會讓伺服器起不來或弄壞 Weather 畫面。舊文件保留作歷史紀錄，**以本文件為準**。
>
> 現況盤點（架構、功能、慣例）見 [`CODEBASE_STATUS.md`](CODEBASE_STATUS.md)。

**規則**（沿用舊文件）：不破壞現有功能；維持 Vanilla JS + ES modules；每一項都要能跑、有測試。

---

## 0. 評分項對照：現況

| 官方評分項 | 舊文件判定 | 實際現況 |
|---|---|---|
| 模組化 | ✅ | ✅ 前端 48 個 ES module（screens / forum / market / farmOps）；後端 routes / services / repositories / middleware 分層，服務用 `createXxx({ deps })` 工廠 + 依賴注入 |
| API 設計 | ⚠️「全塞一檔」 | ✅ 9 個路由檔。⚠️ 錯誤格式有 6 套 → **本計畫第 2 項** |
| 雲端整合 | ❌ | ✅ Open-Meteo（快取 + stale fallback）、data.gov.in 每 30 分鐘同步進 Postgres、Gemini（逾時 / 修復重試 / 固定離線答案）|
| 測試 | ❌「零」 | ✅ 159 個測試，PGlite 跑真正的 Postgres 與 migration，約 17 秒，不需要資料庫 |
| 容錯 | ⚠️「後端沒有」 | ✅ 天氣 stale cache、農場價格 snapshot fallback、AI fallback、per-member rate limit。⚠️ 沒有 requestId → **第 2 項** |
| CI/CD | ❌ | ❌ 沒有 `.github/` → **第 1 項** |
| PWA | ❌ | 不適用：Cloud Phone 在雲端渲染，官方說明 widget 不能離線使用 → **第 5 項** |
| RWD | ⚠️ | ✅ 5 個 CSS 檔有 `max-width:160px` 規則；缺的是逐頁實測 → **第 6 項** |
| Lint | ❌ | ❌ → **第 7 項**（黑客松後）|

---

## 1. CI — GitHub Actions ✅ 本輪實作

`.github/workflows/ci.yml`，push / PR 到 `main` 時執行：

1. `npm ci`（`backend/`，Node 22）
2. `npm test` — 全部 `*.test.js`（`tests/`、`test/`、`services/` 三處都有，**不要**把指令改成 `node --test tests/`，會漏掉 8 個檔）
3. `npm run smoke` — `backend/scripts/smoke.js`：不帶 `DATABASE_URL` 啟動真的 `server.js`（in-memory 模式），檢查：
   - `GET /` 回前端 HTML
   - `GET /api/ai/capabilities` 回 `ok:true`
   - `GET /api/prices/crops?region=IN-UP-01` 回 200
   - `GET /api/prices?crop=x` 回 400 且為統一錯誤格式
   - 不存在的 `/api/...` 回 JSON 404
   - 每個回應都有 `X-Request-Id`

**不做 CD**：部署仍是 VM 上手動 `deploy/setup.sh`。自動部署需要把 VM 的 SSH 金鑰放進 GitHub secrets，要全組同意再做。

> Node：repo 已統一為 22（`.nvmrc`、`engines: >=22`，CI 讀 `.nvmrc`）。VM 仍是 Node 18，升級步驟見 `CODEBASE_STATUS.md`「部署 > Node 版本」；`deploy/setup.sh` 在舊版 Node 上會印出警告。

## 2. 統一錯誤格式 + requestId ✅ 本輪實作

**問題**：現在有 6 套錯誤處理——`prices.js`/`weather.js` 回 `{error:{code:'bad_request'}}`（沒有 `ok:false`，小寫 code）；`auth.js`、`admin.js` 各有 `sendError`/`fail`；`ai.js`、`tts.js` 各有 STATUS 表；`forumErrorHandler` 用正則只管 forum / market / farms；最後還有一個通用 500。`sameOriginWrites` 在三個路由檔各複製一份。未知的 `/api/xxx` 回 Express 預設的 HTML 404。

**做法**（擴充現有的 `middleware/errors.js`，**不要**另建一個參數順序不同的 `AppError`）：

- 統一格式：`{ ok:false, error:{ code, message, field, retryable, requestId } }`；前端只依 `code` 分支。
- `middleware/requestId.js`：每個 request 一個 UUID，放 `req.requestId` 和 `X-Request-Id` header；伺服器 log 帶這個 id。
- `errorHandler`（全域，取代只管三個路徑的 `forumErrorHandler`；舊名保留為別名，dev server / 測試不用改）：
  - `AppError` → 照它的 code / status
  - 帶 `code` + 4xx `status` 的錯誤（`authService.coded()`）→ 原樣傳回
  - JSON 解析錯誤 / body 過大 → `400 VALIDATION_ERROR`
  - 其他 → `500 INTERNAL_ERROR`，不外洩訊息；log 只記訊息，不記 body / PIN / token
- `middleware/sameOrigin.js`：forum / market / farmOps 共用。
- `/api` 下未知路徑 → JSON `404 NOT_FOUND`。
- `prices`、`weather`、`auth`、`admin` 改用 `next(err)`；成功回應加 `ok:true`。
- `ai`、`tts` 保留自己的錯誤碼（`AI_TIMEOUT`、`fallbackAvailable` 等是它們的 API 契約），只補上 `requestId`。

**相容性**：前端只依 `AUTH_REQUIRED` 和 `CANCELLED` 分支，兩者不變；`getJSON` 只看 HTTP status。HTTP status 與訊息文字不變。

## 3. 噴藥評估：同一套規則 + 真的最佳時段（最佳時段 ✅ 已完成，`todays-farm` 分支；統一規則待做）

**問題**：
- `sprayAssessment.js` 的 `bestWindow` 寫死 06:00–10:00（`weatherService` 從不提供 `bestSprayWindow`），Today's Farm 卻顯示得像是算出來的。
- Weather 畫面用 `weatherService.advise()`，Today's Farm 用 `assessSprayConditions()`，同一地點可能相反（降雨機率 10%、風速 20 km/h：前者 OPTIMAL、後者 UNSUITABLE）。與先前兩個畫面價格不一致是同一類問題。

**做法**：
- `weatherService.normalize()` 已經抓了逐時風速 / 溫度 / 濕度 / 降雨機率，把逐時陣列保留在回應中，由 `sprayAssessment` 依逐時資料算最長的合格時段（**不要**照抄舊文件的 `findBestWindow`：最長的一段在資料末尾時 `to` 會是空的）。
- ✅ 已完成：`bestSprayWindow()` 依逐時預報算最長的合格時段，每個非 optimal 的條件都附原因；未來日期依當天預報評估。
- 待做：`advise()` 改由 `assessSprayConditions()` 推出，Weather 畫面的 `advice.action` / `reason` 欄位名稱不變。
- 測試：時段在末尾、整天都不合格、缺資料。

## 4. `createApp()` 工廠（下一輪）

把 `server.js` 的組裝邏輯（依 DB / migration 狀態決定哪些功能啟用或回 503）抽成 `app.js` 的 `createApp({ pool, env })`，`server.js` 只負責 `listen`。好處：這段條件邏輯目前沒有任何測試；`tests/helpers.js` 與 `dev/*.js` 都在重組自己的 app，可以改用它。

**不要加**：`cors()`（不在依賴中，app 是同源，CSP `connect-src 'self'`）、SPA `*` fallback（router 的 `pushState` 不改 URL）。

## 5. PWA：只加 manifest，不加 Service Worker

Cloud Phone 所有畫面在雲端渲染，官方說明 widget 不能離線使用（[developer.cloudfone.com](https://developer.cloudfone.com/docs/tutorials/kaios/)）。

- 可選：`frontend/manifest.json` + `<link rel="manifest">`（icon 用已存在的 `assets/icon-80.png`）。
- **不做 SW**。舊文件的 SW：清單列了不存在的 `js/ws.js`、`js/i18n.js`（`addAll` 失敗、SW 裝不起來）；inline `<script>` 會被 CSP `script-src 'self'` 擋；cache-first + 固定版本號會讓使用者卡在舊 JS；還會快取每位使用者的 `/api/tasks/today`。
- 簡報講法：「Cloud Phone 本來就不能離線；容錯做在伺服器端」，並列出第 0 節的容錯機制。

## 6. RWD 128×160：逐頁實測

舊文件的 CSS 選到的 class（`.menu-item`、`#softkey-bar`、`--sk-h`…）都不存在，唯一生效的是把 `html, body` 寫死 240×320，**不要用**。現有的 160px 規則在 `responsive.css`、`ask-ai.css`、`farmer-circle.css`、`market.css`、`todays-farm.css`。要做的是用模擬器 / 瀏覽器 128×160 逐頁檢查焦點、捲動、soft key，發現問題再補規則。

## 7. Lint（黑客松後）

- ESLint 9 flat config（`eslint.config.js`），只開 `recommended`；先修到 0 error 再放進 CI 當真的關卡，不要 `|| true`。ESLint 8 已停止維護，也不讀 `.eslintrc.json`。
- **不要現在跑 Prettier**：約 13k 行中有 1,653 行超過 100 字元，格式化會改掉大半 repo，4 人同時開發必定衝突。

---

## 不做的項目（及原因）

| 舊文件項目 | 原因 |
|---|---|
| `providers/openMeteoProvider.js` | 已有 `weatherService.buildUrl/normalize`（可注入 fetch、有測試）；舊版會改掉 `current.temp`、`daily[].tmax`、`rain_prob`、`advice`，Weather 畫面會壞 |
| `providers/mandiPriceProvider.js` | 已移除且禁止加回；全 app 行情只有 `app.market_prices` 一個來源 |
| SQLite `weather_cache` / `price_cache` | 本專案是 Postgres；已有 `farm_weather_snapshots`、`price_snapshots`（migration 007 / 011）|
| `routes/listings|tasks|notifications|i18n.js` | 這些 API 不存在；實際路由見 `CODEBASE_STATUS.md` |
| `ws/hub.js` | 沒有 `ws` 依賴、沒有使用者；Local Market 刻意用輪詢（`marketSync.js`）|
| `routes/prefetch.js` | 「離線預載」在 Cloud Phone 不成立；呼叫簽名錯誤；未登入可觸發外部請求 |
| 舊文件的 `priceService.test.js` | 驗證的是測試裡自己寫的常數，沒測到程式；真的測試已在 `services/priceService.test.js` |
| 舊文件的 `package.json` scripts 區塊 | 整段貼上會蓋掉 `db:migrate`、`mandi:sync` 等；`test` 只跑 `tests/` |
