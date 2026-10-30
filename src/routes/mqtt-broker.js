'use strict';

// Built-in MQTT broker — status and settings. See src/mqtt-broker.js.
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;

  router.get('/mqtt-broker/status', (req, res) => {
    const cfg = readConfigFile().mqttBroker || {};
    res.json({ success: true, data: clients.mqttBroker ? clients.mqttBroker.status()
      : { enabled: !!cfg.enabled, listening: false, port: Number(cfg.port) || 1883, clients: [], messages: 0,
          error: cfg.enabled ? 'restart LSH to start the broker' : null } });
  });

  router.post('/settings/mqtt-broker', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const prev = current.mqttBroker || {};
    const b = req.body || {};
    const port = parseInt(b.port) || 1883;
    if (port < 1 || port > 65535) return res.status(400).json({ success: false, error: 'Port must be 1–65535' });
    const username = String(b.username || '').trim();
    const mqttBroker = {
      ...prev,
      enabled: !!b.enabled,
      port,
      username,
      password: username ? (b.password && !String(b.password).includes('•') ? String(b.password) : prev.password || '') : '',
    };
    try {
      writeConfigFile({ ...current, mqttBroker });
      res.json({ success: true, message: `MQTT broker ${mqttBroker.enabled ? 'enabled' : 'disabled'}. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
