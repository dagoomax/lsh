'use strict';

const { McpServer }                  = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const platformStatus = require('./platform-status');

/**
 * Exposes LSH's devices/sensors as MCP tools so an external Claude (Desktop,
 * Claude Code, claude.ai) can query and control the house — read the same
 * data the dashboard shows and drive the same sendCommand() path the REST
 * API and HomeKit bridge use, no separate integration layer.
 *
 * Mounted at POST /api/mcp (see server.js). Auth is done here, not by the
 * /api middleware: a bearer MCP bot token (lshb_…) or an OAuth access token
 * (lsha_…) — see src/mcp-bots.js. Each call is checked against the bot's
 * policy (read-only / control, rooms / devices, sensitive devices), rate
 * limited and audited. Plain LSH API tokens (admin for the whole REST API)
 * only work here when config.mcp.allowApiTokens is true.
 *
 * Stateless Streamable HTTP: a fresh McpServer + transport per request, so
 * there's no session state to keep in sync with a Node process that may be
 * restarted (pm2) independently of any given client.
 */
// Every device command a scene would send, including nested scenes
function sceneDeviceActions(automation, scene, seen = new Set()) {
  if (!scene || seen.has(scene.id)) return [];
  seen.add(scene.id);
  const out = [];
  for (const a of scene.actions || []) {
    if (a.type === 'device') out.push(a);
    else if (a.type === 'scene') out.push(...sceneDeviceActions(automation, automation.scenes.find((s) => s.id === a.sceneId), seen));
  }
  return out;
}

// bot = the authenticated MCP bot (src/mcp-bots.js), or null for a legacy
// full-access caller (an LSH API token with config.mcp.allowApiTokens)
function buildServer(store, sensorRegistry, automation, bot = null, bots = null, ip = null) {
  const server = new McpServer({ name: 'lsh', version: '1.0.0' });
  const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
  const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });
  const device = (key) => sensorRegistry.getDevices().find((d) => d.key === key);
  const visible = (d) => !bot || bots.canSee(bot, d);
  const view = (r) => (bot ? bots.viewDevice(bot, r) : r);
  // Rate limit + audit around every tool
  const tool = (name, def, fn) => server.registerTool(name, def, async (args) => {
    if (bot) {
      try { bots.hit(bot) } catch (err) { bots.audit({ botId: bot.id, bot: bot.name, ip, tool: name, args, ok: false, error: err.message }); return fail(err.message) }
    }
    let res;
    try { res = await fn(args || {}) } catch (err) { res = fail(err.message) }
    if (bot) {
      const writeish = name === 'send_command' || name === 'run_scene';
      bots.audit({ botId: bot.id, bot: bot.name, ip, tool: name, args, ok: !res.isError, ...(res.isError ? { error: res.content?.[0]?.text } : {}) });
      if (writeish || res.isError) console.log(`[MCP] ${bot.name}: ${name} ${JSON.stringify(args)} → ${res.isError ? `denied/failed: ${res.content?.[0]?.text}` : 'ok'}`);
    }
    return res;
  });

  tool(
    'list_devices',
    {
      title: 'List devices',
      description: 'List every device LSH knows about (Victron, Loxone, KNX, Shelly, HomeKit-exposed platforms, …), each with its current sensor readings.',
      inputSchema: {},
    },
    async () => text(sensorRegistry.getAllReadings().filter((r) => r && visible(r)).map(view)),
  );

  tool(
    'get_device',
    {
      title: 'Get device',
      description: 'Get one device\'s current sensor readings by its key, e.g. "shelly/192_168_1_50" (device keys come from list_devices).',
      inputSchema: { deviceKey: z.string().describe('Device key, as returned by list_devices') },
    },
    async ({ deviceKey }) => {
      const data = sensorRegistry.getDeviceReadings(deviceKey);
      if (!data || !visible(data)) return fail(`Device not found: ${deviceKey}`);
      return text(view(data));
    },
  );

  if (!bot || bot.access === 'control') tool(
    'send_command',
    {
      title: 'Send device command',
      description: 'Write a controllable sensor on a device — toggle a switch/relay, set a dimmer level, set a thermostat setpoint, etc. Only sensors marked "controllable" in list_devices/get_device accept writes.',
      inputSchema: {
        deviceKey: z.string().describe('Device key, as returned by list_devices'),
        sensor:    z.string().describe('The sensor path to write, from the device\'s sensors list'),
        value:     z.union([z.string(), z.number(), z.boolean()]).describe('The value to write (on/off, a number, a mode string, …)'),
      },
    },
    async ({ deviceKey, sensor, value }) => {
      if (bot) {
        const denied = bots.writeDenied(bot, device(deviceKey), sensor);
        if (denied) return fail(denied);
      }
      await sensorRegistry.sendCommand(deviceKey, sensor, value);
      return text('OK');
    },
  );

  tool(
    'get_history',
    {
      title: 'Get sensor history',
      description: 'Get recent history points for one store key, e.g. "shelly/192_168_1_50/power". Without hours (or hours <= 6), served from the in-memory ~6h ring buffer; a wider range is only fetched from MongoDB if the server has it configured.',
      inputSchema: {
        key:   z.string().describe('Full store key: "device/instance/sensorPath"'),
        hours: z.number().optional().describe('How many hours of history to return (defaults to the ~6h in-memory window)'),
      },
    },
    async ({ key, hours }) => {
      // Only history of devices the bot can see
      if (bot && !sensorRegistry.getDevices().some((d) => key.startsWith(`${d.key}/`) && visible(d))) return fail(`Not found: ${key}`);
      const points = (!hours || hours <= 6) ? store.getHistory(key) : await store.getHistoryRange(key, hours);
      return text(points);
    },
  );

  tool(
    'list_rooms',
    {
      title: 'List rooms',
      description: 'List configured room names and icons, for grouping devices by location.',
      inputSchema: {},
    },
    async () => text(sensorRegistry.getRoomMeta()),
  );

  tool(
    'list_platform_status',
    {
      title: 'List platform status',
      description: 'Health of each configured integration platform (Victron, Loxone, Shelly, …) — true if currently connected, as shown in the dashboard\'s platform bar.',
      inputSchema: {},
    },
    async () => text(platformStatus.getAll()),
  );

  if (automation) {
    tool(
      'list_scenes',
      {
        title: 'List scenes',
        description: 'List configured automation scenes (id, name, actions) that can be run with run_scene.',
        inputSchema: {},
      },
      async () => text(automation.scenes.map((sc) => ({ id: sc.id, name: sc.name, icon: sc.icon, enabled: sc.enabled }))),
    );

    if (!bot || bot.access === 'control') tool(
      'run_scene',
      {
        title: 'Run scene',
        description: 'Run a scene by id, executing its saved actions (device commands) — the same as pressing it in the dashboard. Scene ids come from list_scenes.',
        inputSchema: { sceneId: z.string().describe('Scene id, as returned by list_scenes') },
      },
      async ({ sceneId }) => {
        if (bot) {
          // A scene may only do what the bot could do itself
          const scene = automation.scenes.find((sc) => sc.id === sceneId);
          if (!scene) return fail('Scene not found');
          for (const a of sceneDeviceActions(automation, scene)) {
            const denied = bots.writeDenied(bot, device(a.deviceKey), a.sensor);
            if (denied) return fail(`Scene "${scene.name}" controls ${a.deviceKey} / ${a.sensor}: ${denied}`);
          }
        }
        const scene = await automation.runScene(sceneId);
        return text(`Ran scene: ${scene.name}`);
      },
    );
  }

  return server;
}

// Bearer value from the request (header only — never query strings)
function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// Browsers send Origin; MCP clients (CLI apps, ChatGPT / claude.ai servers)
// don't. A foreign Origin is a web page trying to reach the house → refuse
// (DNS-rebinding / cross-site protection, as the MCP spec asks).
function originAllowed(req, cfg) {
  const o = req.headers.origin;
  if (!o) return true;
  try {
    const u = new URL(o);
    if (u.host === req.get('host')) return true;
    return (cfg.allowedOrigins || []).includes(u.origin);
  } catch { return false }
}

function resourceMetadataUrl(req, cfg) {
  const base = cfg.publicUrl ? String(cfg.publicUrl).replace(/\/+$/, '') : `${req.protocol}://${req.get('host')}`;
  return `${base}/.well-known/oauth-protected-resource`;
}

async function handleRequest(req, res, store, sensorRegistry, automation, { bots, auth, mcpConfig = {} } = {}) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  const deny = (status, message) => {
    if (status === 401) res.set('WWW-Authenticate', `Bearer realm="lsh-mcp", resource_metadata="${resourceMetadataUrl(req, mcpConfig)}"`);
    res.status(status).json({ jsonrpc: '2.0', error: { code: -32001, message }, id: null });
  };
  if (!originAllowed(req, mcpConfig)) return deny(403, 'Origin not allowed');
  if (bots?.isBlocked(ip)) return deny(429, 'Too many failed sign-ins — try again later');

  const token = bearer(req);
  let bot = token ? bots?.verify(token) : null;
  if (!bot) {
    const legacy = token && mcpConfig.allowApiTokens === true && auth?.verifyApiToken(token);
    if (!legacy) {
      if (token) bots?.recordFailure(ip);
      return deny(401, token ? 'Invalid or revoked MCP credentials' : 'MCP needs a bot token — create one in LSH Settings → Security → MCP bots');
    }
    bot = null; // legacy full access
  } else {
    bots.touch(bot, ip);
  }

  try {
    const server    = buildServer(store, sensorRegistry, automation, bot, bots, ip);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(`[MCP] Request failed: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
}

module.exports = { handleRequest, buildServer };
