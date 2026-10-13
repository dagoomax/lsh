# `src/airplay-pairing.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Media  ·  **~112 lines**

Remembered AirPlay 2 pairings — so an Apple TV / HomePod that asks for a PIN (on-screen code, "first time only") or an AirPlay password is paired once and then accepts LSH without asking again.

@lox-audioserver/node-airplay-sender can do the HomeKit pair-setup (with the PIN the Apple TV shows) but makes up a fresh identity every session and forgets it, so the TV would ask for a new PIN every time. This module patches its RTSP client (the library has no hook for it):

- after a successful pair-setup it saves the identity LSH used (pairing id

```
  + Ed25519 key) and the device's long-term public key, per speaker;
```

- on the next connection to that speaker it skips pair-setup and goes

```
  straight to pair-verify with the saved identity — no PIN.
```

Stored in persist/airplay-pairings.json (override LSH_AIRPLAY_PAIRINGS), file mode 600 — it's a credential.

---

| Aspect | Value |
|---|---|
| Config section(s) | — |
| Enabled when | — |
| Platform-status key | — |
| Registers devices | — |
| npm dependencies | none |
| Other files | — |
| Routes | — |
| Tests | `test/airplay-pairing.test.js` |

*Extracted from the header of `src/airplay-pairing.js`. Source is authoritative — regenerate this page if the module changes.*
