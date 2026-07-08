# `src/acme.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Security  ·  **~186 lines**

Obtains and auto-renews Let's Encrypt TLS certificates via the HTTP-01 ACME challenge. Temporarily binds to port 80 during initial issuance, then hands off to a permanent HTTP→HTTPS redirect server. Certificates are written to `certsDir` and renewed automatically when fewer than 30 days remain.

Requires the `acme-client` npm package. If not installed, ACME is silently disabled.

**Config keys used:** `server.letsEncrypt.*`

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `acquireCert`, `startRedirectServer`, `scheduleRenewal`, `createHttpsServerFromConfig` |
| Polling | uses `setInterval` (interval from config/default) |
| Internal deps | — |
| npm packages | `acme-client` |
| Node built-ins | `fs`, `path`, `http`, `https`, `crypto` |

---

*Extracted from `src/acme.js`. Source is authoritative — regenerate this page if the module changes.*
