# `src/gree-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~204 lines**  ·  installable module `gree`

Gree air conditioners — local UDP protocol of the Gree+ / EWPE Smart apps
(as used by greeclimate). Also the many Gree-made brands on those apps:
Sinclair, Cooper&Hunter, Tosot, Bulex, Kinghome, Ekokai, Proklima,
Daitsu, Heiwa, Innova…

UDP port 7000, JSON. Every request/answer carries an AES-encrypted "pack":
```
  firmware < ~1.21  AES-128-ECB (PKCS7), generic key "a3K8Bx%2r8Y7#xDh"
  newer firmware    AES-128-GCM, generic key "{yxAHAY_Lm6pbC/<", fixed
                    nonce, aad "qualcomm-test", tag in the message's "tag"
```
scan   {"t":"scan"}                        → pack {t:"dev", mac, name, ver}
bind   pack {mac, t:"bind", uid:0}         → pack {t:"bindok", key}  (generic key)
status pack {cols:[…], mac, t:"status"}    → pack {t:"dat", cols, dat}  (device key)
cmd    pack {opt:[…], p:[…], t:"cmd"}      → pack {t:"res", opt, p}

```
  Pow 0/1 · Mod 0 auto, 1 cool, 2 dry, 3 fan, 4 heat · SetTem °C
  WdSpd 0 auto, 1 low … 5 high · Quiet · Tur(bo) · SwUpDn 0 off, 1 full swing
  TemSen room temperature (+40 offset, except v4 firmware)
```

The unit must already be on the Wi-Fi (set up once with the Gree+ / EWPE
Smart app). One LSH device per unit, `gree/<mac>`, with the shared AC model
of src/ac-common.js.

```
config.gree = { devices: [{ host, mac?, key?, encryption?: 'ecb'|'gcm', name? }], pollInterval = 15 (s) }
  mac / key are learned (scan + bind) when not given.
```
Tested against scripts/gree-simulator.js (test/gree.test.js) — not yet
against a real unit.

---

| Aspect | Value |
|---|---|
| Config section(s) | `gree` |
| Enabled when | `config.gree?.devices?.length` |
| Platform-status key | `gree` |
| Registers devices | `gree/…` |
| npm dependencies | none |
| Other files | `src/ac-common.js` `src/polling-client.js` |
| Routes | — |
| Tests | `test/gree.test.js` `scripts/gree-simulator.js` |

*Extracted from the header of `src/gree-client.js`. Source is authoritative — regenerate this page if the module changes.*
