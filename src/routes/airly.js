'use strict';

// Airly — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Airly ────────────────────────────────────────────────────────────────
  router.post('/settings/airly', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { lat, lon, name, pollInterval } = req.body;
    let { apiKey } = req.body;
    if (!apiKey || apiKey.includes('•')) apiKey = current.airly?.apiKey || '';
    try {
      writeConfigFile({
        ...current,
        airly: {
          apiKey,
          lat:          lat !== undefined && lat !== '' ? Number(lat) : current.airly?.lat,
          lon:          lon !== undefined && lon !== '' ? Number(lon) : current.airly?.lon,
          name:         (name || '').trim(),
          pollInterval: Math.max(parseInt(pollInterval) || 900, 300),
        },
      });
      res.json({ success: true, message: 'Airly settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-airly', requireAdmin, async (req, res) => {
    const current = readConfigFile();
    let { apiKey, lat, lon } = req.body;
    if (!apiKey || apiKey.includes('•')) apiKey = current.airly?.apiKey || '';
    if (!apiKey) return res.json({ success: false, error: 'API key is required' });
    if (lat === undefined || lat === '') lat = current.airly?.lat;
    if (lon === undefined || lon === '') lon = current.airly?.lon;
    if (lat == null || lon == null) return res.json({ success: false, error: 'Latitude and longitude are required' });
    try {
      const qs  = `lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lon)}`;
      const url = `https://airapi.airly.eu/v2/measurements/point?${qs}`;
      const response = await fetch(url, { headers: { apikey: apiKey } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.json({ success: false, error: data?.message || `HTTP ${response.status}` });
      }
      const caqi = (data.current?.indexes || []).find((i) => i.name === 'AIRLY_CAQI') || data.current?.indexes?.[0];
      res.json({
        success: true,
        message: `Connected — ${lat},${lon}: ${caqi ? `CAQI ${Math.round(caqi.value)} (${caqi.level})` : 'no current index'}`,
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });
};
