'use strict';

// Tedee Bridge — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Tedee Bridge ─────────────────────────────────────────────────────────

  router.post('/settings/test-tedee', requireAdmin, async (req, res) => {
    const { host, apiToken } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host is required' });
    if (!apiToken) return res.status(400).json({ success: false, error: 'apiToken is required' });
    try {
      const TedeeClient = require('../tedee-client');
      const bridge = await TedeeClient.testConnection({ host, apiToken });
      res.json({ success: true, message: `Connected — ${bridge.name || 'Bridge'} (firmware ${bridge.version || '?'})` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/tedee', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const devices = req.body;
    if (!Array.isArray(devices)) return res.status(400).json({ success: false, error: 'Expected array of devices' });
    const sanitized = devices.map(d => ({
      name:         (d.name || '').trim(),
      host:         (d.host || '').trim(),
      // A masked '••••••••' placeholder (from GET /settings, see below) means
      // the field wasn't touched — fall back to the saved token by array
      // index, same as Reolink/Axis/MOBOTIX camera passwords above.
      apiToken:     (d.apiToken && !String(d.apiToken).includes('•')) ? String(d.apiToken).trim() : undefined,
      pollInterval: parseInt(d.pollInterval) || 5,
    })).filter(d => d.host);
    const prev = current.tedee?.devices || [];
    sanitized.forEach((d, i) => { if (d.apiToken === undefined) d.apiToken = prev[i]?.apiToken || ''; });
    try {
      writeConfigFile({ ...current, tedee: { devices: sanitized.filter(d => d.apiToken) } });
      res.json({ success: true, message: `${sanitized.length} bridge(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
