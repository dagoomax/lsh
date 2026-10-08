'use strict';

// ESPHome — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── ESPHome ──────────────────────────────────────────────────────────

  router.post('/settings/test-esphome', requireAdmin, async (req, res) => {
    const { host, port = 80, password } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });
    const headers = { 'Accept': 'text/event-stream' };
    if (password) headers['Authorization'] = 'Basic ' + Buffer.from(`:${password}`).toString('base64');
    const http2 = require('http');
    let done = false;
    const req2 = http2.get({ hostname: host, port, path: '/events', timeout: 6000, headers }, r => {
      let count = 0;
      r.on('data', chunk => {
        const text = chunk.toString();
        count += (text.match(/event:\s*state/g) || []).length;
        if (count >= 1 && !done) {
          done = true;
          req2.destroy();
          if (!res.headersSent) res.json({ success: true, message: `ESPHome device reachable — ${count}+ entity event(s) detected` });
        }
      });
      r.on('end', () => { if (!done && !res.headersSent) res.json({ success: r.statusCode < 300, message: 'Device reachable (no entity events)' }); });
    });
    req2.on('error', err => { if (!res.headersSent) res.json({ success: false, error: err.message }); });
    req2.on('timeout', () => { req2.destroy(); if (!res.headersSent) res.json({ success: false, error: `Cannot reach ${host}:${port}` }); });
  });

  router.post('/settings/esphome', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const devices = req.body;
    if (!Array.isArray(devices)) return res.status(400).json({ success: false, error: 'Expected array' });
    const sanitized = devices.map(d => ({
      host:     (d.host || '').trim(),
      port:     parseInt(d.port) || 80,
      name:     (d.name || '').trim(),
      password: (d.password && !d.password.includes('•')) ? d.password : (
        (current.esphome?.devices || []).find(x => x.host === d.host)?.password || ''
      ),
    })).filter(d => d.host);
    try {
      writeConfigFile({ ...current, esphome: { devices: sanitized } });
      res.json({ success: true, message: `${sanitized.length} device(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
