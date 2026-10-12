'use strict';

// TECH Sinum — settings + connection test. Client: src/sinum-client.js.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

const MASK = '••••••••';

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store, sensorRegistry } = ctx;

  // Body → config.sinum; masked secrets keep the stored value
  const fromBody = (b = {}, prev = {}) => {
    const keep = (v, old) => (String(v || '').includes('•') ? old : String(v || '').trim() || undefined);
    return {
      ...prev,
      host: String(b.host || '').trim().replace(/\/$/, ''),
      token: keep(b.token, prev.token),
      username: String(b.username || '').trim() || undefined,
      password: keep(b.password, prev.password),
      pollInterval: Math.max(3, Number(b.pollInterval) || 10),
    };
  };

  router.post('/settings/test-sinum', requireAdmin, async (req, res) => {
    const cfg = fromBody(req.body, readConfigFile().sinum || {});
    if (!cfg.host) return res.status(400).json({ success: false, error: 'Give the hub address (sinum.local or its IP)' });
    if (!cfg.token && !(cfg.username && cfg.password)) return res.status(400).json({ success: false, error: 'Give an API token, or login + password' });
    try {
      // The client is an on-demand module — on a fresh install it arrives at the next start
      const SinumClient = require('../sinum-client');
      const c = new SinumClient({ sinum: cfg }, store, sensorRegistry);
      const rooms = await c.call('GET', '/api/v1/rooms');
      let n = 0;
      for (const bus of ['virtual', 'wtp', 'sbus']) {
        try { const l = await c.call('GET', `/api/v1/devices/${bus}`); n += Array.isArray(l) ? l.length : 0 } catch (err) { if (err.status !== 404) throw err }
      }
      res.json({ success: true, message: `Connected — ${Array.isArray(rooms) ? rooms.length : 0} rooms, ${n} devices (virtual / TECH Wireless / SBUS)` });
    } catch (err) {
      res.json({ success: false, error: err.name === 'TimeoutError' || /fetch failed/.test(err.message) ? `Can’t reach ${cfg.host} — check the address (same network as LSH?)` : err.message });
    }
  });

  router.post('/settings/sinum', requireAdmin, async (req, res) => {
    const cur = readConfigFile();
    const sinum = fromBody(req.body, cur.sinum || {});
    if (sinum.token) { delete sinum.username; delete sinum.password }
    writeConfigFile({ ...cur, sinum });
    // First setup starts right away; changing a running hub needs a restart
    // (its devices are already registered against the running client).
    if (clients.sinum || !sinum.host || !(sinum.token || (sinum.username && sinum.password))) {
      return res.json({ success: true, message: clients.sinum ? 'Saved — restart LSH to apply' : 'Saved' });
    }
    try {
      const SinumClient = require('../sinum-client');
      const c = new SinumClient({ ...cur, sinum }, store, sensorRegistry);
      await c.start();
      clients.sinum = c;
      res.json({ success: true, message: `Saved — ${c.devices.size} Sinum devices added` });
    } catch (err) {
      res.json({ success: true, message: `Saved; ${err.message}` });
    }
  });
};
