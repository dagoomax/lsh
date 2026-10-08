'use strict';

// EV charging visualization (which Sketchfab car embeds on the Energy — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin, sensorRegistry } = ctx;

  // ── EV charging visualization (which Sketchfab car embeds on the Energy
  // tab's EV card(s)) — modelId/modelName are optional; the client falls
  // back to its own default (2025 Mercedes-Benz G-Class AMG G63) when unset.
  // `devices` maps a specific charger's device key to its own model, for
  // households running more than one EV — capped at 10 in the Settings UI
  // and on write below, matching the Energy tab's per-charger card cap. ────
  const DEFAULT_EV_MODEL_ID = 'f583b5bfc17346c08573dc4f1edebefe';
  const DEFAULT_EV_MODEL_NAME = '2025 Mercedes-Benz G-Class AMG G63';
  const MAX_EV_VEHICLES = 10;
  const SKETCHFAB_ID_RE = /^[a-f0-9]{32}$/;

  router.get('/ev-visual', (req, res) => {
    const ev = readConfigFile().evVisual || {};
    const modelId = ev.modelId || DEFAULT_EV_MODEL_ID;
    const modelName = ev.modelName || DEFAULT_EV_MODEL_NAME;
    res.json({
      success: true,
      // Top-level fields kept for standalone callers (e.g. GWagenEmbed used
      // without a deviceKey) that just want "the" default car.
      modelId, modelName,
      default: { modelId, modelName },
      devices: ev.devices || {},
    });
  });

  // EV charger devices currently registered, for the Settings picker to
  // build one row per real charger rather than free-text device keys.
  router.get('/settings/ev-charger-devices', requireAdmin, (req, res) => {
    const chargers = sensorRegistry.getDevices()
      .filter((d) => d.category === 'ev-charger')
      .slice(0, MAX_EV_VEHICLES)
      .map((d) => ({ key: d.key, label: d.label || d.key }));
    res.json({ success: true, devices: chargers });
  });

  router.post('/settings/ev-visual', requireAdmin, (req, res) => {
    const validateModel = (m) => {
      const modelId = String(m?.modelId || '').trim();
      if (modelId && !SKETCHFAB_ID_RE.test(modelId)) return null;
      return { modelId, modelName: String(m?.modelName || '').trim().slice(0, 120) };
    };

    const def = validateModel(req.body?.default);
    if (!def) return res.status(400).json({ success: false, error: 'Invalid Sketchfab model id (default)' });

    const devicesIn = req.body?.devices && typeof req.body.devices === 'object' ? req.body.devices : {};
    const devices = {};
    for (const key of Object.keys(devicesIn).slice(0, MAX_EV_VEHICLES)) {
      const m = validateModel(devicesIn[key]);
      if (!m) return res.status(400).json({ success: false, error: `Invalid Sketchfab model id for "${key}"` });
      if (m.modelId) devices[key] = m; // drop entries reset back to "default"
    }

    try {
      const cfg = readConfigFile();
      cfg.evVisual = { modelId: def.modelId, modelName: def.modelName, devices };
      writeConfigFile(cfg);
      const n = Object.keys(devices).length;
      res.json({ success: true, message: `EV visualization saved${n ? ` — ${n} vehicle(s) customized` : ''}.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/home-plan', requireAdmin, (req, res) => {
    const rooms = (Array.isArray(req.body?.rooms) ? req.body.rooms : [])
      .map((r) => ({
        name: String(r.name || '').trim().slice(0, 40),
        x: Math.max(0, Math.min(40, Number(r.x) || 0)),
        y: Math.max(0, Math.min(40, Number(r.y) || 0)),
        w: Math.max(1, Math.min(20, Number(r.w) || 2)),
        d: Math.max(1, Math.min(20, Number(r.d) || 2)),
        floor: ['cellar', 'floor1', 'floor2'].includes(r.floor) ? r.floor : 'floor1',
      }))
      .filter((r) => r.name);
    const floors = {};
    if (req.body?.floors && typeof req.body.floors === 'object') {
      for (const f of ['cellar', 'floor1', 'floor2']) {
        const src = req.body.floors[f];
        if (!src) continue;
        const image = String(src.image || '').trim().slice(0, 400);
        if (!image) continue;
        floors[f] = {
          image,
          w: Math.max(4, Math.min(40, Number(src.w) || 12)),
          h: Math.max(4, Math.min(40, Number(src.h) || 9)),
        };
      }
    }
    const defaultLayers = {};
    if (req.body?.defaultLayers && typeof req.body.defaultLayers === 'object') {
      for (const k of ['furniture', 'appliances', 'power', 'walls', 'textures', 'satellite', 'surroundings']) {
        if (typeof req.body.defaultLayers[k] === 'boolean') defaultLayers[k] = req.body.defaultLayers[k];
      }
    }
    try {
      const cfg = readConfigFile();
      cfg.homePlan = { rooms, floors, singleFloor: !!req.body?.singleFloor, defaultLayers };
      writeConfigFile(cfg);
      res.json({ success: true, message: `Saved ${rooms.length} room(s), ${Object.keys(floors).length} floor image(s)` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
