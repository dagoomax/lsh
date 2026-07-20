# LSH

*Polska instrukcja instalacji: [`INSTALACJA.md`](../INSTALACJA.md).*

Victron / Loxone / KNX smart-home hub — ~40 integrations (Victron, Loxone, KNX, Shelly, Sonos, IKEA, Roborock, UniFi Protect/Access, SIP doorbells, …) in a single ~80–130 MB Node.js process.

## First run

1. Start the app. It clones and builds LSH from GitHub on first install (a couple of minutes), then seeds `config.json` from the example.
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
