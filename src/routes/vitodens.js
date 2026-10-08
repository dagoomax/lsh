'use strict';

// Viessmann Vitodens — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Viessmann Vitodens ─────────────────────────────────────────────────────

  router.post('/settings/vitodens', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { clientId, pollInterval } = req.body;
    try {
      writeConfigFile({
        ...current,
        vitodens: {
          ...current.vitodens,
          clientId:     clientId || current.vitodens?.clientId || '',
          pollInterval: parseInt(pollInterval) || 120,
        },
      });
      res.json({ success: true, message: 'Vitodens settings saved. Run node scripts/vitodens-auth.js if you haven\'t authorized yet, then restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
