'use strict';

// Device customization (room / icon / label) — split out of src/api-routes.js; registered in order by createApiRoutes().
const { editPinOk, readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { sensorRegistry } = ctx;

  // ── Device customization (room / icon / label) ────────────
  // Optionally locked with a PIN (config.editPin, set in Settings → Security).

  router.get('/edit-pin/status', (req, res) => {
    res.json({ success: true, enabled: !!readConfigFile().editPin });
  });

  router.post('/edit-pin/verify', (req, res) => {
    res.json({ success: true, ok: editPinOk(req) });
  });

  router.post('/device/:key/customize', (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    if (!editPinOk(req)) return res.status(403).json({ success: false, error: 'PIN_REQUIRED' });
    try {
      const dev = sensorRegistry.setOverride(req.params.key, req.body || {});
      res.json({ success: true, device: { key: dev.key, label: dev.label, room: dev.room || null, customIcon: dev.customIcon || null } });
    } catch (err) {
      res.status(404).json({ success: false, error: err.message });
    }
  });

  router.get('/rooms', (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    res.json({ success: true, rooms: sensorRegistry.getRoomMeta() });
  });

  router.post('/room/:name/icon', (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    if (!editPinOk(req)) return res.status(403).json({ success: false, error: 'PIN_REQUIRED' });
    try {
      res.json({ success: true, rooms: sensorRegistry.setRoomIcon(req.params.name, req.body?.icon) });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/plan-decor', (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    res.json({ success: true, decor: sensorRegistry.getDecor() });
  });

  router.post('/plan-decor', (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    if (!editPinOk(req)) return res.status(403).json({ success: false, error: 'PIN_REQUIRED' });
    const { op, floor, emoji, image, hideAuto, id, x, y } = req.body || {};
    try {
      let decor;
      if (op === 'add') decor = sensorRegistry.addDecor(floor, emoji, x, y, { image, hideAuto });
      else if (op === 'move') decor = sensorRegistry.moveDecor(id, x, y);
      else if (op === 'remove') decor = sensorRegistry.removeDecor(id);
      else if (op === 'hide') decor = sensorRegistry.hideAutoDecor(id);
      else return res.status(400).json({ success: false, error: `Unknown op '${op}'` });
      res.json({ success: true, decor });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
};
