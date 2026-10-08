'use strict';

// Arduino MQTT — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Arduino MQTT ──────────────────────────────────────────────────────

  router.post('/settings/arduino', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { host, port, username, password, devices } = req.body;
    let parsed = [];
    if (Array.isArray(devices)) {
      parsed = devices;
    } else if (typeof devices === 'string') {
      try { parsed = JSON.parse(devices); } catch { return res.status(400).json({ success: false, error: 'Invalid devices JSON' }); }
    }
    const sanitized = parsed
      .filter(d => d.name && (d.stateTopic || (d.sensors || []).some(s => s.stateTopic)))
      .map(d => ({
        name:         (d.name         || '').trim(),
        key:          (d.key          || '').trim() || undefined,
        stateTopic:   (d.stateTopic   || '').trim() || undefined,
        commandTopic: (d.commandTopic || '').trim() || undefined,
        sensors:      (d.sensors || []).map(s => ({
          path:         (s.path         || '').trim(),
          label:        (s.label        || '').trim() || undefined,
          unit:         (s.unit         || '').trim() || undefined,
          type:         (s.type         || '').trim() || undefined,
          stateTopic:   (s.stateTopic   || '').trim() || undefined,
          commandTopic: (s.commandTopic || '').trim() || undefined,
          payloadOn:    (s.payloadOn    || '').trim() || undefined,
          payloadOff:   (s.payloadOff   || '').trim() || undefined,
          min:          s.min != null ? Number(s.min) : undefined,
          max:          s.max != null ? Number(s.max) : undefined,
          jsonKey:      (s.jsonKey      || '').trim() || undefined,
        })).filter(s => s.path),
      }));
    try {
      writeConfigFile({
        ...current,
        arduino: {
          host:     (host || '').trim(),
          port:     parseInt(port) || 1883,
          username: (username || '').trim(),
          password: (password && !password.includes('•')) ? password : (current.arduino?.password || ''),
          devices:  sanitized,
        },
      });
      res.json({ success: true, message: `Arduino saved (${sanitized.length} device(s)). Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
