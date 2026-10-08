'use strict';

// MC6 Thermostats — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;

  // ── MC6 Thermostats ────────────────────────────────────────────────────

  router.post('/settings/mc6', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { broker, port, username, password, devices } = req.body;
    if (!broker) return res.status(400).json({ success: false, error: 'broker is required' });
    if (!Array.isArray(devices) || !devices.length)
      return res.status(400).json({ success: false, error: 'devices array is required' });

    const sanitized = devices.map(d => ({
      name: (d.name || '').trim(),
      mac:  (d.mac  || '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase(),
    })).filter(d => d.mac.length === 12);

    try {
      writeConfigFile({
        ...current,
        mc6: {
          broker,
          port:     port ? parseInt(port) : 1883,
          username: username || '',
          password: password || '',
          devices:  sanitized,
        },
      });
      res.json({ success: true, message: `${sanitized.length} MC6 device(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // clients.mc6 (not a destructured local) — see the note on the SmartThings
  // sendSmartThingsCommand() helper above for why: the client is registered
  // onto apiClients after createApiRoutes() already ran.
  function mc6Client() {
    const mc6 = clients.mc6;
    if (!mc6) throw new Error('MC6 not configured');
    return mc6;
  }

  const normalizeMac = mac => (mac || '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase();

  router.get('/mc6/:mac/schedule', (req, res) => {
    try {
      res.json({ success: true, data: mc6Client().listSchedules(normalizeMac(req.params.mac)) });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/mc6/:mac/timer', requireAdmin, (req, res) => {
    const { minutes, action } = req.body;
    try {
      const data = mc6Client().setCountdownTimer(normalizeMac(req.params.mac), parseFloat(minutes), action || 'off');
      res.json({ success: true, data });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/mc6/:mac/timer', requireAdmin, (req, res) => {
    try {
      mc6Client().clearCountdownTimer(normalizeMac(req.params.mac));
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/mc6/:mac/schedule', requireAdmin, (req, res) => {
    const { time, action, days, enabled } = req.body;
    try {
      const entry = mc6Client().addDailySchedule(normalizeMac(req.params.mac), { time, action, days, enabled });
      res.json({ success: true, data: entry });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/mc6/:mac/schedule/:id', requireAdmin, (req, res) => {
    try {
      const removed = mc6Client().removeDailySchedule(normalizeMac(req.params.mac), req.params.id);
      if (!removed) return res.status(404).json({ success: false, error: 'Schedule entry not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
};
