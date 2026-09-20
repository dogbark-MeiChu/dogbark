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

> "It is day two of a power outage in Uttar Pradesh. Rakesh's smartphone is dead.
> He picks up his keypad phone, opens AgriLink, and sees exactly this."

Point to the Home screen. Three rows, nothing more:

```
Today  09:14          Synced 09:13

1  Wheat  Rs.2,180/qt  +3%
   Best: Kanpur  +Rs.85/qt net
   Agmarknet · Sep 20

2  Offers to answer: 1
   Wheat 500 qt · Rs.2,450 · Meena S.

3  Farm: 4 tasks open
   SPRAY: CAUTION · safe 06:00-09:00

0  All features       # Read · * Bright
```

> "Row 1: today's wheat price. Row 2: a buyer is waiting for an answer.
> Row 3: his farm, and a spray warning already surfaced from the weather data.
> Everything he needs. One screen. No menu to open."

---

## Part B: Feature Demo

---

### Step 1 - Farm task: reschedule spray, worker notified in real time
**Time budget: ~60 seconds**

Press **3** (or arrow to row 3, Enter).

> "Let's check the farm first. The spray assessment says Caution -- there is rain forecast
> tomorrow afternoon. He wants to move the spray task to this morning's safe window."

Navigate to the spray task (it will be flagged as Caution/Unsuitable). Press Enter to open the task.
Press the softkey for **Reschedule**. Set the date to today, time to 06:00.

> "Task rescheduled."

**Point to Phone B immediately.**

> "Watch Phone B -- Ravi's screen. He is the assigned worker."

Phone B's Home row 3 or Today's Farm dashboard updates within seconds:
a toast notification appears: "Spray task rescheduled to today 06:00."

> "This is CloudMosa's cloud value on a fifteen-dollar phone. Two devices,
> one shared farm, real-time sync -- no smartphone required."

Press **Back** to return to Home.

---

### Step 2 - Verified prices: three mandis, net of transport
**Time budget: ~45 seconds**

Press **1** (row 1: Market Prices).

> "Rakesh grows wheat. The app shows prices from three nearby mandis --
> but not just the headline price. Each one is the net amount after transport costs."

Point to the three market rows. Highlight:
- Distance in km to each mandi
- Price per quintal
- Net gain/loss compared to local

Scroll to the best option (Kanpur or whichever shows the highest net).

> "Each number has a source and a timestamp. This is Agmarknet --
> the government's own database -- synced thirty minutes ago.
> Not a scrape, not an estimate. Official data."

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

> "Meena is a Verified Trader -- AgriLink counts qualifying deals across unique counterparties
> to prevent ring trading. This badge means something."

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

> "Before he confirms, he sees the mandi benchmark right here. This offer is 13% below
> today's Kanpur price -- the app flags it. He can decide whether that's worth it."

Press **#**.

> "He is not fully literate. He presses hash."

The TTS reads the full summary aloud in Hindi:
> "Offer swikarein. Gehun, 500 quintal, Rs.2,450 pratyek quintal..."

> "This is the Shush mechanism -- press hash once to read, press hash again to stop."

After TTS finishes, type **0 0** (the last two digits of Rs.12,25,000).

> "To confirm, he types the last two digits of the total. Not one button press --
> a pocket press cannot accidentally commit a half-million rupee trade."

The deal is created. Press **Back** to return.

---

### Step 4 - Sim Trade (Backend Integration)
**Time budget: ~30-60 seconds**

> "Now, we will demonstrate a live simulated trade. We initiate this trade directly from our backend testing server."

*(Trigger the simulated trade from the backend)*

> "As you can see, the demo phone reacts instantly to the new incoming trade data."

*(Briefly show the UI reaction on the demo phone)*

---

### Step 5 - Pickup code: complete delivery at the market
**Time budget: ~45 seconds**

Press **2** (row 2: Sell / Buy). Navigate to **My Deals**. Open the deal with Meena S.

Show the deal status: `pickup_scheduled`.

> "They agreed on a pickup location and time offline. Now Rakesh is at the mandi.
> Meena shows him her phone -- he types her four-digit pickup code."

Navigate to the **Verify pickup** action. Enter the 4-digit code shown on Phone B
(or enter the correct code from Meena's deal screen).

> "Code verified. Delivery complete."

Show the deal status transition to `handed_over`.

> "The entire transaction -- price check, offer, acceptance, delivery confirmation --
> happened on a fifteen-dollar keypad phone. Rakesh never took out a smartphone.
> No online payment. No bank account. No app install."

Press **Back** to Home.

---

### Step 6 - Lost phone: sign out other devices (10 seconds)
**Time budget: ~20 seconds**

> "One more thing. What if his phone is lost or stolen?"

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

> "One key press. The server revokes every other session.
> The transaction history, the farm data, the deal records -- all stay on the server.
> The lost phone goes dark."

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
