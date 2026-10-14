'use strict';

// Settings for the integrations that are plain "list of devices + poll
// interval" or "account" configs — air conditioners (Daikin, Gree, Midea,
// MELCloud, Sensibo) and batteries / power stations (Zendure, UGREEN, Anker
// SOLIX). One table describes each config section; the routes validate it,
// keep masked secrets (••••••••) from GET /settings, write config.json and
// restart the integration live. Clients: src/<file>.js (see src/integrations.js).
//
//   GET  /integration/:id/status            running?, connected?, its devices
//   POST /integration/:id/test   { config } one poll with these settings, nothing saved
//   POST /settings/integration/:id { config }  save + apply
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');
const platformStatus = require('../platform-status');
const INTEGRATIONS = require('../integrations');

const MASK = '••••••••';
const HOST_RE = /^(https?:\/\/)?[\w.-]+(:\d+)?\/?$/;

// field kinds: host (required in a row), str, secret, num, bool, enum:[…]
const SPECS = {
  daikin: { file: 'daikin-client', prefix: 'daikin/', status: 'daikin', list: { host: 'host', name: 'str', key: 'secret' }, top: { pollInterval: 'num' } },
  gree: { file: 'gree-client', prefix: 'gree/', status: 'gree', list: { host: 'host', name: 'str', mac: 'str', key: 'secret', encryption: ['', 'ecb', 'gcm'] }, top: { pollInterval: 'num' } },
  midea: { file: 'midea-client', prefix: 'midea/', status: 'midea', list: { host: 'host', id: 'str', token: 'secret', key: 'secret', name: 'str', beep: 'bool' }, top: { pollInterval: 'num' }, rowRequired: ['id'] },
  melcloud: { file: 'melcloud-client', prefix: 'melcloud/', status: 'melcloud', top: { email: 'str', password: 'secret', pollInterval: 'num' } },
  sensibo: { file: 'sensibo-client', prefix: 'sensibo/', status: 'sensibo', top: { apiKey: 'secret', pollInterval: 'num' } },
  zendure: { file: 'zendure-client', prefix: 'zendure/', status: 'zendure', list: { host: 'host', name: 'str' }, top: { pollInterval: 'num' } },
  ugreen: { file: 'ugreen-client', prefix: 'ugreen/', status: 'ugreen', top: { email: 'str', password: 'secret' } },
  ankerSolix: { file: 'anker-solix-client', prefix: 'anker/', status: 'ankerSolix', list: { host: 'host', port: 'num', unitId: 'num', name: 'str' }, top: { pollInterval: 'num' } },
};

// incoming value → config value (undefined = leave out); `prev` is the saved one, for masked secrets
function clean(kind, v, prev) {
  if (Array.isArray(kind)) return kind.includes(v) && v ? v : undefined;
  if (kind === 'secret') { const s = String(v ?? '').trim(); return s.includes('•') ? prev : s || undefined }
  if (kind === 'num') { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? undefined : n }
  if (kind === 'bool') return v === true || v === 'true' ? true : v === false || v === 'false' ? false : undefined;
  const s = String(v ?? '').trim();
  return s || undefined;
}

function cleanConfig(spec, body, current = {}) {
  const out = {};
  for (const [k, kind] of Object.entries(spec.top || {})) {
    const v = clean(kind, body?.[k], current[k]);
    if (v !== undefined) out[k] = v;
  }
  if (spec.list) {
    const prevRows = Array.isArray(current.devices) ? current.devices : [];
    out.devices = (Array.isArray(body?.devices) ? body.devices : []).map((row, i) => {
      const prev = prevRows.find((p) => p.host === String(row?.host || '').trim()) || prevRows[i] || {};
      const r = {};
      for (const [k, kind] of Object.entries(spec.list)) {
        const v = clean(kind === 'host' ? 'str' : kind, row?.[k], prev[k]);
        if (v !== undefined) r[k] = v;
      }
      return r;
    }).filter((r) => r.host);
    const bad = out.devices.find((r) => !HOST_RE.test(r.host));
    if (bad) throw new Error(`"${bad.host}" is not a host name or IP`);
    for (const k of spec.rowRequired || []) {
      const missing = out.devices.find((r) => r[k] === undefined);
      if (missing) throw new Error(`${missing.host}: ${k} is required`);
    }
  }
  return out;
}

const integration = (id) => INTEGRATIONS.find((it) => it.file === SPECS[id].file);

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store, sensorRegistry } = ctx;
  const spec = (req, res) => {
    const s = SPECS[req.params.id];
    if (!s) res.status(404).json({ success: false, error: `Unknown integration ${req.params.id}` });
    return s;
  };
  const devicesOf = (s) => [...sensorRegistry.devices.values()].filter((d) => d.key.startsWith(s.prefix))
    .map((d) => ({ key: d.key, label: d.label, online: store.get(`${d.key}/online`) }));

  router.get('/integration/:id/status', requireAdmin, (req, res) => {
    const s = spec(req, res); if (!s) return;
    const it = integration(req.params.id);
    res.json({ success: true, data: { running: !!clients[it.expose], connected: platformStatus.getAll()[s.status] ?? null, devices: devicesOf(s) } });
  });

  // One poll with the given settings: a throwaway client against a throwaway registry
  router.post('/integration/:id/test', requireAdmin, async (req, res) => {
    const s = spec(req, res); if (!s) return;
    const it = integration(req.params.id);
    let client;
    try {
      const current = readConfigFile()[it.expose] || {};
      const cfg = cleanConfig(s, req.body?.config || {}, current);
      const found = [];
      const Client = require(`../${s.file}`);
      client = new Client({ [it.expose]: cfg }, { update() {}, set() {}, get() { return null } }, { registerDevice: (d) => found.push(d.label), devices: new Map(), emit() {} });
      if (typeof client._pollImpl === 'function') {
        client.startPolling = () => Promise.race([client._pollImpl(true), new Promise((_, rej) => setTimeout(() => rej(new Error('No answer within 20 s')), 20000))]);
      }
      if (typeof client._connect === 'function' && !client._pollImpl) client._connect = () => {}; // UGREEN: no live sockets for a test
      await client.start();
      res.json({ success: true, data: { devices: found }, message: found.length ? `Connected — ${found.join(', ')}` : 'Connected' });
    } catch (err) {
      res.json({ success: false, error: err.message });
    } finally {
      try { client?.stop() } catch {}
    }
  });

  router.post('/settings/integration/:id', requireAdmin, async (req, res) => {
    const s = spec(req, res); if (!s) return;
    const it = integration(req.params.id);
    let current, cfg;
    try {
      current = readConfigFile();
      cfg = cleanConfig(s, req.body?.config || {}, current[it.expose] || {});
      writeConfigFile({ ...current, [it.expose]: { ...(current[it.expose] || {}), ...cfg, ...(s.list ? { devices: cfg.devices } : {}) } });
    } catch (err) {
      return res.status(err.message.includes('required') || err.message.includes('host') ? 400 : 500).json({ success: false, error: err.message });
    }
    // apply: stop the running client, drop its devices, start again if configured
    try {
      const config = { ...current, [it.expose]: { ...(current[it.expose] || {}), ...cfg } };
      try { clients[it.expose]?.stop() } catch {}
      delete clients[it.expose];
      for (const d of devicesOf(s)) sensorRegistry.devices.delete(d.key);
      platformStatus.set(s.status, false);
      if (it.when(config)) {
        const Client = require(`../${s.file}`);
        const c = new Client(config, store, sensorRegistry);
        clients[it.expose] = c;
        await Promise.race([c.start(), new Promise((r) => setTimeout(r, 20000))]);
      }
      sensorRegistry.emit('devices-changed');
      res.json({ success: true, message: it.when(config) ? 'Saved and applied.' : 'Saved — not configured, so not running.', data: { devices: devicesOf(s), connected: platformStatus.getAll()[s.status] ?? null } });
    } catch (err) {
      res.json({ success: true, message: `Saved; restart LSH to apply (${err.message}).` });
    }
  });
};

module.exports.SPECS = SPECS;
module.exports.cleanConfig = cleanConfig;
module.exports.MASK = MASK;
