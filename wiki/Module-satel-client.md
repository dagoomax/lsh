# `src/satel-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~467 lines**

Speaks the **Satel INTEGRA binary TCP protocol** (default port 7094). Uses the `new_data` (`0x7F`) command in a self-scheduling loop (~300 ms, no overlapping requests) so zone/output/partition state changes surface within a fraction of a second. Zone, output, and partition names are downloaded from the panel on connect (`0xEE`, CP1250-decoded); config `*Names` maps override them.

Wire protocol uses CRC-16 with `0xFE` byte-stuffing. Reconnects automatically after 30 s on connection loss.

**Config:**
```json
"satel": {
  "host": "192.168.1.100", "port": 7094, "armCode": "1234",
  "zoneCount": 64,
  "zoneNames": { "1": "Front Door" },
  "partitions": [1], "partitionNames": { "1": "House" }
}
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class SatelClient` |
| Config section(s) | `satel` |
| Platform-status key | `satel` |
| Device key prefix | `satel/…` |
| Store keys written | `satel/zone`, `satel/partition`, `satel/output` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status` |
| Node built-ins | `net`, `events` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `satel` section.

---

*Extracted from `src/satel-client.js`. Source is authoritative — regenerate this page if the module changes.*
