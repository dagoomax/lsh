# `src/simulator-manager.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Support  ·  **~120 lines**

Runs the bundled hardware simulators (`scripts/*-simulator.js` — Grenton, Miele, Ampio, Aqara, Hue) as child processes per `config.simulators`, so a development install can enable them without PM2 or extra terminals. Simulator output is relayed into the LSH log prefixed `[sim:<name>]`; a simulator that exits unexpectedly restarts after 5 s while it stays enabled. Runtime control: `GET /api/simulators` (catalog + running state) and `POST /api/simulators/:name { enabled, port? }` — toggles the process and persists the choice to `config.json`.

**Config:**
```json
"simulators": { "grenton": false, "hue": { "enabled": true, "port": 8180 } }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class SimulatorManager` |
| Platform-status key | — |
| Device key prefix | — |
| Store keys written | — |
| Registers devices | no |
| Internal deps | — |
| npm packages | — |
| Node built-ins | `child_process`, `path`, `fs` |

## Related module pages

- [`api-routes.js`](Module-api-routes)

---

*Extracted from `src/simulator-manager.js`. Source is authoritative — regenerate this page if the module changes.*
