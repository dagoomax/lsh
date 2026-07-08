# Overview & Positioning

‹ [Home](Home) · [Configuration](Configuration) · [REST API](REST-API) ›

## Product Leaflet

[![Page 1](leaflet/pages/page1.png)](leaflet/lsh-leaflet.pdf)
[![Page 2](leaflet/pages/page2.png)](leaflet/lsh-leaflet.pdf)
[![Page 3](leaflet/pages/page3.png)](leaflet/lsh-leaflet.pdf)
[![Page 4 — SWOT](leaflet/pages/page4.png)](leaflet/lsh-leaflet.pdf)

📄 **[Download PDF](leaflet/lsh-leaflet.pdf)** — features, integrations &amp; REST API reference

---

## Business Guide — Support-Driven Monetization

💰 **[Open Business Guide](leaflet/lsh-monetize-leaflet.html)** — how to build a support-driven business on LSH (free software, paid expertise model)

3-page A4 guide covering:
- The support flywheel: free deployment → setup fee → annual SLA → expand scope → referrals
- Three support tiers: Community (free), Professional (€300/yr), Managed (€80/mo)
- Full service catalogue with indicative pricing (onboarding, SLA, managed hosting, custom dev, training)
- 3-year revenue projection for a solo operator
- Why LSH's focused integration set is a moat vs Home Assistant's 3 000-integration community

---

## SWOT Analysis

### 💪 Strengths

| | |
|---|---|
| **Local-first, zero cloud dependency** | All data stays on LAN. MQTT runs directly to hardware — no relay server, no account, works during internet outages. Optional VRM cloud fallback only when needed. |
| **20+ integrations in a single process** | ~80–130 MB RAM. No microservice sprawl, no Docker Compose with 12 containers — just `node server.js`. Runs comfortably on a Raspberry Pi 2 or any spare ARM/x86 board. |
| **Victron Energy depth** | Solar MPPT, battery SoC, grid import/export, relay control — uniquely positioned for off-grid and solar installations. SolarEdge overlay included. |
| **Native Apple HomeKit bridge** | Every sensor, switch, camera, and relay auto-exposed. Unlimited accessories — bridge survives restarts without re-pairing. |
| **Protocol breadth** | MQTT, KNXnet/IP, Modbus TCP, REST, WebSocket, RTSP — standard protocols only, no proprietary SDKs required. |
| **On-demand RTSP proxy** | FFmpeg re-streams only when a client connects — zero idle bandwidth. Each camera gets its own port. Loxone Intercom compatible. |
| **Settings UI — no YAML required** | All integrations configured via browser forms with live connectivity tests. KNX group addresses, SmartBob topics, FFmpeg proxy — all point-and-click. |
| **MQTT Explorer built-in** | Live topic browser + publish/subscribe panel, no separate MQTT.fx or MQTT Explorer needed. |

### ⚠️ Weaknesses

| | |
|---|---|
| **Technical setup required** | No one-click installer or Docker Hub image. Requires Node.js, terminal comfort, and manual `config.json` editing for initial setup. |
| **No automation engine** | No built-in rule or scene builder. Users must rely on external tools (Node-RED, cron, HomeKit automations) for time or condition-based triggers. |
| **No persistent history / charting** | Live values only — no time-series database, no energy graphs over days or weeks. Historical data requires InfluxDB + Grafana sidecar. |
| **Single-node, no HA failover** | One server failure = no dashboard, no HomeKit bridge. No clustering or standby replication supported. |
| **Cloud API fragility** | SmartThings, LG ThinQ, and VRM integrations depend on vendor API stability. Unilateral breaking changes can silently disable features. |
| **Single maintainer bus factor** | Platform continuity depends on one developer. No community governance, contributor pipeline, or public issue tracker yet. |

### 🚀 Opportunities

| | |
|---|---|
| **Privacy-conscious market growth** | Users increasingly reject cloud-dependent hubs after outages (SmartThings 2022, Google Nest 2023). LSH's local-first story is a direct answer. |
| **Victron / solar / EV adoption rising** | Victron Energy is the dominant brand in off-grid solar. EV charger integration + battery relay control gives LSH a unique energy management angle no competitor covers. |
| **KNX building automation market** | KNX is the dominant bus in European commercial buildings. First-class KNXnet/IP support opens the professional integrator and architect market. |
| **Docker image + NAS packaging** | A published Docker Hub image and Synology/Unraid community package would unlock a large segment of homelab users who deploy from package managers. |
| **Commercial integrator channel** | KNX + Victron + Loxone overlap with professional AV and building automation installers — a channel underserved by Home Assistant's DIY-first positioning. |
| **Automation engine add-on** | Adding a visual flow builder or simple rule engine (`if sensor X > value → command Y`) would significantly expand the non-technical user segment. |

### 🔴 Threats

| | |
|---|---|
| **Home Assistant dominance** | Enormous ecosystem (3,000+ integrations), massive community, strong brand, and well-funded Nabu Casa behind it. Mindshare is very hard to displace. |
| **Vendor API changes** | SmartThings, LG ThinQ, and VRM can revoke or break APIs without notice. No contractual SLA between LSH and any vendor platform. |
| **Matter / Thread commoditisation** | If Matter becomes universal, Apple Home and Google Home absorb device control natively — reducing the differentiation of multi-protocol middleware like LSH. |
| **Security exposure at network edge** | Self-hosted dashboards port-forwarded to the internet are a common attack vector. Misconfigured TLS or weak passwords can expose the entire home network. |
| **Competing open platforms** | openHAB, Domoticz, ioBroker, and Gladys cover overlapping protocol breadth with established communities and package registries. |
| **HAP-nodejs / HomeKit spec changes** | The HAP bridge relies on a reverse-engineered Apple spec. Apple can introduce MFi restrictions or firmware changes that break the bridge without warning. |

---

## LSH vs. Home Assistant — RAM & Server Footprint

Home Assistant is the most popular open home automation platform and has a huge ecosystem. LSH does not try to replace it — but if you are running both, or just need bridge-and-control without a full automation engine, the resource difference is significant.

| | **LSH** | **Home Assistant** |
|---|---|---|
| **Runtime** | Node.js single process | Python + systemd services (Core/Supervised/OS) |
| **RAM at idle** | ~80–130 MB | 300–600 MB (Core only, no add-ons) |
| **RAM with typical add-ons** | — (no add-ons; all integrations built-in) | 600 MB–1.5 GB (Mosquitto + Z-Wave + Zigbee2MQTT + HA cast) |
| **Minimum RAM recommended** | **256 MB** | **1 GB** (official minimum for HA OS / Supervised) |
| **Minimum sensible hardware** | Raspberry Pi 2 / 512 MB board | Raspberry Pi 3 (2 GB recommended by Nabu Casa) |
| **Startup time** | 2–4 s | 30–90 s |
| **Disk footprint** | ~60 MB (node\_modules included) | 8–32 GB (HA OS image alone is 2 GB) |
| **Containers / processes** | 1 | 5–15 (supervisor, core, DNS, mDNS, add-ons) |
| **Install method** | `npm install && node server.js` | Dedicated image, Docker, or VM |
| **Remote access cost** | Free (own TLS / reverse proxy) | €6.99 / month (Nabu Casa Cloud) or self-host |
| **Database** | None — live data only | SQLite (grows unbounded; recorder purge needed) |
| **Config format** | JSON + browser UI | YAML + browser UI |
| **25+ integration scope** | ✓ all built-in, one process | ✓ 3 000+ via separate integration packages |
| **HomeKit bridge** | ✓ native (hap-nodejs) | ✓ via HomeKit Controller add-on |
| **SIP softphone** | ✓ built-in | ✗ |
| **Victron MQTT depth** | ✓ first-class | Limited (community integration) |

### When to choose LSH

- You want a **bridge-and-control layer** on top of existing hardware without committing 1+ GB RAM to an automation platform.
- You run on a **Raspberry Pi 2, Orange Pi Zero, or any 256–512 MB board** that would thrash with HA.
- You care about **instant startup** — after a power blip LSH is live in under 5 seconds, HomeKit re-pairs in seconds.
- You are a **KNX / Victron / Loxone integrator** who needs a professional-grade API gateway, not a consumer hub.
- You want **zero cloud dependency by default** — no Nabu Casa account, no subscription, works 100% offline.

### When Home Assistant is the better choice

- You need **automations, scenes, and a visual rule builder** — HA's scripting engine has no equivalent in LSH.
- You rely on **Z-Wave, Zigbee, or Matter** devices — HA's native stack for these is far more mature.
- You want **historical charts and energy dashboards** — HA's Recorder + Statistics panels are built for this.
- You need **3 000+ vendor integrations** from the HA ecosystem.

> LSH and Home Assistant run well side-by-side: run LSH on a low-power board for bridging and relay control, and point Home Assistant at the LSH REST API for automations.

---

A self-hosted home automation dashboard built on Node.js. Aggregates live data from Victron Energy, SolarEdge, Samsung SmartThings, Loxone, Satel, UniFi Protect, Reolink, Shelly, BoneIO, Dreame, Homey, IKEA Dirigera, IKEA Tradfri, LG ThinQ, ESPHome (ESP32/ESP8266), KNX, Fibaro Home Center, Z-Way / RaZberry (Z-Wave), Wiren Board, Somfy TaHoma, Bayrol Pool Manager Connect, AUX Air (AC Freedom), SmartTub hot tubs (Jacuzzi / Sundance / Watkins), Sonos speakers, Denon / Marantz AV receivers, Arduino / generic MQTT devices, and Suppla smart-home into a single real-time web UI with relay control, HomeKit integration, SIP softphone, MQTT explorer, FFmpeg RTSP proxy, and multi-language support.

---
