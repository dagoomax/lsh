'use strict';

// Domatiq CAN bus — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Domatiq CAN bus ──────────────────────────────────────────────────────

  router.post('/settings/test-domatiq', requireAdmin, (req, res) => {
    const { host, port = 10001 } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });
    const net = require('net');
    const sock = new net.Socket();
    let done = false;
    const finish = (ok, msg) => {
      if (done) return; done = true;
      sock.destroy();
      res.json({ success: ok, message: ok ? msg : undefined, error: ok ? undefined : msg });
    };
    sock.setTimeout(5000);
    sock.connect(parseInt(port), host, () => finish(true, `TCP connection to ${host}:${port} succeeded`));
    sock.on('error', err => finish(false, err.message));
    sock.on('timeout', () => finish(false, `Connection to ${host}:${port} timed out`));
  });

  router.post('/settings/domatiq', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { host, port, modules } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });
    const sanitized = (modules || []).map(m => ({
      addr:  parseInt(m.addr),
      label: (m.label || '').trim() || undefined,
    })).filter(m => Number.isFinite(m.addr) && m.addr >= 0 && m.addr <= 0x1fff);
    try {
      writeConfigFile({ ...current, domatiq: { host: host.trim(), port: parseInt(port) || 10001, modules: sanitized } });
      res.json({ success: true, message: `Domatiq settings saved (${sanitized.length} module label(s)). Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
