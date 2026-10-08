'use strict';

// Dreame — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Dreame ─────────────────────────────────────────────────────────────

  router.post('/settings/test-dreame', requireAdmin, async (req, res) => {
    const { host, token } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host is required' });
    if (!token || token.includes('•')) return res.status(400).json({ success: false, error: 'token is required' });
    const tokenClean = token.replace(/\s/g, '');
    if (tokenClean.length !== 32) return res.json({ success: false, error: 'token must be 32 hex characters' });

    const crypto = require('crypto');
    const dgram  = require('dgram');
    const HELLO  = Buffer.from('21310020ffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');

    const tryHello = () => new Promise((resolve, reject) => {
      const sock = dgram.createSocket('udp4');
      const t    = setTimeout(() => { sock.close(); reject(new Error('No response — check IP and that the device is on the same network')); }, 5000);
      sock.on('message', msg => { clearTimeout(t); sock.close(); resolve(msg); });
      sock.on('error',   err => { clearTimeout(t); sock.close(); reject(err); });
      sock.send(HELLO, 54321, host);
    });

    try {
      const msg      = await tryHello();
      const deviceId = msg.readUInt32BE(8);
      res.json({ success: true, message: `Connected — device ID ${deviceId}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/dreame', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const devices = req.body;
    if (!Array.isArray(devices)) return res.status(400).json({ success: false, error: 'Expected array of devices' });
    const sanitized = devices.map(d => {
      const prev = (current.dreame?.devices ?? []).find(x => x.host === d.host);
      return {
        name:  (d.name  || '').trim(),
        host:  (d.host  || '').trim(),
        token: (d.token && !d.token.includes('•')) ? d.token.replace(/\s/g, '') : (prev?.token || ''),
        type:  d.type === 'purifier' ? 'purifier' : 'vacuum',
      };
    }).filter(d => d.host && d.token);
    try {
      writeConfigFile({ ...current, dreame: { devices: sanitized } });
      res.json({ success: true, message: `${sanitized.length} device(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
