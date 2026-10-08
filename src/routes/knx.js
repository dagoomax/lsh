'use strict';

// KNX — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── KNX ───────────────────────────────────────────────────────────────

  router.post('/settings/test-knx', requireAdmin, (req, res) => {
    const { host, port = 3671 } = req.body;
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

  router.post('/settings/knx', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { host, port, groupAddresses } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });
    const sanitized = (groupAddresses || []).map(ga => ({
      address:     (ga.address || '').trim(),
      name:        (ga.name    || '').trim(),
      dpt:         (ga.dpt     || 'DPT1').trim(),
      unit:        (ga.unit    || '').trim() || undefined,
      readable:    ga.readable  !== false,
      writable:    !!ga.writable,
      homekitType: (ga.homekitType || '').trim() || undefined,
    })).filter(ga => ga.address);
    try {
      writeConfigFile({ ...current, knx: { host: host.trim(), port: parseInt(port) || 3671, groupAddresses: sanitized } });
      res.json({ success: true, message: `KNX settings saved (${sanitized.length} group address(es)). Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
