# Roborock ↔ Loxone HTTP API

Control and read the Roborock Q Revo vacuums from Loxone using token-authenticated
HTTP requests (Loxone **Virtual Output** for commands, **Virtual HTTP Input** for status).

## Authentication

Append `?token=<TOKEN>` to every URL. Manage tokens in the dashboard
**Settings → API tokens** (or `persist/api-tokens.json`). A token named `loxone`
has been created for this purpose.

- LSH base URL: `http://192.168.1.229:3001`
- Device ids (`duid`):
  - `ZXqqO8pTRE1nGvdMt639d` — Qrevo piętro (upstairs)
  - `6vXyhTPRR3gEUVvV4INscI` — Q Revo parter (downstairs)

## Status — Virtual HTTP Input

```
GET /api/roborock/<duid>/status?token=<TOKEN>
```
Returns flat JSON:
```json
{ "battery":100, "state":"Charging", "error":"None", "cleaning":0,
  "fan":3, "water":3, "clean_time":7, "clean_area":7,
  "main_brush":97, "side_brush":93, "filter":94, "sensor":74 }
```
In Loxone, add a **Virtual HTTP Input** (poll the URL above), then a **Virtual
HTTP Input Command** per value using a command recognition pattern, e.g.
- Battery:  `"battery":\v`
- Cleaning: `"cleaning":\v`
- Fan:      `"fan":\v`
- Filter:   `"filter":\v`

(`\v` extracts the numeric value that follows.)

## Commands — Virtual Output (HTTP GET)

```
GET /api/roborock/<duid>/cmd/<action>?token=<TOKEN>
```

| Action | URL suffix |
|---|---|
| Start cleaning | `/cmd/start` |
| Return to base | `/cmd/dock` |
| Pause          | `/cmd/pause` |
| Stop           | `/cmd/stop` |
| Find robot     | `/cmd/locate` |
| Empty dust bin | `/cmd/empty` |
| Wash mop       | `/cmd/wash` |
| Dry mop        | `/cmd/dry` |
| Fan speed      | `/cmd/fan?value=0..3` (Quiet/Balanced/Turbo/Max) |
| Water flow     | `/cmd/water?value=0..3` (Off/Low/Medium/High) |
| Clean rooms    | `/cmd/clean?rooms=16,17` |

In Loxone, add a **Virtual Output** with the base address `http://192.168.1.229:3001`,
then a **Virtual Output Command** whose *Command for ON* is the path above
(including `?token=…`).

## Helpers

- Room list:  `GET /api/roborock/<duid>/rooms?token=<TOKEN>` → `[{ "segmentId":16, "name":"Hol" }, …]`
- Live map:   `GET /api/roborock/<duid>/map.png?token=<TOKEN>` → PNG

## Examples

```
# Start the upstairs vacuum
http://192.168.1.229:3001/api/roborock/ZXqqO8pTRE1nGvdMt639d/cmd/start?token=<TOKEN>

# Clean kitchen + hallway downstairs
http://192.168.1.229:3001/api/roborock/6vXyhTPRR3gEUVvV4INscI/cmd/clean?rooms=16,19&token=<TOKEN>

# Set water flow to Medium
http://192.168.1.229:3001/api/roborock/ZXqqO8pTRE1nGvdMt639d/cmd/water?value=2&token=<TOKEN>
```
