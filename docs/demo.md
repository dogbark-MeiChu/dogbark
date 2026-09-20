# AgriLink Demo Script
# Team dogbark · MeiChu Hackathon 2026 · CloudMosa Track

> Total demo time: ~4.5 minutes (after a 2-3 min slide presentation)
> Test account: Phone `0912345678` · PIN `123456`
> URL: https://203-116-30-130.sslip.io/
> Second phone (for multi-user sync): use demo account `9100000001` / `246810`

---

## Setup (before judges arrive)

- Two phones / browser tabs open side by side.
  - Phone A (main presenter): logged in as `0912345678`
  - Phone B (second screen, hand to a judge or prop on stand): logged in as `9100000001` (Ravi K., farm worker)
- Both showing the Home screen. Both at 240x320 in browser DevTools.
- Language on Phone A: set to Hindi in Settings beforehand.
- Do NOT run through any offers/deals before the demo -- the incoming offer on row 2 must still be unanswered.

---

## Part A: Daily Context (spoken, no navigation)

**Time budget: ~30 seconds**

Say:

> 「情境是這樣：停電第二天，智慧型手機沒電了。農夫拿起這支按鍵機，打開 AgriLink，直接看到 Today 畫面。」

Point to the Home screen. Three rows, nothing more:

```
Today  09:14          Synced 09:13

1  Wheat  Rs.2,180/qt  +3%
   Best: Kanpur  +Rs.85/qt net
   Agmarknet · Sep 20

2  Offers to answer: 1
   Wheat 500 qt · Rs.2,450 · Meena S.

3  Farm: 4 tasks open
   ⚠ Rain tomorrow 80%

0  All features       # Read · * Bright
```

> 「他不需要進任何選單。畫面直接給他三件事：今天的小麥價格、一個等待他回覆的買家出價，以及農場任務與明日大雨的警告。」

---

## Part B: Feature Demo

---

### Step 1 - Farm task: bring harvest forward, worker notified in real time
**Time budget: ~60 seconds**

Press **3** (or arrow to row 3, Enter).

> 「按 3 進入農場。App 警告明天有大雨，建議今天收成。他將收成任務提前到今天並指派給工人。」

Navigate to the harvest task. Press Enter to open the task.
Press the softkey for **Reschedule**. Set the date to today, and assign it to the worker.

> 「收成任務已更新。」

**Point to Phone B immediately.**

> 「請看第二支手機——這是工人的畫面。」

Phone B's Home row 3 or Today's Farm dashboard updates within seconds:
a toast notification appears: "Harvest task rescheduled to today."

> 「畫面即時更新。這一步展示了 CloudMosa 的雲端價值：多人資料同步，而且完全不需要智慧型手機。」

Press **Back** to return to Home.

---

### Step 2 - Verified prices: three mandis, net of transport
**Time budget: ~45 seconds**

Press **1** (row 1: Market Prices).

> 「按 1 查看小麥價格。這裡比較三個 mandi 扣掉運費後的實際收入。」

Point to the three market rows. Highlight:
- Distance in km to each mandi
- Price per quintal
- Net gain/loss compared to local

Scroll to the best option (Kanpur or whichever shows the highest net).

> 「每一個數字都有確切的來源和時間。這不是預測，這是官方資料。」

Press **Enter** on a market to go to PriceDetail.

Point to the source line at the bottom:
> "Agmarknet · data.gov.in · Sep 20. If the data were stale it would say so."

Press **Back**, then **Back** to return to Home.

---

### Step 3 - Accept buyer's offer: trade confirm with TTS readout
**Time budget: ~75 seconds**

Press **2** (row 2: Offers to answer).

Row 2 shows "Offers to answer: 1" -- press Enter to go directly to the incoming offer.

Show the offer details:
```
Meena S.  ·  Verified Trader  ·  25 deals
Wheat · 500 qt · Rs.2,450/qt
Total estimate: Rs.12,25,000
```

> 「按 2 查看買家出價。Meena 是一位經驗證的交易者（Verified Trader）。」

Press the **Accept** softkey. The Trade Confirm screen opens:

```
Accept offer
Wheat · 500 qt · Rs.2,450/qt

Mandi today: Rs.2,537/qt  Kanpur
  13% below the mandi    (warning)

Total (estimate)
  Rs.12,25,000

Type the last 2 digits of the total to accept
  _ _

Buyer: Meena S. · Cash on pickup
AgriLink moves no money. Pay at handover.
# Read aloud · * Delete
```

> 「進到確認頁。畫面上會顯示這個出價比今天 mandi 的價格低 13% 的警告。」

Press **#**.

> 「如果他不識字，按 # 鍵，系統會用 Hindi 朗讀給他聽。」

The TTS reads the full summary aloud in Hindi:
> "Offer swikarein. Gehun, 500 quintal, Rs.2,450 pratyek quintal..."

> 「這就是 Shush 機制——按一次朗讀，再按一次停止。」

After TTS finishes, type **0 0** (the last two digits of Rs.12,25,000).

> 「最後輸入總金額的末兩碼確認。這防止了口袋誤觸，也防止盲目確認。」

The deal is created. Press **Back** to return.

---

### Step 4 - Sim Trade (Backend Integration)
**Time budget: ~30-60 seconds**

> 「接下來，我們透過後端發起一筆模擬交易 (Sim Trade)。」

*(Trigger the simulated trade from the backend)*

> 「你可以看到，這支按鍵機會即時反應新的交易數據。」

*(Briefly show the UI reaction on the demo phone)*

---

### Step 5 - Pickup code: complete delivery at the market
**Time budget: ~45 seconds**

Press **2** (row 2: Sell / Buy). Navigate to **My Deals**. Open the deal with Meena S.

Show the deal status: `pickup_scheduled`.

> 「現在到市場交貨。雙方見面後，農夫輸入買家的 pickup code。」

Navigate to the **Verify pickup** action. Enter the 4-digit code shown on Phone B
(or enter the correct code from Meena's deal screen).

> 「驗證成功，交貨完成。全程沒有拿出智慧型手機，也沒有線上付款。」

Show the deal status transition to `handed_over`.

Press **Back** to Home.

---

### Step 6 - Lost phone: sign out other devices (10 seconds)
**Time budget: ~20 seconds**

> 「收尾的 10 秒鐘。如果『手機掉了？』」

Press **0** -> Settings (item 7) -> navigate to **Sign out other phones**.
Show the confirmation screen:

```
Sign out other phones
Lost a phone? Every other phone signed in
to your account is signed out.
This phone stays signed in.

1  Yes, sign them out
2  No, go back
```

> 「只要到另一支手機上，一鍵登出其他裝置，所有的資料就安全了。」

Do NOT confirm -- press 2 (No, go back) to keep the demo account live.

---

## Closing line (spoken, no navigation)

> "Power outage, muddy field, crowded market, stolen phone -- four scenarios where
> a smartphone fails. AgriLink is the layer that keeps working.
> Thank you."

---

## Fallback / Contingency Notes

| Problem | Recovery |
|---|---|
| No incoming offer on row 2 | Navigate: 0 -> Sell/Buy -> My offers (outgoing) -> show a deal in progress instead |
| TTS audio blocked by browser autoplay | Manually read the Hindi text on screen; note the feature exists |
| Phone B sync doesn't update in time | Say "on a real network this updates within 5 seconds"; proceed |
| Price data shows "sample" | Note it honestly: "In production this is live Agmarknet data; sample data is shown here because the sync has not run yet on this demo server" |
| Trade confirm digits rejected | Check the estimated total shown on screen -- type the last 2 digits of that exact number |

---

## Key Bindings Reference (for presenter)

| Key | Action |
|---|---|
| `1` - `9` | Jump to that row number directly |
| `0` | Open full menu (All features) |
| Arrow Up/Down | Move focus |
| Enter / D-pad center | Select |
| Escape / left softkey | Menu / Options / Back one step |
| Backspace / right softkey | Back |
| `#` | Read screen aloud (TTS) or commit current letter in text input |
| `*` | Toggle Outdoor high-contrast mode (field use) |

---

## What Was Covered in the Slides (do NOT re-explain)

- TruePrice concept and cost deduction model
- Break-even calculation
- Three-path comparison (local / transport / direct buyer)
- Price confidence A/B/C grades
- Pain points (power, security, environment, financial safety)
- Overall product vision and pitch

The demo adds the live proof: real navigation, real data, multi-device sync,
TTS accessibility, trade verification, and session revocation.
