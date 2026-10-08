'use strict';

// Patrol (Reolink only — the only backend with a documented start/stop — split out of src/api-routes.js; registered in order by createApiRoutes().

module.exports = function register(router, ctx) {
  const { reolink, requireAdmin } = ctx;

  // ── Patrol (Reolink only — the only backend with a documented start/stop
  // call; best-effort, reported unreliable on some models/firmware) ───────
  router.post('/reolink/patrol/:idx', requireAdmin, async (req, res) => {
    if (!reolink) return res.status(503).json({ success: false, error: 'Reolink unavailable' });
    const { action, id } = req.body || {};
    if (!['start', 'stop'].includes(action)) {
      return res.status(400).json({ success: false, error: "action must be 'start' or 'stop'" });
    }
    try {
      await (action === 'start' ? reolink.startPatrol(req.params.idx, id) : reolink.stopPatrol(req.params.idx));
      res.json({ success: true });
    } catch (err) {
      res.status(502).json({ success: false, error: err.message });
    }
  });
};
