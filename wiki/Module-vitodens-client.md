# `src/vitodens-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~418 lines**  ·  installable module `vitodens`

Viessmann ViCare API client (Vitodens boilers, and other ViCare-connected Viessmann heating systems — the API is model-agnostic).

Auth: OAuth2 Authorization Code + PKCE, public client (no secret) — see scripts/vitodens-auth.js for the one-time bootstrap. Access tokens are short-lived (~1h); refreshed automatically here and the rotated refresh token is persisted back to persist/vitodens-tokens.json.

Sensors are NOT hardcoded from a guessed feature list. Each poll fetches every feature the installation actually reports and registers/updates whatever comes back — mirrors this codebase's Victron auto-discovery (device-definitions.js) rather than SmartThings' fixed capability table, because Viessmann's feature set varies a lot by model/firmware and a stale hardcoded list would silently show nothing on a boiler it wasn't written against. KNOWN_LABELS below only prettifies display names for common features — it's cosmetic, discovery works without it.

Writes are similarly self-describing: a feature's own `commands` object (from the live API response) carries the command name, URI, and param schema, so a command is only ever issued using values the boiler itself just advertised as valid — never a guessed command path. This matters because these commands control real heating hardware.

---

| Aspect | Value |
|---|---|
| Config section(s) | `vitodens` `vicare` |
| Enabled when | `config.vitodens?.clientId \|\| config.vicare?.clientId` |
| Platform-status key | `vitodens` |
| Registers devices | `vitodens/…` |
| npm dependencies | none |
| Other files | — |
| Routes | — |
| Tests | — |

*Extracted from the header of `src/vitodens-client.js`. Source is authoritative — regenerate this page if the module changes.*
