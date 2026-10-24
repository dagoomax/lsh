# LSH

*Polska instrukcja instalacji: [`INSTALACJA.md`](../INSTALACJA.md).*

LSH is a smart-home hub with ~55 integrations: Victron, Loxone, KNX, Shelly, Tuya, Sonoff, IKEA, Sonos, Roborock, UniFi Protect, SIP doorbells and more. It runs as a single Node.js process next to Home Assistant, with its own dashboard on port **3000**.

## Install

1. **Add the repository:** Settings → Add-ons → Add-on Store → ⋮ → **Repositories** → `https://github.com/dagoomax/lsh`.
2. **Find LSH:** ⋮ → **Check for updates**, then open **LSH** → **Install**. The image is built on your device, with every integration's packages included:
   - about 5 min on a PC or NUC,
   - 10–25 min on Green or a Raspberry Pi.

   The device needs access to `github.com` and `registry.npmjs.org` while it builds.
3. **Start it:** enable **Start on boot** and **Watchdog**, then **Start**. The first log line shows the build, e.g. `LSH add-on 1.0.9 · main @ 66ce10a · built 2026-10-25`. LSH is ready at `[Automation] Started`.
4. **Sign in:** open `http://<home-assistant-ip>:3000`, create the admin account (separate from Home Assistant's users), and configure integrations in LSH's **Settings**.

Never use **Uninstall** to start over: it deletes `/data`, which holds the settings, accounts, flows, scenes, the 3D model and the HomeKit pairing.

## Connecting LSH and Home Assistant

You can set up either direction, or both. LSH never re-imports its own exports, so there are no loops.

**Home Assistant → LSH (import)**
1. Create a long-lived access token in HA: Profile → Security.
2. In LSH: Settings → Platforms & Hubs → **Home Assistant** → URL `http://127.0.0.1:8123`, then paste the token.

HA entities then show up in LSH with HA's names and areas.

**LSH → Home Assistant**, pick one:
- **HomeKit Device:** HA discovers LSH's HomeKit bridge by itself. Settings → Devices & Services → **LSH** → Configure, then enter the PIN from LSH (Settings → Platforms & Hubs → HomeKit, default `031-45-154`). A HomeKit bridge pairs with only one controller, so if LSH is already in the Apple Home app, use MQTT instead.
- **MQTT Discovery:**
  1. Install the **Mosquitto broker** add-on and the MQTT integration.
  2. Create an HA user for LSH.
  3. In LSH: Settings → Platforms & Hubs → Home Assistant → **Publish LSH devices to Home Assistant** → broker `mqtt://127.0.0.1:1883` with that user.

  This works alongside Apple Home.

## MQTT broker

LSH has a built-in broker (Settings → General → MQTT Broker). Mosquitto also uses port 1883, and on host networking only one of them can have it:
- **If you run Mosquitto:** leave LSH's broker off, and point LSH's MQTT integrations at `127.0.0.1:1883`.
- **If you want both:** give LSH's broker another port, e.g. 1884.

## LSH in the sidebar

There's no Ingress. Instead, add a page: Settings → Dashboards → Add dashboard → **Webpage** → `http://<home-assistant-ip>:3000`.

This works when Home Assistant is opened over `http://` on the LAN. Browsers block an `http://` page inside an `https://` Home Assistant.

## Ports (host networking)

Host networking is required for HomeKit, Tuya, Sonoff and AirPlay discovery over mDNS and UDP broadcast.

| Port | Purpose |
|---|---|
| 3000 | dashboard and API |
| 3443 | HTTPS (when TLS is configured) |
| 47128 | HomeKit bridge |
| 1883 | LSH MQTT broker (when enabled) |
| 5540 | Matter bridge (when enabled) |
| 8554 | RTSP proxy (when `ffmpegRtsp` is on) |
| 6066 | Loxone weather forecast (when enabled) |

## Data, backups, updates

Everything LSH saves lives in the add-on's `/data`, which is kept across restarts and updates and included in Home Assistant backups:
- `config.json`
- `automations.json`
- `persist/`: users, API tokens, HomeKit pairing, the 3D model, history
- `certs/`

**To update:** Add-on Store → ⋮ → **Check for updates** → LSH → **Update**. The image is rebuilt, and the old version keeps running until the new one is built. Take a partial backup of LSH first.

**Rebuild** builds the same version again but may reuse Docker's cached copy of the code. If the build date in the log didn't change, the new code arrives with the next add-on version.

## Troubleshooting

- **An integration doesn't start:** the log names the reason, e.g. `Optional module unavailable: ./src/tuya-client (Cannot find module 'tuyapi')`. **Update** or **Rebuild** reinstalls the packages.
- **Port 3000 in use:** another add-on holds it. Stop it or change its port.
- **HA doesn't pair the HomeKit bridge:** check whether it's already paired with Apple Home (see above).
- **Settings lost after a restart:** this affected versions up to 1.0.7 and is fixed since 1.0.8. Save them once more.

## Limitations

- LSH is configured only in its own Settings. The add-on has no Supervisor options panel.
- No Ingress.
- `amd64` and `aarch64` only.
