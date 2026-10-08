'use strict';

// Hardware simulators (scripts/*-simulator.js) — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { simulators } = ctx;

  // ── Hardware simulators (scripts/*-simulator.js) ──────────
  router.get('/simulators', (req, res) => {
    if (!simulators) return res.status(503).json({ success: false, error: 'Simulator manager unavailable' });
    res.json({ success: true, data: simulators.list() });
  });

  // Enable/disable a simulator at runtime; the choice persists in config.json
  router.post('/simulators/:name', (req, res) => {
    if (!simulators) return res.status(503).json({ success: false, error: 'Simulator manager unavailable' });
    const { enabled, port } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Body must include enabled: true|false' });
    }
    try {
      const status  = simulators.setEnabled(req.params.name, enabled, port ? Number(port) : undefined);
      const current = readConfigFile();
      writeConfigFile({
        ...current,
        simulators: {
          ...(current.simulators || {}),
          [req.params.name]: { enabled, ...(status.port ? { port: status.port } : {}) },
        },
      });
      res.json({ success: true, data: status });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
};
