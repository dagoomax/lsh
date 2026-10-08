'use strict';

// Devices / Sensors — split out of src/api-routes.js; registered in order by createApiRoutes().

module.exports = function register(router, ctx) {
  const { requireAdmin, sensorRegistry } = ctx;

  // ── Devices / Sensors ─────────────────────────────────────
  router.get('/devices', (req, res) => {
    const devices = sensorRegistry ? sensorRegistry.getAllReadings() : [];
    res.json({ success: true, data: devices });
  });

  router.get('/devices/:deviceKey(*)', (req, res) => {
    if (!sensorRegistry) return res.json({ success: true, data: null });
    const data = sensorRegistry.getDeviceReadings(req.params.deviceKey);
    if (!data) return res.status(404).json({ success: false, error: 'Device not found' });
    const { sensor } = req.query;
    if (sensor) {
      const reading = data.readings?.[sensor];
      if (!reading) return res.status(404).json({ success: false, error: `Sensor '${sensor}' not found` });
      return res.send(String(reading.value));
    }
    res.json({ success: true, data });
  });

  router.post('/device/:deviceKey(*)/command', requireAdmin, async (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    const { sensor, value, on } = req.body;
    const cmdValue = value !== undefined ? value : on; // support both 'value' and legacy 'on'
    if (typeof sensor !== 'string' || cmdValue === undefined) {
      return res.status(400).json({ success: false, error: 'Body must contain { sensor: string, value: any }' });
    }
    try {
      await sensorRegistry.sendCommand(req.params.deviceKey, sensor, cmdValue);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // GET version — browser/Loxone friendly: /api/device/{key}/set?sensor=…&value=…&token=…
  router.get('/device/:deviceKey(*)/set', async (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    const { sensor, value } = req.query;
    if (typeof sensor !== 'string' || value === undefined) {
      return res.status(400).json({ success: false, error: 'Query must contain sensor and value' });
    }
    try {
      await sensorRegistry.sendCommand(req.params.deviceKey, sensor, value);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
};
