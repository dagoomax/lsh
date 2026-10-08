'use strict';

// Grenton (GATE HTTP) — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Grenton (GATE HTTP) ─────────────────────────────────────
  router.post('/settings/grenton', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { host, port, path: gpath, token, pollInterval, devices } = req.body;
    if (!Array.isArray(devices)) return res.status(400).json({ success: false, error: 'devices array is required' });
    // Preserve advanced per-device fields (scale/getIndex/commands) by object
    // name — they're config-only, not exposed in the Settings form.
    const prevByObj = {};
    for (const p of (current.grenton?.devices || [])) if (p.object) prevByObj[p.object] = p;
    const cleaned = devices.map((d) => {
      const out = {
        name:   String(d.name || '').trim(),
        object: String(d.object || '').trim(),
        type:   d.type || 'switch',
      };
      const p = prevByObj[out.object];
      if (p) for (const k of ['scale', 'getIndex', 'commands']) if (p[k] !== undefined) out[k] = p[k];
      return out;
    }).filter((d) => d.object);
    try {
      writeConfigFile({
        ...current,
        grenton: {
          ...current.grenton,
          host:         host || current.grenton?.host || '',
          port:         parseInt(port) || current.grenton?.port || 80,
          path:         gpath || current.grenton?.path || '/lsh',
          token:        (token && !token.includes('•')) ? token : (current.grenton?.token || ''),
          pollInterval: parseInt(pollInterval) || 5,
          devices:      cleaned,
        },
      });
      res.json({ success: true, message: `Grenton saved — ${cleaned.length} device(s). Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
