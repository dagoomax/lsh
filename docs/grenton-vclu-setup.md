# Grenton vCLU — complete config to show the LSH klimas in myGrenton

Everything to configure on the **Grenton vCLU** (or GATE) so the **myGrenton app**
controls the three Tuya air-conditioners that LSH exposes. The vCLU calls LSH over
REST; myGrenton then sees the klimas as native Grenton objects.

```
LSH  ──REST──▶  vCLU (HttpRequest + virtual objects + Lua)  ──▶  myGrenton Builder  ──QR──▶  myGrenton app
```

> myGrenton only accepts **its own** interface QR (from myGrenton Builder). The
> QR in LSH Settings is *not* for the app — it only carries the two endpoint
> values below.

A proprietary Object Manager project can't be generated from here, so this is the
exact object-by-object spec to enter in Object Manager (names match
`grenton-mygrenton-klima.lua` one-to-one).

---

## 0. Endpoint (from LSH)

| Field | Value |
|-------|-------|
| **LSH URL** | `http://192.168.1.56:3001` |
| **API token** | paste from LSH → *Settings → Grenton → Generate QR & token* |

The token is a secret and is shown once; keep it only in the vCLU config. If it
leaks, delete it under *Users & API tokens* in LSH and generate a new one.

---

## 1. HttpRequest objects (2)

| Object name | Purpose | Method | Base URL | Headers |
|-------------|---------|--------|----------|---------|
| `LSH_HTTP`     | reads (round-robin) | GET  | set per request in Lua | `Authorization: Bearer <TOKEN>` |
| `LSH_HTTP_CMD` | commands (fire-and-forget) | POST | set per request in Lua | `Authorization: Bearer <TOKEN>`, `Content-Type: application/json` |

If your firmware configures URL/headers on the object instead of in Lua, set the
`Authorization` header here and leave the Lua `SetRequestHeader` calls as backup.

## 2. Timer (1)

| Object name | Type | Period | Event |
|-------------|------|--------|-------|
| `LSH_POLL_TIMER` | Timer | 1 s, repeating | `OnTimer → pollTick` |

## 3. Virtual objects (12 — 4 per klima)

Create these exact names. "RW" ones drive a command on `OnChange`; `_TMP` is read-only.

### Klima salon — LSH `tuya/bf0sim0klima`
| Object | Widget type | Range | R/W | OnChange → |
|--------|-------------|-------|-----|------------|
| `KLIMA_SALON_PWR_VO`  | switch | 0/1   | RW | `cmdSalonPwr` |
| `KLIMA_SALON_SET_VO`  | slider | 16–31 | RW | `cmdSalonSet` |
| `KLIMA_SALON_MODE_VO` | slider | 0–4   | RW | `cmdSalonMode` |
| `KLIMA_SALON_TMP_VO`  | value  | —     | R  | — |

### Klima sypialnia — LSH `tuya/bf0sim0klima2`
| Object | Widget type | Range | R/W | OnChange → |
|--------|-------------|-------|-----|------------|
| `KLIMA_SYPIALNIA_PWR_VO`  | switch | 0/1   | RW | `cmdSypialniaPwr` |
| `KLIMA_SYPIALNIA_SET_VO`  | slider | 16–31 | RW | `cmdSypialniaSet` |
| `KLIMA_SYPIALNIA_MODE_VO` | slider | 0–4   | RW | `cmdSypialniaMode` |
| `KLIMA_SYPIALNIA_TMP_VO`  | value  | —     | R  | — |

### Klima biuro — LSH `tuya/bf0sim0klima3`
| Object | Widget type | Range | R/W | OnChange → |
|--------|-------------|-------|-----|------------|
| `KLIMA_BIURO_PWR_VO`  | switch | 0/1   | RW | `cmdBiuroPwr` |
| `KLIMA_BIURO_SET_VO`  | slider | 16–31 | RW | `cmdBiuroSet` |
| `KLIMA_BIURO_MODE_VO` | slider | 0–4   | RW | `cmdBiuroMode` |
| `KLIMA_BIURO_TMP_VO`  | value  | —     | R  | — |

Mode index: `0 cold · 1 hot · 2 wet · 3 wind · 4 auto`.

## 4. Lua script

Use [`grenton-mygrenton-klima.lua`](grenton-mygrenton-klima.lua) verbatim, with
the two constants set to:

```lua
local LSH_URL = "http://192.168.1.56:3001"
local TOKEN   = "<paste the API token from the LSH QR>"
```

Attach the script to the vCLU and send the configuration to the device.

## 5. Event wiring

| Source | Event | Calls |
|--------|-------|-------|
| `LSH_POLL_TIMER` | OnTimer | `pollTick` |
| `LSH_HTTP` | OnResponse | `onLshResponse` |
| every `*_PWR_VO` / `*_SET_VO` / `*_MODE_VO` | OnChange | its `cmd…` function (table in §3) |
| every `*_TMP_VO` | — | read-only, no event |

## 6. myGrenton Builder

Add a page per klima and bind widgets to the virtual objects:
- a **thermostat / slider** to `_SET_VO` (°C) and a label to `_TMP_VO`,
- a **toggle** to `_PWR_VO`,
- a **selector / slider** to `_MODE_VO` (0–4).

Then **send the interface to mobile** — that shows **Grenton's own QR**, which you
scan with the myGrenton app.

---

## Verify first (from the vCLU's network)

```
curl -H "Authorization: Bearer <TOKEN>" \
  "http://192.168.1.56:3001/api/devices/grenton/AC_bf0sim0klima_TMP?sensor=value"
```
A number back = reachable and authorised. `401` = bad token; empty = wrong key.

Command test (turns the salon klima on):
```
curl -X POST -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"sensor":"switch","value":true}' \
  "http://192.168.1.56:3001/api/device/tuya/bf0sim0klima/command"
```

> Firmware note: the HttpRequest object's method/header/send/response API and the
> event names vary by Grenton version — adapt the two helper functions in the Lua
> if yours differs. The object list, ranges, URL and REST paths above are exact.
