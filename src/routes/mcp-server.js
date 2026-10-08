'use strict';

// MCP Server — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── MCP Server ───────────────────────────────────────────────────────────
  router.post('/settings/mcp', requireAdmin, (req, res) => {
    const current = readConfigFile();
    try {
      writeConfigFile({ ...current, mcp: { enabled: !!req.body.enabled } });
      res.json({ success: true, message: 'MCP server settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
