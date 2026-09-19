Here is the exact prompt you can copy and paste into an AI (or give back to me) to immediately generate the production-ready HTML, CSS, and JS code for your weather module.

---

**Copy and Paste the Prompt Below:**

**Role:** You are a Senior Frontend Engineer and Cloud-Rendered App Specialist competing in a 36-hour hackathon. We have 25 hours left until the demo.

**Objective:** Write the complete HTML, CSS, and vanilla JavaScript for the "Weather Forecast" module of our agricultural cloud-phone app, "FarmPulse". The code must be strictly tailored for a feature phone running via server-side rendering, acting as a dumb terminal.

**Technical Constraints & Environment:**

* **Screen Size:** Exactly 320x240 pixels (Landscape/Portrait depending on CSS orientation, lock the body to `width: 320px; height: 240px`). Must use `overflow: hidden` to prevent native browser scrolling.
* **Tech Stack:** Vanilla HTML, CSS, and JavaScript.
* **Input Method:** Keypad ONLY. No mouse, no touch. You must write a centralized JavaScript event listener for `keydown` that handles:
* 4 Arrow keys (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`)
* `Enter` (OK button)
* Number keys (`0`-`9`)
* `*` and `#`


* **UI/UX:** Extremely high contrast, large typography (18px+), and clear visual focus states (e.g., a thick yellow border or background inversion) so the user knows which element is currently selected via the D-pad.

**API Integration:**
You will fetch data using the Open-Meteo API.
*Endpoint:* `[https://api.open-meteo.com/v1/forecast?latitude=](https://api.open-meteo.com/v1/forecast?latitude=){local_lat}&longitude={local_lon}&daily=weather_code,percipitation_max&current=temperature_2m&forecast_days=3`
*(Note: For the purpose of this hackathon code, you can hardcode the `local_lat` and `local_lon` to Taichung City, Taiwan (Lat: 24.14, Lon: 120.67), or write a simple function that allows passing them in).*

* The UI needs to display: Current Temperature, Current Precipitation Probability, and a 3-day forecast mapped from the `daily=weather_code` to simple text/emoji icons (e.g., ☀️, 🌧️, ☁️) to avoid loading external image assets.

**Architectural References:**
Please write the code assuming it will be dropped into the environment defined by:

1. `[https://github.com/cloudfonecom/cloudfone-starter](https://github.com/cloudfonecom/cloudfone-starter)` (Assume standard template injection, keep logic modular).
2. `[https://www.cloudphone.tech/dev-guidelines](https://www.cloudphone.tech/dev-guidelines)` (Adhere strictly to their input debouncing rules and lightweight DOM recommendations).

**Required Output:**
Please provide:

1. **`index.html`**: The semantic DOM structure.
2. **`style.css`**: The strict 320x240 layout, flexbox/grid for easy alignment, and distinct `.focused` classes for D-pad navigation.
3. **`app.js`**: The logic to fetch the Open-Meteo API, parse the JSON, map the WMO `weather_code` to simple icons, render the DOM, and handle keypad navigation with a 300ms debounce to prevent server flooding.

Keep the code lean, hackathon-ready, and immediately executable.

---
