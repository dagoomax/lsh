'use strict';

// Waveshare Modbus TCP — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Waveshare Modbus TCP ───────────────────────────────────────────────

  router.post('/settings/test-waveshare', requireAdmin, async (req, res) => {
    const { host, port = 502, slaveId = 1 } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host is required' });
    const net = require('net');
    const sock = new net.Socket();
    const timeout = setTimeout(() => {
      sock.destroy();
      res.json({ success: false, error: `Cannot reach ${host}:${port} — connection timed out` });
    }, 5000);
    sock.connect(parseInt(port), host, () => {
      // Send FC01 read 1 coil to probe the slave
      const txId = 1;
      const frame = Buffer.from([
        txId >> 8, txId & 0xFF,   // Transaction ID
        0x00, 0x00,                // Protocol ID
        0x00, 0x06,                // Length
        slaveId & 0xFF,            // Unit ID
        0x01,                      // FC01 Read Coils
        0x00, 0x00,                // Start addr
        0x00, 0x01,                // Quantity = 1
      ]);
      sock.write(frame);
    });
    sock.once('data', (data) => {
      clearTimeout(timeout);
      sock.destroy();
      const fc = data[7];
      if (fc === 0x01 || fc === 0x81) {
        // 0x01 = valid response, 0x81 = exception (slave exists but rejected)
        res.json({ success: true, message: `Slave ${slaveId} responded at ${host}:${port}` });
      } else {
        res.json({ success: false, error: `Unexpected response from ${host}:${port}` });
      }
    });
    sock.on('error', (err) => {
      clearTimeout(timeout);
      res.json({ success: false, error: `${host}:${port} — ${err.message}` });
    });
  });

  router.post('/settings/waveshare', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const devices = req.body;
    if (!Array.isArray(devices)) return res.status(400).json({ success: false, error: 'Expected array of devices' });
    const sanitized = devices.map(d => ({
      name:       (d.name || '').trim(),
      host:       (d.host || '').trim(),
      port:       parseInt(d.port) || 502,
      slaveId:    parseInt(d.slaveId) || 1,
      relayCount: parseInt(d.relayCount) || 8,
    })).filter(d => d.host);
    try {
      writeConfigFile({ ...current, waveshare: { devices: sanitized } });
      res.json({ success: true, message: `${sanitized.length} device(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
