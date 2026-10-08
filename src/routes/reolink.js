'use strict';

// Reolink PoE cameras — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Reolink PoE cameras ───────────────────────────────────
  router.post('/settings/reolink', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const cams = req.body?.cameras ?? req.body;
    if (!Array.isArray(cams)) return res.status(400).json({ success: false, error: 'Body must be an array of cameras' });
    const cleaned = cams.map((c) => ({
      name:     String(c.name || '').trim(),
      host:     String(c.host || '').trim(),
      username: String(c.username || '').trim(),
      password: (c.password && !String(c.password).includes('•')) ? String(c.password) : undefined,
      channel:  parseInt(c.channel) || 0,
      stream:   c.stream === 'sub' ? 'sub' : 'main',
      https:    !!c.https,
      port:     parseInt(c.port) || 0,
      webrtcUrl:  String(c.webrtcUrl || '').trim(),
      ptz:        !!c.ptz,
      ir:         !!c.ir,
      floodlight: !!c.floodlight,
      siren:      !!c.siren,
    })).filter((c) => c.host);
    // Preserve saved passwords when the UI sends a masked placeholder
    const prev = current.reolink?.cameras || [];
    cleaned.forEach((c, i) => { if (c.password === undefined) c.password = prev[i]?.password || ''; });
    try {
      writeConfigFile({ ...current, reolink: { cameras: cleaned } });
      res.json({ success: true, message: 'Reolink cameras saved' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Test a single Reolink camera by pulling one snapshot
  router.post('/settings/test-reolink', requireAdmin, async (req, res) => {
    const cam = req.body || {};
    if (!cam.host) return res.status(400).json({ success: false, error: 'host is required' });
    try {
      const ReolinkClient = require('../reolink-client');
      const { buffer } = await ReolinkClient.fetchSnapshot(cam);
      res.json({ success: true, message: `Snapshot OK — ${(buffer.length / 1024).toFixed(0)} KB`, data: { bytes: buffer.length } });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });
};
