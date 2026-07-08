# `src/sonos-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~300 lines**

Integrates **Sonos** speakers via the **UPnP/SOAP** control protocol over HTTP port 1400. No external npm packages required — uses only `http`, `dgram`, and `net` from Node.js stdlib.

**Discovery:** On startup, sends a UDP `M-SEARCH` multicast to `239.255.255.250:1900` targeting `urn:schemas-upnp-org:device:ZonePlayer:1`. Responses are validated by checking for `ZonePlayer` or `RINCON` in the response body and the IP is taken from `rinfo.address` (not the LOCATION header, which can be `0.0.0.0` on some networks). Discovered IPs are merged with any manually configured `hosts`.

**Room name:** Fetched from each speaker's `/xml/device_description.xml` (`<roomName>` tag) so the dashboard shows "Living Room", "Kitchen" etc. instead of raw IPs.

**State polling:** Every `pollInterval` seconds (default 5 s), fires four parallel SOAP calls:

| SOAP action | Service | Used for |
|---|---|---|
| `GetTransportInfo` | AVTransport | Play / Paused / Stopped state |
| `GetVolume` | RenderingControl | Master volume (0–100) |
| `GetMute` | RenderingControl | Mute on/off |
| `GetPositionInfo` | AVTransport | Current track metadata (DIDL-Lite) |

Track title and artist are extracted from the HTML-entity-encoded DIDL-Lite XML in `TrackMetaData` (`dc:title`, `dc:creator`).

**Commands:** `Play` / `Pause` (AVTransport), `Previous` / `Next` (AVTransport), `SetVolume` / `SetMute` (RenderingControl). State is refreshed 700 ms after each command.

**Config:** See [`sonos`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class SonosClient` |
| Config section(s) | `sonos` |
| Platform-status key | `sonos` |
| Registers devices | yes (via sensor-registry) |
| Polling | uses `setInterval` (interval from config/default) |
| Internal deps | `platform-status` |
| Node built-ins | `http`, `dgram` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `sonos` section.

---

*Extracted from `src/sonos-client.js`. Source is authoritative — regenerate this page if the module changes.*
