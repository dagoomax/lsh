# `src/auth.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Security  ·  **~247 lines**

Full authentication system: user accounts, JWT session cookies, and static API bearer tokens.

- **Users** — stored in `persist/users.json` (bcrypt-hashed passwords, roles: `admin` / `viewer`)
- **Sessions** — JWT in an `httpOnly` cookie (`lsh-session`), 7-day TTL, auto-signed with a secret persisted in `config.json`
- **API tokens** — random 32-byte hex strings stored in `persist/api-tokens.json`; sent as `Authorization: Bearer <token>` header

**Public paths** (no auth required): `/login.html`, `/setup.html`, `/login.js`, `/setup.js`, `/theme.js`, `/common.js`, `/i18n.js`, `/i18n/*.json`, all `.css`, `.svg`, `.ico`, `/api/auth/login`, `/api/auth/setup`

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `auth` |
| Config section(s) | `json` |
| Internal deps | — |
| npm packages | `bcryptjs`, `jsonwebtoken` |
| Node built-ins | `fs`, `path`, `crypto` |

See the [Configuration Reference](Configuration) for the `json` section.

---

*Extracted from `src/auth.js`. Source is authoritative — regenerate this page if the module changes.*
