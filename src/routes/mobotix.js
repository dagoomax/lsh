'use strict';

// MOBOTIX — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── MOBOTIX ───────────────────────────────────────────────
  router.post('/settings/mobotix', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const cams = req.body?.cameras ?? req.body;
    if (!Array.isArray(cams)) return res.status(400).json({ success: false, error: 'Body must include a cameras array' });
    const prev = current.mobotix?.cameras || [];
    const cleaned = cams.map((c, i) => {
      const out = {
        name:       String(c.name || '').trim(),
        host:       String(c.host || '').trim(),
        username:   String(c.username || '').trim(),
        password:   (c.password && !String(c.password).includes('•')) ? String(c.password) : (prev[i]?.password || ''),
        https:      !!c.https,
        port:       parseInt(c.port) || 0,
        rtspPort:   parseInt(c.rtspPort) || 554,
        streamPath: String(c.streamPath || '').trim() || 'mobotix.mobotix.h264',
        door:       !!c.door,
      };
      if (prev[i]?.outputs) out.outputs = prev[i].outputs; // preserve door/relay outputs (config-only)
      return out;
    }).filter((c) => c.host);
    try {
      writeConfigFile({ ...current, mobotix: { ...current.mobotix, pollInterval: parseInt(req.body?.pollInterval) || current.mobotix?.pollInterval || 30, cameras: cleaned } });
      res.json({ success: true, message: `${cleaned.length} MOBOTIX camera(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-mobotix', requireAdmin, async (req, res) => {
    const cam = req.body || {};
    if (!cam.host) return res.status(400).json({ success: false, error: 'host is required' });
    try {
      const { buffer } = await require('../mobotix-client').fetchSnapshot(cam);
      res.json({ success: true, message: `Snapshot OK — ${(buffer.length / 1024).toFixed(0)} KB` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });
};
