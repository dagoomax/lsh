# Somfy TaHoma — local API reference (Developer Mode token)

Local Overkiz `enduserAPI` on the casablanca TaHoma box. Endpoints verified live
against the box (✅ = returned 200).

**Box:** `192.168.1.105:8443` · gateway PIN `2028-5589-5601`
**Base:** `https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI`
**Auth header (every request):** `Authorization: Bearer 6a428e3946d66be54591`
**TLS:** self-signed cert → `curl -k` (`-sk`).

> The box is only reachable on the LSH LAN. From outside, wrap each call:
> `ssh casablanca "curl -sk -H 'Authorization: Bearer 6a428e3946d66be54591' <url>"`
> (casablanca = the LSH host at 192.168.1.229, on the same LAN as the box.)

For the device inventory and live readings see
[`somfy-devices-casablanca.md`](somfy-devices-casablanca.md).

## Endpoints (full HTTP strings)

```
GET    https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/apiVersion                                    # ✅ local API version
GET    https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup                                         # ✅ full setup (gateways + devices + states)
GET    https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/gateways                                # ✅ gateway/box info (PIN, firmware, connectivity)
GET    https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices                                 # ✅ all devices (definitions + inline states)
GET    https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/{deviceURL}                     # ✅ one device (definition + states)
GET    https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/{deviceURL}/states              # ✅ one device's live states
GET    https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/{deviceURL}/states/{stateName}  # ✅ one single state
POST   https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/exec/apply                                    # ✅ run commands (body = action list)
GET    https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/exec/current                                  # ✅ all executions in progress
GET    https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/exec/current/setup                            # ✅ executions on this setup
DELETE https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/exec/current                                  # cancel all running executions
DELETE https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/exec/current/setup/{execId}                   # cancel one execution
POST   https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/events/register                               # ✅ create listener -> { "id": "…" }
POST   https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/events/{listenerId}/fetch                     # ✅ poll queued events
POST   https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/events/{listenerId}/unregister                # ✅ tear down listener
```

`{deviceURL}` must be URL-encoded (`io://…` → `io%3A%2F%2F…`). `{stateName}` too
(e.g. `core:ClosureState` → `core%3AClosureState`).

## Per-device states — full URLs (URL-encoded)

```
GET https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/io%3A%2F%2F2028-5589-5601%2F11600128/states   # Ogród front
GET https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/io%3A%2F%2F2028-5589-5601%2F12851042/states   # Ogród front praw
GET https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/io%3A%2F%2F2028-5589-5601%2F15773918/states   # Ogród lewy front
GET https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/io%3A%2F%2F2028-5589-5601%2F2826492/states    # Ogród lewa
GET https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/io%3A%2F%2F2028-5589-5601%2F16201055/states   # Sypialnia pole
GET https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/io%3A%2F%2F2028-5589-5601%2F3073581/states    # Sypialnia droga
GET https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/io%3A%2F%2F2028-5589-5601%2F5634152/states    # Roleta gościnny
GET https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/io%3A%2F%2F2028-5589-5601%2F9471579/states    # Korytarz
GET https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/io%3A%2F%2F2028-5589-5601%2F9534217/states    # Blanka
GET https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/io%3A%2F%2F2028-5589-5601%2F15350050/states   # Pergola
GET https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/rts%3A%2F%2F2028-5589-5601%2F16714763/states  # Żaluzja ogród
GET https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/rts%3A%2F%2F2028-5589-5601%2F16725287/states  # Żagiel taras na dole
GET https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/rts%3A%2F%2F2028-5589-5601%2F16743992/states  # RTS screen
GET https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/setup/devices/rts%3A%2F%2F2028-5589-5601%2F16762043/states  # Żagiel taras góra
```

RTS covers (last four) are one-way — their `/states` returns `[]` (no feedback).

## Command body (`POST /exec/apply`)

```
POST https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI/exec/apply
Authorization: Bearer 6a428e3946d66be54591
Content-Type: application/json

{"label":"cmd","actions":[{"deviceURL":"io://2028-5589-5601/11600128","commands":[{"name":"setPosition","parameters":[50]}]}]}
```

**Command names:** `open` · `close` · `stop` · `my` · `setPosition [0–100]` (0=closed) ·
`setClosure [0–100]` (0=open) · `setOrientation [0–100]` (tilt) ·
`setClosureAndOrientation [closure,orient]` · `up` / `down` · `tiltUp` / `tiltDown` ·
`identify` / `wink`. io covers support the full set; RTS covers accept
open/close/up/down/my/stop only.

## Worked examples (from outside the LAN, via casablanca)

```bash
B="https://192.168.1.105:8443/enduser-mobile-web/1/enduserAPI"
H="Authorization: Bearer 6a428e3946d66be54591"

ssh casablanca "curl -sk -H '$H' $B/apiVersion"
ssh casablanca "curl -sk -H '$H' $B/setup/gateways"
ssh casablanca "curl -sk -H '$H' $B/setup/devices"

# one device state / single state
ssh casablanca "curl -sk -H '$H' $B/setup/devices/io%3A%2F%2F2028-5589-5601%2F11600128/states"
ssh casablanca "curl -sk -H '$H' $B/setup/devices/io%3A%2F%2F2028-5589-5601%2F11600128/states/core%3AClosureState"

# command: set position 50 %
ssh casablanca "curl -sk -X POST -H '$H' -H 'Content-Type: application/json' $B/exec/apply \
  -d '{\"label\":\"cmd\",\"actions\":[{\"deviceURL\":\"io://2028-5589-5601/11600128\",\"commands\":[{\"name\":\"setPosition\",\"parameters\":[50]}]}]}'"

# events: register -> fetch -> unregister
ssh casablanca "curl -sk -X POST -H '$H' $B/events/register"
ssh casablanca "curl -sk -X POST -H '$H' $B/events/<listenerId>/fetch"
ssh casablanca "curl -sk -X POST -H '$H' $B/events/<listenerId>/unregister"
```

Note: `GET /events` (bare) and `/setup/devices/controllables` return 400 — not valid
paths on this box.
