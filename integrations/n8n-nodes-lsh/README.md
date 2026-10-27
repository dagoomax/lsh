# n8n-nodes-lsh

n8n community nodes for [LSH](https://github.com/dagoomax/lsh).

- **LSH** — Device: Send Command, Get Value, Get, Get Many · Scene: Run, Get Many · Flow: Run, Get Many
- **LSH Trigger** — starts a workflow when device values change. Activating the workflow registers
  its webhook in LSH (`POST /api/webhooks`), deactivating removes it. Deliveries are signed
  (`X-LSH-Signature: sha256=<HMAC of the body>`) and checked by the node.

## Install

Download the package from LSH (Settings → n8n & Webhooks → Download the n8n nodes), then:

```bash
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes
npm install /path/to/n8n-nodes-lsh-0.1.0.tgz
# restart n8n
```

With Docker, mount `~/.n8n` (the default `/home/node/.n8n` volume) and run the install inside it.

## Credentials

**LSH API**: the LSH address n8n can reach (e.g. `http://lsh.local:3000`) and an API token from
LSH → Settings → Security & Authentication → API tokens. Commands, scenes and the trigger need an
admin token.

The trigger also needs LSH to reach n8n's webhook URL — set `WEBHOOK_URL` in n8n when it runs behind
a proxy or in Docker.

## Trigger output

One item per change (or one per delivery, with a `changes` list):

```json
{ "event": "change", "hub": "Casablanca", "key": "shelly/plug-1/power", "value": 1800, "previous": 4,
  "at": "2026-10-27T07:00:00.000Z", "device": "shelly/plug-1", "deviceLabel": "Kettle plug",
  "room": "Kitchen", "sensor": "power", "sensorLabel": "Power", "unit": "W" }
```

Watch devices (all their values, or the ones listed under *Values*) and/or key patterns:
`*` matches one segment, `**` any number (`shelly/*/power`, `airbnb/**`, `**` for everything).
