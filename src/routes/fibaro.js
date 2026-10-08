'use strict';

// Fibaro Home Center — split out of src/api-routes.js; registered in order by createApiRoutes().
const http = require('http');
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Fibaro Home Center ────────────────────────────────────────────────

  router.post('/settings/test-fibaro', requireAdmin, async (req, res) => {
    const { host, port = 80, username = 'admin', password = '' } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host is required' });
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    const reqHttp = http.get(
      { hostname: host, port: parseInt(port), path: '/api/loginStatus', timeout: 6000,
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
      r => {
        const chunks = [];
        r.on('data', d => chunks.push(d));
        r.on('end', () => {
          if (r.statusCode === 401) return res.json({ success: false, error: 'Authentication failed — check username/password' });
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            const type = json.type || json.serialNumber || 'Home Center';
            res.json({ success: r.statusCode < 300, message: `Connected — ${type}` });
          } catch {
            res.json({ success: r.statusCode < 300, message: r.statusCode < 300 ? 'Connected' : `HTTP ${r.statusCode}` });
          }
        });
      }
    );
    reqHttp.on('error', err => res.json({ success: false, error: err.message }));
    reqHttp.on('timeout', () => { reqHttp.destroy(); res.json({ success: false, error: 'Connection timed out' }); });
  });

  router.post('/settings/fibaro', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { host, port, username, password } = req.body;
    try {
      writeConfigFile({
        ...current,
        fibaro: {
          host:     (host     || current.fibaro?.host     || '').trim(),
          port:     parseInt(port || 80),
          username: (username || current.fibaro?.username || 'admin').trim(),
          password: (password && !password.includes('•')) ? password : (current.fibaro?.password || ''),
        },
      });
      res.json({ success: true, message: 'Fibaro settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
