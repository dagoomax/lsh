# Security & Authentication

‹ [Home](Home) · [Configuration](Configuration) · [REST API](REST-API) ›

## Security & Auth

### User Accounts

- Create the admin account on first run at `/react/`
- Additional users (admin or viewer role) can be added in **Settings → Security → Users**
- Passwords are bcrypt-hashed with 12 salt rounds and stored in `persist/users.json`
- Sessions use JWT cookies (`lsh-session`, 7-day TTL, `httpOnly`, `sameSite: strict`)

### API Tokens

Static bearer tokens for script / Home Assistant integration:

```http
Authorization: Bearer <token>
```

Create tokens in **Settings → Security → API Tokens**. Tokens are stored as plain hex in `persist/api-tokens.json` — treat them like passwords.

### MCP bots (AI assistants)

AI assistants never get an API token: each one gets its own **MCP bot** — a credential valid only on `/api/mcp`, with read-only / control, room scope and locks / alarm / gates / doors blocked by default, rate-limited and audited; ChatGPT and claude.ai connect through OAuth 2.1 with admin approval. See **[AI assistants (MCP)](AI-Assistants-MCP)**.

### Role Permissions

| Role | Dashboard | Settings | Relay control |
|---|---|---|---|
| `admin` | ✓ | ✓ | ✓ |
| `viewer` | ✓ | ✗ | ✗ |

---
