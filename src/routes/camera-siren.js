'use strict';

// Siren + floodlight (Reolink only) — split out of src/api-routes.js; registered in order by createApiRoutes().

module.exports = function register(router, ctx) {
  const { reolink, requireAdmin } = ctx;

  // ── Siren + floodlight (Reolink only) ────────────────────
  router.post('/reolink/siren/:idx', requireAdmin, async (req, res) => {
    if (!reolink) return res.status(503).json({ success: false, error: 'Reolink unavailable' });
    try { await reolink.triggerSiren(req.params.idx, (req.body || {}).times); res.json({ success: true }); }
    catch (err) { res.status(502).json({ success: false, error: err.message }); }
  });

  router.get('/reolink/floodlight/:idx', async (req, res) => {
    if (!reolink) return res.status(503).json({ success: false, error: 'Reolink unavailable' });
    try { res.json({ success: true, data: await reolink.getFloodlight(req.params.idx) }); }
    catch (err) { res.status(502).json({ success: false, error: err.message }); }
  });

  router.post('/reolink/floodlight/:idx', requireAdmin, async (req, res) => {
    if (!reolink) return res.status(503).json({ success: false, error: 'Reolink unavailable' });
    const { on } = req.body || {};
    if (typeof on !== 'boolean') return res.status(400).json({ success: false, error: 'Body must include on: true|false' });
    try { await reolink.setFloodlight(req.params.idx, on); res.json({ success: true }); }
    catch (err) { res.status(502).json({ success: false, error: err.message }); }
  });
};
