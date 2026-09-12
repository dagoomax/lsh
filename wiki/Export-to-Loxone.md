# Exporting LSH Data to Loxone

‹ [Home](Home) · [Loxone Integration](Loxone-Integration) · [REST API](REST-API) ›

A step-by-step guide to getting LSH sensor/device data **into** a Loxone Miniserver. For the full bidirectional reference (including sending commands *from* Loxone to LSH) see [Loxone Integration](Loxone-Integration) — this page only walks through the export direction.

There are two ways to do it. Use **Method A** unless you specifically need instant push for something time-critical (a doorbell, a door contact) — it needs no config.json editing and no restart.

| Method | Latency | Setup | Use for |
|---|---|---|---|
| **A. Poll** (Virtual HTTP Input) | 2–5 s (configurable) | Import an XML file in Loxone Config | Most sensors — temperature, power, battery, state, … |
| **B. Push** (`loxoneOut` config) | Instant | Edit `config.json`, restart LSH | Doorbell rings, door/window contacts, anything alarm-relevant |

---

## Method A: Poll (Virtual HTTP Input) — recommended default

LSH can generate a ready-to-import Loxone Config file for any device or integration, so you never have to hand-write a URL or a value-recognition pattern.

### 1. Create an API token

In the LSH dashboard: **Settings → Security → API Tokens → + New Token**. Name it something like `loxone`. Copy the token value — it's only shown once.

### 2. Find what you want to export

Every device has a `key` (e.g. `fibaro/room_443`) and each of its readings has a sensor `path` (e.g. `71/value`). List everything LSH knows about:

```
GET http://<lsh-ip>:3000/api/devices?token=<token>
```

Or skip this step entirely and export **a whole integration at once** in step 3 below (e.g. every Fibaro device, every Somfy blind).

### 3. Generate the import file

Open this URL in a browser (or `curl` it to a file) — LSH builds the XML from your live device list, so it's always in sync with what's actually configured:

```
GET http://<lsh-ip>:3000/api/loxone/inputs.xml?type=fibaro&named=1&token=<token>
```

Useful query parameters:

| Param | Meaning |
|---|---|
| `type=<key>` | Only this integration (`fibaro`, `somfy`, `satel`, `shelly`, `sofar`, …) — omit for every device LSH has |
| `device=<key>` | Only this one device |
| `named=1` | Skip devices that never got a real name (generic fallback labels) |
| `polling=<ms>` | Poll interval, default 5000, minimum 1000 |
| `host=` | Override the LSH address baked into the file (defaults to the request's own host) |

Save the response as an `.xml` file. If you're exporting a lot of devices at once, LSH may instead return a `.zip` of several smaller `.xml` files — Loxone Config limits how many commands one Virtual Input/Output block can hold, so large exports get auto-split. Import each file from the zip the same way, one after another.

### 4. Import into Loxone Config

Open your project in **Loxone Config** → right-click **Virtual Inputs** in the tree → **Import Virtual HTTP Input…** → pick the file you just saved. One Virtual HTTP Input block appears per exported sensor, already pointed at the right LSH URL with a value-recognition pattern pre-filled.

### 5. Verify and save to the Miniserver

Check a couple of the imported inputs (`Address`, poll cycle, recognition pattern) look sane, then save the project to the Miniserver as usual. Within one poll cycle the values should start updating — watch them live in Loxone Config's **I/O Table**.

### Doing it by hand instead

If you'd rather wire up a single Virtual HTTP Input manually (useful for a one-off, or to understand what the generated file is actually doing):

- **Address:** `http://<lsh-ip>:3000/api/devices/<key>?token=<token>` (URL-encode `/` inside `<key>` as `%2F`, e.g. `fibaro%2Froom_443`)
- **Command recognition:** anchor on text unique to the sensor, with `\v` marking the number to extract, e.g. `"characteristic":"Brightness"},"value":\v`
- Mark it **analog**, poll interval **2–5 s**

See [Loxone Integration](Loxone-Integration) for more worked examples of the recognition-pattern syntax.

---

## Method B: Push (instant, for time-critical events)

Polling has latency — fine for a temperature reading, not for a doorbell that should ring the moment it's pressed. For that, LSH pushes the value itself, the instant it changes, straight to a Miniserver Virtual Input.

### 1. Create a Virtual Input in Loxone Config

Add a plain **Virtual Input** (not "Virtual HTTP Input" — this one receives a push from LSH, it doesn't poll for anything) and note its name, e.g. `VI3`.

### 2. Map it in `config.json`

```json
"loxoneOut": {
  "host": "192.168.1.x",
  "port": 80,
  "username": "admin",
  "password": "",
  "mappings": [
    { "storeKey": "sip/lastCall/ring", "virtualInput": "VI3" }
  ]
}
```

- `host`/`port` — the Miniserver's address (default port `80`)
- `username`/`password` — a Miniserver user with permission to write virtual inputs (HTTP Basic auth)
- `storeKey` — the LSH store key to watch, same `<device-key>/<sensor-path>` shape as everywhere else in LSH (see `GET /api/devices` if you're not sure of the exact key)
- `virtualInput` — the Miniserver Virtual Input's name from step 1

Add one object per key you want pushed — there's no bulk/prefix shorthand for this one (unlike `fibaroOut`'s `storePrefix`/`variablePrefix`, which is a different integration).

### 3. Restart LSH

```bash
pm2 restart lsh   # or: ./scripts/update-linux.sh, or npm start in dev
```

The moment the mapped store key changes, LSH calls `http://<miniserver>/dev/sps/io/VI3/<value>` on the Miniserver directly (debounced 200 ms so a rapid burst only sends the latest value) — no polling delay.

### Worked example

[UniFi Door Station](UniFi-Door-Station) walks through this exact method end-to-end for a doorbell ring, including the Loxone-side program logic that reacts to it.

---

## Troubleshooting

- **Nothing updates in Loxone Config's I/O Table** — check the Virtual HTTP Input's `Address` actually resolves from the Miniserver (it's a separate device on your network, not your browser) and that the token in the URL is still valid (`Settings → Security → API Tokens` in LSH).
- **Value looks stuck / recognition fails** — the JSON shape returned by `/api/devices/<key>` can differ device-to-device; open that URL directly in a browser and check the recognition pattern's anchor text actually appears verbatim in the response.
- **Push (Method B) never fires** — confirm the `storeKey` is exact (case-sensitive, no leading `/`) by cross-checking against `GET /api/devices`, and check LSH's logs for `[LoxoneOut]` lines after restarting.
