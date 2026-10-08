'use strict';

// CAN bus scan (tool module lsh-can, src/lsh-can-scan.js) — passive,
// listen-only. Offers to install the module when it isn't on disk.

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  const load = (res) => {
    try { return require('../lsh-can-scan') } catch {
      res.status(409).json({ success: false, needsModule: true, error: 'The CAN bus scan module is not installed on this LSH host' });
      return null;
    }
  };

  router.get('/lsh-can/interfaces', requireAdmin, async (req, res) => {
    const m = load(res); if (!m) return;
    try { res.json({ success: true, data: await m.interfaces() }) }
    catch (err) { res.status(500).json({ success: false, error: err.message }) }
  });

  router.post('/lsh-can/scan', requireAdmin, async (req, res) => {
    const m = load(res); if (!m) return;
    const b = req.body || {};
    try {
      const data = await m.scan({ iface: b.iface, serialPort: b.serialPort, bitrate: b.bitrate, seconds: b.seconds });
      res.json({ success: true, data });
    } catch (err) {
      res.status(err.needsModule ? 409 : err.down ? 409 : 400).json({ success: false, error: err.message, needsModule: !!err.needsModule, down: !!err.down });
    }
  });
};
