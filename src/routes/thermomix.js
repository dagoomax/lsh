'use strict';

// Thermomix / Cookidoo — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Thermomix / Cookidoo ────────────────────────────────────
  router.post('/settings/thermomix', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { email, password, country, pollSeconds } = req.body;
    try {
      writeConfigFile({
        ...current,
        thermomix: {
          ...current.thermomix,
          email:       email || current.thermomix?.email || '',
          password:    (password && !password.includes('•')) ? password : (current.thermomix?.password || ''),
          country:     country || current.thermomix?.country || 'pl',
          pollSeconds: parseInt(pollSeconds) || 300,
        },
      });
      res.json({ success: true, message: 'Thermomix settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
