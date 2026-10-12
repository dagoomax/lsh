# `src/mcp-server.js`

‹ [Home](Home) · [Modules Index](Modules) · [AI assistants (MCP)](AI-Assistants-MCP) ›

**Category:** Interface  ·  **~241 lines**

The MCP server at `POST /api/mcp` (stateless Streamable HTTP — a fresh `McpServer` + transport per request). Tools: `list_devices`, `get_device`, `send_command`, `get_history`, `list_rooms`, `list_platform_status`, `list_scenes`, `run_scene` — the same `sendCommand()` path the REST API and HomeKit use.

**Auth (done here, not by the `/api` middleware):** a bearer MCP bot token or OAuth access token, resolved to a bot by [`mcp-bots.js`](Module-mcp-bots); plain API tokens only with `mcp.allowApiTokens`. Missing / bad credentials → 401 with `WWW-Authenticate: Bearer resource_metadata=…` (OAuth discovery). Foreign `Origin` → 403; IP locked out after repeated bad credentials → 429.

**Per-bot policy:** read-only bots get no `send_command` / `run_scene`; devices outside the bot's rooms are invisible (including history); sensitive sensors are shown with `controllable: false, blocked: true`; a scene is refused if any device action in it (nested scenes too) is something the bot couldn't do itself. Every tool call is rate-limited and audited.

Requires `@modelcontextprotocol/sdk` and `zod` (installed on demand). Mounted by `server.js` when `mcp.enabled` is true, together with the OAuth endpoints from `src/routes/mcp-oauth.js`.

See [AI assistants (MCP)](AI-Assistants-MCP) for setup.

*Extracted from `src/mcp-server.js`. Source is authoritative — regenerate this page if the module changes.*
