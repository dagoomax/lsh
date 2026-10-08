'use strict';

// MQTT Explorer — split out of src/api-routes.js; registered in order by createApiRoutes().

module.exports = function register(router, ctx) {
  const { mqttExplorer, requireAdmin } = ctx;

  // ── MQTT Explorer ──────────────────────────────────────────────────────

  router.get('/mqtt-explorer/topics', (req, res) => {
    if (!mqttExplorer) return res.json({ success: true, data: [], connected: false });
    res.json({
      success:   true,
      connected: mqttExplorer.connected,
      data:      mqttExplorer.getTopics(),
    });
  });

  router.get('/mqtt-explorer/history', (req, res) => {
    if (!mqttExplorer) return res.json({ success: true, data: [] });
    const topic = req.query.topic;
    if (!topic) return res.status(400).json({ success: false, error: 'topic query param required' });
    res.json({ success: true, data: mqttExplorer.getHistory(topic) });
  });

  router.post('/mqtt-explorer/publish', requireAdmin, async (req, res) => {
    if (!mqttExplorer) return res.status(503).json({ success: false, error: 'MQTT explorer not available' });
    const { topic, payload, retain } = req.body;
    if (!topic) return res.status(400).json({ success: false, error: 'topic required' });
    try {
      await mqttExplorer.publish(topic, payload ?? '', !!retain);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/mqtt-explorer/subscribe', requireAdmin, (req, res) => {
    if (!mqttExplorer) return res.status(503).json({ success: false, error: 'MQTT explorer not available' });
    const { pattern } = req.body;
    if (!pattern) return res.status(400).json({ success: false, error: 'pattern required' });
    mqttExplorer.subscribe(pattern);
    res.json({ success: true });
  });

  router.post('/mqtt-explorer/clear', requireAdmin, (req, res) => {
    if (!mqttExplorer) return res.status(503).json({ success: false, error: 'MQTT explorer not available' });
    mqttExplorer.clear();
    res.json({ success: true });
  });
};
