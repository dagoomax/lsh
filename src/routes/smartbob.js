'use strict';

// SmartBob — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── SmartBob ──────────────────────────────────────────────────────────

  router.post('/settings/test-smartbob', requireAdmin, (req, res) => {
    const { host, port = 1883 } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });
    const net = require('net');
    const sock = new net.Socket();
    let done = false;
    const finish = (ok, msg) => {
      if (done) return; done = true;
      sock.destroy();
      res.json({ success: ok, [ok ? 'message' : 'error']: msg });
    };
    sock.setTimeout(5000);
    sock.connect(parseInt(port), host, () => finish(true, `TCP connection to ${host}:${port} succeeded (MQTT broker reachable)`));
    sock.on('error',   err => finish(false, err.message));
    sock.on('timeout', ()  => finish(false, `Connection to ${host}:${port} timed out`));
  });

  router.post('/settings/smartbob', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { host, port, name, username, password, entities } = req.body;
    const sanitized = (entities || []).map(e => ({
      name:         (e.name         || '').trim(),
      stateTopic:   (e.stateTopic   || '').trim(),
      commandTopic: (e.commandTopic || '').trim() || undefined,
      type:         (e.type         || 'switch').trim(),
      payloadOn:    (e.payloadOn    || 'ON').trim(),
      payloadOff:   (e.payloadOff   || 'OFF').trim(),
      unit:         (e.unit         || '').trim() || undefined,
      homekitType:  (e.homekitType  || '').trim() || undefined,
    })).filter(e => e.stateTopic);
    try {
      writeConfigFile({
        ...current,
        smartbob: {
          host:     (host || '').trim(),
          port:     parseInt(port) || 1883,
          name:     (name || 'SmartBob').trim(),
          username: (username || '').trim(),
          password: (password && !password.includes('•')) ? password : (current.smartbob?.password || ''),
          entities: sanitized,
        },
      });
      res.json({ success: true, message: `SmartBob saved (${sanitized.length} entity(s)). Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
