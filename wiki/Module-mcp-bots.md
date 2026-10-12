# `src/mcp-bots.js`

‹ [Home](Home) · [Modules Index](Modules) · [AI assistants (MCP)](AI-Assistants-MCP) ›

**Category:** Security  ·  **~318 lines**

MCP bots — one credential and policy per AI assistant for [`mcp-server.js`](Module-mcp-server), plus the OAuth 2.1 grant store used by `src/routes/mcp-oauth.js`.

| Piece | Details |
|---|---|
| Bot policy | `access` (`read` \| `control`), `rooms`, `devices`, `sensitive`, `enabled`, `client` (claude / gemini / chatgpt / other) |
| Static token | `lshb_` + 256-bit random; SHA-256 hash stored; shown once; rotate / disable / remove |
| OAuth | public clients (DCR), codes (10 min, single use, PKCE S256), access tokens `lsha_` (1 h), refresh tokens `lshr_` (30 d, rotated) — all hashed, bound to a bot |
| Sensitive devices | types `satel`, `dsc`, `sip`, `tedee`, `yale`, `unifiaccess`, …, HomeKit `lock-rw` / `door-rw`, Sinum `gate` / `wicket`, vCLU `lock` / `garage_door`, and controllable paths like `lock`, `arm`, `door`, `gate`, `garage` |
| Limits | 120 tool calls / min per bot; 20 bad credentials / 10 min per IP → lockout |
| Audit | in-memory ring of the last 500 calls (`GET /api/mcp-bots/audit`) |
| Storage | `persist/mcp-bots.json`, mode 0600, atomic writes |

**Routes** (`src/routes/mcp-server.js`, signed-in admin session only): `GET/POST /api/mcp-bots`, `PUT/DELETE /api/mcp-bots/:id`, `POST /api/mcp-bots/:id/rotate`, `POST /api/mcp-bots/:id/revoke-oauth`, `GET /api/mcp-bots/audit`, `POST /api/settings/mcp`.

**Tests:** `test/mcp-bots.test.js` (policy, auth, lockout, rate limit, full OAuth flow with PKCE and refresh rotation).

*Extracted from `src/mcp-bots.js`. Source is authoritative — regenerate this page if the module changes.*
