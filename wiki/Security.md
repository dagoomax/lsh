# Security & Authentication

‹ [Home](Home) · [Configuration](Configuration) · [REST API](REST-API) ›

## Security & Auth

### User Accounts

- Create the admin account on first run at `/setup.html`
- Additional users (admin or viewer role) can be added in **Settings → Security → Users**
- Passwords are bcrypt-hashed with 12 salt rounds and stored in `persist/users.json`
- Sessions use JWT cookies (`lsh-session`, 7-day TTL, `httpOnly`, `sameSite: strict`)

### API Tokens

Static bearer tokens for script / Home Assistant integration:

```http
Authorization: Bearer <token>
```

Create tokens in **Settings → Security → API Tokens**. Tokens are stored as plain hex in `persist/api-tokens.json` — treat them like passwords.

### Role Permissions

| Role | Dashboard | Settings | Relay control |
|---|---|---|---|
| `admin` | ✓ | ✓ | ✓ |
| `viewer` | ✓ | ✗ | ✗ |

---
