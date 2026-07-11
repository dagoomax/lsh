# Somfy (casablanca) ↔ LSH HTTP API

Token-authenticated per-cover endpoints for the casablanca TaHoma covers,
including the **`my`** favourite (Somfy remote middle button). Loxone-friendly
(GET only): **Virtual Output** for commands, **Virtual HTTP Input** for status.

## Authentication

Append `?token=<TOKEN>` to every URL. Manage tokens in the dashboard
**Settings → API tokens** (the `loxone` token works here too).

- LSH base URL: `http://192.168.1.229:3001`

## Endpoints

```
GET /api/somfy/devices?token=<TOKEN>                     # list covers
GET /api/somfy/<id>/status?token=<TOKEN>                 # { position, tilt }
GET /api/somfy/<id>/cmd/<action>?token=<TOKEN>           # command
```

| Action | URL suffix | Notes |
|---|---|---|
| Open        | `/cmd/open` | fully up |
| Close       | `/cmd/close` | fully down |
| Stop        | `/cmd/stop` | halt in motion |
| **My**      | `/cmd/my` | move to stored favourite |
| Position    | `/cmd/position?value=0..100` | io covers (0 = closed, 100 = open) |
| Tilt        | `/cmd/tilt?value=0..100` | io venetian slats (0 = closed, 100 = open) |

`open`/`close`/`stop`/`my` work on all covers (io + rts); `position`/`tilt`
only on io covers.

## Covers (`<id>`)

| id | Label | Type |
|---|---|---|
| 11600128 | Ogród front | io |
| 12851042 | Ogród front praw | io |
| 15350050 | Pergola | io |
| 15773918 | Ogród lewy front | io |
| 16201055 | Sypialnia pole | io |
| 2826492 | Ogród lewa | io |
| 3073581 | Sypialnia droga | io |
| 5634152 | Roleta gościnny | io |
| 9471579 | Korytarz | io |
| 9534217 | Blanka | io |
| 16714763 | Żaluzja ogród | rts |
| 16725287 | Żagiel taras na dole | rts |
| 16743992 | RTS (16743992) | rts |
| 16762043 | Żagiel taras góra | rts |

## Loxone wiring

- **Commands** — one **Virtual Output** (Address `http://192.168.1.229:3001`),
  a Virtual Output Command per action, e.g. *Command for ON*:
  `/api/somfy/2826492/cmd/my?token=<TOKEN>`
- **Status** — a **Virtual HTTP Input** polling
  `/api/somfy/<id>/status?token=<TOKEN>`, with recognition `"position":\v`
  and `"tilt":\v`.

## Examples

```
# Move "Ogród lewa" to its My favourite
http://192.168.1.229:3001/api/somfy/2826492/cmd/my?token=<TOKEN>

# Bedroom blind to 50 %
http://192.168.1.229:3001/api/somfy/3073581/cmd/position?value=50&token=<TOKEN>

# Stop the awning
http://192.168.1.229:3001/api/somfy/16762043/cmd/stop?token=<TOKEN>
```

The generic per-sensor API and the Loxone XML export
(`/api/loxone/outputs.xml?type=somfy`) also expose these controls — see
[`lsh-api-endpoints.md`](lsh-api-endpoints.md).
