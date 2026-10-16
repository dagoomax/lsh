# LSH

*Polska instrukcja instalacji: [`INSTALACJA.md`](../INSTALACJA.md).*

Victron / Loxone / KNX smart-home hub — ~40 integrations (Victron, Loxone, KNX, Shelly, Sonos, IKEA, Roborock, UniFi Protect/Access, SIP doorbells, …) in a single ~80–130 MB Node.js process.

## First run

1. Start the app. It clones and builds LSH from GitHub on first install (a couple of minutes), then seeds an empty `config.json` — not a copy of `config.example.json`, which has every integration's fields already filled with placeholder hosts and would auto-start all of them against a fake address.
2. Open `http://<home-assistant-ip>:3000` — you'll land on `/setup.html` to create the admin account.
3. Configure integrations from the **Settings** page in LSH's own UI (this is how LSH is normally configured — you rarely need to touch `config.json` by hand). See the main [README](https://github.com/dagoomax/lsh#readme) for every integration's config reference.

## Ports (host networking)

This app runs with `host_network: true` — required for HomeKit's mDNS advertisement to reach the LAN, which only works with host networking, exactly like the plain Docker deployment. Every port below is exposed directly on the Home Assistant host:

| Port | Purpose |
|---|---|
| 3000 | HTTP dashboard / API |
| 3443 | HTTPS (if TLS is configured) |
| 47128 | HomeKit bridge |
| 8554 | RTSP proxy (if `ffmpegRtsp` is enabled) |

## Data persistence

`config.json`, `persist/` (HomeKit pairing, API tokens, users — never delete), and `certs/` all live under the app's `/data` directory, which Supervisor keeps across restarts, updates, and **includes in Home Assistant backups** automatically.

## Connecting to Home Assistant

Once running, point HA at LSH's REST API — see the "Home Assistant integration example" in the main README for a working `sensor:`/`switch:` REST config using an LSH API token (Settings → API Tokens in LSH).

## Build pin

The Dockerfile clones `LSH_REF` (default `main`) from `github.com/dagoomax/lsh` at build time — set it to a tag/commit in a fork of this add-on if you want a pinned, reproducible version instead of tracking the latest commit.

## Limitations

- No `options`/`schema` integration — LSH is configured entirely through its own Settings UI and `config.json`, not Supervisor's add-on options panel.
- No Ingress (sidebar-embedded UI) yet — LSH is reached directly on its own port with its own login.

## Settings and integrations (1.0.8)

- Everything changed in LSH's Settings is saved in the add-on's `/data` (backed up by Home Assistant). Before 1.0.8 a save replaced the link to `/data` with a file inside the container, so changes — AirPlay speakers included — were lost at the next add-on restart or update. Flows, rules and scenes (`automations.json`) are kept in `/data` too. After updating, check your settings once and save again what's missing.
- All integrations' packages (AirPlay, Chromecast, KNX, IKEA, Matter, …) are installed when the add-on is built, so nothing is downloaded at start-up and AirPlay works right after a reboot, even before the internet is up.

## Rebuilding on Home Assistant Green

1. **Back up first:** Settings → System → Backups → Create backup → *Partial*, tick only **LSH**. Never use *Uninstall* to start over — it deletes the add-on's `/data` (settings, accounts, flows, HomeKit pairing).
2. Settings → Add-ons → Add-on Store → ⋮ → **Check for updates**, then open **LSH** → **Update**. Green builds the image from scratch (10–25 min); leave it running.
3. The first line of the add-on **Log** shows what was built, e.g. `LSH add-on 1.0.8 · main @ 1a2b3c4 · built 2026-10-16`. LSH is ready at `[Automation] Started`.
4. Test: change something in LSH's Settings, **Restart** the add-on, reload LSH — the change must still be there. Settings lost *before* 1.0.8 can't be recovered; enter them once more.

⋮ → **Rebuild** builds the same version again but may reuse Docker's cached copy of the code — if the build date in the log didn't change, the new code arrives with the next add-on version.
