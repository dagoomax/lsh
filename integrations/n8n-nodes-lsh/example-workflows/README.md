# LSH hotel automation — starter n8n workflows

Four importable workflows, one per LSH hotel event (the "skills"). Each is a
Webhook trigger → a Code node that turns the LSH payload into a ready-to-send
`$json.summary` line → a NoOp placeholder, with a sticky note telling you where
to connect your notifier (Slack / Telegram / Gmail) or an HTTP Request back into
LSH to run a scene.

| File | LSH event(s) | Webhook path |
|------|--------------|--------------|
| `lshRsOrder.json` | `room-service.order` | `/webhook/lsh-room-service-order` |
| `lshRsEscalation.json` | `room-service.escalation` | `/webhook/lsh-room-service-escalation` |
| `lshArrival.json` | `hotel.checkin`, `hotel.checkout` | `/webhook/lsh-hotel-arrival-departure` |
| `lshDailyReport.json` | `hotel.daily-report` | `/webhook/lsh-daily-report` |

## Additional hotel services

Deeper operational workflows (files prefixed `svc-`):

| File | Trigger | What it does |
|------|---------|--------------|
| `svc-guest-welcome-check-in.json` | `hotel.checkin` | Builds a guest welcome (room, nights, computed checkout date) → send via SMS/email/in-room display |
| `svc-housekeeping-turnover-check-out.json` | `hotel.checkout` | Emits a turnover/cleaning task for the vacated room → housekeeping board |
| `svc-order-routing-kitchen-bar-amenities.json` | `room-service.order` | Classifies order items into kitchen / bar / amenities, one group per team/printer |
| `svc-front-desk-morning-board.json` | Schedule 07:00 | Pulls live occupancy from LSH `/api/hotel/rooms` and builds a morning board. **Needs an LSH-token Header-Auth credential attached to the HTTP node, then activate.** |

Events can fan out to several workflows — e.g. `room-service.order` drives both the staff alert and the routing workflow; `hotel.checkin` drives both the arrival scene and the guest welcome. Just add one LSH hook per workflow with the same event.

## Guest-facing (multilingual, all 7 LSH languages)

| File | Trigger | What it does |
|------|---------|--------------|
| `svc-guest-onboarding-all-languages.json` | `hotel.checkin` | Renders the welcome + house info (room, checkout date, Wi-Fi/door-code pointer, room service, guest portal, city) in en/pl/de/fr/es/it/uk — `$json.localized` per language, `$json.allLanguages` as one block. **No LLM.** Active. |
| `svc-concierge-agent-claude.json` | Chat Trigger | AI concierge: Chat Trigger → AI Agent ← Claude (Anthropic). Replies in the guest's language across all 7 LSH languages, grounded in the hotel info. **Needs an Anthropic credential** on the model node, then activate (set the Chat Trigger to Public for a guest URL). Created inactive. |

The concierge has no LLM credential wired because the instance has none — attach an Anthropic API credential to the "Claude" node in the n8n UI, pick the model, and activate. Optional: add an HTTP Request tool pointing at `GET /api/order/menu` (public) so it can quote the live room-service menu.

## Deploy

```bash
n8n import:workflow --separate --input=./example-workflows
n8n update:workflow --id=lshRsOrder      --active=true
n8n update:workflow --id=lshRsEscalation --active=true
n8n update:workflow --id=lshArrival      --active=true
n8n update:workflow --id=lshDailyReport  --active=true
# restart n8n so the active webhooks register
```

Then in LSH (Settings → Home → **Hotel Automation (n8n)**) add one hook per
workflow with its URL — same-machine, so `http://127.0.0.1:5678/webhook/<path>`
is fine (no TLS needed server-to-server) — and the matching event(s).

The payload each workflow receives is `{ event, hub, sentAt, data }`; the LSH
`data` shape per event is documented in `core-go/n8n.go` / `src/n8n.js`.
Deliveries are signed with `X-LSH-Signature` (HMAC-SHA256) when the hook has a
secret — add a verification Code node if you expose the webhook beyond
localhost.
