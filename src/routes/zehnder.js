'use strict';

// Zehnder ventilation — status, LAN C discovery, connection test and settings
// (applied live: the client is restarted on save). Client: src/zehnder-client.js.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

const TYPES = ['lanc', 'pro', 'ca350'];
const HOST_RE = /^[\w.-]+$/;

function cleanUnit(u) {
  const type = TYPES.includes(u?.type) ? u.type : 'lanc';
  const out = { type, host: String(u?.host || '').trim(), name: String(u?.name || '').trim() };
  // hand-set fields the client honours — dropping them would change the device key / LAN C app name
  const id = String(u?.id || '').trim();
  if (id) out.id = id;
  const num = (k) => { const n = Number(u?.[k]); if (u?.[k] !== '' && u?.[k] != null && Number.isFinite(n)) out[k] = n };
  num('port');
  if (type === 'lanc') { num('pin'); if (String(u?.appName || '').trim()) out.appName = String(u.appName).trim(); if (/^[0-9a-f]{32}$/i.test(String(u?.uuid || '').replace(/-/g, ''))) out.uuid = String(u.uuid).replace(/-/g, '').toLowerCase() }
  if (type === 'pro') num('unitId');
  if (type === 'ca350') {
    const sp = String(u?.serialPort || '').trim();
    if (sp) out.serialPort = sp;
    if (['log', 'master'].includes(u?.rs232Mode)) out.rs232Mode = u.rs232Mode;
  }
  num('pollSeconds');
  for (const k of Object.keys(out)) if (out[k] === '') delete out[k];
  return out;
}

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store, sensorRegistry } = ctx;

  router.get('/zehnder/status', (req, res) => {
    res.json({ success: true, data: clients.zehnder ? clients.zehnder.status() : [] });
  });

  // ComfoConnect LAN C / Pro gateways answering the UDP search (broadcast, or one host)
  router.post('/zehnder/discover', requireAdmin, async (req, res) => {
    try {
      const LanC = require('../zehnder/lanc');
      const host = String(req.body?.host || '').trim();
      const found = await LanC.discover(host ? { host, timeout: 2500 } : { timeout: 2500 });
      res.json({ success: true, data: found, message: found.length ? `Found ${found.map((g) => `${g.type === 'pro' ? 'ComfoConnect Pro' : 'LAN C'} at ${g.host}`).join(', ')}` : 'No ComfoConnect gateway answered — enter its IP (ComfoConnect gateways must be on the same network segment for discovery)' });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // One read from a unit, without saving. A unit LSH already runs answers from its live session
  // (the LAN C gateway takes one session at a time and a serial bridge often one TCP client).
  router.post('/zehnder/test', requireAdmin, async (req, res) => {
    const u = cleanUnit(req.body || {});
    if (!u.host && !u.serialPort) return res.status(400).json({ success: false, error: 'host (or serial port) required' });
    const live = clients.zehnder?.status().find((s) => s.type === u.type && (s.host || '') === u.host
      && (u.host ? !u.port || !s.port || s.port === u.port : s.serialPort === u.serialPort));
    if (live) {
      return res.json({ success: live.connected, data: live.values, message: live.connected ? `${live.label}: connected (running in LSH)` : undefined, error: live.connected ? undefined : live.error || 'not connected' });
    }
    const ZehnderClient = require('../zehnder-client');
    let backend;
    try {
      if (u.type === 'lanc') {
        // only find the gateway — a session would kick the Zehnder app / LSH's own session
        const LanC = require('../zehnder/lanc');
        const [g] = await LanC.discover({ host: `${u.host}:${u.port || 56747}`, timeout: 3000 });
        if (!g) throw new Error(`No ComfoConnect gateway answered at ${u.host}`);
        return res.json({ success: true, data: g, message: `ComfoConnect ${g.type === 'pro' ? 'Pro' : 'LAN C'} found at ${g.host} (uuid ${g.uuid}). Save to connect — LSH registers itself with the PIN.` });
      }
      const Backend = ZehnderClient.BACKENDS[u.type]();
      backend = new Backend({ ...u, port: u.port || (u.type === 'pro' ? 502 : undefined) });
      backend.on('debug', () => {});
      const data = await backend.poll();
      const parts = [];
      if (data.speed != null) parts.push(`level ${data.speed}`);
      if (data.outdoorTemp != null) parts.push(`outdoor ${data.outdoorTemp} °C`);
      if (data.extractTemp != null) parts.push(`room ${data.extractTemp} °C`);
      if (data.filterDays != null) parts.push(`filter in ${data.filterDays} d`);
      res.json({ success: true, data, message: `Connected — ${parts.join(', ') || 'unit answered'}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    } finally {
      try { backend?.stop() } catch {}
    }
  });

  router.post('/settings/zehnder', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const units = (Array.isArray(b.units) ? b.units : []).map(cleanUnit).filter((u) => u.host || u.serialPort);
    const bad = units.find((u) => u.host && !HOST_RE.test(u.host));
    if (bad) return res.status(400).json({ success: false, error: `"${bad.host}" is not a host name or IP` });
    if (units.some((u) => u.type === 'ca350' && !u.serialPort && !u.port)) return res.status(400).json({ success: false, error: 'ComfoAir 350: give the serial bridge TCP port, or a serial port path' });
    let current, zehnder;
    try {
      current = readConfigFile();
      zehnder = {
        ...(current.zehnder || {}),
        units,
        boostMinutes: Math.max(5, Math.min(1440, Number(b.boostMinutes) || 60)),
        awayHours: Math.max(0, Math.min(720, Number(b.awayHours) || 0)),
      };
      delete zehnder.devices;
      writeConfigFile({ ...current, zehnder });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    try {
      clients.zehnder?.stop();
      // the old devices go; the new client registers its units again
      for (const s of clients.zehnder?.status() || []) sensorRegistry.devices.delete(s.deviceKey);
      delete clients.zehnder;
      if (units.length) {
        const ZehnderClient = require('../zehnder-client');
        const c = new ZehnderClient({ ...current, zehnder }, store, sensorRegistry);
        await c.start();
        clients.zehnder = c;
      }
      sensorRegistry.emit('devices-changed');
      res.json({ success: true, message: 'Saved and applied.', data: clients.zehnder?.status() || [] });
    } catch (err) {
      res.json({ success: true, message: `Saved; restart LSH to apply (${err.message}).` });
    }
  });
};
