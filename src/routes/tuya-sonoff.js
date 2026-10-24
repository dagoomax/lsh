'use strict';

// Tuya / Smart Life and Sonoff / eWeLink — status, settings, connection test.
// See src/tuya-client.js and src/ewelink-client.js.
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

const keep = (v, prev) => (v && !String(v).includes('•') ? String(v) : prev || '');
const MODES = ['auto', 'cloud', 'local'];

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;

  router.get('/tuya/status', (req, res) => {
    res.json({ success: true, data: clients.tuya ? clients.tuya.status() : [] });
  });
  router.get('/sonoff/status', (req, res) => {
    res.json({ success: true, data: clients.sonoff ? clients.sonoff.status() : [] });
  });

  // ── Tuya ──
  router.post('/settings/test-tuya', requireAdmin, async (req, res) => {
    const prev = readConfigFile().tuya || {};
    const { accessId, region, uid } = req.body || {};
    const cfg = { accessId, region, uid, accessSecret: keep(req.body?.accessSecret, prev.accessSecret) };
    if (!cfg.accessId || !cfg.accessSecret) return res.status(400).json({ success: false, error: 'Access ID and Access Secret are required' });
    try {
      const devices = await require('../tuya-client').probe(cfg);
      res.json({ success: true, message: `Signed in — ${devices.length} device(s) on the project`, data: { devices } });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/tuya', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const prev = current.tuya || {};
    const b = req.body || {};
    const prevDevs = prev.devices || [];
    const devices = (Array.isArray(b.devices) ? b.devices : []).map((d, i) => {
      const old = prevDevs.find((p) => p.id === String(d.id || '').trim()) || prevDevs[i];
      const out = {
        id: String(d.id || '').trim(),
        name: String(d.name || '').trim(),
        key: keep(d.key, old?.key),
        ip: String(d.ip || '').trim(),
        version: String(d.version || '').trim(),
      };
      if (old?.dps) out.dps = old.dps;
      return out;
    }).filter((d) => d.id);
    const tuya = {
      ...prev,
      mode: MODES.includes(b.mode) ? b.mode : 'auto',
      region: String(b.region || prev.region || 'eu'),
      accessId: String(b.accessId || '').trim(),
      accessSecret: keep(b.accessSecret, prev.accessSecret),
      uid: String(b.uid || '').trim(),
      pollInterval: parseInt(b.pollInterval) || prev.pollInterval || 30,
      devices,
    };
    try {
      writeConfigFile({ ...current, tuya });
      res.json({ success: true, message: 'Tuya settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Sonoff / eWeLink ──
  router.post('/settings/test-sonoff', requireAdmin, async (req, res) => {
    const prev = readConfigFile().sonoff || {};
    const { appId, region, email, phoneNumber, countryCode } = req.body || {};
    const cfg = { appId, region, email: email && String(email).includes('@') ? email : undefined,
      phoneNumber: phoneNumber || (email && !String(email).includes('@') ? email : undefined), countryCode,
      password: keep(req.body?.password, prev.password), appSecret: keep(req.body?.appSecret, prev.appSecret) };
    if (!cfg.appId || !cfg.appSecret) return res.status(400).json({ success: false, error: 'App ID and App Secret are required' });
    if (!cfg.password || !(cfg.email || cfg.phoneNumber)) return res.status(400).json({ success: false, error: 'eWeLink email (or phone) and password are required' });
    try {
      const devices = await require('../ewelink-client').probe(cfg);
      res.json({ success: true, message: `Signed in — ${devices.length} device(s) on the account`, data: { devices } });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/sonoff', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const prev = current.sonoff || {};
    const b = req.body || {};
    const prevDevs = prev.devices || [];
    const devices = (Array.isArray(b.devices) ? b.devices : []).map((d, i) => {
      const old = prevDevs.find((p) => p.id === String(d.id || '').trim()) || prevDevs[i];
      return {
        id: String(d.id || '').trim(),
        name: String(d.name || '').trim(),
        devicekey: keep(d.devicekey, old?.devicekey),
        host: String(d.host || '').trim(),
      };
    }).filter((d) => d.id);
    const email = String(b.email || '').trim();
    const sonoff = {
      ...prev,
      mode: MODES.includes(b.mode) ? b.mode : 'auto',
      region: String(b.region || prev.region || 'eu'),
      email: email.includes('@') ? email : '',
      phoneNumber: email && !email.includes('@') ? email : '',
      password: keep(b.password, prev.password),
      countryCode: String(b.countryCode || prev.countryCode || '+48').trim(),
      appId: String(b.appId || '').trim(),
      appSecret: keep(b.appSecret, prev.appSecret),
      pollInterval: parseInt(b.pollInterval) || prev.pollInterval || 30,
      devices,
    };
    try {
      writeConfigFile({ ...current, sonoff });
      res.json({ success: true, message: 'Sonoff settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};

