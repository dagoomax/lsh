'use strict';

// vCLU — settings + connection test. Client: src/vclu-client.js (MCP over HTTP).
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store, sensorRegistry } = ctx;

  // Body → config.vclu; a masked token keeps the stored one
  const fromBody = (b = {}, prev = {}) => ({
    ...prev,
    host: String(b.host || '').trim().replace(/\/+$/, ''),
    token: String(b.token || '').includes('•') ? prev.token : String(b.token || '').trim() || undefined,
    pollInterval: Math.max(2, Number(b.pollInterval) || 5),
  });

  router.post('/settings/test-vclu', requireAdmin, async (req, res) => {
    const cfg = fromBody(req.body, readConfigFile().vclu || {});
    if (!cfg.host || !cfg.token) return res.status(400).json({ success: false, error: 'Give the vCLU address and an MCP bot token' });
    try {
      // On-demand module — on a fresh install it arrives at the next start
      const VcluClient = require('../vclu-client');
      const c = new VcluClient({ vclu: cfg }, store, sensorRegistry);
      const out = await c.tool('vclu_devices');
      const list = out?.devices || [];
      const ro = list.filter((d) => d.readonly).length;
      res.json({ success: true, message: `Connected — ${list.length} devices${ro ? ` (${ro} read-only for this bot)` : ''}` });
    } catch (err) {
      res.json({ success: false, error: err.name === 'TimeoutError' || /fetch failed/.test(err.message) ? `Can’t reach ${cfg.host} — check the address and port of the vCLU web UI` : err.message });
    }
  });

  router.post('/settings/vclu', requireAdmin, async (req, res) => {
    const cur = readConfigFile();
    const vclu = fromBody(req.body, cur.vclu || {});
    writeConfigFile({ ...cur, vclu });
    // First setup starts right away; changing a running one needs a restart
    // (its devices are already registered against the running client).
    if (clients.vclu || !vclu.host || !vclu.token) {
      return res.json({ success: true, message: clients.vclu ? 'Saved — restart LSH to apply' : 'Saved' });
    }
    try {
      const VcluClient = require('../vclu-client');
      const c = new VcluClient({ ...cur, vclu }, store, sensorRegistry);
      await c.start();
      clients.vclu = c;
      res.json({ success: true, message: `Saved — ${c.devices.size} vCLU devices added` });
    } catch (err) {
      res.json({ success: true, message: `Saved; ${err.message}` });
    }
  });
};
