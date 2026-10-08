'use strict';

// OpenWeatherMap — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── OpenWeatherMap ───────────────────────────────────────────────────────
  router.post('/settings/openweather', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { lat, lon, name, units, pollInterval } = req.body;
    let { apiKey } = req.body;
    if (!apiKey || apiKey.includes('•')) apiKey = current.openweather?.apiKey || '';
    try {
      writeConfigFile({
        ...current,
        openweather: {
          apiKey,
          lat:          lat !== undefined && lat !== '' ? Number(lat) : current.openweather?.lat,
          lon:          lon !== undefined && lon !== '' ? Number(lon) : current.openweather?.lon,
          name:         (name || '').trim(),
          units:        units === 'imperial' ? 'imperial' : 'metric',
          pollInterval: Math.max(parseInt(pollInterval) || 600, 60),
        },
      });
      res.json({ success: true, message: 'OpenWeatherMap settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-openweather', requireAdmin, async (req, res) => {
    const current = readConfigFile();
    let { apiKey, lat, lon, units } = req.body;
    if (!apiKey || apiKey.includes('•')) apiKey = current.openweather?.apiKey || '';
    if (!apiKey) return res.json({ success: false, error: 'API key is required' });
    if (lat === undefined || lat === '') lat = current.openweather?.lat;
    if (lon === undefined || lon === '') lon = current.openweather?.lon;
    if (lat == null || lon == null) return res.json({ success: false, error: 'Latitude and longitude are required' });
    try {
      const u = units === 'imperial' ? 'imperial' : 'metric';
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=${u}&appid=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.json({ success: false, error: data?.message || `HTTP ${response.status}` });
      }
      const temp = data.main?.temp;
      const desc = data.weather?.[0]?.description;
      res.json({
        success: true,
        message: `Connected — ${data.name || `${lat},${lon}`}: ${temp != null ? `${temp}°${u === 'imperial' ? 'F' : 'C'}` : '?'}${desc ? `, ${desc}` : ''}`,
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });
};
