'use strict';

// Modbus scan (tool module lsh-modbus, src/lsh-modbus-scan.js) — read-only.
// Offers to install the module when it isn't on disk.

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  const load = (res) => {
    try { return require('../lsh-modbus-scan') } catch {
      res.status(409).json({ success: false, needsModule: true, error: 'The Modbus scan module is not installed on this LSH host' });
      return null;
    }
  };
  const fail = (res, err) => res.status(err.needsModule ? 409 : 400).json({ success: false, error: err.message, needsModule: !!err.needsModule });

  router.get('/lsh-modbus/ports', requireAdmin, (req, res) => {
    const m = load(res); if (!m) return;
    res.json({ success: true, data: { serial: m.serialPorts(), subnets: m.localSubnets(), platform: process.platform } });
  });

  router.post('/lsh-modbus/scan', requireAdmin, async (req, res) => {
    const m = load(res); if (!m) return;
    const b = req.body || {};
    try {
      const hosts = String(b.host || '').split(/[\s,]+/).filter(Boolean);
      res.json({ success: true, data: await m.scan({ mode: b.mode, hosts, port: b.port, units: b.units, serialPort: b.serialPort, baud: b.baud, parity: b.parity, timeout: b.timeout }) });
    } catch (err) { fail(res, err) }
  });

  router.post('/lsh-modbus/read', requireAdmin, async (req, res) => {
    const m = load(res); if (!m) return;
    try { res.json({ success: true, data: await m.readRange(req.body || {}) }) }
    catch (err) { fail(res, err) }
  });
};
