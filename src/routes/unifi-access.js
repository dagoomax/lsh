'use strict';

// Settings → UniFi Access and Settings → UniFi Play. Both clients run in
// their own processes (src/unifi-access-client.js, src/unifi-play-client.js),
// so status comes from the registry and store, and a save restarts the process.
//
//   GET  /unifi-access/status      doors with their state
//   POST /unifi-access/test        { host, apiKey } — list doors, nothing saved
//   POST /settings/unifi-access    { host, apiKey }
//   GET  /unifi-play/status        speakers with their state
//   POST /unifi-play/test          { host, apiKey } — list the console's Play devices
//   POST /settings/unifi-play      { host, apiKey, devices, certFile, keyFile }
const fs = require('fs');
const path = require('path');
const https = require('https');
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');
const INTEGRATIONS = require('../integrations');

const HOST_RE = /^[\w.-]+(:\d{1,5})?$/;
const IP_RE = /^[\w.-]+$/;
const DOOR_KEYS = ['contact', 'lock', 'doorbell', 'lockRule', 'lockRuleEnds', 'lastAccess'];
const PLAY_KEYS = ['online', 'playing', 'volume', 'muted', 'source', 'service', 'title', 'artist'];

// A masked secret ("••••") from the form keeps the saved one
const secret = (v, prev) => (v && !String(v).includes('•') ? String(v).trim() : prev || '');
const cleanHost = (h) => String(h || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');

function get(host, defPort, pathname, headers) {
  const [hostname, port] = host.split(':');
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, port: port || defPort, path: pathname, headers, rejectUnauthorized: false, timeout: 8000 }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { let data = null; try { data = JSON.parse(raw); } catch { /* html / text */ } resolve({ status: res.statusCode, type: res.headers['content-type'] || '', data }); });
    });
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    req.end();
  });
}

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, sensorRegistry, store } = ctx;

  const apply = async (res, file, moduleId, enabled, okMsg) => {
    if (!clients.moduleHost) return res.json({ success: true, message: 'Saved — restart LSH to apply.' });
    try {
      // a fresh install ships core only — fetch the module before starting it
      if (enabled && !fs.existsSync(path.join(__dirname, '..', `${file}.js`))) await require('../module-manager').install([moduleId], readConfigFile());
      const info = await clients.moduleHost.apply(INTEGRATIONS.find((x) => x.file === file));
      res.json({ success: true, message: enabled ? okMsg : 'Saved — module stopped.', data: info });
    } catch (err) {
      res.json({ success: true, message: `Saved; restart LSH to apply (${err.message}).` });
    }
  };
  const devicesOf = (type, keys) => sensorRegistry.getDevices().filter((d) => d.type === type).map((d) => ({
    key: d.key, label: d.label, model: d.model || null, ...Object.fromEntries(keys.map((k) => [k, store.get(`${d.key}/${k}`)])),
  }));

  // ── UniFi Access ──

  router.get('/unifi-access/status', requireAdmin, (req, res) => {
    const all = devicesOf('unifiAccess', DOOR_KEYS);
    const sys = all.find((d) => d.key === 'unifiAccess/system');
    res.json({
      success: true,
      data: {
        configured: !!readConfigFile().unifiAccess?.host,
        doors: all.filter((d) => d.key !== 'unifiAccess/system'),
        lockdown: store.get('unifiAccess/system/lockdown'), evacuation: store.get('unifiAccess/system/evacuation'),
        readers: store.get('unifiAccess/system/readers'), system: !!sys,
      },
    });
  });

  router.post('/unifi-access/test', requireAdmin, async (req, res) => {
    const prev = readConfigFile().unifiAccess || {};
    const host = cleanHost(req.body?.host || prev.host);
    const apiKey = secret(req.body?.apiKey, prev.apiKey);
    if (!HOST_RE.test(host) || !apiKey) return res.json({ success: false, error: 'Enter the console address and the Access API token' });
    try {
      const r = await get(host, 12445, '/api/v1/developer/doors', { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' });
      if (r.status === 401) return res.json({ success: false, error: 'The API token was rejected (401)' });
      if (r.status !== 200 || r.data?.code !== 'SUCCESS') return res.json({ success: false, error: `HTTP ${r.status}${r.data?.msg ? ` — ${r.data.msg}` : ''}` });
      const doors = r.data.data || [];
      res.json({ success: true, message: `Connected — ${doors.length} door(s): ${doors.map((d) => d.name).join(', ') || '—'}` });
    } catch (err) { res.json({ success: false, error: err.message }); }
  });

  router.post('/settings/unifi-access', requireAdmin, async (req, res) => {
    const prev = readConfigFile();
    const b = req.body || {};
    const host = cleanHost(b.host);
    const apiKey = secret(b.apiKey, prev.unifiAccess?.apiKey);
    if (host && !HOST_RE.test(host)) return res.status(400).json({ success: false, error: 'Console address like 192.168.1.1' });
    if (host && !apiKey) return res.status(400).json({ success: false, error: 'The Access API token is required' });
    const next = { ...prev };
    if (host) next.unifiAccess = { ...(prev.unifiAccess || {}), host, apiKey };
    else delete next.unifiAccess;
    try { writeConfigFile(next); } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
    apply(res, 'unifi-access-client', 'unifi-access', !!host, 'Saved and applied — doors appear in a few seconds.');
  });

  // ── UniFi Play ──

  router.get('/unifi-play/status', requireAdmin, (req, res) => {
    const c = readConfigFile().unifiPlay || {};
    res.json({ success: true, data: { configured: !!(c.host || c.devices?.length), control: !!(c.mqtt?.certFile && c.mqtt?.keyFile), devices: devicesOf('unifiPlay', PLAY_KEYS) } });
  });

  router.post('/unifi-play/test', requireAdmin, async (req, res) => {
    const prev = readConfigFile().unifiPlay || {};
    const host = cleanHost(req.body?.host || prev.host);
    const apiKey = secret(req.body?.apiKey, prev.apiKey);
    if (!HOST_RE.test(host) || !apiKey) return res.json({ success: false, error: 'Enter the console address and its API key' });
    try {
      const r = await get(host, 443, '/proxy/apollo/api/v1/devices', { 'X-API-KEY': apiKey, Accept: 'application/json' });
      if (r.status === 401) return res.json({ success: false, error: 'The API key was rejected (401)' });
      if (/text\/html/.test(r.type)) return res.json({ success: false, error: 'UniFi Play is not installed on this console' });
      if (r.status !== 200) return res.json({ success: false, error: `HTTP ${r.status}` });
      const list = Array.isArray(r.data?.data) ? r.data.data : [];
      res.json({ success: true, message: `Connected — ${list.length} device(s): ${list.map((d) => d.name).join(', ') || '—'}` });
    } catch (err) { res.json({ success: false, error: err.message }); }
  });

  router.post('/settings/unifi-play', requireAdmin, async (req, res) => {
    const prev = readConfigFile();
    const b = req.body || {};
    const host = cleanHost(b.host);
    const apiKey = secret(b.apiKey, prev.unifiPlay?.apiKey);
    if (host && !HOST_RE.test(host)) return res.status(400).json({ success: false, error: 'Console address like 192.168.1.1' });
    if (host && !apiKey) return res.status(400).json({ success: false, error: 'The console API key is required' });
    const devices = [];
    for (const d of Array.isArray(b.devices) ? b.devices : []) {
      const ip = String(d?.host || '').trim();
      if (!ip) continue;
      if (!IP_RE.test(ip)) return res.status(400).json({ success: false, error: `"${ip}" is not an IP address or host name` });
      devices.push({ host: ip, ...(String(d.name || '').trim() ? { name: String(d.name).trim() } : {}) });
    }
    const certFile = String(b.certFile || '').trim();
    const keyFile = String(b.keyFile || '').trim();
    if (!!certFile !== !!keyFile) return res.status(400).json({ success: false, error: 'Control needs both the certificate and the key file' });
    for (const f of [certFile, keyFile].filter(Boolean)) {
      if (!path.isAbsolute(f)) return res.status(400).json({ success: false, error: `${f}: use the full path` });
      if (!fs.existsSync(f)) return res.status(400).json({ success: false, error: `${f}: no such file on the LSH host` });
    }
    if (devices.length && !certFile) return res.status(400).json({ success: false, error: 'Speakers added by IP are reached over MQTT — add the client certificate and key' });
    const enabled = !!(host || devices.length);
    const next = { ...prev };
    if (enabled) {
      const cfg = { ...(prev.unifiPlay || {}) };
      if (host) Object.assign(cfg, { host, apiKey }); else { delete cfg.host; delete cfg.apiKey; }
      if (devices.length) cfg.devices = devices; else delete cfg.devices;
      if (certFile) cfg.mqtt = { ...(cfg.mqtt || {}), certFile, keyFile }; else delete cfg.mqtt;
      next.unifiPlay = cfg;
    } else delete next.unifiPlay;
    try { writeConfigFile(next); } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
    apply(res, 'unifi-play-client', 'unifi-play', enabled, 'Saved and applied — speakers appear in a few seconds.');
  });
};
