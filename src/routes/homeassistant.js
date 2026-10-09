'use strict';

// Home Assistant — status, entity list and settings (applied live: the client
// is restarted on save). Client: src/homeassistant-client.js.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

const MASK = '••••••••';
// Same as the client's DEFAULT_DOMAINS (the client is an on-demand module and may not be installed yet)
const DEFAULT_DOMAINS = ['light', 'switch', 'cover', 'climate', 'lock', 'fan', 'sensor', 'binary_sensor', 'input_boolean'];

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store, sensorRegistry } = ctx;

  router.get('/homeassistant/status', (req, res) => {
    const c = clients.homeassistant;
    res.json({ success: true, data: c ? c.getStatus() : null });
  });

  // Camera proxy (snapshot / live MJPEG) — the HA token stays on the server
  router.get('/homeassistant/camera/:entity/:kind(snapshot|mjpeg)', (req, res) => {
    const c = clients.homeassistant;
    if (!c) return res.status(404).end();
    c.proxyCamera(req.params.entity, req.params.kind, req, res);
  });

  // Every HA entity seen at the last sync (for choosing what to import)
  router.get('/homeassistant/entities', requireAdmin, (req, res) => {
    const c = clients.homeassistant;
    res.json({ success: true, data: c ? c.listAvailable() : [] });
  });

  // What would be / is exported to HA over MQTT Discovery
  router.get('/homeassistant/export-plan', requireAdmin, (req, res) => {
    const c = clients.homeassistant;
    if (!c) return res.json({ success: true, data: [] });
    res.json({ success: true, data: c.exportPlan().map((p) => ({ objectId: p.objectId, component: p.component, device: p.device.label || p.deviceKey, deviceKey: p.deviceKey, path: p.path, label: p.sensor.label || p.path })) });
  });

  // Remove every LSH entity from HA (empty retained discovery configs)
  router.post('/homeassistant/unpublish', requireAdmin, (req, res) => {
    const c = clients.homeassistant;
    if (!c?.mqtt) return res.status(409).json({ success: false, error: 'Export is not running' });
    res.json({ success: true, data: { removed: c.unpublishAll() } });
  });

  router.get('/settings/homeassistant', requireAdmin, (req, res) => {
    const h = readConfigFile().homeassistant || {};
    const ex = h.export || {};
    res.json({
      success: true,
      data: {
        url: h.url || '', token: h.token ? MASK : '',
        import: { enabled: h.import?.enabled !== false, cameras: h.import?.cameras !== false, domains: h.import?.domains || [], entities: h.import?.entities || [] },
        export: { enabled: !!ex.enabled, mqttUrl: ex.mqttUrl || '', username: ex.username || '', password: ex.password ? MASK : '',
          prefix: ex.prefix || 'homeassistant', base: ex.base || 'lsh', node: ex.node || 'lsh', types: ex.types || [] },
        defaultDomains: DEFAULT_DOMAINS,
        types: [...new Set(sensorRegistry.getDevices().map((d) => d.type).filter((t) => t && t !== 'homeassistant'))].sort(),
      },
    });
  });

  router.post('/settings/homeassistant', requireAdmin, async (req, res) => {
    const current = readConfigFile();
    const prev = current.homeassistant || {};
    const b = req.body || {};
    const keep = (v, old) => (String(v ?? '').includes('•') ? old : String(v ?? '').trim());
    const list = (v) => (Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter(Boolean) : []);
    const url = String(b.url ?? '').trim().replace(/\/+$/, '');
    const token = keep(b.token, prev.token);
    const ex = b.export || {};
    const errors = [];
    if (url && !/^https?:\/\/[^\s/]+/.test(url)) errors.push('Home Assistant URL must start with http:// or https://');
    if (url && !token) errors.push('A long-lived access token is needed (HA → Profile → Security)');
    if (ex.enabled && !/^mqtts?:\/\/[^\s/]+/.test(String(ex.mqttUrl || ''))) errors.push('Export needs the MQTT broker HA uses, e.g. mqtt://192.168.1.10:1883');
    const topic = /^[A-Za-z0-9_-]+$/;
    for (const [k, v] of [['prefix', ex.prefix || 'homeassistant'], ['base', ex.base || 'lsh'], ['node', ex.node || 'lsh']]) {
      if (!topic.test(v)) errors.push(`Export ${k} may only contain letters, digits, _ and -`);
    }
    if (errors.length) return res.status(400).json({ success: false, error: errors.join(' · ') });

    const homeassistant = {
      url: url || undefined, token: token || undefined,
      import: { enabled: b.import?.enabled !== false, cameras: b.import?.cameras !== false, domains: list(b.import?.domains), entities: list(b.import?.entities) },
      export: {
        enabled: !!ex.enabled, mqttUrl: String(ex.mqttUrl || '').trim() || undefined,
        username: String(ex.username || '').trim() || undefined, password: keep(ex.password, prev.export?.password) || undefined,
        prefix: ex.prefix || 'homeassistant', base: ex.base || 'lsh', node: ex.node || 'lsh', types: list(ex.types),
      },
    };
    try {
      writeConfigFile({ ...current, homeassistant });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    // Apply now: restart the client with the new settings
    try {
      clients.homeassistant?.stop();
      delete clients.homeassistant;
      if ((homeassistant.url && homeassistant.token) || homeassistant.export.enabled) {
        const HomeAssistantClient = require('../homeassistant-client');
        const c = new HomeAssistantClient({ ...current, homeassistant }, store, sensorRegistry);
        await c.start();
        clients.homeassistant = c;
      }
      res.json({ success: true, message: 'Saved and applied.' });
    } catch (err) {
      res.json({ success: true, message: `Saved; restart LSH to apply (${err.message}).` });
    }
  });
};
