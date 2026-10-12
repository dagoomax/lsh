'use strict';

// UniFi Protect — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin, unifiProtect } = ctx;

  // ── UniFi Protect ─────────────────────────────────────────

  router.post('/settings/test-unifi', requireAdmin, async (req, res) => {
    const https = require('https');
    const { host, username, password, apiKey } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'Host is required' });
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['X-API-Key'] = apiKey;
      const p = new Promise((resolve, reject) => {
        const body = JSON.stringify({ username, password });
        const r = https.request({
          hostname: host, path: apiKey ? '/proxy/protect/integration/v1/meta/info' : '/api/auth/login',
          method: apiKey ? 'GET' : 'POST', headers, rejectUnauthorized: false,
        }, res2 => {
          let d = '';
          res2.on('data', c => d += c);
          res2.on('end', () => resolve(res2.statusCode));
        });
        r.on('error', reject);
        if (!apiKey) r.write(body);
        r.end();
      });
      const status = await p;
      if (status === 200) res.json({ success: true, message: `Connected to ${host}` });
      else res.json({ success: false, error: `HTTP ${status}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Fire a Protect Alarm Manager webhook trigger (Alarm Manager → trigger
  // "Webhook" → its id) — for flows / Loxone: POST /api/unifi/alarm/<id>
  router.post('/unifi/alarm/:triggerId', requireAdmin, async (req, res) => {
    if (!unifiProtect) return res.status(409).json({ success: false, error: 'UniFi Protect isn’t set up' });
    try { await unifiProtect.triggerAlarm(req.params.triggerId); res.json({ success: true }); }
    catch (err) { res.status(err.status === 404 ? 404 : 400).json({ success: false, error: err.message }); }
  });

  router.post('/settings/unifi', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { host, username, password, apiKey } = req.body;
    const updated = {
      ...current,
      unifi: {
        ...(current.unifi || {}), // keep createStreams / streamQuality / sirenDuration / ringPollInterval
        host:     host     || current.unifi?.host     || '',
        username: username || current.unifi?.username || '',
        password: (password && !password.includes('•')) ? password : (current.unifi?.password || ''),
        apiKey:   (apiKey   && !apiKey.includes('•'))   ? apiKey   : (current.unifi?.apiKey   || ''),
      },
    };
    try {
      writeConfigFile(updated);
      res.json({ success: true, message: 'UniFi Protect settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
