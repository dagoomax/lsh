'use strict';

// Axis (VAPIX) — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Axis (VAPIX) ──────────────────────────────────────────
  router.post('/settings/axis', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const cams = req.body?.cameras ?? req.body;
    if (!Array.isArray(cams)) return res.status(400).json({ success: false, error: 'Body must include a cameras array' });
    const prev = current.axis?.cameras || [];
    const cleaned = cams.map((c, i) => {
      const out = {
        name:       String(c.name || '').trim(),
        host:       String(c.host || '').trim(),
        username:   String(c.username || '').trim(),
        password:   (c.password && !String(c.password).includes('•')) ? String(c.password) : (prev[i]?.password || ''),
        auth:       c.auth === 'basic' ? 'basic' : 'digest',
        https:      !!c.https,
        port:       parseInt(c.port) || 0,
        rtspPort:   parseInt(c.rtspPort) || 554,
        ptz:        !!c.ptz,
        ir:         !!c.ir,
        resolution: String(c.resolution || '').trim(),
      };
      if (prev[i]?.outputs) out.outputs = prev[i].outputs; // preserve relay outputs (config-only)
      return out;
    }).filter((c) => c.host);
    try {
      writeConfigFile({ ...current, axis: { ...current.axis, pollInterval: parseInt(req.body?.pollInterval) || current.axis?.pollInterval || 30, cameras: cleaned } });
      res.json({ success: true, message: `${cleaned.length} Axis camera(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-axis', requireAdmin, async (req, res) => {
    const cam = req.body || {};
    if (!cam.host) return res.status(400).json({ success: false, error: 'host is required' });
    try {
      const { buffer } = await require('../axis-client').fetchSnapshot(cam);
      res.json({ success: true, message: `Snapshot OK — ${(buffer.length / 1024).toFixed(0)} KB` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });
};
