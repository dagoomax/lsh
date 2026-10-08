'use strict';

// Config backup / restore — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { relayController, requireAdmin } = ctx;

  // ── Config backup / restore ───────────────────────────────
  router.get('/settings/export', requireAdmin, (req, res) => {
    const cfg = readConfigFile();
    const filename = `victron-config-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(cfg, null, 2));
  });

  router.post('/settings/import', requireAdmin, (req, res) => {
    const body = req.body;
    // Basic structure validation
    const required = ['mqtt', 'vrm', 'server', 'homekit'];
    const missing = required.filter((k) => !(k in body));
    if (missing.length) {
      return res.status(400).json({
        success: false,
        error: `Invalid config file — missing keys: ${missing.join(', ')}`,
      });
    }
    if ('relays' in body && !Array.isArray(body.relays)) {
      return res.status(400).json({ success: false, error: '"relays" must be an array' });
    }
    try {
      writeConfigFile(body);
      relayController.config.relays = body.relays;
      res.json({ success: true, message: 'Configuration restored. Restart the server to apply connection changes.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
