'use strict';

// Victron Bluetooth (read directly by the LSH host — the Arduino UNO Q) —
// settings + live status. Client: src/victron-ble-client.js.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;

  router.get('/victron-ble/status', (req, res) => {
    const c = clients.victronBle;
    res.json({ success: true, data: c ? c.getStatus() : null });
  });

  // Live BLE scan from this host (lists nearby devices, Victron first). Lives
  // in the victron-ble module, so it needs that module (+ dbus-next) on disk —
  // the UI offers to install it when it isn't.
  router.post('/victron-ble/scan', requireAdmin, async (req, res) => {
    let scan;
    try {
      ({ scan } = require('../victron-ble-client'));
      require.resolve('dbus-next');
    } catch {
      return res.status(409).json({ success: false, needsModule: true, error: 'The Victron Bluetooth module is not installed on this LSH host' });
    }
    try {
      const adapter = readConfigFile().victronBle?.adapter || 'hci0';
      const data = await scan({ adapter, seconds: req.body?.seconds });
      res.json({ success: true, data });
    } catch (err) {
      const hint = /AccessDenied|not allowed/i.test(err.message) ? ' — add the LSH user to the `bluetooth` group and restart LSH' : '';
      res.status(500).json({ success: false, error: err.message + hint });
    }
  });

  router.post('/settings/victron-ble', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const prev = current.victronBle || {};
    const b = req.body || {};
    const errors = [];
    const devices = (Array.isArray(b.devices) ? b.devices : []).map((d, i) => {
      const mac = String(d.mac || '').trim().toUpperCase().replace(/-/g, ':');
      // A masked key means "unchanged" — keep the stored one for this MAC.
      let bindkey = String(d.bindkey || '').trim().toLowerCase();
      if (bindkey.includes('•')) bindkey = (prev.devices || []).find((x) => String(x.mac).toUpperCase() === mac)?.bindkey || '';
      const row = `Device ${i + 1}${d.name ? ` (${d.name})` : ''}`;
      if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) errors.push(`${row}: MAC must look like 60:A4:23:91:8F:55`);
      if (!/^[0-9a-f]{32}$/.test(bindkey)) errors.push(`${row}: encryption key must be 32 hex characters (VictronConnect → Product info → Instant readout → Show)`);
      return { name: String(d.name || '').trim(), mac, bindkey };
    });
    if (errors.length) return res.status(400).json({ success: false, error: errors.join(' · ') });

    const victronBle = {
      adapter: String(b.adapter || prev.adapter || 'hci0').trim(),
      feedDashboard: b.feedDashboard !== false,
      devices,
    };
    try {
      writeConfigFile({ ...current, victronBle });
      res.json({ success: true, message: `${devices.length} device(s) saved. Restart LSH to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
