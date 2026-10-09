'use strict';

// Wiring emulator → Pair & save: pair the module just wired to a real network
// through a gateway LSH knows (Z-Wave JS inclusion, Wi-Fi / LAN by address, or
// a device LSH already has) and save the link with the device's real id.
// Store: src/wiring-links.js.
const links = require('../wiring-links');
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, sensorRegistry, store } = ctx;
  const zw = () => clients.zwaveJs;
  const run = async (res, fn) => {
    try { res.json({ success: true, data: await fn() }) }
    catch (err) { res.status(/not connected/.test(err.message) ? 503 : 400).json({ success: false, error: err.message }) }
  };

  // Gateways usable for pairing, per network
  router.get('/wiring/gateways', requireAdmin, (req, res) => {
    const z = zw();
    const devs = sensorRegistry.getDevices();
    const types = [...new Set(devs.map((d) => d.type).filter(Boolean))].sort();
    res.json({
      success: true,
      data: {
        zwave: [
          { id: 'zwaveJs', label: 'Z-Wave JS', available: !!z, connected: !!z?.connected, homeId: z?.homeId ? Number(z.homeId).toString(16).padStart(8, '0') : null },
        ],
        wifi: [{ id: 'lan', label: 'Wi-Fi / LAN (by address)', available: true, connected: true }],
        existingTypes: types,
      },
    });
  });

  // ── Z-Wave inclusion / exclusion ──
  router.get('/wiring/zwave/status', requireAdmin, (req, res) => {
    const z = zw();
    if (!z) return res.json({ success: true, data: { phase: 'unavailable' } });
    const p = z.getPairing();
    res.json({ success: true, data: { ...p, realId: p.node?.nodeId && p.homeId ? links.zwaveRealId(p.homeId, p.node.nodeId) : null } });
  });
  const needZ = (res) => { if (!zw()) { res.status(409).json({ success: false, error: 'Z-Wave JS isn’t set up in LSH (config.zwaveJs.host)' }); return false } return true };
  router.post('/wiring/zwave/include', requireAdmin, (req, res) => { if (needZ(res)) run(res, () => zw().startInclusion({ secure: req.body?.secure !== false })) });
  router.post('/wiring/zwave/exclude', requireAdmin, (req, res) => { if (needZ(res)) run(res, () => zw().startExclusion()) });
  router.post('/wiring/zwave/stop', requireAdmin, (req, res) => { if (needZ(res)) run(res, () => zw().stopPairing()) });
  router.post('/wiring/zwave/pin', requireAdmin, (req, res) => { if (needZ(res)) run(res, () => zw().submitPin(req.body?.pin)) });

  // ── Wi-Fi / LAN ──
  router.post('/wiring/lan/probe', requireAdmin, (req, res) => run(res, () => links.probe(String(req.body?.host || '').trim())));

  // Devices LSH already has (to link an existing one)
  router.get('/wiring/devices', requireAdmin, (req, res) => {
    const type = req.query.type;
    res.json({ success: true, data: sensorRegistry.getDevices().filter((d) => !type || d.type === type).map((d) => ({ key: d.key, label: d.label, type: d.type, room: d.room || null })) });
  });

  // ── Saved links ──
  router.get('/wiring/links', requireAdmin, (req, res) => res.json({ success: true, data: links.list() }));

  router.post('/wiring/links', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const realId = String(b.realId || '').trim();
    if (!realId) return res.status(400).json({ success: false, error: 'Pair the device first — there is no real id yet' });
    const name = String(b.name || '').trim().slice(0, 80);
    const room = String(b.room || '').trim().slice(0, 60);
    let deviceKey = b.deviceKey ? String(b.deviceKey) : null;
    const notes = [];

    // Wi-Fi Shelly: add it to LSH's Shelly integration so it's controllable
    if (b.addToLsh && b.info?.kind === 'shelly' && b.info.host) {
      const host = String(b.info.host);
      const cfg = readConfigFile();
      const devices = cfg.shelly?.devices || [];
      if (!devices.some((d) => d.host === host)) {
        writeConfigFile({ ...cfg, shelly: { ...(cfg.shelly || {}), devices: [...devices, { host, name: name || undefined }] } });
      }
      deviceKey = `shelly/${host.replace(/\./g, '_')}`;
      try {
        if (clients.shelly) await clients.shelly._initDevice({ host, name: name || undefined });
        else {
          const ShellyClient = require('../shelly-client');
          const c = new ShellyClient({ ...cfg, shelly: { devices: [{ host, name: name || undefined }] } }, store, sensorRegistry);
          await c.start();
          clients.shelly = c;
        }
      } catch (err) { notes.push(`Added to the Shelly integration; it will connect after a restart (${err.message})`) }
    }

    if (deviceKey && (name || room)) {
      try { sensorRegistry.setOverride(deviceKey, { ...(name ? { label: name } : {}), ...(room ? { room } : {}) }) } catch { notes.push('Name / room will apply once the device appears in LSH') }
    }
    const entry = links.save({
      emulator: { device: String(b.emulatorDevice || ''), model: String(b.model || ''), scenario: String(b.scenario || '') },
      gateway: String(b.gateway || ''), protocol: String(b.protocol || ''),
      realId, deviceKey, name: name || null, room: room || null,
      info: b.info && typeof b.info === 'object' ? b.info : null,
    });
    res.json({ success: true, data: entry, message: notes.join(' · ') || 'Saved' });
  });

  router.delete('/wiring/links/:id', requireAdmin, (req, res) => {
    res.json({ success: links.remove(req.params.id) });
  });
};
