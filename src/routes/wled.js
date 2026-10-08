'use strict';

// WLED — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── WLED ─────────────────────────────────────────────────────────────────────

  router.post('/settings/wled', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const devs = req.body?.devices ?? req.body;
    if (!Array.isArray(devs)) return res.status(400).json({ success: false, error: 'Body must include a devices array' });
    const cleaned = devs.map((d) => ({
      name: String(d.name || '').trim(),
      host: String(d.host || '').trim(),
      port: parseInt(d.port) || 80,
    })).filter((d) => d.host);
    try {
      writeConfigFile({
        ...current,
        wled: {
          ...current.wled,
          pollInterval: parseInt(req.body?.pollInterval) || current.wled?.pollInterval || 5,
          devices: cleaned,
        },
      });
      res.json({ success: true, message: `${cleaned.length} WLED controller(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-wled', requireAdmin, async (req, res) => {
    const d = req.body || {};
    if (!d.host) return res.status(400).json({ success: false, error: 'host is required' });
    try {
      const j = await require('../wled-client').fetchState(d);
      const info = j.info || {};
      const leds = info.leds?.count;
      res.json({ success: true, message: `${info.name || 'WLED'} — ${leds != null ? leds + ' LEDs' : 'connected'}${info.ver ? ' · v' + info.ver : ''}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/homey', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { mode, host, homeyId, token, pollInterval } = req.body;
    try {
      writeConfigFile({
        ...current,
        homey: {
          mode:         mode         || current.homey?.mode         || 'local',
          host:         host         || current.homey?.host         || '',
          homeyId:      homeyId      || current.homey?.homeyId      || '',
          token:        (token && !token.includes('•')) ? token : (current.homey?.token || ''),
          pollInterval: pollInterval != null ? parseInt(pollInterval) : (current.homey?.pollInterval ?? 10),
        },
      });
      res.json({ success: true, message: 'Homey settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
