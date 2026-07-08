# `src/suppla-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~291 lines**

Integrates **Suppla** smart-home devices via the **Suppla Cloud REST API** (`api/v2.4.0`) or a self-hosted Suppla server. No external npm packages (uses Node.js built-in `https`/`http`).

**Discovery flow:**
1. `GET /channels?include[]=state,iodevice,connected` — fetches all channels with their current state and parent ioDevice info.
2. Channels are grouped by `iodevice.id` → one dashboard card per physical device.
3. Each channel's `functionName` determines the sensor type: read-only, toggle, range slider, or compound (e.g. temperature + humidity from one channel).
4. Initial state is applied immediately; polling refreshes state every `pollInterval` seconds.

**Channel ↔ sensor mapping:**

| Suppla function | `path` key | Notes |
|---|---|---|
| `LIGHTSWITCH` / `POWERSWITCH` | `ch_<id>` | Toggle; 0/1 |
| `DIMMER` / `RGBLIGHTING` | `ch_<id>` | Range 0–100 |
| `CONTROLLINGTHEROLLERSHUTTER` | `ch_<id>` | Range 0–100; 0=open |
| `CONTROLLINGTHEGARAGEDOOR` / `GATEWAY` | `ch_<id>` | Toggle; open/close |
| `THERMOMETER` | `ch_<id>` | Float °C |
| `HUMIDITYANDTEMPERATURE` | `ch_<id>_temp` + `ch_<id>_hum` | Two sensors per channel |
| `ELECTRICITYMETER` | `ch_<id>_power` + `ch_<id>_energy` | W + kWh from phase array |

**Commands:** PATCH `/channels/{id}` with `{ action }`. Switch → `TURN_ON`/`TURN_OFF`; dimmer → `SET_RGBW_PARAMETERS` with `brightness`; gate → `OPEN`/`CLOSE`; shutter → `REVEAL`/`SHUT`/`REVEAL_PARTIALLY`.

**Config:** See [`suppla`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class SuplaClient` |
| Config section(s) | `suppla` |
| Platform-status key | `suppla` |
| Registers devices | yes (via sensor-registry) |
| Polling | uses `setInterval` (interval from config/default) |
| Internal deps | `platform-status` |
| Node built-ins | `https`, `http` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `suppla` section.

---

*Extracted from `src/suppla-client.js`. Source is authoritative — regenerate this page if the module changes.*
