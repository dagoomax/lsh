# AI assistants (MCP)

‹ [Home](Home) · [Security](Security) · [Modules Index](Modules) ›

LSH can be driven by AI assistants — **Claude**, **Gemini**, **ChatGPT** or any other [MCP](https://modelcontextprotocol.io) client — through its MCP server at `POST /api/mcp`. Tools: `list_devices`, `get_device`, `send_command`, `get_history`, `list_rooms`, `list_platform_status`, `list_scenes`, `run_scene`.

## 1. Turn it on

Settings → Security → **MCP Server & AI bots** → *Enable MCP server* → Save → restart LSH (`"mcp": { "enabled": true }`).

## 2. Create one bot per assistant

Every assistant gets its own **bot** — never an LSH API token (an API token is admin for the whole REST API). A bot credential works **only** on `/api/mcp` and only within the bot's policy:

| Setting | Effect |
|---|---|
| **Read only** | sees devices, history, scenes; the write tools aren't even offered |
| **Control** | may switch devices and run scenes |
| **Rooms** | limit the bot to some rooms — other devices (and their history) don't exist for it |
| **Allow locks, alarm, gates and doors** | off by default: locks, alarm panels (Satel, DSC), gates / garage / doors / wickets and the doorbell stay read-only, and scenes that would touch them are refused (nested scenes too) |

Plus, for every bot: 120 tool calls per minute; 20 bad credentials from one IP lock that IP out for 10 minutes; requests carrying another site's `Origin` are refused; every call is logged (*Show recent bot activity*, refusals and writes also in the server log). Disable, issue a new token, or remove a bot at any time.

Bot tokens (`lshb_…`, 256-bit) are shown **once** and stored only as SHA-256 hashes (`persist/mcp-bots.json`, mode 0600). Bots can be managed only from a signed-in admin session — an API token can't create them.

## 3. Connect the assistant

The settings page shows the exact snippet when you create a bot.

**Claude Code**
```bash
claude mcp add --transport http lsh https://your-lsh-host/api/mcp --header "Authorization: Bearer lshb_…"
```

**Claude Desktop** — `claude_desktop_config.json`
```json
{ "mcpServers": { "lsh": { "command": "npx", "args": ["-y", "mcp-remote", "https://your-lsh-host/api/mcp", "--header", "Authorization:${LSH_AUTH}"], "env": { "LSH_AUTH": "Bearer lshb_…" } } } }
```

**Gemini CLI** — `~/.gemini/settings.json`, token in the environment (`export LSH_MCP_TOKEN=lshb_…`)
```json
{ "mcpServers": { "lsh": { "httpUrl": "https://your-lsh-host/api/mcp", "headers": { "Authorization": "Bearer $LSH_MCP_TOKEN" } } } }
```

**ChatGPT** (Developer mode → custom connector) and **claude.ai** (Settings → Connectors → custom connector) can't send a fixed token — they use **OAuth**:

1. LSH must be reachable over **HTTPS** (Tailscale Funnel, a reverse proxy, or LSH's own TLS — see [Remote Access](Remote-Access-and-Security)). Put that address in *Public HTTPS address* (`mcp.publicUrl`).
2. Add the connector with URL `https://your-lsh-host/api/mcp`, authentication **OAuth**.
3. The assistant sends you to LSH. Signed in as an **admin**, pick the bot it will act as and **Approve**.

The connector then has exactly that bot's permissions. Disabling or removing the bot — or *Sign out OAuth* — cuts it off.

## How the OAuth side works

`src/routes/mcp-oauth.js` implements OAuth 2.1 for public clients: the 401 from `/api/mcp` carries `WWW-Authenticate: Bearer resource_metadata=…`; discovery at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`; dynamic client registration (`/oauth/register`, https or localhost redirect URIs only); `/oauth/authorize` consent behind LSH's login (frame-blocked, same-origin form, one-time request id); authorization code + **PKCE S256 only**, exact redirect-URI match, single-use 10-minute codes; `/oauth/token` issues 1-hour access tokens (`lsha_…`) and 30-day refresh tokens (`lshr_…`) rotated on every use; `/oauth/revoke`. Everything is refused over plain http except on localhost.

## Legacy API tokens

Older setups that point an assistant at `/api/mcp` with an LSH API token stop working — create a bot instead. To keep an old setup running temporarily, turn on *Also accept plain API tokens* (`mcp.allowApiTokens: true`); that gives the assistant full admin-level MCP access, without any of the limits above.

---

Modules: [`mcp-server.js`](Module-mcp-server) · [`mcp-bots.js`](Module-mcp-bots)
