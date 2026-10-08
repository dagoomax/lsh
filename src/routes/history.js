'use strict';

// History — split out of src/api-routes.js; registered in order by createApiRoutes().

module.exports = function register(router, ctx) {
  const { store } = ctx;

  // ── History ───────────────────────────────────────────────
  // ?hours=N — anything within the in-memory ring buffer's ~6h window (no
  // param, or a small one) is served straight from RAM exactly as before;
  // wider ranges only touch Mongo when explicitly asked for, so the default
  // 1h/6h chart views keep costing nothing extra.
  router.get('/history/:key(*)', async (req, res) => {
    const hours = req.query.hours ? Number(req.query.hours) : null;
    if (!hours || hours <= 6) {
      return res.json({ success: true, key: req.params.key, points: store.getHistory(req.params.key) });
    }
    const points = await store.getHistoryRange(req.params.key, hours);
    res.json({ success: true, key: req.params.key, points });
  });

  router.get('/history-status', (req, res) => {
    res.json({ success: true, data: store.historyStatus() });
  });
};
