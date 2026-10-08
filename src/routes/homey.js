'use strict';

// Homey — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Homey ──────────────────────────────────────────────────────────────

  router.post('/settings/test-homey', requireAdmin, async (req, res) => {
    const { mode = 'local', host, homeyId, token } = req.body;
    if (!token) return res.status(400).json({ success: false, error: 'token is required' });

    let baseUrl;
    if (mode === 'cloud') {
      if (!homeyId) return res.status(400).json({ success: false, error: 'homeyId is required for cloud mode' });
      baseUrl = `https://${homeyId}.connect.athom.com`;
    } else {
      if (!host) return res.status(400).json({ success: false, error: 'host is required for local mode' });
      baseUrl = `http://${host}`;
    }

    try {
      const r = await fetch(`${baseUrl}/api/manager/devices/device`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return res.json({ success: false, error: `HTTP ${r.status} — check host and token` });
      const data = await r.json();
      const count = Array.isArray(data) ? data.length : Object.keys(data).length;
      res.json({ success: true, message: `Connected — ${count} device(s) found` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/homeconnect', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { clientId, clientSecret, simulator } = req.body;
    try {
      writeConfigFile({
        ...current,
        homeConnect: {
          ...current.homeConnect,
          clientId:     clientId || current.homeConnect?.clientId || '',
          clientSecret: (clientSecret && !clientSecret.includes('•')) ? clientSecret : (current.homeConnect?.clientSecret || ''),
          simulator:    !!simulator,
        },
      });
      res.json({ success: true, message: 'Home Connect settings saved. Run scripts/homeconnect-auth.js to authorize, then restart.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/miele', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { clientId, clientSecret, username, password, country } = req.body;
    try {
      writeConfigFile({
        ...current,
        miele: {
          ...current.miele,
          clientId:     clientId || current.miele?.clientId || '',
          clientSecret: (clientSecret && !clientSecret.includes('•')) ? clientSecret : (current.miele?.clientSecret || ''),
          username:     username || current.miele?.username || '',
          password:     (password && !password.includes('•')) ? password : (current.miele?.password || ''),
          country:      country || current.miele?.country || 'de-DE',
        },
      });
      res.json({ success: true, message: 'Miele settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
