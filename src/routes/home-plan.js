'use strict';

// Home plan (isometric floor plan for the dashboard) — split out of src/api-routes.js; registered in order by createApiRoutes().
const { readConfigFile } = require('./helpers');

module.exports = function register(router) {
  // ── Home plan (isometric floor plan for the dashboard) ────
  router.get('/home-plan', (req, res) => {
    res.json({ success: true, plan: readConfigFile().homePlan || { rooms: [] } });
  });
};
