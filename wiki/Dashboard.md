# Dashboard & Pages

‹ [Home](Home) · [Configuration](Configuration) · [REST API](REST-API) ›

## React Dashboard

A Homey-style dark dashboard served at `/react/` — no separate port needed.

**URL:** `http://<server-ip>:3001/react/`

### Add to Home Screen (fullscreen PWA)

The dashboard ships as a Progressive Web App. When installed from the home screen it runs fullscreen with no browser chrome.

#### iPhone / iPad (Safari)

1. Open `http://<server-ip>:3001/react/` in **Safari**
2. Tap the **Share** button (box with arrow pointing up)
3. Scroll down and tap **Add to Home Screen**
4. Name it **LSH** → tap **Add**
5. Open the icon from your home screen — runs fullscreen, no address bar

> Safari is required on iOS. Chrome and Firefox on iOS cannot install PWAs.

#### Android (Chrome)

1. Open `http://<server-ip>:3001/react/` in **Chrome**
2. Tap the **⋮ menu** (three dots, top right)
3. Tap **Add to Home screen** → **Add**
4. Open the icon — runs as a standalone app

#### Desktop (Chrome / Edge)

1. Open `http://<server-ip>:3001/react/` in Chrome or Edge
2. Click the **install icon** (⊕) in the address bar
3. Click **Install**

### Features

- Live energy flow — solar, battery, grid, AC loads
- Device tile grid with one-tap toggle and brightness/colour-temp sliders
- Category filter (Lighting / Switches / Climate / Security / Sensors / Victron)
- Relay control panel
- Mobile: bottom tab bar switches between Devices and Energy views
- Auto-reconnects via Socket.IO; falls back to 15-second polling

---

## Pages

| URL | Description |
|---|---|
| `/` | Live dashboard — energy flow, battery, solar, grid, relays, device cards, cameras |
| `/settings.html` | All integration settings, test buttons, HomeKit QR, backup/restore |
| `/logs.html` | Per-category log viewer with auto-refresh and download |
| `/mqtt.html` | Real-time MQTT topic explorer with message history |
| `/login.html` | Sign-in page |
| `/setup.html` | First-run admin account creation |

---
