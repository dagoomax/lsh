'use strict';

// BroadLink IR/RF — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;

  // ── BroadLink IR/RF ───────────────────────────────────────────────────────

  router.get('/broadlink/codes', (req, res) => {
    const bl = clients.broadlink;
    if (!bl) return res.json({});
    res.json(bl.getAllCodes());
  });

  router.post('/broadlink/learn/ir', requireAdmin, async (req, res) => {
    const bl = clients.broadlink;
    if (!bl) return res.status(503).json({ success: false, error: 'BroadLink not configured' });
    const { host, name } = req.body;
    if (!host || !name) return res.status(400).json({ success: false, error: 'host and name are required' });
    // Streaming status via ndjson
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    const send = (obj) => { try { res.write(JSON.stringify(obj) + '\n'); } catch { /* client gone */ } };
    try {
      const hex = await bl.learnIR(host, name, (status) => send({ status }));
      send({ success: true, name, bytes: hex.length / 2 });
    } catch (err) {
      send({ success: false, error: err.message });
    }
    res.end();
  });

  router.post('/broadlink/learn/rf', requireAdmin, async (req, res) => {
    const bl = clients.broadlink;
    if (!bl) return res.status(503).json({ success: false, error: 'BroadLink not configured' });
    const { host, name } = req.body;
    if (!host || !name) return res.status(400).json({ success: false, error: 'host and name are required' });
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    const send = (obj) => { try { res.write(JSON.stringify(obj) + '\n'); } catch { /* client gone */ } };
    try {
      const hex = await bl.learnRF(host, name, (status) => send({ status }));
      send({ success: true, name, bytes: hex.length / 2 });
    } catch (err) {
      send({ success: false, error: err.message });
    }
    res.end();
  });

  router.post('/broadlink/send', requireAdmin, async (req, res) => {
    const bl = clients.broadlink;
    if (!bl) return res.status(503).json({ success: false, error: 'BroadLink not configured' });
    const { host, name } = req.body;
    if (!host || !name) return res.status(400).json({ success: false, error: 'host and name required' });
    try {
      await bl.sendCode(host, name);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.delete('/broadlink/codes', requireAdmin, (req, res) => {
    const bl = clients.broadlink;
    if (!bl) return res.status(503).json({ success: false, error: 'BroadLink not configured' });
    const { host, name } = req.body;
    if (!host || !name) return res.status(400).json({ success: false, error: 'host and name required' });
    bl.deleteCode(host, name);
    res.json({ success: true });
  });

  router.post('/settings/test-broadlink', requireAdmin, (req, res) => {
    const { host } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });
    const dgram = require('dgram');
    // Send a minimal auth packet; any UDP response means the device is reachable
    const probe = Buffer.alloc(0x38, 0);
    probe[0x00] = 0x5a; probe[0x01] = 0xa5; probe[0x02] = 0xaa; probe[0x03] = 0x55;
    probe[0x04] = 0x5a; probe[0x05] = 0xa5; probe[0x06] = 0xaa; probe[0x07] = 0x55;
    probe[0x24] = 0x2a; probe[0x25] = 0x27;
    probe[0x26] = 0x65; // auth command low byte
    const sock = dgram.createSocket('udp4');
    let done = false;
    const finish = (json) => { if (done) return; done = true; try { sock.close(); } catch {} res.json(json); };
    setTimeout(() => finish({ success: false, error: `No response from ${host}:80 — check IP and device power` }), 4000);
    sock.on('message', () => finish({ success: true, message: `Device at ${host} is online` }));
    sock.on('error', err  => finish({ success: false, error: err.message }));
    sock.send(probe, 80, host);
  });

  router.post('/settings/broadlink', requireAdmin, (req, res) => {
    const current  = readConfigFile();
    const devices  = req.body;
    if (!Array.isArray(devices)) return res.status(400).json({ success: false, error: 'Expected array' });
    const sanitized = devices.map(d => ({
      name: (d.name || '').trim(),
      host: (d.host || '').trim(),
      mac:  (d.mac  || '').trim(),
    })).filter(d => d.host);
    try {
      writeConfigFile({ ...current, broadlink: { devices: sanitized } });
      res.json({ success: true, message: `${sanitized.length} device(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
