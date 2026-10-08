'use strict';

// LAN scanner (src/lsh-lan.js — tool module `lsh-lan`, installed on demand).
module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  const load = (res) => {
    try {
      const lan = require('../lsh-lan');
      require.resolve('multicast-dns');
      return lan;
    } catch {
      res.status(409).json({ success: false, needsModule: true, module: 'lsh-lan', error: 'The LAN scanner module is not installed on this LSH host' });
      return null;
    }
  };

  // Full sweep of this host's LAN(s): ~15–40 s depending on network size.
  router.post('/lsh-lan/scan', requireAdmin, async (req, res) => {
    const lan = load(res);
    if (!lan) return;
    try {
      res.json({ success: true, data: await lan.scan() });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/lsh-lan/inspect', requireAdmin, async (req, res) => {
    const lan = load(res);
    if (!lan) return;
    try {
      res.json({ success: true, data: await lan.inspect({ ip: String(req.body?.ip || '').trim() }) });
    } catch (err) {
      res.status(/Invalid/.test(err.message) ? 400 : 500).json({ success: false, error: err.message });
    }
  });
};
