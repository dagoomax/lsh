'use strict';

// Integration modules (src/module-manager.js) — split out of src/api-routes.js; registered in order by createApiRoutes().
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Integration modules (src/module-manager.js) ──────────
  // Listing is admin-only too: it reveals which integrations are configured.
  router.get('/modules', requireAdmin, (req, res) => {
    try {
      res.json({ success: true, data: require('../module-manager').list(readConfigFile()) });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Fetch a module's files from GitHub + npm-install its deps. update=true
  // re-fetches files that are already present. Takes effect on restart.
  router.post('/modules/:id/install', requireAdmin, async (req, res) => {
    try {
      const [status] = await require('../module-manager').install([req.params.id], readConfigFile(), { force: !!req.body?.update });
      res.json({ success: true, data: status, message: 'Installed — restart LSH to load it.' });
    } catch (err) {
      res.status(/^Unknown module/.test(err.message) ? 404 : 500).json({ success: false, error: err.message });
    }
  });
};
