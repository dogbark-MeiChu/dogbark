# Devlog — Yoyo

時間格式：`YYYYMMDDHHMM`（GMT+8）。每個開發步驟一筆，新的加在最下面。
欄位：**發現的問題** / **想解決什麼** / **做了什麼改動** / **給組員的注意事項**。

> 前 4 筆為補記（當天研究與初版實作），時間以檔案最後修改時間推估。

---

## 202609191110 · 研究 + 規劃（未動程式碼）

- **發現的問題**
  - `docs/Weather.md` 是一份 AI prompt，與官方規範/proposal 多處矛盾：320×240（官方只有 240×320 與 128×160）、專案名 FarmPulse、把 `current=precipitation`（雨量 mm）當降雨機率、URL markdown 語法壞掉、時數與 proposal 不同、引用 Next.js 的 cloudfone-starter（與 Vanilla 原則衝突）。
  - 官方 dev-guidelines **沒有** debounce 規則。
  - Open-Meteo 免費版僅限非商業（1 萬次/日）、需 CC-BY 標示。
  - Agmarknet（data.gov.in）有開放 API，但**越南/孟加拉沒有**同等級開放即時價格 API（FAO FPMA 只有國家級月價）。
- **想解決什麼**：先確認能用的 API 與限制，再決定架構，避免做到一半才發現不合規。
- **做了什麼改動**：無程式碼；計畫存於 `~/.claude/plans/proposal-md-weather-md-research-api-whimsical-lynx.md`（在 Yoyo 本機，不在 repo）。
- **給組員的注意事項**
  - 解析度以 **240×320 / 128×160** 為準。
  - 不用 cloudfone-starter，維持 Vanilla ES modules。
  - 真實行情資料只有印度；VN/BD 用 seed 並標「sample」，**簡報不要說成真實資料**。

## 202609191125 · 後端骨架 + 天氣服務

- **發現的問題**：前端直連 Open-Meteo 會吃額度、遇網路問題無 fallback。
- **想解決什麼**：後端代理 + 快取 + 失敗回傳最後成功值；建議由規則產生而非 LLM 猜。
- **做了什麼改動**
  - 新增 `backend/`（Express、`server.js`、`routes/weather.js`、`services/weatherService.js`、單元測試 4 項全過、`.env.example`）。
  - `GET /api/weather?lat=&lng=`：同座標 30 分鐘快取；上游失敗回 `stale:true`；座標驗證失敗回 400。
  - 降雨機率改取 `daily.precipitation_probability_max`；加入 `et0_fao_evapotranspiration`。
  - 新增 `.gitignore`（`node_modules/`、`.env`）。
- **給組員的注意事項**
  - `cd backend && npm install && npm start`（預設 :3000，`PORT` 可改）；`npm test` 跑測試。
  - 目前**尚未使用 better-sqlite3**（避免原生編譯風險），DB 相關功能開始時再加。
  - **API key 一律放 `backend/.env`，不要 commit**（repo 是 public）。

## 202609191130 · 前端 keypad 框架 + 主選單 + 天氣頁

- **發現的問題**：軟鍵在不同裝置的 `KeyboardEvent.key` 值不確定；官方 RSK 語意是「有 history 返回，否則關閉頁面」。
- **想解決什麼**：先做地基（keypad / focus / router / 版面），並讓 RSK 行為符合官方。
- **做了什麼改動**
  - 新增 `frontend/`：`index.html`、`css/{base,layout,responsive}.css`、`js/{keypad,focus,router,api,state,main}.js`、`screens/{mainMenu,weather,comingSoon}.js`。
  - router 的 push/pop 與 `history` 同步（`pop()` = `history.back()`）。
  - 主選單數字鍵 1–6 直接跳選；其餘 5 項為 `ComingSoon` 佔位。
  - 天氣頁：溫度、降雨機率、3 日預報、Enter 切換「建議 ↔ 細節」。
  - 修 bug：天氣載入失敗時會無限重試（加 `tried` 旗標）。
- **給組員的注意事項**
  - **新畫面照 `screens/weather.js` 的介面寫**（`name/title/render/onKey/onEnter/softLeft/softRight/onShow/onHide`），在 `js/main.js` 的 `screens` 註冊，在 `mainMenu.js` 的 `ITEMS` 加入口。
  - 列表項目加 class `item` 即可被焦點系統管理；次要資訊加 `hide-small`（128×160 會隱藏）。
  - **軟鍵值尚未在模擬器確認**：開 `/?debug=1` 頂端會顯示實際 key/keyCode，確認後修 `frontend/js/keypad.js` 的 `KEYMAP`（目前 F1/F2 只是猜的備援）。
  - 位置目前寫死 Rampur（28.8, 79.03），可用 `?lat=&lng=` 覆寫；等 `/api/auth/session` 做好再改讀 profile。

## 202609191132 · 128×160 調整 + 文件修正

- **發現的問題**：128×160 下大字溫度過大，農事建議被切掉一行。
- **想解決什麼**：小螢幕仍能看到關鍵資訊；文件與實作、官方規範一致。
- **做了什麼改動**
  - `responsive.css` 縮小字級/列高/間距；建議文字縮短（≤ ~30 字）。
  - `docs/proposal.md`：Node 安裝改 NodeSource（Ubuntu 24.04 的 apt 版本過舊）、補 RSK/LSK 官方語意、新增 `GET /weather`、風險表新增 3 項（Open-Meteo 非商業、Agmarknet 延遲、VN/BD 無開放 API）。
  - `docs/Weather.md`：改寫為正式規格（含修正對照表），取代原 prompt。
- **給組員的注意事項**
  - 請以修正後的 `docs/Weather.md` 為準，不要再用舊 prompt 生程式。
  - 目前驗證過：Chrome 模擬 240×320 與 128×160、鍵盤完整走一遍；**尚未**在 Cloud Phone simulator / 實機測過。
  - 這批變更**尚未 commit**。

## 202609191146 · push 整合 + devlog 歸位

- **發現的問題**：第一次 push 被拒絕，Kris 已先推 commit，並把 `Weather.md`、`proposal.md` 搬進 `docs/`；devlog 也有了專屬 `devlog/` 資料夾。
- **想解決什麼**：不覆蓋組員的內容，把我們的變更整合進去；統一 devlog 位置與文件路徑。
- **做了什麼改動**
  - `git rebase origin/main`，無衝突，我對兩份文件的修改自動套用到 `docs/` 新路徑；已 push（`7239c62`）。
  - `devlog-Yoyo.md` 移到 `devlog/devlog-Yoyo.md`，內文的 `Weather.md` / `proposal.md` 路徑改為 `docs/` 開頭。
- **給組員的注意事項**
  - 文件都在 `docs/`，devlog 都放 `devlog/`。
  - push 前先 `git pull --rebase origin main`，避免像這次被拒絕。

## 202609191148 · 實機測試前：校正桌面軟鍵對應

- **發現的問題**：`docs/HACKATHON_PREP.md` 指出官方範例把桌面模擬的 `Escape`→左軟鍵、`F12`→右軟鍵；我原本把 `Escape` 對到 BACK，與官方衝突。
- **想解決什麼**：讓 Cloud Phone simulator / 桌面測試時軟鍵行為與官方一致。
- **做了什麼改動**：`frontend/js/keypad.js`：`Escape`→`SOFT_L`、`F12`→`SOFT_R`（`Backspace` 仍為 BACK，`SoftLeft/SoftRight` 保留）。
- **給組員的注意事項**：實機的真實 key 值仍未驗證，測試時開 `?debug=1` 記錄後回填 `KEYMAP`。

## 202609191156 · 實機測試前：部署方案（主辦 Ubuntu 主機）

- **發現的問題**
  - 主機已由主辦預先配置：nginx 在 80/443、certbot 已簽好 `<IP>.sslip.io` 網域憑證，官方範例放在 `/cloudphone-2025meichuhackathon-demo/`，根路徑 `/` 是空的。**不需要自己申請網域/憑證。**
  - 主機 Node 是 **18.19**（非 proposal 假設的 20），且沒裝 pm2。
  - nginx 站台設定是 certbot 管理的，不能整個覆蓋。
- **想解決什麼**：用最小改動把 AgriLink 掛到根路徑，不破壞主辦的範例站與憑證。
- **做了什麼改動**
  - 新增 `deploy/setup.sh`（可重複執行：clone/pull、`npm ci`、systemd 服務、nginx 只加一行 `include`，改前自動備份、`nginx -t` 通過才 reload）、`deploy/agrilink.service`、`deploy/agrilink.conf`。
  - 用 systemd 取代 pm2（省去多裝套件）；Node 18 已驗證程式相容。
- **給組員的注意事項**
  - 每人的主機不同（IP、私鑰都是個人的），**IP / 私鑰 / IMEI 都不要進 repo**。
  - 主機上 `git clone` 走公開 https，所以**要先 push 才能部署**。
  - 各組員本機 Node 版本可能與主機不同（主機為 18），請避免用 Node 20+ 才有的語法。
  - 主機上更新：`ssh` 進去後 `bash ~/dogbark/deploy/setup.sh`。

## 202609191158 · 已部署到主辦主機（HTTPS 可用）

- **發現的問題**：`setup.sh` 把 nginx 備份檔放進 `sites-enabled/`，nginx 會把該目錄全部載入，造成 `duplicate listen options`；`nginx -t` 失敗所以**沒有 reload，線上未受影響**。另外 `package.json` 的 `engines` 要求 Node>=20，主機是 18，只產生警告。
- **想解決什麼**：完成第一次部署並驗證公開網址。
- **做了什麼改動**
  - 備份改放 `/etc/nginx/backup/`；`setup.sh` 同步修正。
  - 部署完成：systemd 服務 `agrilink` active，nginx reload 成功。
  - 外部驗證：`/` 200、官方範例路徑 200、`/api/weather` 回真實資料、HTTP 301 轉 HTTPS。
- **給組員的注意事項**
  - **備份檔絕對不要放在 `sites-enabled/`**。
  - 後續更新：主機上 `bash ~/dogbark/deploy/setup.sh`（會 git pull 並重啟服務）；看 log：`journalctl -u agrilink -f`。
  - 下一步（需本人操作）：登入 cloudphone.tech Console 用主辦給的 `*.sslip.io` 網址註冊 widget（Name: AgriLink、80×80 PNG icon），實機用 `?debug=1` 記錄軟鍵 key 值。

## 202609191214 · 依 simulator 實測結果更新鍵位對照

- **發現的問題**（simulator 實測，用 `?debug=1`）
  - 左軟鍵 = `Escape`（kc 27）；與官方範例一致，原設定正確。
  - **右軟鍵完全沒有 keydown 事件**：由平台處理（等同 `history.back()`／根畫面關閉），與官方文件描述相符，所以 router 與 history 同步的設計是對的，不需要也不能在前端攔截。
  - 數字鍵回報 `code=DigitN`（原本只用 `e.key` 比對，可能漏接）；`*` 回報 `NumpadMultiply`（kc 106），原本 `'*'` 對不到；`#` 回報與 `3` 相同的 `Digit3`（kc 51），僅能靠 `shiftKey` 區分（尚待確認）。
  - 無獨立返回鍵。
- **想解決什麼**：讓數字、`*`、`#` 在 simulator 上也能正確對到動作。
- **做了什麼改動**：`frontend/js/keypad.js` 新增 `resolveAction()`（依序比對 `key` → `code` → `keyCode`）；加入 `Digit0-9`、`Numpad0-9`、`NumpadMultiply`、kc 106；`#` 判定 = `key==='#'` 或 `Shift+Digit3`。debug 覆蓋層改顯示 `key/code/kc/shift/對應動作`。以 Node 腳本驗證 7 個案例皆通過。
- **給組員的注意事項**
  - 別依賴前端收到右軟鍵；畫面上的 "Back" 只是標籤，實際由平台觸發返回。
  - **`#` 與 `3` 在 simulator 上可能無法區分**（若 `shiftKey` 也是 false）：T9「送出」不要只靠 `#`，需要備援（例如 Enter 或 soft key）。實機結果仍待測。
  - 尚未在實機驗證。

## 202609191220 · 確認 # 鍵可與 3 區分（simulator）

- **發現的問題**：前一筆擔心 `#` 與 `3` 無法區分。實測 `#` 為 `key="#" code="Digit3" kc=51 shift=false`，`key` 欄位就是 `#`，能與 `3` 分開；先前誤判是因為只看了 `code`/`kc`。
- **想解決什麼**：確認 `#`/`*`/數字在部署版上正確對應。
- **做了什麼改動**：無邏輯變更（`resolveAction` 先比 `key` 所以 `#`→HASH 已正確）；只更新 `keypad.js` 註解。已部署版本 `4f083e7` 驗證 `#`→HASH。
- **給組員的注意事項**
  - 判斷按鍵請**優先用 `e.key`**，`code`/`keyCode` 只當備援（`#` 的 `code` 與 `3` 相同）。
  - 上一筆「T9 送出不要只靠 `#`」的顧慮在 simulator 上解除；**實機仍待驗證**，備援 Enter 仍建議保留。

## 202609191221 · 實機驗證準備：新增 keytest 測試頁

- **發現的問題**：實機上進 app 再看頂端小字逐鍵記錄很不方便；右軟鍵不送 keydown，需要觀察平台實際觸發了什麼；字型（emoji/印地語/孟加拉語）與 viewport 實際尺寸也尚未驗證。
- **想解決什麼**：一頁看完實機所有關鍵資訊，並與 simulator 結果對照。
- **做了什麼改動**：新增 `frontend/keytest.html`（無依賴、無 build）：顯示 keydown/keyup 最近 9 筆（key/code/kc/shift）、viewport 與 dpr、emoji + 印地語 + 孟加拉語字型渲染、UA，並監聽 popstate / pagehide / visibilitychange（用來看右軟鍵實際做了什麼；頁面載入時先 pushState 讓它有 history 可返回）。
- **給組員的注意事項**
  - 測試網址：部署後 `/keytest.html`。
  - 記錄格式：每按一個鍵抄最後一行；右軟鍵看有沒有 `EVENT popstate` 或 `EVENT pagehide`。
  - 若 emoji/印地語顯示成方框，代表實機缺字型，天氣頁要靠文字標籤，i18n 只主打 en。

## 202609191225 · keytest 字太小 → 放大重排

- **發現的問題**：`keytest.html` 原本 11px，在 240×320 上完全看不清（主 app 用 16px 才可讀）。
- **想解決什麼**：實機上一眼就能讀到按鍵值。
- **做了什麼改動**：`frontend/keytest.html` 字級改 16px；最新一次 keydown 用 22px 綠底大字獨立顯示；歷史只留 6 筆；viewport / 字型資訊縮成兩行。本機以 240×320 截圖確認可讀。
- **給組員的注意事項**
  - 手機上寫的字級請以 **≥16px** 為底線（128×160 才縮到約 10px，且僅限次要資訊）。
  - 瀏覽器工具模擬按鍵時 `code` 會是空字串、`kc=0`，那是模擬工具的限制，不是頁面 bug；實機才有真值。

## 202609191254 · 確認右軟鍵行為：觸發 popstate

- **發現的問題**：右軟鍵不送 keydown，不知道平台實際怎麼處理。
- **想解決什麼**：確認 router 與 history 同步的設計可行。
- **做了什麼改動**：無程式碼變更。keytest 實測：按右軟鍵 → 出現 `EVENT popstate`（頁面載入時已 `pushState`，所以有 history 可返回），與官方「有 history 就返回」的描述一致。
- **給組員的注意事項**
  - 右軟鍵 = 瀏覽器返回 → 觸發 `popstate`。**每個畫面切換都要用 `router.push`（會 pushState）**，不要自己改 DOM 換畫面，否則右軟鍵會直接跳出整個 widget。
  - 畫面內的子狀態（例如彈窗、下拉選單）若希望右軟鍵先關掉它，也要自己 `pushState`，並在 `popstate` 時關閉。
  - 根畫面（主選單）按右軟鍵 = 離開 widget（預期行為）。
  - 這筆記錄未標明是 simulator 還是實機，實機需再確認一次。

## 202609191301 · 鍵位與字型驗證結果（keytest）

- **發現的問題**：需確認 `#`、`*` 的實際值，以及 emoji / 印地語 / 孟加拉語是否缺字型。
- **想解決什麼**：決定天氣頁圖示與多語言範圍。
- **做了什麼改動**：無程式碼變更，結果如下。
  - `#` → `key="#" code="Digit3" kc=51 shift=false`；`*` → `key="*" code=NumpadMultiply kc=106 shift=false`。與 simulator 一致，`resolveAction` 皆能正確對到 HASH / STAR。
  - **emoji（☀️ ⛅ 🌧️）、印地語（हिन्दी）、孟加拉語（বাংলা）皆正常渲染，沒有方框。**
- **給組員的注意事項**
  - 天氣頁可以用 emoji 圖示（仍保留文字標籤當備援）。
  - **Hindi / Bengali i18n 可以做**，字型不是阻礙；仍需注意長字串在 240×320 / 128×160 會換行，UI 要留空間。
  - 此筆未標明測試環境（simulator 或實機），請測的人補上；若是 simulator，實機需再測一次。

## 202609191305 · 實機驗證確認 + 天氣頁顯示地區

- **發現的問題**
  - 上兩筆（右軟鍵 popstate、`#`/`*` 鍵值、emoji/印地語/孟加拉語字型）**是在實機（itel）上測的**，結果與 simulator 一致，鍵位與字型驗證完成。
  - 天氣頁沒顯示是哪個地區的天氣；寫死的印度 Rampur 座標在台灣實機上看會很違和。
- **想解決什麼**：天氣頁要標明地區，且 demo 時能快速切換地點。
- **做了什麼改動**
  - `frontend/js/state.js`：新增 `LOCATIONS`（Rampur IN / Taichung TW / Hanoi VN / Dhaka BD）、`user.location`、`user.nextLocation()`；選擇存 `localStorage`（有 try/catch）；`?lat=&lng=` 仍可覆寫。
  - `frontend/js/screens/weather.js`：最上方顯示「📍 地區名 # ▸」；按 `#` 切換下一個地點並重新載入。
  - CSS 微調（`.big` 2.4→2em、列高 -6px）讓建議文字在 240×320 不被切掉；128×160 亦確認可讀。
- **給組員的注意事項**
  - 地點清單目前是前端寫死的暫時方案；等 `/api/auth/session` 與 Settings 做好後，改讀使用者 profile 的 village + lat/lng，`LOCATIONS` 屆時可移除或當預設選項。
  - `#` 在天氣頁被用來切換地點，其他畫面若要用 `#`（例如 T9 送出）互不影響（只在該畫面 `onKey` 處理）。
  - 版面底線：內容高度要預留 header（📍）＋ 溫度 ＋ 3 列 ＋ 建議兩行，新增元素前先在 240×320 截圖確認。

## 202609191319 · Market Prices（行情頁 + 淨利計算）

- **發現的問題**
  - 主機上已有組員建的 **PostgreSQL**（`agrilink` 庫、`app` schema、角色 `agrilink_migrator`=改結構 / `agrilink_app`=讀寫資料），與 proposal 的 SQLite 不同 → 後端改用 `pg`，**proposal §5/§8 的 SQLite 描述已過時**。
  - 主機上有 `001_foundation.sql`、`002_marketplace.sql`，但**不在 git**，repo 也沒有 DB 連線說明；所有表目前是空的，且**沒有行情表**。
  - 淨利實測算出負值：沿用 proposal 範例的運費 2.8 ₹/qt/km 太高（77km 就吃掉 ₹216）；且 sample 漲幅太小，「建議等兩天」不會出現。兩者都是估算/假資料常數問題，已調整（運費 1.5，標註為估算）。
- **想解決什麼**：做出 Market Prices（多市場比價 + 趨勢建議 + 淨利計算），資料層接 Postgres，沒設 `DATABASE_URL` 時退回記憶體假資料，demo 不會白屏。
- **做了什麼改動**
  - 把 001、002 從主機（唯讀）複製進 `backend/db/migrations/`；新增 `003_market_prices.sql`（`app.markets`、`app.market_prices`，沿用 uuid / numeric+currency / CHECK 慣例，含 `is_sample`、`source` 欄位）。
  - `backend/db/`：`pool.js`（無 `DATABASE_URL` 回傳 null）、`seedData.js`（**唯一**的假資料來源，記憶體與寫 DB 共用）、`seed.js`（冪等，以 app 角色寫入 regions/crops/markets/prices）。
  - `services/priceRepo.js`（memory / pg 兩種 repo，同一種資料形狀）、`priceService.js`（趨勢建議、淨利、距離）、`routes/prices.js`：`GET /api/prices?crop=&region=`、`GET /api/prices/net-profit?crop=&region=&from=&to=&qty=`。
  - 前端 `screens/marketPrices.js`（LEFT/RIGHT 換作物）、`screens/priceDetail.js`（LEFT/RIGHT 調數量、文字走勢圖）、`fmt.js`；router 新增 `screen.initialFocus`，從詳情返回時焦點停在原本那列；主選單 1 = Market Prices。
  - 測試：後端 11 項全過；瀏覽器 240×320 / 128×160 鍵盤操作驗證。
- **給組員的注意事項**
  - **建議文字標「Tip」而非「AI」**：目前是規則式（今日價 vs 7 日均價，±2%），不是 LLM；Ask AI 頁若要引用行情請取這支 API 的數字。
  - **畫面上的價格目前全是 sample 假資料**（回傳 `sample:true` 並顯示「Sample data」）；真實 Agmarknet 抓取還沒做（需要 `DATA_GOV_IN_KEY`，到 data.gov.in 免費註冊）。demo 時不要說成真實資料。
  - **003 尚未套用到共用資料庫**，也尚未在真 Postgres 上驗證過 SQL 與 `pgRepo`（本機沒有 Postgres）。套用方式：用 `agrilink_migrator` 執行 `003_market_prices.sql`，再記錄版本到 `app.schema_migrations`（我沒有在檔內寫入，避免和 runner 重複）；接著用 app 角色執行 `DATABASE_URL=... node db/seed.js`。
  - 目前只有 `IN-UP-01`（Rampur）有市場資料；VN/BD/TW 無資料。
  - **`DATABASE_URL`（含密碼）只能放主機 `backend/.env`，絕不進 repo / devlog**；systemd 服務已用 `EnvironmentFile` 讀取。密碼曾出現在對話中，建議之後更換。
  - 表名/欄位若與 Kris 的 migration 有衝突或命名想法請先提，003 尚未套用，改起來成本低。

## 202609191326 · 部署 Market Prices（003 已由組員套用）

- **發現的問題**：003 已在共用 DB 建好 `app.markets` / `app.market_prices`（唯讀確認存在），但**三張表（markets、market_prices、crops）都還是 0 筆**，主機 `backend/.env` 也還沒有 `DATABASE_URL`。
- **想解決什麼**：先讓行情頁上線，DB 之後再切換。
- **做了什麼改動**：執行 `deploy/setup.sh`；外部驗證 `/api/prices`、首頁、新前端檔皆正常；服務日誌顯示 `prices: using in-memory seed data`。沒有改動資料庫。
- **給組員的注意事項**
  - **線上目前仍走記憶體假資料**。要切到 Postgres：主機 `~/dogbark/backend/.env` 加 `DATABASE_URL`（`chmod 600`）→ `node db/seed.js`（以 app 角色灌 regions/crops/markets/sample 價格）→ `sudo systemctl restart agrilink`，日誌應顯示 `prices: using Postgres`。
  - 灌資料會寫入 `regions`（`IN-UP-01`）與 `crops`（rice/wheat/onion/tomato），皆 `ON CONFLICT DO NOTHING`；若其他人已用不同 code 種了 regions/crops，請先協調避免重複。
  - 切到 DB 後若價格頁報「Prices unavailable」，先看 `journalctl -u agrilink`；DB 掛掉時目前**不會**自動退回假資料（只在未設 `DATABASE_URL` 時才用）。

## 202609191328 · 切換到 PostgreSQL + 修「Your area」顯示錯誤

- **發現的問題**
  - 切到 DB 後驗證發現：列表第一個市場被當成「Your area」，但 pgRepo 依市場代碼字母排序（Bareilly → Moradabad → Rampur），所以**線上「Your area」實際是 Bareilly**。記憶體版按插入順序剛好 Rampur 在前，所以本機測試沒抓到。舊測試也隱含這個「第一個就是自己地區」的假設。
  - 同時 service 假設 repo 回傳的資料已按日期排好，pg 版 ORDER BY 有做，但這是隱含耦合。
- **想解決什麼**：讓「自己的市場」由明確參數決定，不依賴 repo 排序。
- **做了什麼改動**
  - 主機：`backend/.env` 寫入 `DATABASE_URL`（權限 600，不在 git）；`node db/seed.js` 寫入 84 筆 sample 價格（1 region、4 crops、3 markets）；服務日誌確認 `prices: using Postgres`。
  - `state.js` 新增 `user.homeMarket = 'rampur'`；行情頁 / 淨利頁改傳 `home=`、`from=`，不再寫死；`priceService` 內部先按代碼與日期排序；新增「repo 順序顛倒時 home 仍在最前 + 走勢由舊到新」測試（共 12 項通過）。
- **給組員的注意事項**
  - **呼叫 `/api/prices` 一定要帶 `home=<市場代碼>`**，否則預設取字母序第一個；之後 home 應改由使用者 profile 決定。
  - 寫 repo/service 時**不要假設資料庫回傳順序**；本機記憶體版與 Postgres 的行為要都測。
  - 修正版本尚待部署（部署前線上「Your area」仍是 Bareilly）。

## 202609191349 · Ask AI 頁面（依 docs/ASK_AI_PAGE_SPEC.md）

- **發現的問題**
  - 主選單 Ask AI 原本導到 ComingSoon；後端沒有任何 AI 路由，`api.js` 只有 GET。
  - router 的中間軟鍵沒有 handler 機制，標題/軟鍵文字只能是固定字串，無法顯示信心度、錄音狀態。
  - nginx 預設 `client_max_body_size` 1 MB，語音（上限 2.5 MB）會被 nginx 直接擋成 HTML 413；且 app 在 nginx 後面，rate limit 若不設 `trust proxy` 會所有人共用同一個 IP 額度。
- **想解決什麼**：做出 spec 的 P0（首頁 hero + 4 個預設問題、多鍵輸入、Gemini 結構化答案卡、追問、各種錯誤/離線 fallback、240×320 與 128×160）並加上 P1 的照片/語音漸進增強、印地語切換、最近 5 題紀錄。
- **做了什麼改動**
  - 後端：`routes/ai.js`（`GET /api/ai/capabilities`、`POST /api/ai/ask`、`POST /api/ai/ask-media`，每分鐘 6 次 / 每日 30 次限流，multer 只用記憶體不落地）；`services/geminiProvider.js`（直接打 Gemini REST，key 只從 `GEMINI_API_KEY` 讀、放 header）；`aiSchemas.js`（ajv 驗證模型輸出、剝除多餘欄位、超長字串截斷、模型自編的來源/URL 一律丟掉）；`aiAdapter.js`（requestId 冪等、10 分鐘快取、對話保留最後 4 輪、無效輸出修復一次、失敗改用 `aiFallbacks.js` 的固定檢查清單）；`mediaService.js`（檔頭簽章檢查，拒絕 SVG/偽裝檔、超大檔）；`aiPresets.js`。`server.js` 加 CSP、JSON 32kb 上限、`trust proxy loopback`、dotenv。
  - 前端：`askAI.js`（composer/請求流程/本機歷史與答案快取/匿名事件計數）、`t9.js`（多鍵輸入狀態機 + 整句補全）、`media.js`（拍照壓縮 1024px/JPEG 0.72/去 EXIF、MediaRecorder 30 秒自動停、釋放麥克風）、`dom.js`；畫面 `askAIHome / askAIInput / askAIThinking / askAIAnswer(+Sources) / askAIMedia(Options/Photo/Voice/History)`；`css/ask-ai.css`。
  - router：`softCenter.handler`（中間軟鍵 = Enter）、`title` 可為函式、`statusBadge`、軟鍵文字可為函式。主選單 4 改導 `AskAIHome`。
  - deploy：`agrilink.conf` 加 `client_max_body_size 4m`。`.env.example` 補齊 AI 變數（key 留空）。
  - 測試：新增 `aiAdapter.test.js`（34 項）與 `test/t9.test.js`（10 項），全部 56 項通過；瀏覽器 240×320 / 128×160 用鍵盤走過：預設題 → 答案、`##` 送出、追問、Back 回首頁、Options/Photo/Voice 畫面。
- **給組員的注意事項**
  - **本機沒有 `GEMINI_API_KEY`，所以真正的 Gemini 呼叫還沒實測過**（只用假 fetch 測了請求格式與錯誤處理）。部署後請在主機 `backend/.env` 加 key → 重啟 → 日誌應出現 `ai: gemini configured`，首頁右上角由 `○ OFF` 變 `● ON`。沒有 key 時所有問題都回「BASIC TIPS」固定清單，不會白屏。
  - Gemini 用 REST + fetch，**沒有裝 `@google/genai`**（和 weatherService 同一套 timeout/abort 寫法，也方便測試）；spec 列的其他套件（ajv、multer、express-rate-limit、dotenv）都有裝。
  - **Demo 照片還沒放**：請把真實葉片照放到 `frontend/img/sample-leaf-1.jpg`、`sample-leaf-2.jpg`（說明見該資料夾 README）。
  - 部署要重跑 `deploy/setup.sh`（會 `npm ci` 新套件並更新 nginx snippet 的上傳大小）。
  - `test/t9.test.js` 直接 import 前端 ESM 檔，需要 Node 22+ 才會自動判斷 ESM；主機若是 Node 20 請改用 `node --experimental-detect-module --test`。
  - 語音/相機在 Cloud Phone 與 itel 實機上**都還沒驗證**；不支援時 Voice 選項會顯示「Not available on this device」並可直接改打字。
  - 預設題的 id 前後端各有一份（`frontend/js/askAI.js`、`backend/services/aiPresets.js`），改題目時兩邊要一起改。

## 202609191352 · 建立本機 backend/.env

- **做了什麼改動**：從 `.env.example` 複製出 `backend/.env`（權限 600，已確認被 `.gitignore` 忽略），`GEMINI_API_KEY` 留空待填。
- **給組員的注意事項**：key 只填在各自機器／主機的 `backend/.env`，不要貼進 repo、devlog 或對話。

## 202609191356 · Gemini 模型改為 gemini-3.5-flash-lite

- **發現的問題**：填好 key 後實測仍回 fallback。直接呼叫 Gemini 得到 404：spec 指定的 `gemini-2.5-flash-lite` 已不開放給新用戶（key 本身正常）。
- **做了什麼改動**：用模型清單 API 確認 `gemini-3.5-flash-lite` 可用，實測約 2 秒回應、輸出通過 ajv schema；`backend/.env`、`.env.example`、`geminiProvider.js` 預設值都改成它。
- **給組員的注意事項**：**主機的 `backend/.env` 也要把 `GEMINI_MODEL` 改成 `gemini-3.5-flash-lite`**（或刪掉該行用程式預設），否則線上會一直回 BASIC TIPS。spec 第 10 節的模型名已過時。

## 202609191358 · 本機驗證 Gemini 真實回答

- **做了什麼**：組員本機重啟後，Ask AI 按 1（黃葉）得到 Gemini 真實回答：無 BASIC TIPS 標籤，含 Bottom line、Do now 2 項、Watch for、Local context、Ask next 2 題，格式驗證通過。
- **給組員的注意事項**：本機驗證只涵蓋文字問答；照片、語音、印地語輸出尚未用真實 Gemini 測過。桌機寬螢幕看會被拉寬，要看實際樣子請用瀏覽器 DevTools 設 240×320。

## 202609191401 · Ask AI 推上 main（部署待執行）

- **做了什麼**：commit `1695e72`（Ask AI 全部檔案，確認 `.env` 未進版控、diff 內無 API key），rebase 到最新 main（含 Kris 的 CEDA 同步，`package.json` 無衝突），合併後 60 項測試全過，已 push。
- **發現的問題**：本機 SSH key 沒有主機權限（`ubuntu@`、`root@` 都 Permission denied），無法代為部署。
- **給組員的注意事項**：部署前主機 `backend/.env` 必須有 `GEMINI_API_KEY` 且 `GEMINI_MODEL=gemini-3.5-flash-lite`，再跑 `bash ~/dogbark/deploy/setup.sh`。

## 202609191404 · 修正 Node 18 相容性並部署 Ask AI

- **發現的問題**：主機 Node 是 v18.19，`AbortSignal.any`（Node 20.3+）不存在，Gemini 呼叫會丟 TypeError、每題都靜默退回 BASIC TIPS；本機 Node 25 完全看不出來。
- **做了什麼改動**：`geminiProvider.js` 改用自寫的 `anySignal`；新增 2 項測試（共 62 項）。
- **給組員的注意事項**：主機 Node 18 與 `package.json` 的 `engines >=20` 不符，新程式碼請避免 Node 20+ 才有的 API（或先升級主機 Node）。`backend/test/t9.test.js` 在 Node 18 無法直接 import 前端 ESM，主機上請不要跑 `npm test`。

## 202609191405 · Ask AI 已部署到主機（尚缺 GEMINI_API_KEY）

- **做了什麼**：用主辦給的 key 以 `ubuntu` 登入，主機 `backend/.env` 補上非機密的 AI 設定（模型 gemini-3.5-flash-lite、逾時、限流），執行 `deploy/setup.sh`。服務 active，日誌 `prices: using Postgres`；線上首頁、`/api/ai/capabilities`、`ask-ai.css` 皆 200。
- **目前狀態**：日誌顯示 `ai: no GEMINI_API_KEY`，線上 Ask AI 暫時只回 BASIC TIPS 固定清單。**主機 `.env` 還沒有 `GEMINI_API_KEY`**，加入後執行 `sudo systemctl restart agrilink` 即生效。
- **給組員的注意事項**：`ubuntu` 可登入、`root` 不行；主機 Node 為 v18.19（`engines` 要求 >=20，npm 有警告但可運作）。

## 202609191408 · Ask AI 線上啟用 Gemini（部署完成）

- **做了什麼**：組員把本機 `GEMINI_API_KEY` 以 pipe 方式寫入主機 `backend/.env`（未經對話、未進 repo），重啟服務。
- **驗證結果**：主機 `.env` 僅 1 行 key（長度 53）、服務 active、日誌 `ai: gemini configured`；對線上 `/api/ai/ask`（黃葉預設題）實測約 1.7 秒回真實答案（`fallback:false`）。
- **給組員的注意事項**
  - 仍未在線上實測：照片、語音、印地語；Cloud Phone 模擬器與 itel 實機的相機/麥克風未驗證。
  - `frontend/img/sample-leaf-1.jpg`、`sample-leaf-2.jpg` 尚未放，demo 照片目前無法使用。
  - 限流為每 IP 每分鐘 6 次、每日 30 次；demo 前避免用光額度。
  - 更新 key 或設定：改主機 `backend/.env` 後 `sudo systemctl restart agrilink`，日誌應見 `ai: gemini configured`。
  - 主辦提供的 SSH 私鑰在組員本機 `~/Downloads/id_ed25519`，不可進 repo，事後請妥善保管或刪除。

## 202609191411 · 調高 Ask AI 限流（15/分鐘、300/天）

- **發現的問題**：預設每 IP 每分鐘 6 次、每日 30 次，若 Cloud Phone/評審共用同一個出口 IP，整天只有 30 次可用，demo 容易被 429 擋下。
- **做了什麼改動**：`AI_RATE_LIMIT_PER_MINUTE=15`、`AI_RATE_LIMIT_PER_DAY=300`（主機 `.env`、`.env.example`、`routes/ai.js` 預設值）並重新部署。成本仍受 10 分鐘快取與 500 token 輸出上限約束。
- **給組員的注意事項**：限流存在記憶體，服務重啟即歸零；快取命中的請求仍計入額度。要再調整只需改主機 `backend/.env` 後 `sudo systemctl restart agrilink`。

## 202609191413 · 加入 demo 葉片照

- **做了什麼改動**：新增 `frontend/img/sample-leaf-1.jpg`（發黃/橘斑葉，432×462，41 KB）、`sample-leaf-2.jpg`（水稻葉褐色病斑，979×653，132 KB），皆為有效 JPEG 且小於 700 KB 上限；重新部署。Ask AI → Options → Photo 的兩個 DEMO SAMPLE 現在可用，答案會標 SAMPLE DATA。
- **給組員的注意事項**：照片來源/授權請確認可用於公開 demo；若要更換，保持相同檔名並維持 <700 KB。

## 202609191423 · 修正「Ask next / 按 1」看起來沒作用

- **發現的問題**：答案頁按 `1` 其實會進 Follow-up 輸入畫面，但輸入框是空的，使用者看不出有反應，也不知道卡片上的兩個追問怎麼問。另外 Gemini 有時把追問寫成指示（"Upload a clear photo…"）而不是問題。
- **做了什麼改動**：按 `1`（或在 Ask next 卡片按 Enter）進入 Follow-up 時自動填入第一個建議追問，提示「Send to ask · ▲▼ other (1/2)」，Send 直接送出、上/下鍵換另一題；系統提示新增規則，追問必須是農民口吻的問題。本機用瀏覽器走過：按 1 → 預填 → 下鍵換題 → Enter 送出 → 收到答案；62 項測試通過。
- **給組員的注意事項**：預填只在從答案頁進入時發生一次，使用者刪掉後不會再自動填回。

## 202609191434 · 部署「Ask next 預填追問」修正

- **做了什麼**：執行 `deploy/setup.sh`，主機更新到 `2ae7808`，服務 active，日誌 `ai: gemini configured`。
- **驗證結果**：線上前端已含預填邏輯；對線上 `/api/ai/ask` 實測（稻葉褐斑）為真實 Gemini 回答（`fallback:false`），追問為問句：「Are the spots spreading fast?」「Should I spray fungicide now?」。
- **給組員的注意事項**：手機/瀏覽器若仍看到舊畫面，強制重新整理以清除前端快取。

## 202609191453 · 語音：後端實測通過 + 修正等待麥克風授權時畫面像當掉

- **語音後端實測（線上）**：用 macOS `say` 合成英文問題，`.wav` 與 `.m4a`（Safari MediaRecorder 格式）皆正確轉成文字並得到真實 Gemini 答案（約 3–4 秒，`fallback:false`）。
- **發現的問題**：組員在瀏覽器按 Enter 後畫面停在 `00s / 30s`。錄音本身正常（用假音訊來源驗證：計時、● REC、Stop、Send 都對），問題是瀏覽器麥克風授權對話框等待期間畫面沒有任何提示，授權若被忽略會永遠停在 00s。
- **做了什麼改動**：等待授權時顯示「Allow the microphone when your browser asks.」與標題列「… MIC」；10 秒未回應自動放棄並提示「No microphone permission. Press Enter to retry.」；授權在取消後才回來的 stream 會立刻釋放，避免麥克風燈一直亮。本機用「永不回應的假麥克風」與「可用假麥克風」各走一遍。
- **給組員的注意事項**：Claude 桌面 App 內建瀏覽器窗格會封鎖麥克風，語音請用真正的 Chrome 開 https 網址測；Cloud Phone / itel 實機仍未驗證。

## 202609191456 · 實機語音卡在 00s/30s：新增診斷資訊

- **發現的問題**：組員在實機（Cloud Phone / itel）按 Enter 後畫面停在 `00s / 30s`。代表該環境有 `getUserMedia` 與 `MediaRecorder`（Voice 選項未變灰），但呼叫後既不成功也不報錯，多半是沒有實際麥克風或授權畫面。
- **做了什麼改動**：帶 `?debug=1` 時，錯誤訊息後面會附上原始錯誤名稱（如 `[NotFoundError]`、`[NotAllowedError]`），10 秒無回應則顯示 `[no response]`；同時寫入 console。本機用「拒絕」與「永不回應」兩種假麥克風驗證。
- **給組員的注意事項**：部署後請在實機開 `https://203-116-30-130.sslip.io/?debug=1` 再試一次 Voice，把畫面上括號內的字記下來（這就是 spec 要的「實機實際能力」紀錄）。若是 `[no response]` 或 `NotFoundError`，該環境不支援語音，demo 請改用文字/照片。

## 202609191502 · 實機語音：平台權限提示 + 改用 Cloud Phone hasFeature

- **發現的問題**：實機（itel NEO R60+）進 Voice 按 Enter 後出現「需要麥克風存取權」，組員不知道如何同意。該句不是本 app 顯示的（repo 內無此文字），是 Cloud Phone 客戶端的原生權限提示。官方文件（developer.cloudfone.com）只說：模擬器沒有麥克風/相機；實機才有；`getUserMedia` 可能丟 `NotAllowedError` / `NotFoundError`。**文件沒有說明使用者要按哪個鍵同意**，需向主辦/CloudMosa 確認。
- **做了什麼改動**
  - 新增 Cloud Phone 專用的功能偵測：`navigator.hasFeature('AudioCapture')`、`('ImageUpload')`（非 Cloud Phone 環境無此函式，行為不變）。回報不支援時 Voice/Photo 會變灰並顯示「Not available on this device」。本機用假的 hasFeature 驗證。
  - 等待權限提示的逾時由 10 秒放寬為 30 秒（feature phone 找到並確認提示需要時間）；提示文字改為「Allow the microphone when the phone asks.」。
- **給組員的注意事項**：實機請用 `?debug=1` 開啟，逾時或失敗時畫面會附上錯誤名稱，請記錄下來作為「實機實際能力」。若實機一直無法授權，demo 請改走文字/照片。

## 202609191544 · Farmer Circle（Reddit 式農業論壇）改用 PostgreSQL

- **想解決的問題**：主選單的 Farmer Circle 還是 Coming Soon；要做可瀏覽、需登入才能互動的論壇（無 AI）。最初用 SQLite 做完，但主機（Ubuntu）已有 PostgreSQL `app` schema 與組員的手機號碼 + PIN 身分系統，所以改成直接用它們。
- **先看了主機 schema**：`app.users / user_profiles / regions / auth_sessions ...`（uuid 主鍵、migrator 角色擁有表、app 角色只有 DML）；主機 Node 是 18。
- **做了什麼改動**：
  - `db/migrations/005_forum.sql`：`app.forum_communities / tags / posts / post_tags / replies / votes / saved_posts / reports / request_ids / mod_actions / user_state`，作者指向 `app.users`、地區指向 `app.regions`；`users.role` 放寬為 member/moderator/admin。分數不存欄位，由 votes 加總。
  - 後端：`routes/forum.js`（沿用組員的 `/api/auth` 登入 cookie）、`services/forumService.js`（全部 async pg、交易、冪等 requestId、伺服器端權限）、`db/forumSeed.js`（示範會員經 `auth.signup` 建立；票數由 34 個無法登入的 voter 列產生）。
  - 前端：Vanilla JS 的 feed / 貼文詳情 / 發文精靈 / 回覆 / 篩選 / 我的貼文 / 收藏；訪客閘門導向組員的登入畫面；長貼文在 128×160 會分段。
  - 測試：`backend/tests/`，用 PGlite（真正的 Postgres WASM）跑 001/004/005 migration，全部 99 項測試通過；也用 `npm run forum:dev` 在瀏覽器 240×320 / 128×160 走過登入→瀏覽→投票→回覆→發文。
- **給組員的注意事項**：
  - **需要先套用 migration 005**（用 migrator 或 postgres），否則 `/api/forum` 回 503（其他功能不受影響）。
  - 示範帳號手機 `9100000001`–`9100000005`，PIN 由 `DEMO_USER_PIN` 設定；production 沒設 PIN 時 seed 會拒絕執行。seed 也會補上 `IN-BR`、`VN-AG`、`BD-RAJ` 三個 region（會出現在註冊的地區清單）。
  - 我把 `users_role_check` 加了 `moderator`；如果 admin 程式有寫死角色清單請留意。
  - 沒做：照片上傳（P1）、reply-to-reply 的按鍵入口。Cloud Phone 實機鍵碼尚未驗證。詳見 `docs/FARMER_CIRCLE.md`。

## 202609191558 · Local Market（buysell_exchange）PostgreSQL schema：migration 006

- **想解決的問題**：`docs/buysell_exchange.md` 的資料模型是 SQLite（TEXT id、REAL、`district_code`、`users`），不能直接搬到主機的 PostgreSQL `app` schema。需要轉成符合 001–005 慣例的版本，並把 PRD 的不變條件盡量交給資料庫保證。
- **發現的問題**：`002_marketplace.sql` 已有簡化版 `app.listings / listing_interests`（目前沒有任何程式使用）。migration 是 append-only，不能改 002。
- **做了什麼改動**
  - 新增 `backend/db/migrations/006_market_exchange.sql`，全部在 `app` schema：`market_listings / market_buy_requests / market_offers / market_offer_revisions / market_deals / market_ratings / market_reports / market_blocks / market_request_ids / market_events`。用 `market_` 前綴避開 002 的 `listings`，002 的表保留但**不要再往上蓋**；`notifications`、`outbox_events` 沿用 002。
  - 型別對照：`uuid` 主鍵、`numeric` 金額/數量、`timestamptz`、`date/time`；PRD 的 `district_code` → `region_id`（`app.regions`）、作物 → `crop_id`（`app.crops`）、使用者 → `app.users`。
  - 資料庫層保證：`reserved_quantity + sold_quantity <= quantity`（不會超賣）；offer 必須剛好指向 listing 或 buy request、不能自己對自己出價、同一人對同一標的只能有一筆進行中的 offer（partial unique index）；offer revision 與 `market_events` 用 trigger 禁止 UPDATE/DELETE，且 app 角色只有 INSERT/SELECT；deal 的 CHECK：雙方都確認才能 `agreed`、要有取貨日才能 `pickup_scheduled`、要有交貨驗證/買方收貨/付款狀態才能 `completed`、取消要有人與原因；評價 trigger 限定「已完成 deal 的雙方、各一次」。
  - `notifications_type_check` 放寬加入 `market_offer`、`market_deal`（同 005 放寬 role 的作法）。
  - 新增 `backend/tests/marketSchema.test.js`（PGlite 跑 001/002/004/006，共 10 項），全套 109 項測試通過。
- **給組員的注意事項**
  - **需要先套用 migration 006**（migrator 或 postgres），且要在 002 之後；本次只有 schema，尚無 API/前端，所以不套用也不影響現有功能。
  - `latitude/longitude` 是私有欄位，公開 API 只能回 `public_location_label`，不可回座標。
  - 取貨 4 位數代碼**不存資料庫**：由 service 用 `HMAC(secret, deal_id)` 取 4 位數算出（買方要看得到，賣方輸入驗證），表內只存失敗次數與鎖定時間；4 位數只有一萬種，所以驗證一定要限制次數。
  - 狀態轉移（誰能 accept/counter、accept 時要在同一個 transaction 內 `SELECT ... FOR UPDATE` 鎖 listing 再增加 `reserved_quantity`）仍是 service 的責任，DB 只擋不合法的列。
  - PRD 的 `market_prices`、`snake_matches` 沒放進來：價格已有 003，貪吃蛇不屬於這個功能。listing 也拿掉了 PRD 的 `draft` 狀態（沒有草稿流程）。

## 202609191608 · 主機套用 migration 006（Local Market schema）

- **想解決的問題**：006 只在本機測過，主機 `agrilink` 資料庫還停在 005。
- **做了什麼**：先用 `pg_dump -n app` 備份到主機 `/home/ubuntu/agrilink-backup-202609191607.sql`（29 張表），再以 `postgres` 套用 006（單一 transaction，無錯誤），並手動在 `app.schema_migrations` 記入 `006_market_exchange.sql`。
- **驗證結果**：`market_*` 新表 10 張；`agrilink_app` 對 `market_deals` 有 UPDATE、對 `market_events` 沒有 UPDATE（append-only 權限生效）。
- **給組員的注意事項**：主機 `schema_migrations` 的 001–003 記成沒有 `.sql` 的名字，004 起才有；直接跑 `npm run db:migrate` 會把 001–003 當成未套用而重跑並失敗，之前請先把那三筆改成完整檔名。目前仍只有 schema，沒有 API/前端。

## 202609191616 · Local Market 後端 service + API（/api/market）

- **想解決的問題**：006 只有 schema，需要實作 PRD 的 listing → offer → deal 流程，並把「誰能做什麼、狀態怎麼轉」放在 transaction 裡。
- **做了什麼改動**
  - `services/marketService.js`、`routes/market.js`：listings / buy-requests 的瀏覽與發布、offer（counter / accept / decline / withdraw）、deal（confirm / schedule / verify-pickup / received / payment-status / cancel / rating）、report、block。`middleware/errors.js` 新增 `INVALID_STATE`、`CONFLICT`、`QUANTITY_UNAVAILABLE`、`PICKUP_LOCKED`，錯誤處理範圍擴到 `/api/market`。
  - `server.js`：偵測到 `app.market_listings` 才掛載 `/api/market`，沒套 006 時回 503，不影響其他功能。
  - 測試 `tests/market.test.js`（11 項，走完整流程，含超賣、隱私、封鎖、過期、代碼鎖定），全套 120 項通過。
- **行為與 PRD 的差異／決定（請組員知悉）**
  - 「誰能 accept」：PRD 寫只有 listing 擁有者；但 counter 之後要由買方接受賣方的還價，所以規則改成「**不是目前這版提案的提出者**」才能 accept／counter／decline，提案者本人只能 withdraw。
  - 所有 `/api/market` 端點都要登入（forum 允許訪客瀏覽）；地區來自使用者 profile，不用 IP。
  - accept 會在同一個 transaction 鎖 offer 與 listing，並把數量記入 `reserved_quantity`；cancel 釋放、completed 轉為 `sold_quantity`。
  - 完成條件：買方按 received **且**賣方付款狀態為 received／not_applicable；付款狀態 pending 不會完成。
  - 取貨代碼由 `HMAC(MARKET_CODE_SECRET 或 AUTH_LOOKUP_SECRET, deal_id)` 算出，只有買方看得到；賣方連錯 5 次鎖 15 分鐘。
  - 定價為 fixed 的 listing，offer 單價必須等於標價。
- **給組員的注意事項**：主機 006 已套用，部署後 `/api/market` 才會生效；目前沒有前端畫面。offer 過期清理用 `expireStale()`，每 5 分鐘由 router 內的 timer 執行。

## 202609191628 · Local Market 前端（keypad 畫面）

- **想解決的問題**：後端 `/api/market` 已完成但沒有畫面；主選單的「Sell / Buy」還是 Coming Soon。
- **做了什麼改動**
  - 新增 `frontend/js/market/`（`marketApi.js`、`marketUtils.js`、`marketForm.js`、`marketForms.js`、`marketScreens.js`、`marketTrades.js`）與 `css/market.css`，沿用 Farmer Circle 的 `forum-*` 樣式、ForumPicker、T9 文字輸入。主選單「Sell / Buy」改指向 `MarketHome`。
  - 畫面：Market 首頁（1 瀏覽、2 買家需求、3 賣農產品、4 發買家需求、5 我的報價、6 我的交易）→ 列表（可篩選作物 / 範圍 / 排序）→ 詳情（出價、檢舉、封鎖、移除）→ 報價（接受 / 還價 / 拒絕 / 撤回）→ 交易（確認條款、排定取貨、賣方輸入取貨碼、買方標記收貨、賣方記錄付款、評價、取消）。
  - 輸入方式：日期、單位、時間窗、取消原因都用選單；數量/價格用數字鍵（`#` = 小數點、`*` = 刪除）；只有取貨地點與備註需要 T9。改動每一步都用 `?debug` 以外的實際按鍵走過。
  - `backend/dev/forumDevServer.js` 也掛上 `/api/market` 並加入幾個作物，方便本機用 `npm run forum:dev` 試（PGlite，重啟即清空）。
  - 後端小改：deal 回應加 `ratedByMe`（評價後不再顯示「Rate this trade」），測試已補。
- **驗證結果**：在 240×320 用瀏覽器完整走過「出價 → 賣方接受 → 買方確認 → 賣方排定取貨 → 買方看到取貨碼 → 賣方驗證 → 買方收貨 → 賣方記錄付款 → 完成 → 評價」；128×160 檢查了表單、選單、詳情與必填驗證。全套 120 項後端測試通過。
- **給組員的注意事項**
  - 賣方一側（accept、排定取貨、輸入取貨碼、記錄付款）我是用 API 腳本代替第二支手機，UI 本身是同一套畫面，但**兩台真機 / 兩個瀏覽器同時操作尚未實測**。
  - 目前沒有即時推播：對方操作後要重新進入畫面才會看到（每次進入都會重抓）。首頁「My Offers (n new)」徽章也只在進入首頁時更新。
  - 需要先登入；還沒有 Cloud Phone 實機鍵碼驗證（沿用既有 keymap）。
  - 發布 listing 時作物清單來自 `/api/auth/options`，主機的 `app.crops` 需要有資料，否則作物選單是空的。

## 202609191633 · Local Market 即時通知（sync 輪詢）

- **想解決的問題**：對方操作（新 listing、出價、還價、接受、排定取貨…）後，要重新進畫面才看得到；PRD 要求兩機即時同步。
- **做法與取捨**：沒有加 WebSocket（`ws` 不在依賴裡，且 Cloud Phone 對 WS 的支援尚未實機驗證），改用 PRD 明列的 3–5 秒輪詢 fallback，資料來自既有的 `app.outbox_events`（產生事件的 transaction 已經會寫入）。之後若要換成 WS，事件格式與 cursor 可以直接沿用。
- **做了什麼改動**
  - 後端：`GET /api/market/sync?since=<id>`（`marketService.sync`）。沒帶 `since` = 「從現在開始」，只回 cursor；帶了就回該會員的 offer/deal 事件，加上同地區新的 listing / buy request（不含自己發的，也不含有封鎖關係的人）。一次最多 50 筆，回應不帶任何座標或 ownerId。地區事件 payload 加上 `kind`、`ownerId`。`expireStale()` 順便清掉 2 天前的 market outbox 事件。
  - 前端：`js/market/marketSync.js` 每 4 秒輪詢（頁面隱藏時暫停，失敗會退避，伺服器回 503/404 就停止），畫面底部（softkey 上方）顯示綠色橫幅，5 秒後消失；`router.refresh()` 讓目前的 Market 畫面靜默重抓、保留焦點位置（首頁「My Offers (n new)」徽章也會更新）。
  - 測試：`tests/market.test.js` 新增 sync 測試（只收到自己的事件、地區事件不含發文者與封鎖對象、cursor 前進、重播、非法 cursor 回 400），共 12 項；全套通過。
- **驗證結果**：瀏覽器 240×320 實測：別人發布 listing 後列表自動出現新項目並跳出「New produce for sale nearby」；對方還價後「Offers I sent」清單自動更新，橫幅顯示「Counter offer received」，切到 Inbox 看到「Your turn」。
- **給組員的注意事項**
  - 延遲最長約 4 秒（輪詢間隔）；多頁列表（按過「More…」）在刷新時會回到第一頁。
  - 每個登入中的畫面每 4 秒一個很小的請求；`/api/market` 每 IP 每分鐘上限 240 次，同一個 NAT 後面很多人時要留意。
  - 新登入的會員從「現在」開始收事件，不會補發登入前的事件（首頁徽章與「My Offers」仍看得到待回覆項目）。

## 202609191637 · 部署 Local Market 到主機

- **做了什麼**：在主機（`ubuntu@203.116.30.130`）執行 `deploy/setup.sh`，主機從 `61dbe1b` 更新到 `89966c0`（含組員的 TTS 更新與 Local Market 的 schema 之外全部程式），服務 active。日誌：`market: Local Market enabled`、`forum: Farmer Circle enabled`、`auth: PostgreSQL sessions enabled`。006 早已在資料庫套用，本次沒有再動資料庫。
- **驗證結果**（從外部走 HTTPS，只讀，沒有建立任何資料）：`/api/market/listings`、`/api/market/sync` 未登入回 401；`/css/market.css`、`/js/market/marketSync.js` 回 200；首頁有載入 market.css；`/api/forum/communities` 200，`/api/prices` 缺參數回 400（原本行為）。
- **還沒驗證**：登入後的實際流程（避免在正式站建立示範資料）；兩台真機同時操作；Cloud Phone 鍵碼。
- **給組員的注意事項**：主機 Node 是 18（`package.json` 要求 >=20，安裝時有 EBADENGINE 警告，但目前正常運作）。手機或瀏覽器若看到舊畫面，請強制重新整理。主機 `app.crops` 需要有資料，發布貨源的作物選單才不會是空的。

## 202609191642 · Local Market 測資（marketSeed）

- **想解決的問題**：主機上 Local Market 是空的，兩機示範（A 發布 → B 出價 → A 接受）與各畫面都需要現成資料。
- **做了什麼改動**
  - 新增 `backend/db/marketSeed.js`（`npm run market:seed`）：透過 `marketService` 建立資料（所以預留數量、事件、通知都和真實操作一致），再標記 `is_demo`，畫面上會顯示 DEMO。每個項目都有固定 requestId，重跑不會重複，也會把示範貨源的到期日與備貨日往後延。
  - 內容：7 筆貨源、3 筆買家需求、4 段議價——Ravi 出價被 Meena 還價（輪到 Ravi）、Meena 對 Ravi 的稻米出價（等 Ravi 回覆）、Ravi 買固定價洋蔥且 Meena 已接受（等雙方確認，貨源 100 kg 已預留）、Ravi 買 5 quintal 小麥並已走完（完成 + 互評，貨源顯示已售 5）。
  - **Ravi K. 和 Meena S. 同在 Bihar，是兩機示範組**；Asha（Rampur）、Minh（An Giang，VND）、Rahim（Rajshahi，BDT）各在自己的地區有一筆貨源，所以他們的列表不是空的。
  - `--reset` 可移除所有示範資料。offer revision 與事件表是 append-only，所以 reset 用 `session_replication_role = replica`，只有 superuser 能執行（`RESET_DATABASE_URL`）。
  - 測試 `tests/marketSeed.test.js`：涵蓋各狀態、重跑不變、reset 後歸零可再灌。
- **在主機的執行**：把腳本暫時複製到主機執行後刪除（`market demo: 7 listings, 3 requests, 4 negotiations`），主機上 repo 維持乾淨；資料庫核對：7 筆示範貨源（`is_demo = true`）、deal 一筆 completed / 一筆 awaiting_confirmation、offer 為 countered / open / accepted ×2。
- **給組員的注意事項**
  - 主機上有一筆非示範的貨源（Test_Admin，洋蔥 100 kg，₹20）——不是這次建立的，seed / reset 都不會動它。
  - 示範帳號手機 `9100000001`–`9100000005`，PIN 由主機的 `DEMO_USER_PIN` 決定。
  - 想重來一次兩機示範：以 postgres 執行 reset 再 seed。

## 202609192007 · 介面多語系（en / hi / bn / vi）

- **想解決的問題**：Settings → Language 選了語言沒有效果，畫面還是英文。原本語言只存進 `user_profiles.language`，只影響按 # 朗讀（後端翻譯）和 Ask AI 的回答語言；所有畫面文字都是寫死的英文，前端沒有 i18n。
- **做了什麼改動**
  - 新增 `frontend/js/i18n/`：`index.js`（`t()`、`setLanguage()`、`LANGUAGES`、`dateLocale`）和 `hi.js` / `bn.js` / `vi.js` 三份翻譯表（約 800 條）。**以英文原文當 key**：`t('Settings')`；沒有翻譯就顯示英文，不會出現空白；變數用 `{n}`：`t('{n} days left', { n })`。
  - 語言在「一次頁面載入內」固定：啟動時從 `localStorage['agrilink.lang']` 同步讀取，所以模組頂層的 `t()`（例如選單、標籤表）也能運作。換語言＝存起來 + `location.reload()`。登入 / 讀到 session 時如果 profile 語言和目前不同，也會存起來重新載入（`main.js`、`identity.js`）。
  - `router.js` 會自動翻譯畫面標題和三個 softkey 的文字，所以畫面裡只寫英文 key 即可；其他畫面（identity、weather、prices、Ask AI、Farmer Circle、Market、Today's Farm、TTS 提示、api 錯誤訊息）都把文字包了 `t()`。
  - 登入前的 Welcome 畫面新增第 3 項 Language（`WelcomeLanguage`）：還沒有 profile，所以只存在這個瀏覽器；註冊時 `draft.language` 預設為目前語言。
  - 日期改用該語言的 locale（一律 Latin 數字，價格與數量不會變成別種數字）；孟加拉語翻譯表裡的數字也統一用 Latin 數字。
  - 伺服器回傳的固定英文句子（天氣建議、價格趨勢、噴藥條件、錯誤訊息）在前端用同一份表翻譯。
  - 新增 `backend/test/i18n.test.js`：三種語言 key 必須相同、不可空白、`{placeholder}` 要一致；全套測試 163 項通過。
- **驗證結果**：用 `npm run forum:dev`（3101）登入示範帳號，在 240×320 實測 hi、bn、vi：Settings → Language 選語言 → 儲存 → 重新載入 → 主選單、Farmer Circle（含篩選選單）、Market 各畫面、Ask AI（含離線答案）都已換成該語言。**沒有實測**：Today's Farm、Weather、Market Prices 有資料時的畫面、議價 / 交易畫面（dev server 沒有這些資料），只做了程式檢查與語法載入。
- **給組員的注意事項**
  - **新增畫面文字一律用 `t('English text')`**，並且同時在 `hi.js`、`bn.js`、`vi.js` 補上翻譯（測試會檢查三份 key 一致）。`t()` 用在物件屬性（例如 `label:`、`title:`）時，router 會自動再翻譯一次，所以不用重複包；但陣列 / 對照表裡的文字要自己包。
  - 不要在有 `t` 這個 import 的檔案裡把區域變數也叫 `t`（會蓋掉翻譯函式）；`api.js` 與 `farmOps.js` 因為既有的 `t` 變數，改用 `import { t as tr }`。
  - **還沒翻譯 / 沒辦法翻譯的**：使用者輸入的內容（貼文、回覆）、伺服器資料（地區名、市場名、專家頭銜、作物名只翻譯了常見幾種）、T9 輸入法只能輸入英文字母（hi/bn/vi 無法用九宮格打字）、Ask AI 的 `language` 後端 schema 目前只接受 `en` / `hi`（bn、vi 會用英文回答，`aiSchemas.js` 的 enum 要擴充）、# 朗讀會把已翻譯的畫面文字再送去翻譯（不影響結果，但多一次呼叫）。
  - 三種語言的字型用 `system-ui`；Cloud Phone 真機是否有天城文 / 孟加拉文字型還沒驗證。
  - 翻譯是我（Claude）直接寫的，請讓母語者看過再上線，特別是農業用語和 Market 交易畫面。
