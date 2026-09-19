# Kris 開發紀錄（Devlog）

本檔案供 CloudMosa Hackathon 組員交接與追蹤。每一筆均使用 `YYYYMMDDHHMM GMT+8`（Asia/Taipei）格式，記錄發現、目標、實際變更與後續注意事項。

> 不得在本檔案記錄 private key、密碼、token、憑證私鑰或其他機密內容。可記錄檔案位置、公開網址與非機密設定。

---

## 202609191115 GMT+8 — 建立共用 devlog

### 發現／問題

- 專案此前沒有統一記錄開發與部署決策的文件，組員難以確認 VM、手機測試與 widget URL 的最新狀態。

### 要解決什麼

- 建立可持續附加的開發紀錄，讓每次變更都有可追溯的背景、目的、做法及風險。

### 做了什麼改動

- 在專案根目錄建立 `devlog-kris.md`。
- 補登本次已完成的裝置確認、Cloud Phone 研究、VM 部署與 HTTPS 設定。

### 組員注意事項

- 後續每次改程式、部署設定或測試環境後，請在檔案末端新增一筆紀錄。
- 時戳請使用 `date '+%Y%m%d%H%M GMT+8'` 取得。

---

## 202609191115 GMT+8 — itel NEO R60+ USB 儲存區確認

### 發現／問題

- 插入的裝置掛載為 `/Volumes/NO NAME`，僅顯示約 27 MiB 的 USB Mass Storage 區。
- 可見目錄包含 `System/`、`Cool_Photo/`、`Cool_Music/`、`Cool_Video/`、`vCard/` 與 `@cstardata/`。
- 此模式不等同完整系統存取，無法直接取得韌體、SIM、簡訊或受保護系統分區。

### 要解決什麼

- 確認手機可以安全讀取的資料範圍，以及開發 widget 時是否應從 USB 檔案系統著手。

### 做了什麼改動

- 僅做唯讀檢查，未更動手機儲存資料。
- 確認可見資料量約 480 KB，主要為系統設定與預設資料，未發現使用者媒體檔。

### 組員注意事項

- 不要將 USB 儲存區誤認為 Android 檔案系統，也不要期待 `adb` 可用。
- 若未來進行低階韌體研究，先取得完整唯讀備份；不要使用不相容 loader 或任意刷機。

---

## 202609191115 GMT+8 — Cloud Phone 開發方式確認

### 發現／問題

- itel NEO R60+（it9310）為 UNISOC T127 的 feature phone，Cloud Phone 版本為 2.5.0。
- Cloud Phone widget 不是 APK；它是 CloudMosa 遠端 Chromium 瀏覽器開啟的 HTTPS 網頁。

### 要解決什麼

- 找出把 demo 顯示在手機上測試的正規方式。

### 做了什麼改動

- 確認測試流程：在 Cloud Phone Developer Console 登入後，將測試機 IMEI 加入帳號並新增 widget URL。
- 手機端可在 Cloud Phone App 的 About 頁面連按左軟鍵 7 次，啟用 Developer Mode，讓指定 IMEI 看到測試 widget。

### 組員注意事項

- Widget URL 必須是公開可存取、具有效 TLS 憑證的 HTTPS 網址。
- Cloud Phone 不支援直接用 HTTP、裸 IP 位址、Android APK 或離線檔案作為 widget。

---

## 202609191115 GMT+8 — 將 cloudphone-demo 部署至 CloudMosa Ubuntu VM

### 發現／問題

- `cloudphone-demo` 為 Next.js 15 專案，`next.config.ts` 已設定 `output: 'export'`。
- production `basePath` 是 `/cloudphone-2025meichuhackathon-demo`；若 Nginx 路徑不對應，會造成靜態資產或首頁 404。
- VM `203.116.30.130` 初始為 Ubuntu 24.04，未安裝 Node.js、npm 或 Nginx，且入站防火牆預設 DROP。

### 要解決什麼

- 建立公開可存取的靜態 widget 網頁，作為 Cloud Phone Developer Console 可填入的網址。

### 做了什麼改動

- 使用本機 SSH 私鑰連線至 `ubuntu@203.116.30.130`，並以 `rsync` 上傳專案至 `/home/ubuntu/cloudphone-demo/`。
- VM 安裝 `nodejs`、`npm`、`nginx`；執行 `npm ci` 與 `npm run build`，成功產出約 1.2 MB 的 `out/` 靜態檔。
- 靜態檔部署至 `/var/www/cloudphone-2025meichuhackathon-demo/`。
- 建立 Nginx site `cloudphone-demo`，以 `/cloudphone-2025meichuhackathon-demo/` 提供網站。
- 開放並以 `netfilter-persistent` 保存 TCP 80 規則。

### 組員注意事項

- 更新程式後必須重新執行 build，並將新的 `out/` 內容複製到 `/var/www/cloudphone-2025meichuhackathon-demo/`，再 reload Nginx。
- 不要上傳 `node_modules`、`.next` 或 `out`；VM 應由 lockfile 重建依賴與輸出。
- 詳細指令請參考 `cloudphone-demo/DEPLOYMENT_ZH_TW.md`。

---

## 202609191115 GMT+8 — Widget HTTPS URL 與 Let’s Encrypt 憑證

### 發現／問題

- HTTP 測試網址可連線，但 Cloud Phone Console 只能接受 HTTPS URL。
- 團隊暫無自有網域；直接使用 VM IP 也無法作為標準 HTTPS hostname。

### 要解決什麼

- 為測試環境取得可公開驗證、可直接貼入 Cloud Phone Console 的 HTTPS URL。

### 做了什麼改動

- 使用 `sslip.io` 的 IP 內嵌 hostname：`203-116-30-130.sslip.io`，已確認其 DNS 解析至 VM 公網 IP。
- 開放並持久化 TCP 443。
- 安裝 `certbot` 與 `python3-certbot-nginx`，透過 Let’s Encrypt 簽發憑證並設定 HTTP→HTTPS redirect。
- 外網驗證 HTTPS 首頁回傳 `200 OK`。
- 目前可用 widget URL：

  ```text
  https://203-116-30-130.sslip.io/cloudphone-2025meichuhackathon-demo/
  ```

- 憑證到期日為 2026-12-18；Certbot 已設定自動續期排程。

### 組員注意事項

- 此 `sslip.io` hostname 適合 hackathon／測試，不應視為長期正式網域。
- 正式上線時應改用團隊持有網域，更新 Nginx `server_name`、DNS A record、TLS 憑證與 Cloud Phone Console 的 widget URL。
- TCP 80 與 443 現已公開；不得把敏感測試資料或管理介面放進此靜態網站。

---

## 202609191204 GMT+8 — 確認 Agrilink 已部署服務的公開 URL

### 發現／問題

- VM 上新增了 `/home/ubuntu/dogbark` 專案與已啟用的 `agrilink.service`。
- Agrilink Node.js backend 運行在 `127.0.0.1:3000`，不應直接對公網開放該埠。

### 要解決什麼

- 確認 Agrilink 對外可使用的網址，並釐清它與 Cloud Phone demo 的路由關係。

### 做了什麼改動

- 以唯讀方式檢查 systemd、Nginx 與本機 HTTP 回應。
- 確認 Nginx HTTPS 根路徑 `/` 已反向代理至 `http://127.0.0.1:3000`，且回應為 `200 OK`。
- Agrilink 公開 URL：

  ```text
  https://203-116-30-130.sslip.io/
  ```

### 組員注意事項

- Cloud Phone demo 仍位於同一網域的 `/cloudphone-2025meichuhackathon-demo/`；較長的路徑優先匹配，因此不受 Agrilink 根路徑代理影響。
- Agrilink 由 `agrilink.service` 管理。檢查狀態請用 `sudo systemctl status agrilink`；更新後應重啟該 service，不要直接手動執行 `node server.js` 佔用 3000 埠。

---

## 202609191247 GMT+8 — 自架 PostgreSQL 與基礎 schema 上線

### 發現／問題

- AgriLink 的核心流程是多人共享狀態：刊登、表達興趣、通知、登入與點數都會有同時寫入需求；proposal 中的 SQLite 設計不再是目前後端的正確基礎。
- VM 當時未安裝 PostgreSQL 或 Docker，但既有 Nginx（80/443）與 `agrilink.service`（127.0.0.1:3000）正在服務，資料庫部署不得干擾現有網站。

### 要解決什麼

- 在同一台 Ubuntu VM 建立只供後端使用、不可由公網直接連線的 PostgreSQL authoritative store。
- 建立登入／個人化／市集的最小可用資料結構，並保留安全 migration 與權限分工。

### 做了什麼改動

- 安裝 PostgreSQL 16，建立 `agrilink` database；資料庫只監聽 `127.0.0.1:5432`，沒有開放 5432 防火牆規則。
- 建立兩個非 superuser 角色：`agrilink_migrator` 負責 schema migration、`agrilink_app` 供 Node application 讀寫；實際憑證僅保存在 VM 權限 `600` 的設定檔，未進 Git、未記錄於本檔。
- 撤除 `public` schema 的預設建表權限，只授予 application role 對 `app` schema 的必要權限。
- 套用 `001_foundation` 與 `002_marketplace`：建立地區、使用者／身份、profile、作物、刊登、interest、通知與 outbox event 等表與索引。
- 新增／維護 PostgreSQL 設計與交接文件：`docs/POSTGRESQL_SCHEMA_PLAN.md`；環境變數範例只保留無密碼的 `DATABASE_URL` 格式。

### 組員注意事項

- Browser／Cloud Phone 前端不可直接使用資料庫帳密；所有資料存取必須經 Node API／WebSocket。
- PostgreSQL superuser 採 VM 本機 peer authentication；日常應用請使用 `agrilink_app`，schema 變更只使用 `agrilink_migrator`。
- 不要在部署過程中重啟或手動搶佔 3000 埠；資料庫本身與 Nginx 路由無直接衝突。

---

## 202609191325 GMT+8 — Market Prices migration 003 套用與驗證

### 發現／問題

- 組員新增 Market Prices API／畫面後，需要把市場與每日行情資料從記憶體假資料切換為 PostgreSQL 的可追溯資料來源。

### 要解決什麼

- 將市場／行情結構安全加入既有 `app` schema，並保持 demo 資料與真實資料來源可區分。

### 做了什麼改動

- 拉取並 review `backend/db/migrations/003_market_prices.sql` 後，以 migrator role 套用至共用 VM database。
- 新增 `app.markets`、`app.market_prices`、作物／市場／日期查詢索引，以及 app role 的必要讀寫權限。
- VM `app.schema_migrations` 已記錄 `003_market_prices`；application role 已可讀取新表。

### 組員注意事項

- 行情資料必須保留 `source` 與 `is_sample`，不能把 sample 資料說成即時市場資料。
- schema 已存在不代表 production 已有資料；seed／外部同步仍須分別執行與驗證。

---

## 202609191505 GMT+8 — Identity / Admin migration 004 狀態確認

### 發現／問題

- Keypad-first login 與管理功能需要持久化 credentials、session、application settings 與 audit log。

### 要解決什麼

- 確認新 identity/admin schema 已在共用 VM 套用，而非只存在於 Git。

### 做了什麼改動

- 驗證 VM migration ledger 已包含 `004_identity_admin.sql`，並確認 `agrilink.service` 為 active。
- 此 migration 新增 user role、`auth_credentials`、`auth_sessions`、`app_settings` 與 `admin_audit_log`，並授予 application role 所需權限。

### 組員注意事項

- credentials 僅存 phone lookup hash 與 PIN hash；禁止加入明碼電話號碼、PIN 或 session secret 欄位。
- 登入／管理相關變更應一併寫 audit log，且不可把 session token 輸出到 console、devlog 或 Git。

---

## 202609191530 GMT+8 — PostgreSQL GUI 連線與 migration ledger 稽核

### 發現／問題

- 需要讓組員能以 GUI 檢視資料庫，又不能為 TablePlus／pgAdmin 對公網開放 5432。
- 現有 migration ledger 的版本格式不一致：`001_foundation`、`002_marketplace`、`003_market_prices` 沒有 `.sql`，但 `004_identity_admin.sql` 含副檔名。

### 要解決什麼

- 提供安全的開發者 GUI 存取方式，並在 migration runner 造成重複套用前標記命名風險。

### 做了什麼改動

- 驗證可用 TablePlus 的 SSH tunnel 連線：Over SSH 模式下，database host 填 VM 端 `127.0.0.1`、port 填 `5432`、database 為 `agrilink`；不要同時使用手動 5433 tunnel 與 TablePlus Over SSH。
- 核對 VM PostgreSQL 16.15、`agrilink.service` active 與四筆 migration ledger。
- 更新本 devlog，補齊 PostgreSQL 上線、001–004 migration、權限邊界與 GUI 操作交接。

### 組員注意事項

- **在修正 ledger 前，不要直接執行 `npm run db:migrate`。** 現行 `backend/db/migrate.js` 以完整檔名（如 `001_foundation.sql`）檢查 migration；前三筆 ledger 缺少 `.sql`，runner 可能誤判未執行並嘗試重跑已存在的 schema。
- 修復時需統一一種格式：要麼將既有前三筆 ledger 改為完整檔名，要麼修改 runner 一律以不含副檔名的 version 比對；先在 VM 備份／transaction 驗證，再恢復自動 migration。
- GUI 僅用 `agrilink_app`；migration 與 schema 管理仍使用 migrator role。不要將 VM 憑證複製到 repo、截圖或聊天室。

---

## 202609191609 GMT+8 — 修正 migration runner 的版本比對

### 發現／問題

- VM ledger 同時有 `001_foundation`（無副檔名）與 `004_identity_admin.sql`（含副檔名）；舊版 `migrate.js` 以完整檔名比對，會把 001–003 當成未套用而重跑。

### 要解決什麼

- 讓 `npm run db:migrate` 可以安全地在共用 VM 上套用 `005_forum.sql`。

### 做了什麼改動

- `backend/db/migrate.js` 以去掉 `.sql` 的 version 比對 ledger，新紀錄一律寫入不含副檔名的 version；抽出 `runMigrations()` 供測試使用。
- 新增 `backend/tests/migrate.test.js`（PGlite），重現 VM 的混合格式 ledger，確認只會套用 005 且重跑不重複。全部 100 項測試通過。

### 組員注意事項

- 既有 ledger 不需要改；新舊兩種格式都會被視為已套用。
- VM 仍須以 migrator role 執行 `npm run db:migrate` 套用 005，執行前先備份資料庫。

---

## 202609191656 GMT+8 — 修正 Local Market「Send offer 沒反應」

### 發現／問題

- 實機（itel）對別人的 listing 按 Send offer 後看似沒反應。nginx log 顯示第一次 POST 已成功（201），之後對同一 listing 重送 7 次皆為 409 `CONFLICT`（每人對同一標的只能有一筆進行中 offer）。
- 詳情頁不知道使用者已出價，仍顯示「Make offer」；表單的錯誤訊息畫在「Send offer」下方，且焦點跳回最後編輯的欄位，240×320 下錯誤文字在畫面外。

### 做了什麼改動

- 後端 `marketService.detail`：非擁有者會拿到 `myOfferId`（進行中 offer 的 id，沒有則為 null）；測試補上。
- 前端：詳情頁有 `myOfferId` 時改顯示「View my offer」並開啟該 offer。
- `MarketForm`：錯誤訊息改放在送出列正上方；非欄位錯誤時焦點停在送出列，確保訊息在畫面上。
- 本機 dev server 240×320 實測：出價成功 → 返回詳情顯示 View my offer；賣方下架後送出，畫面顯示「Not found. It may have been removed.」。

### 組員注意事項

- 所有使用 `MarketForm` 的表單（出價、還價、刊登、排定取貨）都套用新的錯誤顯示位置。

---

## 202609191708 GMT+8 — Local Market：把「我發出的 offer」放到首頁

### 發現／問題

- 實機發出 offer 後進 My Offers 看不到。該頁固定開啟 incoming（別人給我、等我回覆的），自己發出的要按左軟鍵「Sent」才看得到；nginx log 顯示手機從未請求 `role=outgoing`。
- My Deals 空白屬正常：offer 需被對方接受並雙方確認才會成立 deal；seed 示範帳號不會自動回覆。

### 做了什麼改動

- Local Market 首頁改為 `5 Offers to Answer`（保留 n new 徽章）、`6 Offers I Sent`、`7 My Deals`。
- 空清單提示改為說明原因（沒有待回覆／尚未發出 offer／offer 被接受後才會出現 deal）。
- 本機 240×320 實測三個入口。

### 組員注意事項

- My Deals 的數字快捷鍵由 6 改為 7。

---

## 202609191742 GMT+8 — 程式碼流程問題修正（8 項）與部署

### 發現／問題

- 全面 review 後找出 8 個可由程式碼確認的流程問題（登入後行情／Ask AI 失效、登出停在主選單、共用 IP 限流、TTS/AI 未登入可用、Today's Farm 新用戶死路、Settings 未被使用、淨利計算不一致、市集示範帳號不回應）。

### 做了什麼改動（依序，各自一個 commit）

1. `6e80956` 登入後不再把 region UUID 寫入 `user.region`（原本導致 /api/prices 400、Ask AI 每題 INVALID_INPUT）；登出改用 `router.resetTo()`，確實回到 Welcome。
2. `6818c3d` 限流改按帳號：Cloud Phone 所有手機共用 CloudMosa 出口 IP（203.208.133.15）。市集／論壇按會員、登入按電話號碼（每號 15 分鐘 10 次），IP 只做寬鬆防洪。
3. `a496832` /api/ai、/api/tts 需登入；按會員限流並加全站每日上限（`AI_GLOBAL_LIMIT_PER_DAY`、`TTS_GLOBAL_LIMIT_PER_DAY`）；TTS 以記憶體 LRU 快取相同文字的語音。
4. `73c9e25` Today's Farm：新增 `POST /api/farms` 讓新會員建立自己的農場；Quick Add 指派給自己（一人農場可完成任務）；儀表板顯示快捷鍵並接上 6 Team、7 Fields；alert() 改 toast；「今天」依農場時區。
5. `ec64866` profile 帶 regionCode、座標、cropCodes；Ask AI 送會員自己的地區／作物，profile 為 hi 時預設印地語；天氣預設會員地區。migration 008 補 region 座標。
6. `2afc844` 行情：CEDA 兩個市場原本無座標，淨利以 0 km、免運費計算（Rampur→Milak 顯示 +₹10/qt，實際 32 km、運費 ₹48，淨 −₹38/qt）。無座標時顯示「運費未知」；migration 009 補市場座標；net-profit 以 from 為本地市場並回傳兩邊日期；漲跌只比 7 天內；分析改為陳述與近兩週平均的關係，不再建議「等兩天」。
7. `71431f2` 市集：示範貼文與對其發出的 offer 會明確提示「沒有人會回覆」。

### 部署

- VM 更新至 `71431f2`，服務 active。008、009（純資料 UPDATE）以 postgres 角色套用並寫入 ledger；套用前備份 `~/agrilink-backup-regions-markets-202609190941.sql`。
- 外部驗證：匿名呼叫 /api/tts、/api/ai/ask 回 401；net-profit 回傳 32 km／運費 ₹48。

### 組員注意事項

- 前端需強制重新整理才會拿到新版。
- Ask AI 與 TTS 現在必須登入；本機無資料庫的 demo 模式仍開放。
- 行情資料仍停在 2025-10-30，且前端地區仍固定為 `IN-CEDA-S9-D136`（行情個人化與每日同步是下一階段）。

---

## 202609191832 GMT+8 — 行情改用 data.gov.in 每日即時價格（北方邦）

### 發現／問題

- CEDA 的 Agmarknet 資料只到 2025-10-30；data.gov.in 註冊要印度手機簡訊驗證碼，無法取得個人 key。
- 實測 data.gov.in「Current Daily Price of Various Commodities」可用官方文件公開的 sample key 取得**當天**資料（2026-09-19 全印度 11,845 筆），不需註冊；限制是每次 10 筆、全球共用、常被限流（約 1–2 分鐘恢復）。

### 做了什麼改動

- `services/mandiClient.js`：分頁抓取、429 指數退避（20s 起、最多 5 分鐘一次、總等待上限）。
- `db/syncMandi.js`：同步北方邦 rice/wheat/onion/tomato/potato；被限流太久就停，下次接續；同一州×作物每 3 小時重抓（市場陸續回報）。市場以 Open-Meteo 地名查詢定位，**只接受落在同一縣的結果**（UP 同名城鎮很多，寧可「運費未知」也不要錯的距離）；加上 UP 縣名拼法對照表。
- VM：`agrilink-mandi-sync.timer` 每 30 分鐘執行（`deploy/setup.sh` 會安裝）。
- migration 010：新增 `IN-UP` 與 Meerut／Agra／Lucknow／Varanasi 四個縣（Rampur 沿用 `IN-UP-01`）；縣找不到價格時用整個邦；只有 sample 資料時改用邦的真實資料。
- 行情邏輯：只比較同一品種（多數市場回報的那個，避免 basmati 混入一般米）、列出離使用者最近的 8 個市場、14 天沒回報的市場排除、距離從使用者算起；淨收益 =（目標市場價 − 運過去的運費）−（最近市場價 − 運到最近市場的運費）。新增 `/api/prices/crops`；畫面依使用者作物排序，最近市場太遠時標「Nearest」。

### 部署與驗證

- VM 更新至 `08ab4af`；010 以 postgres 角色套用並寫 ledger；套用前備份 `~/agrilink-backup-prices-202609191023.sql`。
- 第一次同步 30 秒完成：5 種作物、136 筆 2026-09-19 價格；88 個市場中 75 個有座標。
- 線上 API 驗證 5 個縣皆回傳 `source=agmarknet`、`sample=false`。本機 240×320 實測 Varanasi 使用者：Prayagraj 稻米扣運費後淨 +₹223/qt。

### 組員注意事項

- 若取得個人 data.gov.in key，設定 `MANDI_API_KEY` 即可（每頁 500 筆、不共用限流）。
- 歷史趨勢要靠每日累積；前幾天詳情頁會顯示「Trend appears after a few days of prices」。
- **`services/ttsService.test.js` 目前失敗**：TTS 已改用 Google 翻譯（5603058），但該測試仍模擬 Gemini 並會真的連網；請 TTS 負責人更新。

---

## 202609191849 GMT+8 — Today's Farm 行情改讀同一份同步資料（與 Yoyo 協議）

### 發現／問題

- Today's Farm（f370b2e）另外接了 `mandi-api.onrender.com`（非官方、Render 免費方案會休眠），距離用寫死的「離 Lucknow 公里數」表，淨收益用舊公式；與 Market Prices 同一位使用者可能看到不同數字。

### 做了什麼改動

- `createFarmPriceService` 改包 `createPriceService`：依農場座標找最近市場、列出接下來 5 個市場，淨收益公式與 Market Prices 相同（兩段運費都從農場算）。回傳格式不變，儀表板與 `marketSnapshot` 不需修改；農場所在地區沒有同步資料時回傳已存的 snapshot（標 stale）。
- 移除 `providers/mandiPriceProvider.js` 與其測試；示範農場地區改為與其座標一致的 `IN-UP-LKO`；兩份規劃文件加註「已改用 data.gov.in，勿再加回」。

### 部署與驗證

- VM 更新至 `45321bc`，服務 active。示範農場（Lucknow）：最近市場 Safdarganj ₹2,432；儀表板摘要「Unnao +₹409/qt net」，與 Market Prices 同地點列表逐一相符，source=live、2026-09-19。

### 組員注意事項

- 全 app 行情只有一個來源：`app.market_prices`（`syncMandi.js` 每 30 分鐘同步）。新功能需要價格請用 `createPriceService`，不要另接 API。

---

## 202609191909 GMT+8 — CI、統一 API 錯誤格式、現況盤點文件

### 發現／問題

- `docs/ENGINEERING_QUALITY_UPGRADE.md` 是照早期 proposal 寫的（SQLite、單檔 server、WebSocket、「沒有測試」），與現況不符；照抄會讓 server 起不來、Weather 畫面壞掉、`npm test` 漏掉 8 個測試檔。
- 後端有 6 套錯誤格式：prices／weather 回 `{error:{code:'bad_request'}}`（沒有 `ok:false`），auth、admin、ai、tts 各自一套，`forumErrorHandler` 只管三個路徑；`sameOriginWrites` 複製了三份；未知的 `/api` 路徑回 HTML 404；沒有 request id。
- 沒有 CI。

### 做了什麼改動

- 新文件：`docs/ENGINEERING_QUALITY_PLAN.md`（取代舊的 UPGRADE，舊檔保留）、`docs/CODEBASE_STATUS.md`（給組員與 agent 的現況盤點）。
- 統一錯誤格式 `{ ok:false, error:{ code, message, field, retryable, requestId } }`：`middleware/errors.js` 改成全域 `errorHandler`（`forumErrorHandler` 保留為別名）；新增 `middleware/requestId.js`（`X-Request-Id`）、`middleware/sameOrigin.js`；auth／admin／prices／weather 改用 `next(err)`，成功回應加 `ok:true`；ai／tts 保留原本的 code，只補 requestId；`/api` 未知路徑回 JSON 404；缺表時的 503 改用 `unavailable()`。
- 順手修：Today's Farm 停用時訊息誤寫成「Farmer Circle is not available」；`forum:dev` dev server 補掛 `/api/weather`。
- CI：`.github/workflows/ci.yml`（Node 22：`npm ci` → `npm test` → `npm run smoke`）；`backend/scripts/smoke.js` 不帶 DB 啟動真的 `server.js` 做 7 項檢查。只測試，不自動部署。

### 部署與驗證

- 本機：163/163 測試通過（新增 `tests/errors.test.js` 4 個）；`npm run smoke` 全過。
- 瀏覽器 240×320（`prices-live`，demo `9100000002`）：Market Prices、Weather 正常顯示；net-profit API 正常，未知市場回 `404 NO_DATA`。
- **尚未部署到 VM，CI 尚未在 GitHub 上跑過。**

### 組員注意事項

- 後端丟錯誤請用 `AppError` 或 `next(err)`，不要自己寫 `res.status(...).json({ error })`；新 code 要加進 `errors.js` 的 `STATUS` 表。前端請依 `error.code` 分支。
- 開工前請先讀 `docs/CODEBASE_STATUS.md`；工程改進以 `docs/ENGINEERING_QUALITY_PLAN.md` 為準，舊的 UPGRADE 文件勿照做。
- VM 是 Node 18，`package.json` 要求 >=20，CI 用 22；只在 Node 22 驗證過，部署前建議把 VM 升到 Node 22。
- 行情 demo 請用 `9100000002`（北方邦），其他 demo 帳號所在地區沒有同步的行情。

---

## 202609191920 GMT+8 — 北方邦 demo 帳號、有資料的地區整理、Node 22

### 發現／問題

- 即時行情只同步北方邦（`IN-UP`），但 demo 帳號大多在 Bihar、越南、孟加拉，行情畫面顯示「No mandi prices for your area yet」；北方邦只有 Rampur（`IN-UP-01`）有人，Meerut／Agra／Lucknow／Varanasi 四個縣沒有帳號。
- demo 帳號都沒有設定作物；Today's Farm 的示範農場在 Lucknow，成員卻都不在 Lucknow；`forum:dev` 有掛 Local Market 但沒有 demo 刊登。
- Node：VM 是 18（2025-04 停止支援），`package.json` 寫 `>=20`，CI 用 22。程式在 18 上還能跑，但 `google-translate-api-x` 要求 21 以上。

### 做了什麼改動

- 新增 5 個北方邦 demo 帳號（PIN 同其他 demo 帳號）：`9100000011` Rakesh（Meerut，wheat／potato）、`…12` Kavita（Agra，potato／onion）、`…13` Imran（Lucknow，rice／tomato）、`…14` Sunita（Varanasi，rice／wheat）、`…15` Pooja（Lucknow，onion／potato）；Asha（`…02`）也設定 rice／wheat。作物只在帳號沒有作物時才設定，在 Settings 改過的不會被覆蓋。
- 相關內容：論壇 4 篇在地貼文（其中 2 篇已解決）；Local Market 6 筆刊登、2 筆收購、1 筆進行中的出價（Pooja 對 Imran 的番茄）；價格對齊 2026-09-19 的 mandi 行情，避免和 Market Prices 互相矛盾；Imran、Pooja 加入 Green Field Cooperative（Lucknow）當 worker，Imran 明天有一個採番茄任務。
- `forum:dev` 啟動時一併建立 Local Market demo 資料。
- Node：`.nvmrc`＝22、`engines: >=22`（含 lockfile），CI 讀 `.nvmrc`；`deploy/setup.sh` 在 VM 的 Node 小於 22 時印出警告。
- 文件：`docs/CODEBASE_STATUS.md` 新增第 7 節「有資料的地區、選項與 demo 帳號」（地區×行情／天氣對照、作物、每個帳號看得到什麼、各環境怎麼建立 demo 資料），以及「部署 > Node 版本」的 VM 升級與退回步驟。

### 部署與驗證

- 本機 164/164 測試通過（新增：北方邦帳號的地區、作物，以及改過的作物不被 seed 覆蓋）；更新了論壇、市場、農場 seed 的數量斷言。
- `prices-live`（MANDI_LIVE=1）：6 個北方邦帳號都拿到自己作物的即時行情（source=agmarknet，各 8 個 mandi）與天氣；每人在 Local Market 看到自己縣的刊登，論壇最上面是自己地區的貼文。Imran 的畫面顯示「Offers to Answer (1 new)」。
- `farm-dev`：Imran 看到 Green Field Cooperative（worker），任務清單有 2026-09-20 的採番茄任務。
- **VM 尚未部署，也還沒升級 Node。**

### 組員注意事項

- demo 行情請用北方邦帳號（`9100000011`–`15` 或 `02`）；完整對照見 `docs/CODEBASE_STATUS.md` 第 7 節。
- VM 上 demo 帳號的 PIN 是 VM `.env` 的 `DEMO_USER_PIN`，不一定是 `246810`。新帳號要在 VM 出現：`SEED_DEMO_DATA=true` 後重啟服務（論壇＋農場），Local Market 另外執行 `npm run market:seed`。
- VM 升級 Node 22 的步驟在 `CODEBASE_STATUS.md`「部署 > Node 版本」；升級會重啟服務，請先和大家約時間。
- 新增 demo 貼文或刊登時，`tests/forum.test.js`、`permissions.test.js`、`marketSeed.test.js`、`farmOps.test.js` 裡的數量斷言要一起改。

---

## 202609191933 GMT+8 — main 的 TTS 衝突：先保留線上 v3 部署，之後再合併 v2

### 發現／問題

- craby168 的 `70efa82`（19:06，"Overwrite v3 with perfect v2 Hybrid TTS"）把**沒解決的衝突標記**（`<<<<<<<` / `=======` / `>>>>>>>`，共 8 行）commit 進 `backend/services/ttsService.js`，語法錯誤，`server.js` 一啟動就 crash。它只有一個 parent（`b49382c`），不是 merge commit，推測是本機衝突沒解決就整檔 commit。VM 當時停在 `45321bc`，線上沒受影響。
- 衝突兩邊：
  - **v3（線上版，18:23 `a9bdef1`）**：後端只翻譯、回傳 `{ ok, text }`，手機用瀏覽器的 `speechSynthesis` 朗讀。
  - **v2 Hybrid（只存在於 `70efa82` 的衝突檔）**：後端用 google-translate-api-x 產生 MP3，被擋時改用 Gemini `gemini-1.5-flash-8b` 產生語音，回傳 `{ audio, mimeType }`。
- craby168 改 v2 的原因（見 `devlog_Will.md` 18:58）：**裝置缺少東南亞語音包，越南語／孟加拉語會被瀏覽器用中文發音唸出來**。這是 v3 的真問題，合併時要解決。
- 若直接採用 v2 會有的問題：`routes/tts.js` 送出 `result.text`、`frontend/js/tts.js` 用 `speechSynthesis`，兩者都沒改，所以按 `#` 會唸不出東西；VM 的 IP 向 Google 要 MP3 曾被擋（503，同一份 devlog 18:15）；`gemini-1.5-flash-8b` 很可能不支援語音輸出；API key 放在網址參數（`?key=`）而不是 header。

### 做了什麼改動

- 決定（與 kris 討論）：**先保留線上的 v3 並部署**；等 craby168 測完 v2，再一起想辦法合併。
- `a6fe511`：`ttsService.js` 還原成線上 v3（與 `b49382c` 完全相同）；`devlog_Will.md` 兩段紀錄都保留、依時間排序、拿掉衝突標記，18:58 那段從 Big5 轉回 UTF-8（內容無損）。
- 我的 `engineering-quality` 分支 rebase 到這個修正之後，fast-forward 進 main。

### 組員注意事項

- **@craby168**：v2 Hybrid 的程式碼在 `70efa82`（`git show 70efa82:backend/services/ttsService.js`，看 `<<<<<<< HEAD` 那段）。合併時請把後端回傳格式、`routes/tts.js`、`frontend/js/tts.js` 一起改，並在 VM 上實測 Google MP3 會不會被擋、Gemini 語音模型能不能用。建議開分支或 PR，CI 會先跑測試和 smoke，衝突標記這類錯誤會在合併前被擋下。
- 可以考慮的折衷：保留 v3（手機朗讀），只在瀏覽器沒有該語言的語音時（`speechSynthesis.getVoices()` 找不到 `vi` / `bn`）才向後端要音檔。
- push 前請先跑 `npm test`；`git grep -n '^<<<<<<<'` 可以檢查有沒有漏掉的衝突標記。

---

## 202609192011 GMT+8 — Today's Farm：多農場，以及 8 項問題修正（分支 `todays-farm`）

### 發現／問題

- 一個農夫可能有好幾個農場（自己的地、家族農場、合作社），但 `createFarm` 發現已有農場就直接回傳那一個，只能有一個。
- 逐頁操作後整理出 8 項問題：切換日期時天氣仍是「現在」；噴藥最佳時段寫死 06:00–10:00、風太小等原因沒寫；被卡住的任務看不到原因、也無法解除；不能改派、改日期、延後、取消，快速新增不能選田區；昨天開始、還在做的任務被歸到 OVERDUE；行情列固定只看稻米；紀錄／團隊／田區點不進去；歷史時間是雲端瀏覽器的時區與美式格式。

### 做了什麼改動（每項一個 commit）

- **多農場**：`POST /api/farms` 接受 `{ name, regionCode }`（預設為個人資料的地區；同名回傳原農場；每人最多 10 個）。農場清單顯示地區，最後一列「+ Add a farm」（輸入名稱 → 選地區）；儀表板按 1 回到清單切換農場。
- **1 天氣跟著日期**：Open-Meteo 改抓 7 天並保留逐時資料（Weather 畫面仍顯示 3 天）。今天顯示現在的天氣，7 天內顯示當天預報，其他日期直接寫「Past day · no forecast」。
- **2 噴藥**：`bestSprayWindow()` 取白天（06–18 時）沒有任何 unsuitable 條件的最長連續時段；今天只從目前這個小時算起，找不到就寫「no safe window」。門檻不變，但每個非 optimal 的條件都附原因（例如風太小：逆溫，藥霧會飄散）。未來日期依當天預報評估。
- **3 被卡住**：詳情顯示卡住、延後、取消的原因；owner／manager 可 Unblock（有負責人就回到 assigned，沒有就回到 scheduled，並清除原因）；Report problem 改成從原因清單選。
- **4 操作**：詳情頁新增「Options…」，依角色列出指派（`POST /tasks/:id/assign`）、改日期（`POST /tasks/:id/reschedule`，時段一起平移）、延後與取消（選原因）。快速新增改成先選種類、再選田區。歷史顯示實際事件（reassigned、moved to Sep 21）。
- **5**：進行中的任務在之後的日子仍列在 IN PROGRESS，並標示「from Sep 19」。
- **6 行情**：依農場的作物週期（沒有就用會員的作物，再沒有才用稻米），最多 3 種，按 Enter 切換（1/2）。回應保留 `marketSnapshot`，新增 `marketSnapshots`。
- **7 詳情**：紀錄、成員、田區都能點進去；任務清單 API 新增 `assignee`、`field`、`open` 篩選，田區回應補上品種。
- **8 時間**：歷史時間改用農場時區，格式如「Sep 19 17:37」。

### 部署與驗證

- 本機 175/175 測試通過（新增：多農場、日期天氣、噴藥時段與原因、解除卡住、改派、改日期、跨日進行中、作物行情、成員／田區篩選）。
- `farm-dev` 240×320 逐項操作驗證，128×160 可用。行情的多作物切換在本機沒有番茄行情，是用測試時注入的回應確認畫面；實際資料要等 VM 上的即時行情。
- **尚未 merge 到 main，也尚未部署。**

### 組員注意事項

- 沒有新的 migration，全部沿用 007／011 的欄位。
- Weather 畫面的 `advise()` 仍是另一套規則（計畫第 3 項後半，還沒做）。
- 新畫面沿用論壇的 `ForumPicker` 和市場的 `MarketText`，改這兩個元件時請留意 Today's Farm。

---

## 202609192032 GMT+8 — 修 main 的 CI；todays-farm rebase 到 i18n 之後

### 發現／問題

- main 的 CI 在 `2fb73a4`、`fa40588` 都失敗：craby168 的 TTS 改成回傳音檔，但 TTS 快取測試還在檢查 `{ ok, text }`；`ttsService.test.js` 被刪除；TTS 錯誤回應少了 requestId。`2fb73a4` 的 `frontend/js/tts.js` 還有語法錯誤（emoji 變成 `??`，吃掉字串結尾引號，整個 app 會白畫面），Yoyo 在 `fa40588` 修好了。
- Yoyo 的 i18n（`b5507ce`）把 `farmOps.js` 幾乎每個字串都包上 `t()`，和 todays-farm 的改寫衝突；`weather.js` 也有小衝突。

### 做了什麼改動

- main `3543cc1`：TTS 快取測試改成檢查音檔；新增「兩種雲端語音都失敗時回傳 `fallbackText`」的測試；TTS 錯誤回應改回共用格式（有 requestId）。GitHub CI 通過。
- todays-farm rebase 到最新 main：rebase 時 `farmOps.js` 先採用本分支的版本，`weather.js` 手動合併（`wmo` 匯出，並保留翻譯）。最後一個 commit 把 `farmOps.js` 全部字串重新包上 `t()`，沿用 Yoyo 的 key，日期改用 `dateLocale`；三個語言各新增 120 條翻譯，並刪除 5 條已經沒有畫面使用的 key。
- 噴藥最佳時段多回傳 `watch`（要注意的條件），讓前端能用會員的語言組句子。

### 部署與驗證

- 本機 172/172 測試通過（含 i18n 測試）、smoke 通過、前端全部檔案可解析。
- `farm-dev` 240×320：英文與 Hindi 模式都驗證了農場清單、儀表板、任務詳情、Options、取消原因選單。
- **todays-farm 尚未 push、尚未合進 main、尚未部署。**

### 組員注意事項

- 介面語言以會員個人資料為準（登入後會覆寫 localStorage），測試其他語言要改個人資料的語言。
- 新加的 Hindi／Bengali／Vietnamese 譯文由我撰寫，請母語組員看過再 demo。
- @craby168：`ttsService.test.js` 已刪除，新版 service 沒辦法注入 Google 翻譯，建議之後把測試補回來。
