'use strict';

// Missed calls (SIP doorbell) — split out of src/api-routes.js; registered in order by createApiRoutes().
const callLog = require('../call-log');

module.exports = function register(router) {
  // ── Missed calls (SIP doorbell) ──────────────────────────────────────────
  router.get('/call-log', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    res.json({ success: true, data: callLog.getRecent(limit) });
  });
};
