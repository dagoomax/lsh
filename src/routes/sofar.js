'use strict';

// Sofar Solar (K-TLX via LSW-3 dongle) — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Sofar Solar (K-TLX via LSW-3 dongle) ───────────────────

  router.post('/settings/test-sofar', requireAdmin, async (req, res) => {
    const { host, port, serialNumber, slaveId } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host is required' });
    if (!serialNumber) return res.status(400).json({ success: false, error: 'serialNumber is required' });
    try {
      const registers = await require('../sofar-client').readRegisters({
        host, port: port ? Number(port) : 8899, serial: Number(serialNumber),
        slaveId: slaveId ? Number(slaveId) : 1, startAddr: 0x0000, quantity: 1, timeoutMs: 5000,
      });
      const STATUS = { 0: 'Stand-by', 1: 'Self-checking', 2: 'Normal', 3: 'Fault', 4: 'Permanent Fault' };
      res.json({ success: true, message: `Connected — inverter status: ${STATUS[registers[0]] || registers[0]}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/sofar', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { host, port, serialNumber, slaveId, pollInterval } = req.body;
    const c = current.sofar || {};
    try {
      writeConfigFile({
        ...current,
        sofar: {
          host: host ?? c.host ?? '',
          port: port != null && port !== '' ? Number(port) : (c.port ?? 8899),
          serialNumber: serialNumber ?? c.serialNumber ?? '',
          slaveId: slaveId != null && slaveId !== '' ? Number(slaveId) : (c.slaveId ?? 1),
          pollInterval: pollInterval != null && pollInterval !== '' ? Number(pollInterval) : (c.pollInterval ?? 10),
        },
      });
      res.json({ success: true, message: 'Sofar settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
