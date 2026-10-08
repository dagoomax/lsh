'use strict';

// Logs — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');

module.exports = function register(router, ctx) {
  const { requireAdmin, store } = ctx;

  // ── Logs ───────────────────────────────────────────────────────────────

  const logger = require('../logger');

  router.get('/logs', (req, res) => {
    res.json({ success: true, categories: logger.categories() });
  });

  router.get('/logs/:name', (req, res) => {
    const name  = req.params.name.replace(/[^a-z0-9_-]/gi, '');
    const limit = Math.min(parseInt(req.query.lines) || 300, 2000);
    const lines = logger.tail(name, limit);
    res.json({ success: true, name, lines });
  });

  router.delete('/logs/:name', requireAdmin, (req, res) => {
    const name = req.params.name.replace(/[^a-z0-9_-]/gi, '');
    logger.clear(name);
    res.json({ success: true });
  });

  router.post('/admin/restart', requireAdmin, (req, res) => {
    res.json({ success: true, message: 'Server restarting…' });
    // Save first — a bare process.exit() skips the signal handlers and drops
    // up to 5 min of sensor data/history since the last periodic persist.
    setTimeout(() => store.saveForShutdown().finally(() => process.exit(0)), 300);
  });

  router.post('/admin/reset-config', requireAdmin, (req, res) => {
    const blank = {
      mqtt:         { host: '', port: 1883, portalId: '' },
      vrm:          { email: '', password: '', apiToken: '', installationId: '' },
      solaredge:    { siteId: '', apiKey: '' },
      smartthings:  { token: '', deviceIds: [] },
      satel:        { host: '', port: 7094, armCode: '', zoneCount: 32, partitions: [1], zoneNames: {}, partitionNames: {} },
      unifi:        { host: '', username: '', password: '', apiKey: '' },
      loxone:       { host: '', port: 80, username: 'admin', password: '' },
      shelly:       { devices: [] },
      cameras:      [],
      relays:       [{ index: 0, name: 'Relay 1' }, { index: 1, name: 'Relay 2' }],
      server:       { port: 3000 },
      homekit:      { pin: '031-45-154', port: 47128, username: 'CC:22:3D:E3:CE:F6' },
    };
    try {
      writeConfigFile(blank);
      res.json({ success: true, message: 'Configuration erased. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
