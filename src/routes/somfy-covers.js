'use strict';

// Somfy covers (casablanca TaHoma) — token/Loxone-friendly per-cover API — split out of src/api-routes.js; registered in order by createApiRoutes().

module.exports = function register(router, ctx) {
  const { sensorRegistry, store } = ctx;

  // ── Somfy covers (casablanca TaHoma) — token/Loxone-friendly per-cover API ──
  // Cover keys look like somfy/io___<pin>_<id>; :id is the trailing device id.
  const somfyFind = (id) => (sensorRegistry ? sensorRegistry.getDevices() : [])
    .find((d) => d.type === 'somfy' && d.key.split('_').pop() === String(id));

  //   GET /api/somfy/devices?token=…  → list of covers with capabilities
  router.get('/somfy/devices', (req, res) => {
    const list = (sensorRegistry ? sensorRegistry.getDevices() : [])
      .filter((d) => d.type === 'somfy')
      .map((d) => ({
        id:    d.key.split('_').pop(),
        key:   d.key,
        label: d.label,
        my:    (d.sensors || []).some((s) => s.path === 'my'),
        tilt:  (d.sensors || []).some((s) => s.path === 'tilt'),
      }));
    res.json({ success: true, devices: list });
  });

  //   GET /api/somfy/:id/status?token=…  → position / tilt (Virtual HTTP Input)
  router.get('/somfy/:id/status', (req, res) => {
    const dev = somfyFind(req.params.id);
    if (!dev) return res.status(404).json({ success: false, error: 'Cover not found' });
    const g = (p) => store.get(`${dev.key}/${p}`);
    res.json({ success: true, id: req.params.id, key: dev.key, label: dev.label, position: g('level'), tilt: g('tilt') });
  });

  //   GET /api/somfy/:id/cmd/<action>?token=…  (Virtual Output → HTTP GET)
  //   actions: open | close | stop | my | position?value=0..100 | tilt?value=0..100
  router.get('/somfy/:id/cmd/:action', async (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    const dev = somfyFind(req.params.id);
    if (!dev) return res.status(404).json({ success: false, error: 'Cover not found' });
    const action = String(req.params.action).toLowerCase();
    const value  = req.query.value ?? req.query.level;
    // Prefer the dedicated up/down sensors (real RTS up()/down() commands);
    // fall back to the open/close toggle for covers that don't expose them.
    const hasUpDown = (dev.sensors || []).some((s) => s.path === 'up');
    const MAP = {
      open: ['switch', 1], close: ['switch', 0],
      on:   ['switch', 1], off:   ['switch', 0],   // TaHoma lights / on-off modules
      up:   hasUpDown ? ['up', 1]   : ['switch', 1],
      down: hasUpDown ? ['down', 1] : ['switch', 0],
      stop: ['stop', 1], my: ['my', 1],
      position: ['level', value], level: ['level', value], tilt: ['tilt', value],
      brightness: ['level', value],                 // alias for lights
    };
    const m = MAP[action];
    if (!m) return res.status(400).json({ success: false, error: `Unknown action '${action}'` });
    if (m[1] === undefined) return res.status(400).json({ success: false, error: `Action '${action}' requires ?value=` });
    try {
      await sensorRegistry.sendCommand(dev.key, m[0], m[1]);
      res.json({ success: true, id: req.params.id, action });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
};
