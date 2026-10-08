'use strict';

// Satel INTEGRA — split out of src/api-routes.js; registered in order by createApiRoutes().
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin, sensorRegistry } = ctx;

  // ── Satel INTEGRA ─────────────────────────────────────────
  // Live state + control for zones (inputs), outputs and partitions.
  const satelList = (kind) => (sensorRegistry ? sensorRegistry.getDevices() : [])
    .filter((d) => d.type === 'satel' && d.key.startsWith(`satel/${kind}/`))
    .map((d) => sensorRegistry.getDeviceReadings(d.key))
    .sort((a, b) => (+a.key.split('/').pop()) - (+b.key.split('/').pop()));
  const rv = (d, path) => (d.readings?.[path]?.value ?? 0) === 1;
  const zoneKind = (d) => (d.homekit || []).includes('motion') ? 'motion'
    : (d.homekit || []).includes('contact') ? 'contact' : 'other';

  router.get('/satel/zones', (req, res) => {
    res.json({ success: true, data: satelList('zone').map((d) => ({
      num: +d.key.split('/').pop(), key: d.key, label: d.label, kind: zoneKind(d),
      violation: rv(d, 'state'), tamper: rv(d, 'tamper'), alarm: rv(d, 'alarm'),
    })) });
  });

  router.get('/satel/outputs', (req, res) => {
    res.json({ success: true, data: satelList('output').map((d) => ({
      num: +d.key.split('/').pop(), key: d.key, label: d.label, on: rv(d, 'state'),
    })) });
  });

  router.get('/satel/partitions', (req, res) => {
    res.json({ success: true, data: satelList('partition').map((d) => ({
      num: +d.key.split('/').pop(), key: d.key, label: d.label,
      armed: rv(d, 'armed'), alarm: rv(d, 'alarm'), fireAlarm: rv(d, 'fire_alarm'),
    })) });
  });

  router.get('/satel/status', (req, res) => {
    const zones = satelList('zone'), outputs = satelList('output'), partitions = satelList('partition');
    res.json({ success: true, data: {
      configured: !!readConfigFile().satel?.host,
      zones:      { total: zones.length,   open: zones.filter((d) => rv(d, 'state')).length },
      outputs:    { total: outputs.length, on:   outputs.filter((d) => rv(d, 'state')).length },
      partitions: partitions.map((d) => ({
        num: +d.key.split('/').pop(), label: d.label, armed: rv(d, 'armed'), alarm: rv(d, 'alarm'),
      })),
    } });
  });

  // Control an output — body: { state: true | false | "on" | "off" }
  router.post('/satel/output/:num', requireAdmin, async (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    try {
      await sensorRegistry.sendCommand(`satel/output/${req.params.num}`, 'state', req.body?.state);
      res.json({ success: true });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
  });

  // Arm / disarm a partition
  router.post('/satel/partition/:num/:action(arm|disarm)', requireAdmin, async (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    try {
      await sensorRegistry.sendCommand(`satel/partition/${req.params.num}`, 'armed', req.params.action === 'arm');
      res.json({ success: true });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
  });
};
