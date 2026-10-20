'use strict';

// Dahua NVRs / IP cameras — snapshot proxy, status, settings. See src/dahua-client.js.
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;

  // Snapshot proxy — keeps the NVR password server-side
  router.get('/dahua/snapshot/:idx/:ch', (req, res) => {
    if (!clients.dahua) return res.status(503).end();
    clients.dahua.proxySnapshot(req.params.idx, req.params.ch, res);
  });

  router.get('/dahua/status', (req, res) => {
    res.json({ success: true, data: clients.dahua ? clients.dahua.status() : [] });
  });

  router.post('/settings/test-dahua', requireAdmin, async (req, res) => {
    const current = readConfigFile();
    const { idx, ...dev } = req.body || {};
    if (!dev.host) return res.status(400).json({ success: false, error: 'host is required' });
    if (!dev.password || String(dev.password).includes('•')) dev.password = current.dahua?.devices?.[Number(idx)]?.password || '';
    try {
      const { model, channels } = await require('../dahua-client').probe(dev);
      const used = channels.filter((c) => c.connected !== false);
      res.json({
        success: true,
        message: `${model || 'Dahua device'} — ${used.length} camera(s): ${used.map((c) => `${c.ch} ${c.name}`).join(', ')}`,
        data: { model, channels },
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/dahua', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const list = req.body?.devices ?? req.body;
    if (!Array.isArray(list)) return res.status(400).json({ success: false, error: 'Body must include a devices array' });
    const prev = current.dahua?.devices || [];
    const devices = list.map((d, i) => ({
      ...prev[i],
      name:     String(d.name || '').trim(),
      host:     String(d.host || '').trim(),
      port:     parseInt(d.port) || 0,
      https:    !!d.https,
      username: String(d.username || '').trim(),
      password: (d.password && !String(d.password).includes('•')) ? String(d.password) : (prev[i]?.password || ''),
      rtspPort: parseInt(d.rtspPort) || 554,
      stream:   d.stream === 'sub' ? 'sub' : 'main',
      events:   d.events !== false,
    })).filter((d) => d.host);
    try {
      writeConfigFile({ ...current, dahua: { ...current.dahua, devices } });
      res.json({ success: true, message: `${devices.length} Dahua device(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
