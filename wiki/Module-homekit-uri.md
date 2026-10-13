# `src/homekit-uri.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** HomeKit  ·  **~43 lines**

Generates the `X-HM://` setup URI from the HomeKit PIN, setup ID and accessory category (default 2 = bridge). Used by the Settings page to display a scannable QR code via the `qrcodejs` library.

Payload (HAP §5.7.3, identical to hap-nodejs `Accessory.setupURI()`): setup code in bits 0–26, flags in 27–30 (bit 28 = HAP over IP), category in bits 31–38, base-36, padded to 9 characters, followed by the 4-character setup ID. Before October 2026 the category sat one bit too high, so iOS read the bridge (2) as a garage door opener (4) when pairing from the QR code; `test/homekit-uri.test.js` now checks the output against hap-nodejs.

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `generateSetupUri`, `generateSetupID` |
| Internal deps | — |

---

*Extracted from `src/homekit-uri.js`. Source is authoritative — regenerate this page if the module changes.*
