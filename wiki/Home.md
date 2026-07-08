# LSH — LoxoneSwaggerHelper Wiki

**LSH** is a lightweight Node.js smart-home hub: it unifies Victron Energy, 30+ device integrations (Fibaro, Satel, Somfy, Shelly, UniFi, IKEA, LG, and more), a REST/Socket.IO API, a React dashboard, HomeKit bridging, and a two-way Loxone bridge — all in a small footprint that runs happily on a Raspberry Pi.

> This wiki is generated from the in-repo documentation (`README.md`, `docs/`). For the authoritative source, see those files; edits here should be mirrored back.

## Getting started

- **[Quick Start & Requirements](Quick-Start)** — install, Docker, first run, HTTPS/TLS
- **[Overview & Positioning](Overview)** — what LSH is, business model, LSH vs. Home Assistant
- **[Dashboard & Pages](Dashboard)** — the React PWA and page layout

## Configuration & operation

- **[Configuration Reference](Configuration)** — `config.json` top-level sections + every integration
- **[Architecture & Modules](Architecture)** — backend modules and per-integration clients
- **[Automation, Scenes & History](Automation)** — rules, scenes, notifications, sensor charts
- **[Internationalization](Internationalization)** — multi-language support

## Interfaces

- **[REST API](REST-API)** — the unified API, authentication, endpoints, examples
- **[HomeKit](HomeKit)** — exposing devices to Apple Home
- **[Cameras & SIP Softphone](Cameras-and-SIP)** — camera streams and the door-phone
- **[Loxone Integration](Loxone-Integration)** — two-way bridge, REST recipes, import templates
- **[UniFi Door Station](UniFi-Door-Station)** — end-to-end doorbell → LSH → Loxone guide

## Security & deployment

- **[Security & Authentication](Security)** — users, API tokens, roles
- **[Remote Access & Security](Remote-Access-and-Security)** — Tailscale, proxies, SSH hardening

---

*Reference production install: Raspberry Pi `casablanca` (LAN `192.168.1.229:3000`, Tailscale `100.86.235.13`).*
