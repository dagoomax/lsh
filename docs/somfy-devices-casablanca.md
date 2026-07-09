# Somfy devices — casablanca (TaHoma)

**Box:** casablanca · gateway PIN `2028-5589-5601`
**Region:** europe

**Bases**
- Local: `https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI`
- Cloud: `https://ha101-1.overkiz.com/enduser-mobile-web/enduserAPI`

Commands for every cover use the shared endpoint `POST {base}/exec/apply` (deviceURL supplied in the body).

Total devices from setup: **24** (14 controllable covers).

## Controllable covers (14)

| # | Label | uiClass | Proto | deviceURL | Avail | States endpoint (URL-encoded) |
|---|-------|---------|-------|-----------|:-----:|-------------------------------|
| 1 | Ogród front | ExteriorVenetianBlind | io | `io://2028-5589-5601/11600128` | ✅ | `GET {base}/setup/devices/io%3A%2F%2F2028-5589-5601%2F11600128/states` |
| 2 | Ogród front praw | ExteriorVenetianBlind | io | `io://2028-5589-5601/12851042` | ✅ | `GET {base}/setup/devices/io%3A%2F%2F2028-5589-5601%2F12851042/states` |
| 3 | Ogród lewy front | ExteriorVenetianBlind | io | `io://2028-5589-5601/15773918` | ✅ | `GET {base}/setup/devices/io%3A%2F%2F2028-5589-5601%2F15773918/states` |
| 4 | Ogród lewa | ExteriorVenetianBlind | io | `io://2028-5589-5601/2826492` | ✅ | `GET {base}/setup/devices/io%3A%2F%2F2028-5589-5601%2F2826492/states` |
| 5 | Sypialnia pole | ExteriorVenetianBlind | io | `io://2028-5589-5601/16201055` | ✅ | `GET {base}/setup/devices/io%3A%2F%2F2028-5589-5601%2F16201055/states` |
| 6 | Sypialnia droga | ExteriorVenetianBlind | io | `io://2028-5589-5601/3073581` | ✅ | `GET {base}/setup/devices/io%3A%2F%2F2028-5589-5601%2F3073581/states` |
| 7 | Roleta gościnny | ExteriorVenetianBlind | io | `io://2028-5589-5601/5634152` | ✅ | `GET {base}/setup/devices/io%3A%2F%2F2028-5589-5601%2F5634152/states` |
| 8 | Blanka | ExteriorVenetianBlind | io | `io://2028-5589-5601/9534217` | ✅ | `GET {base}/setup/devices/io%3A%2F%2F2028-5589-5601%2F9534217/states` |
| 9 | Korytarz | ExteriorVenetianBlind | io | `io://2028-5589-5601/9471579` | ⚠️ offline | `GET {base}/setup/devices/io%3A%2F%2F2028-5589-5601%2F9471579/states` |
| 10 | Pergola | Pergola | io | `io://2028-5589-5601/15350050` | ⚠️ offline | `GET {base}/setup/devices/io%3A%2F%2F2028-5589-5601%2F15350050/states` |
| 11 | Żaluzja ogród | VenetianBlind | rts | `rts://2028-5589-5601/16714763` | ✅ | `GET {base}/setup/devices/rts%3A%2F%2F2028-5589-5601%2F16714763/states` |
| 12 | Żagiel taras na dole | RollerShutter | rts | `rts://2028-5589-5601/16725287` | ✅ | `GET {base}/setup/devices/rts%3A%2F%2F2028-5589-5601%2F16725287/states` |
| 13 | RTS (16743992) | ExteriorScreen | rts | `rts://2028-5589-5601/16743992` | ✅ | `GET {base}/setup/devices/rts%3A%2F%2F2028-5589-5601%2F16743992/states` |
| 14 | Żagiel taras góra | Awning | rts | `rts://2028-5589-5601/16762043` | ✅ | `GET {base}/setup/devices/rts%3A%2F%2F2028-5589-5601%2F16762043/states` |

Notes:
- **io** covers support `setPosition` / `my` / `stop` and report full position feedback.
- **rts** covers are one-way — `open` / `close` / `my` / `stop` only, no reliable position feedback.
- Korytarz and Pergola are currently `available: false` (offline/unreachable to the box).

## Other devices (not covers — no cover control)

| Label | uiClass | deviceURL | States endpoint (URL-encoded) |
|-------|---------|-----------|-------------------------------|
| LIGHT VAR io | Light | `io://2028-5589-5601/6616650` | `GET {base}/setup/devices/io%3A%2F%2F2028-5589-5601%2F6616650/states` |
| Box | Pod | `internal://2028-5589-5601/pod/0` | `GET {base}/setup/devices/internal%3A%2F%2F2028-5589-5601%2Fpod%2F0/states` |
| INTERNAL wifi | Wifi | `internal://2028-5589-5601/wifi/0` | `GET {base}/setup/devices/internal%3A%2F%2F2028-5589-5601%2Fwifi%2F0/states` |
| HOMEKIT (stack) | ProtocolGateway | `homekit://2028-5589-5601/stack` | `GET {base}/setup/devices/homekit%3A%2F%2F2028-5589-5601%2Fstack/states` |
| IO (10271951) | ProtocolGateway | `io://2028-5589-5601/10271951` | `GET {base}/setup/devices/io%3A%2F%2F2028-5589-5601%2F10271951/states` |
| ZIGBEE (65535) | ProtocolGateway | `zigbee://2028-5589-5601/65535` | `GET {base}/setup/devices/zigbee%3A%2F%2F2028-5589-5601%2F65535/states` |
| OGP KNX Bridge | ProtocolGateway | `ogp://2028-5589-5601/00000BE8` | `GET {base}/setup/devices/ogp%3A%2F%2F2028-5589-5601%2F00000BE8/states` |
| OGP Sonos Bridge | ProtocolGateway | `ogp://2028-5589-5601/0003FEF3` | `GET {base}/setup/devices/ogp%3A%2F%2F2028-5589-5601%2F0003FEF3/states` |
| OGP Siegenia Bridge | ProtocolGateway | `ogp://2028-5589-5601/039575E9` | `GET {base}/setup/devices/ogp%3A%2F%2F2028-5589-5601%2F039575E9/states` |
| OGP Intesis Bridge | ProtocolGateway | `ogp://2028-5589-5601/09E45393` | `GET {base}/setup/devices/ogp%3A%2F%2F2028-5589-5601%2F09E45393/states` |

`{base}` = local `https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI` or cloud `https://ha101-1.overkiz.com/enduser-mobile-web/enduserAPI`. Gateways/Pod/Wifi expose diagnostic states (e.g. RSSI, connectivity) rather than controllable ones; `LIGHT VAR io` is a dimmable light (`core:LightIntensityState`, `core:OnOffState`) that the dashboard does not register as a cover.

## API endpoints (reference)

| Method | Path (relative to base) | Purpose |
|--------|-------------------------|---------|
| POST | `/login` | Cookie auth (local, email + password) → `JSESSIONID` |
| GET | `/setup/devices` | Discover all devices |
| GET | `/setup/devices/{deviceURL}/states` | Read one device's states |
| POST | `/exec/apply` | Send commands |
| POST | `/events/register` | Register event listener (token mode) |
| POST | `/events/{listenerId}/fetch` | Poll for state-change events |
| POST | `/events/{listenerId}/unregister` | Tear down listener |

### Command body (shared `/exec/apply`)

```json
{
  "label": "cmd",
  "actions": [
    {
      "deviceURL": "io://2028-5589-5601/11600128",
      "commands": [ { "name": "open|close|my|stop|setPosition", "parameters": [50] } ]
    }
  ]
}
```

Position semantics: `setPosition` → 0 = closed, 100 = open; `setClosure` → 0 = open, 100 = closed.

---

## Live readings — 2026-07-09 19:59 CEST (cloud)

Open % = 100 − ClosureState.

### io covers (with feedback)

| Label | Status | Closure | Open % | Slate° | Moving | RSSI |
|-------|--------|:-------:|:------:|:------:|:------:|:----:|
| Ogród front | available | 97 | 3% (nearly closed) | 0 | no | 72 |
| Ogród front praw | available | 0 | 100% (fully open) | 0 | no | 98 |
| Ogród lewy front | available | 98 | 2% (nearly closed) | 0 | no | 92 |
| Ogród lewa | available | 70 | 30% | 0 | no | 90 |
| Sypialnia pole | available | 97 | 3% (nearly closed) | 0 | no | 56 |
| Sypialnia droga | available | 100 | 0% (closed) | 0 | no | 52 |
| Roleta gościnny | available | 100 | 0% (closed) | 0 | no | 26 |
| Blanka | available | 0 | 100% (open) | 24 | no | 44 |
| Korytarz | unavailable | 99 | 1% (last known) | 0 | no | 34 |
| Pergola | unavailable | — | no closure data | 44 | — | 26 |

Note: Ogród lewa shows Closure 70 but TargetClosure 0 — settled at 30% open (not moving).

### rts covers (no feedback — one-way)

| Label | uiClass | State |
|-------|---------|-------|
| Żaluzja ogród | VenetianBlind | no states reported |
| Żagiel taras na dole | RollerShutter | no states reported |
| RTS (16743992) | ExteriorScreen | no states reported |
| Żagiel taras góra | Awning | no states reported |

RTS is one-way RF — the box has no position feedback for these four (empty state list is expected).
