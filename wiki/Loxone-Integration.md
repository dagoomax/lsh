# Loxone Integration

‹ [Home](Home) · [REST API](REST-API) · [UniFi Door Station](UniFi-Door-Station) ›

LSH bridges to a Loxone Miniserver **both ways**:

| Direction | Mechanism | Config / endpoint |
|---|---|---|
| Loxone → LSH (commands) | **Virtual Output** calling LSH REST | `/api/device/<key>/set` |
| LSH → Loxone (feedback, poll) | **Virtual HTTP Input** polling LSH | `/api/devices` |
| LSH → Loxone (feedback, push) | LSH pushes to Miniserver **Virtual Inputs** | `loxoneOut` config → `/dev/sps/io/<VI>/<value>` |
| Miniserver → LSH (inbound mirror) | LSH WebSocket client mirrors Loxone controls | `loxone` config |

See [Configuration](Configuration) for the `loxone` (inbound) and `loxoneOut` (push) config sections.

---

## Using LSH from Loxone (REST)

A Loxone Miniserver can read and control any LSH device through the REST API — useful for bringing cloud-only or otherwise incompatible gear (Fibaro, Satel, Somfy, Bayrol, SmartThings…) into Loxone. Loxone reads with a **Virtual HTTP Input** and controls with a **Virtual Output**.

Loxone's HTTP blocks can't easily set an `Authorization` header, so pass the token as the **`?token=`** query parameter (create a dedicated API token in **Settings → API Tokens**). `<lsh-ip>` is the LSH host as reachable from the Miniserver; the default port is `3000`.

> **Encoding:** device keys and sensor paths contain `/`, which must be URL-encoded as **`%2F`** in Loxone commands (e.g. key `fibaro/room_443` → `fibaro%2Froom_443`, sensor `71/value` → `71%2Fvalue`). Find every device's `key` and sensor `path` via `GET http://<lsh-ip>:3000/api/devices?token=<token>`.

**Control a device — Virtual Output**

Set the Virtual Output *Address* to `http://<lsh-ip>:3000`, then add a Virtual Output Command. This example sets a Fibaro dimmer (device `71` in room `443`) to the value `<v>` (0–99):

```
/api/device/fibaro%2Froom_443/set?sensor=71%2Fvalue&value=<v>&token=<token>
```

`<v>` is Loxone's value placeholder — wire an analog output (0–99) to it, or use fixed `value=99` / `value=0` commands for on/off. The `/set` endpoint is a GET-friendly control route made for exactly this (no request body needed).

**Read a value — Virtual HTTP Input**

- **URL:** `http://<lsh-ip>:3000/api/devices/fibaro%2Froom_443?token=<token>`
- **Command recognition** (`\v` marks the number to extract — the dimmer's current level):

```
"characteristic":"Brightness"},"value":\v
```

Anchor the recognition on something unique to the device if a room has several controllables (e.g. `Dimmer Biuro"…"value":\v`). Mark the input as analog with a 2–5 s poll interval.

The same two patterns work for **any** LSH device — swap in the target's `key` and sensor `path`: a Satel output (`satel/output/5`, `state`), a relay (`/api/relay/0/state`), a Somfy blind, etc.

---

## Auto-generated import templates

Instead of typing commands by hand, LSH generates ready-to-import Loxone Config XML for your live devices:

```
GET /api/loxone/outputs.xml?type=fibaro&token=<token>     # Virtual Outputs (commands)
GET /api/loxone/inputs.xml?type=fibaro&named=1&token=<token>   # Virtual HTTP Inputs (feedback)
```

Query parameters:

- `?type=<integration,…>` — filter by integration key (`fibaro`, `somfy`, `satel`, `unifi`, `shelly`, …)
- `?device=<key>` — a single device
- `?named=1` — skip devices with generic fallback labels (e.g. unnamed Satel zones)
- `?host=` — override the LSH address embedded in the XML
- `?token=` / `?tokenId=` — embed an API token into the command URLs
- `?polling=` — poll interval in ms for inputs (min 1000, default 5000)

Then in Loxone Config: **Virtual Outputs → Import Virtual Output…** and **Virtual Inputs → Import Virtual HTTP Input…**.

## Pre-built templates in the repo

`docs/loxone/` contains hand-verified sample templates. Replace **`YOUR_LSH_TOKEN`** with a real token and set the `Address` to `http://<lsh-ip>:3000` before importing:

| File | Contents |
|---|---|
| `loxone-lsh-somfy.xml` | 14 Somfy blinds: Open/Close, Stop, My (favourite), Position (0–100) |
| `loxone-lsh-fibaro-all.xml` | 44 Fibaro devices: switches, shutters, dimmers |
| `loxone-lsh-fibaro-dimmers.xml` | just the Fibaro dimmers |
| `loxone-lsh-fibaro-all-input.xml` | feedback for all Fibaro devices |
| `loxone-lsh-fibaro-dimmers-input.xml` | feedback for the Fibaro dimmers |

**Notes**

- Commands use `GET` with the `?token=` query param.
- Device keys are `%2F`-encoded in the path (`fibaro%2Froom_443`, `somfy%2Fio___…`).
- Dimmers are 0–99; shutters/blind positions are 0–100.
- Somfy RTS motors are one-way (no position feedback); io motors report state.

## Instant events (push)

Polling has latency. For events that must arrive immediately — a **doorbell ring** especially — use the **push** path instead: map an LSH store key to a Miniserver Virtual Input in the `loxoneOut` config, and LSH calls `/dev/sps/io/<VI>/<value>` the moment the value changes. See [UniFi Door Station](UniFi-Door-Station) for a complete worked example.
