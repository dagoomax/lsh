'use strict';

// Dyson (local MQTT; account login happens offline via — split out of src/api-routes.js; registered in order by createApiRoutes().
const fs   = require('fs');
const path = require('path');
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Dyson (local MQTT; account login happens offline via
  // scripts/dyson-auth.js, not through this route) ────────────
  router.get('/settings/dyson-devices', requireAdmin, (req, res) => {
    const tokensPath = path.join(__dirname, '..', '..', 'persist', 'dyson-tokens.json');
    if (!fs.existsSync(tokensPath)) return res.json({ success: true, devices: [] });
    try {
      const saved = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
      const devices = (saved.devices || []).map((d) => ({ name: d.name, serial: d.serial, productType: d.productType, ip: d.ip || '' }));
      res.json({ success: true, devices });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/dyson', requireAdmin, (req, res) => {
    const current = readConfigFile();
    try {
      writeConfigFile({
        ...current,
        dyson: { ...current.dyson, enabled: !!req.body?.enabled },
      });
      res.json({ success: true, message: 'Dyson settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
