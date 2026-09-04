# Automation, Scenes & History

‹ [Home](Home) · [Configuration](Configuration) · [REST API](REST-API) ›

## Automation, Scenes & History

### Sensor history + charts

Every numeric (and boolean) store value is recorded in an in-memory ring buffer — up to 720 points per key, at most one point per 30 s (≈6 h of full-resolution history; fast-changing values update the latest point in place, so RAM stays bounded).

- **UI:** click any read-only sensor value on a device card to open a chart modal with 1h / 6h / All ranges and min/avg/max stats.
- **API:** `GET /api/history/<storeKey>` → `{ success, key, points: [[timestamp, value], …] }`

History is in-memory only — it resets on server restart.

### Automation rules

Rules are edge-triggered: a comparison rule fires once when the condition becomes true, and re-arms when it becomes false again. `changes` fires on every value change. An optional per-rule cooldown limits how often it can fire.

```json
{
  "name": "Spa overheating",
  "enabled": true,
  "trigger": { "key": "smarttub/<id>/water_temp", "op": ">", "value": 40 },
  "actions": [
    { "type": "notify", "level": "critical", "message": "Spa is {value}°C!" },
    { "type": "relay", "index": 1, "on": false }
  ],
  "cooldownSeconds": 300
}
```

**Trigger ops:** `>` `<` `>=` `<=` `==` `!=` `changes`

**Action types:**
| Type | Fields | Effect |
|---|---|---|
| `device` | `deviceKey`, `sensor`, `value` | Send a device command via the sensor registry |
| `relay` | `index`, `on` | Switch a Victron relay |
| `notify` | `level` (`info`/`warning`/`critical`), `message` | Add a notification + toast; `{value}` and `{key}` placeholders supported |
| `scene` | `sceneId` | Run a scene |

### Flows (Node-RED-style)

For anything a single trigger→actions rule can't express — branching, delays, HTTP calls, MQTT, regex extraction — a flow is a small graph of nodes connected by `wires`. Entry-point node types (`trigger`, `time`, `mqttIn`) start a run; each node transforms/routes the message and forwards it along its wires. Same storage/API shape as rules and scenes (`automations.json`, `GET/POST /api/automation/flows`), and same restriction: flows act on live device state and store values — they can't rewrite `config.json` (a device's configured name, Shelly's per-relay labels, etc. stay a Settings/script-level change, not something a flow node can do).

The full node-type reference (config fields for `condition`, `sync`, `store`, `http`, `mqttOut`, `delay`, …) lives in the doc comment at the top of the "Flows" section in `src/automation-engine.js` — this page only shows a worked example.

**Example — mirror one Shelly relay to another** (built and verified against `scripts/shelly-simulator.js`: toggling `relay_0` reliably turned `relay_1` on/off within one poll cycle, both in the live device reading and the exported Loxone XML):

```json
{
  "id": "shellysim-mirror",
  "name": "Shelly Sim: mirror pump to lights",
  "enabled": true,
  "nodes": [
    {
      "id": "n1", "type": "trigger",
      "config": { "key": "shelly/localhost/relay_0", "op": "changes" },
      "wires": [["n2"]]
    },
    {
      "id": "n2", "type": "device",
      "config": { "deviceKey": "shelly/localhost", "sensor": "relay_1", "value": "{value}" },
      "wires": [["n3"]]
    },
    {
      "id": "n3", "type": "notify",
      "config": { "level": "info", "message": "Garden Pump changed to {value} — Patio Lights mirrored" },
      "wires": [[]]
    }
  ]
}
```

`op: "changes"` fires on every store update for that key (not just a value transition); `{value}` in a `device`/`notify` node's config resolves to the triggering message's payload. Swap in real device keys/sensors from your own setup — `GET /api/devices` (or the dashboard) shows the exact keys and sensor paths to use.

Renaming `relay_0`/`relay_1` themselves (or the device's own name) is a separate, unrelated tool — as the restriction above notes, no flow node can do it. Use `scripts/shelly-rename-and-export.js` instead: `rename` for the device-level name, `label <host> path=Name ...` for per-sensor names like "Garden Pump"/"Patio Lights" above, and `export` to re-pull the Loxone XML once the new names are live. See the `shelly` config section in the README for the full `sensorLabels` reference.

**Example — auto-refresh a Loxone export on a schedule.** `http`'s `saveAs` option fetches a URL and serves the result back from a stable `/api/flow-snapshots/<name>` link, saved under whatever extension its Content-Type maps to (`xml`/`zip`/`json`/`jpg`/…, see `SAVEAS_TYPES` in `src/automation-engine.js`) — originally built for camera snapshots, it works just as well for re-pulling a Loxone export so the link always reflects current names/devices, no manual re-export needed after a rename:

```json
{
  "id": "shelly-xml-refresh",
  "name": "Shelly: refresh Loxone export nightly",
  "enabled": true,
  "nodes": [
    {
      "id": "n1", "type": "time",
      "config": { "intervalSeconds": 86400 },
      "wires": [["n2"]]
    },
    {
      "id": "n2", "type": "http",
      "config": {
        "method": "GET",
        "url": "http://localhost:3001/api/loxone/outputs.xml?type=shelly&token=<api-token>",
        "saveAs": "shelly-outputs"
      },
      "wires": [[]]
    }
  ]
}
```

Point Loxone Config's import (or a periodic fetch, if you're scripting the import too) at `/api/flow-snapshots/shelly-outputs.zip` — verified end-to-end: a >40-command export correctly saves and serves as `.zip` (`application/zip`), a single-block export as `.xml` (`application/xml`), and existing JPEG-snapshot flows are unaffected. Swap `outputs.xml`/`type=shelly` for `inputs.xml` or a different `?type=` as needed — two `http` nodes off the same `time` trigger covers both.

### Scenes

Named action groups run manually — one tap from the **scene strip** shown above all dashboard tabs, or from the Automation tab. Same action types as rules.

### Notifications

`notify` actions append to an in-memory log (last 200) shown on the Automation tab, push a real-time toast to all connected browsers (via the `notification` socket.io event), and log to the server console.

### Storage & API

Rules and scenes persist to `automations.json` in the project root (gitignored). Endpoints:

```
GET/POST  /api/automation/rules          DELETE /api/automation/rules/:id
GET/POST  /api/automation/scenes         DELETE /api/automation/scenes/:id
POST      /api/automation/scenes/:id/run
GET       /api/automation/notifications  DELETE /api/automation/notifications
```

`POST` creates or updates (include `id` to update). All endpoints require auth like the rest of the API.

---
