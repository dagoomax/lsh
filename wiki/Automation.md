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
