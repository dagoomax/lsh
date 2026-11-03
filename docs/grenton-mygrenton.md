# LSH devices in the myGrenton app

Goal: see and control **LSH** devices (Tuya air-conditioners, Shelly, Victron, …)
from the **myGrenton** mobile app.

## Why you can't just scan an LSH QR with myGrenton

There are **two different QR codes**, and they are not interchangeable:

| QR | Made by | Scanned by | Carries |
|----|---------|-----------|---------|
| **myGrenton interface QR** | myGrenton Builder (Object Manager) | the **myGrenton app** | a reference to your interface in **Grenton Cloud** |
| **LSH endpoint QR** (Settings → Grenton) | LSH | a **plain camera / QR reader** | `url: <LSH>` + `token: <API token>` for the **GATE Lua script** |

The myGrenton app only accepts the first one. LSH cannot produce it — it is a
closed Grenton format tied to their Builder and cloud. So the flow is:

```
LSH  ──REST──▶  GATE (Lua + virtual objects)  ──▶  myGrenton Builder  ──QR──▶  myGrenton app
     (url+token from the LSH endpoint QR)         (bind widgets)      (Grenton's own QR)
```

The GATE becomes the bridge: its Lua script polls LSH and mirrors each LSH value
into a **Grenton virtual object**; myGrenton then shows those objects like any
native Grenton object.

> The companion script in `grenton-gate-lsh.lua` is the **opposite** direction
> (GATE serves, LSH polls — brings Grenton objects *into* LSH). This document is
> the reverse: GATE calls *out* to LSH.

---

## What you need

1. **LSH URL + API token** — in the dashboard: *Settings → BoneIO & Grenton →
   Grenton → “Sync the Grenton GATE to LSH” → Generate QR & token*. Copy both
   values (or scan the QR with a plain camera). The token is shown once; it is a
   normal API token you can also manage under *Users & API tokens*.
2. A **GATE** (or CLU with HTTP capability) reachable from LSH on the LAN, and
   **Object Manager** + **myGrenton Builder**.
3. The LSH **device keys** you want to expose. List them:
   ```
   curl -H "Authorization: Bearer <TOKEN>" http://<LSH>:3001/api/devices
   ```
   e.g. `grenton/AC_bf0sim0klima_SET`, `grenton/AC_bf0sim0klima_PWR`,
   `tuya/<id>`.

### LSH REST API the GATE will call

- **Read one value** (bare value, ideal for one virtual object):
  `GET /api/devices/<key>?sensor=<path>`
  e.g. `GET /api/devices/grenton/AC_bf0sim0klima_SET?sensor=level` → `24`
- **Read the whole device** (JSON with every reading):
  `GET /api/devices/<key>`
- **Send a command** (admin):
  `POST /api/device/<key>/command` body `{"sensor":"<path>","value":<v>}`
  e.g. `{"sensor":"level","value":22}` on `grenton/AC_..._SET`.
- **Auth**: header `Authorization: Bearer <TOKEN>` (preferred — keeps the token
  out of URLs/logs). `?token=<TOKEN>` on the query string also works if your GATE
  can only do simple GETs, but avoid it for anything logged.

---

## Steps

### 1. Pick the LSH devices and note their keys + sensor paths
From `GET /api/devices`. For an LSH-exposed AC you'll typically use:
`…_PWR/switch` (on/off), `…_SET/level` (°C), `…_MODE/level` (mode index),
`…_TMP/value` (current °C).

### 2. Create a virtual object on the GATE for each value
In Object Manager add, per LSH value you want to show:
- a **virtual object** holding the current value (a feature/variable the Lua
  writes into, bound later in myGrenton), and
- for controllable values, make it writable (a switch / slider object) whose
  `OnChange` runs the command script in step 3.

### 3. GATE Lua — poll LSH and push commands

> **Template — adapt object names to your Object Manager.** Untested against a
> physical GATE; verify the `HttpRequest` API against your firmware. Set the two
> constants from the LSH endpoint QR.

Create an **HttpRequest** virtual object (e.g. `LSH_Http`) and a script on a
timer (`OnTimer`, every few seconds) to read, plus a script on each writable
object's `OnChange` to send commands.

```lua
-- Constants from LSH Settings → Grenton (the endpoint QR)
local LSH_URL = "http://192.168.1.50:3001"
local TOKEN   = "<paste the API token>"

-- Poll one LSH sensor into a virtual object (OnTimer) --------------------------
local function readLSH(key, sensor, targetObject)
  LSH_Http->SetUrl(LSH_URL .. "/api/devices/" .. key .. "?sensor=" .. sensor)
  LSH_Http->SetMethod("GET")
  LSH_Http->SetRequestHeader("Authorization", "Bearer " .. TOKEN)
  LSH_Http->SetResponseType(0)        -- plain text / number
  LSH_Http->SendRequest()
  -- in the HttpRequest OnResponse event:
  --   targetObject->SetValue(tonumber(LSH_Http->GetResponseBody()))
end

-- Example timer body:
readLSH("grenton/AC_bf0sim0klima_TMP", "value", KLIMA_TEMP)   -- current °C
readLSH("grenton/AC_bf0sim0klima_SET", "level", KLIMA_SET)    -- setpoint °C
readLSH("grenton/AC_bf0sim0klima_PWR", "switch", KLIMA_PWR)   -- 0/1

-- Send a command to LSH (OnChange of a writable object) -----------------------
local function writeLSH(key, sensor, value)
  LSH_Http->SetUrl(LSH_URL .. "/api/device/" .. key .. "/command")
  LSH_Http->SetMethod("POST")
  LSH_Http->SetRequestHeader("Authorization", "Bearer " .. TOKEN)
  LSH_Http->SetRequestHeader("Content-Type", "application/json")
  LSH_Http->SetRequestBody('{"sensor":"' .. sensor .. '","value":' .. tostring(value) .. '}')
  LSH_Http->SendRequest()
end

-- e.g. the setpoint slider's OnChange:
--   writeLSH("grenton/AC_bf0sim0klima_SET", "level", KLIMA_SET->GetValue())
-- the power switch's OnChange (JSON needs true/false, not 1/0):
--   writeLSH("grenton/AC_bf0sim0klima_PWR", "switch", KLIMA_PWR->GetValue() == 1 and "true" or "false")
```

Notes:
- One shared `HttpRequest` object is simplest; if reads and writes overlap, use a
  second object or serialize them.
- Use the `grenton/AC_<id>_*` keys (the two-way objects LSH already builds) or the
  raw `tuya/<id>` device with its own sensor paths — either works.

**Ready-made script for the three klimas** (`bf0sim0klima`, `…2`, `…3` — salon,
sypialnia, biuro): see [`grenton-mygrenton-klima.lua`](grenton-mygrenton-klima.lua).
It covers all 12 objects (PWR/SET/MODE/TMP ×3) with a round-robin poll and per-object
command handlers — set `LSH_URL`/`TOKEN` and map the `*_VO` names to the virtual
objects you create. The `WIRING` block at the bottom lists which event calls which
function.

### 4. Build the interface in myGrenton Builder
In Object Manager → myGrenton Builder, add a page and **widgets bound to the
virtual objects** from step 2 (a thermostat/slider for `_SET`, a toggle for
`_PWR`, a label for `_TMP`). Save and send the configuration to the GATE.

### 5. Send the interface to the phone — Grenton's own QR
In myGrenton Builder use **“send interface to mobile”**; it shows the **myGrenton
QR**. Scan *that* with the myGrenton app. Your LSH-backed objects now appear in
the app.

---

## Troubleshooting

- **myGrenton says “wrong QR”** — you scanned the LSH endpoint QR with the app.
  Use the myGrenton Builder QR for the app; the LSH QR is for the Lua script.
- **No values / command does nothing** — check from the GATE's network:
  `curl -H "Authorization: Bearer <TOKEN>" http://<LSH>:3001/api/devices/<key>?sensor=<path>`.
  A 401 means a bad/missing token; empty means the key or sensor path is wrong.
- **Works on LAN, not remotely** — the GATE reaches LSH over the LAN only. For
  remote myGrenton, the app talks through Grenton Cloud (set the CLU's `UseCloud`
  / `CloudConnection` to true); the GATE↔LSH link stays local.
- **Token** — treat it like a password; if leaked, delete it under *Users & API
  tokens* and generate a new one (regenerates the QR).
