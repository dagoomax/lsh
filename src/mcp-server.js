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
 * Mounted at POST /api/mcp (see server.js), behind the same auth middleware
 * as the rest of /api/* — connect with an LSH API bearer token
 * (Settings → Security → API Tokens).
 *
 * Stateless Streamable HTTP: a fresh McpServer + transport per request, so
 * there's no session state to keep in sync with a Node process that may be
 * restarted (pm2) independently of any given client.
 */
function buildServer(store, sensorRegistry, automation) {
  const server = new McpServer({ name: 'lsh', version: '1.0.0' });

  server.registerTool(
    'list_devices',
    {
      title: 'List devices',
      description: 'List every device LSH knows about (Victron, Loxone, KNX, Shelly, HomeKit-exposed platforms, …), each with its current sensor readings.',
      inputSchema: {},
    },
    async () => ({ content: [{ type: 'text', text: JSON.stringify(sensorRegistry.getAllReadings(), null, 2) }] }),
  );

  server.registerTool(
    'get_device',
    {
      title: 'Get device',
      description: 'Get one device\'s current sensor readings by its key, e.g. "shelly/192_168_1_50" (device keys come from list_devices).',
      inputSchema: { deviceKey: z.string().describe('Device key, as returned by list_devices') },
    },
    async ({ deviceKey }) => {
      const data = sensorRegistry.getDeviceReadings(deviceKey);
      if (!data) return { content: [{ type: 'text', text: `Device not found: ${deviceKey}` }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.registerTool(
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
      try {
        await sensorRegistry.sendCommand(deviceKey, sensor, value);
        return { content: [{ type: 'text', text: 'OK' }] };
      } catch (err) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
    },
  );

  server.registerTool(
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
      const points = (!hours || hours <= 6) ? store.getHistory(key) : await store.getHistoryRange(key, hours);
      return { content: [{ type: 'text', text: JSON.stringify(points, null, 2) }] };
    },
  );

  server.registerTool(
    'list_rooms',
    {
      title: 'List rooms',
      description: 'List configured room names and icons, for grouping devices by location.',
      inputSchema: {},
    },
    async () => ({ content: [{ type: 'text', text: JSON.stringify(sensorRegistry.getRoomMeta(), null, 2) }] }),
  );

  server.registerTool(
    'list_platform_status',
    {
      title: 'List platform status',
      description: 'Health of each configured integration platform (Victron, Loxone, Shelly, …) — true if currently connected, as shown in the dashboard\'s platform bar.',
      inputSchema: {},
    },
    async () => ({ content: [{ type: 'text', text: JSON.stringify(platformStatus.getAll(), null, 2) }] }),
  );

  if (automation) {
    server.registerTool(
      'list_scenes',
      {
        title: 'List scenes',
        description: 'List configured automation scenes (id, name, actions) that can be run with run_scene.',
        inputSchema: {},
      },
      async () => ({ content: [{ type: 'text', text: JSON.stringify(automation.scenes, null, 2) }] }),
    );

    server.registerTool(
      'run_scene',
      {
        title: 'Run scene',
        description: 'Run a scene by id, executing its saved actions (device commands) — the same as pressing it in the dashboard. Scene ids come from list_scenes.',
        inputSchema: { sceneId: z.string().describe('Scene id, as returned by list_scenes') },
      },
      async ({ sceneId }) => {
        try {
          const scene = await automation.runScene(sceneId);
          return { content: [{ type: 'text', text: `Ran scene: ${scene.name}` }] };
        } catch (err) {
          return { content: [{ type: 'text', text: err.message }], isError: true };
        }
      },
    );
  }

  return server;
}

async function handleRequest(req, res, store, sensorRegistry, automation) {
  try {
    const server    = buildServer(store, sensorRegistry, automation);
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

module.exports = { handleRequest };
