'use strict';

// Suppla — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Suppla ────────────────────────────────────────────────────────────

  router.post('/settings/test-suppla', requireAdmin, async (req, res) => {
    const https = require('https');
    const http  = require('http');
    const { token, server = 'https://cloud.supla.org' } = req.body;
    if (!token) return res.status(400).json({ success: false, error: 'token required' });
    try {
      const parsed  = new URL(server);
      const mod     = parsed.protocol === 'https:' ? https : http;
      const port    = parsed.port ? parseInt(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
      const payload = await new Promise((resolve, reject) => {
        const rq = mod.request({
          hostname: parsed.hostname, port,
          path: '/api/v2.4.0/server-info',
          method: 'GET', timeout: 8000,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }, resp => {
          const c = [];
          resp.on('data', d => c.push(d));
          resp.on('end', () => {
            if (resp.statusCode === 401) return reject(new Error('Invalid token — check your personal access token'));
            if (resp.statusCode < 200 || resp.statusCode >= 300) return reject(new Error(`HTTP ${resp.statusCode}`));
            try { resolve(JSON.parse(Buffer.concat(c).toString())); }
            catch { reject(new Error('Non-JSON response')); }
          });
        });
        rq.on('error', reject);
        rq.on('timeout', () => { rq.destroy(); reject(new Error('Connection timed out')); });
        rq.end();
      });
      res.json({ success: true, message: `Connected — server ${payload.serverAddress || server}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/suppla', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { token, server, pollInterval } = req.body;
    try {
      writeConfigFile({
        ...current,
        suppla: {
          token:        (token && !token.includes('•')) ? token.trim() : (current.suppla?.token || ''),
          server:       (server || current.suppla?.server || 'https://cloud.supla.org').trim(),
          pollInterval: parseInt(pollInterval) || 30,
        },
      });
      res.json({ success: true, message: 'Suppla saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
