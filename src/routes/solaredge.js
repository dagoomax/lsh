'use strict';

// SolarEdge — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin, store } = ctx;

  // ── SolarEdge ─────────────────────────────────────────────

  router.get('/solaredge', (req, res) => {
    res.json({ success: true, data: store.getGrouped().solaredge });
  });

  router.post('/settings/test-solaredge', requireAdmin, async (req, res) => {
    const { siteId, apiKey } = req.body;
    if (!siteId || !apiKey) {
      return res.status(400).json({ success: false, error: 'siteId and apiKey are required' });
    }
    try {
      const r = await fetch(
        `https://monitoringapi.solaredge.com/site/${siteId}/overview?api_key=${apiKey}`
      );
      if (r.status === 403 || r.status === 401) {
        return res.json({ success: false, error: 'Invalid API key or site ID' });
      }
      if (!r.ok) {
        return res.json({ success: false, error: `SolarEdge returned HTTP ${r.status}` });
      }
      const data = await r.json();
      const power = data?.overview?.currentPower?.power ?? null;
      const energy = data?.overview?.lastDayData?.energy ?? null;
      res.json({
        success: true,
        message: `Connected — site ${siteId}`,
        data: { currentPower: power, dailyEnergy: energy },
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/solaredge', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { siteId, apiKey } = req.body;
    const updated = {
      ...current,
      solaredge: {
        siteId: siteId ?? current.solaredge?.siteId ?? '',
        apiKey: (apiKey && !apiKey.includes('•')) ? apiKey : (current.solaredge?.apiKey ?? ''),
      },
    };
    try {
      writeConfigFile(updated);
      res.json({ success: true, message: 'SolarEdge settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
