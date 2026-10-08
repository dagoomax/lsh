'use strict';

// Dashboard lock PIN (screen lock, default 0000) — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Dashboard lock PIN (screen lock, default 0000) ────────
  router.post('/dashboard-pin/verify', (req, res) => {
    const pin = String(readConfigFile().dashboardPin || '0000');
    res.json({ success: true, ok: String(req.body?.pin || '') === pin });
  });

  router.post('/settings/dashboard-pin', requireAdmin, (req, res) => {
    const pin = String(req.body?.pin ?? '').trim();
    if (pin && !/^\d{4,8}$/.test(pin)) {
      return res.status(400).json({ success: false, error: 'PIN must be 4–8 digits' });
    }
    try {
      const cfg = readConfigFile();
      cfg.dashboardPin = pin; // empty falls back to the default 0000
      writeConfigFile(cfg);
      res.json({ success: true, message: pin ? 'Dashboard PIN set' : 'Dashboard PIN reset to default 0000' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/edit-pin', requireAdmin, (req, res) => {
    const pin = String(req.body?.pin ?? '').trim();
    if (pin && !/^\d{4,8}$/.test(pin)) {
      return res.status(400).json({ success: false, error: 'PIN must be 4–8 digits' });
    }
    try {
      const cfg = readConfigFile();
      cfg.editPin = pin;
      writeConfigFile(cfg);
      res.json({ success: true, message: pin ? 'Edit PIN enabled' : 'Edit PIN disabled' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
