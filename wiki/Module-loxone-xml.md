# `src/loxone-xml.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Loxone  ·  **~118 lines**

Loxone Config XML template generator (Miniserver / Loxone Config 17.1).

Generates ready-to-import Virtual Output / Virtual HTTP Input templates for
LSH devices, in the exact format proven by the hand-built templates
(VirtualOut driving /api/device/<key>/set, VirtualInHttp polling
/api/devices with a JSON substring Check ending in `"value":\v`).

## At a glance

| Aspect | Value |
|---|---|
| Exports | `buildInputsXml`, `buildOutputsXml` |
| Internal deps | — |

---

*Extracted from `src/loxone-xml.js`. Source is authoritative — regenerate this page if the module changes.*
