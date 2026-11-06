'use strict';

// n8n hotel automation bridge — REST routes (mirrors core-go/n8n.go routes).
//
//   GET  /api/n8n                 config (secrets masked) + event catalog + status
//   POST /api/settings/n8n        save config (masked secrets kept)
//   POST /api/n8n/test            { hookId } → send a "test" event now
//   GET  /api/hotel/rooms         current occupancy
//   POST /api/hotel/checkin       { room, guest?, nights? } → record + emit
//   POST /api/hotel/checkout      { room } → record + emit

const crypto = require('crypto');
const N8n = require('../n8n');
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');
const { resolveLicense } = require('../license');
const laundry = require('../laundry');

const BULLETS = '••••••••';
const masked = (s) => typeof s === 'string' && s.includes('•');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;
  const n8n = N8n.shared();

  router.get('/n8n', requireAdmin, (req, res) => {
    const cfg = JSON.parse(JSON.stringify(readConfigFile().n8n || { enabled: false, hooks: [] }));
    cfg.enabled = cfg.enabled === true;
    cfg.hooks = (Array.isArray(cfg.hooks) ? cfg.hooks : []).map((h) => {
      const v = { ...h };
      if (v.secret) v.secret = BULLETS;
      const last = n8n.lastFor(v.id);
      if (last) v.last = last;
      return v;
    });
    const lic = resolveLicense(readConfigFile());
    res.json({ success: true, data: { n8n: cfg, events: N8n.EVENTS, hotel: { tier: lic.tier, hotel: lic.limits.hotel } } });
  });

  router.post('/settings/n8n', requireAdmin, (req, res) => {
    const config = readConfigFile();
    const prev = {};
    for (const h of (Array.isArray(config.n8n?.hooks) ? config.n8n.hooks : [])) prev[h.id] = h.secret || '';
    const incoming = req.body?.n8n || {};
    incoming.hooks = (Array.isArray(incoming.hooks) ? incoming.hooks : []).map((h) => {
      const v = { ...h };
      if (!v.id) v.id = crypto.randomBytes(6).toString('hex');
      if (masked(v.secret)) v.secret = prev[v.id] || '';
      if (!v.secret) v.secret = crypto.randomBytes(16).toString('hex');
      return v;
    });
    try { writeConfigFile({ ...config, n8n: incoming }); }
    catch (err) { return res.status(500).json({ success: false, error: err.message }); }
    res.json({ success: true });
  });

  router.post('/n8n/test', requireAdmin, async (req, res) => {
    const r = await n8n.emitTo(String(req.body?.hookId || ''), 'test', { message: 'LSH test event', at: Date.now() });
    if (!r) return res.status(404).json({ success: false, error: 'No such hook' });
    if (r.error) return res.status(502).json({ success: false, error: r.error, status: r.status });
    res.json({ success: true, data: { status: r.status } });
  });

  router.get('/hotel/rooms', requireAdmin, (req, res) => {
    res.json({ success: true, data: Object.values(n8n.loadRooms()) });
  });

  router.post('/hotel/checkin', requireAdmin, (req, res) => {
    const room = String(req.body?.room || '').trim();
    if (!room) return res.status(400).json({ success: false, error: 'room is required' });
    const rec = { room, guest: String(req.body?.guest || '').trim(), nights: Number(req.body?.nights) || 0, checkedInAt: Date.now() };
    const rooms = n8n.loadRooms();
    rooms[room] = rec;
    try { n8n.saveRooms(rooms); } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
    n8n.emit('hotel.checkin', rec);
    // On room entry, run the configured arrival scene (TV + lights on, …) in-process.
    const sceneId = String(readConfigFile().n8n?.arrivalScene || '').trim();
    if (sceneId && ctx.clients?.automation?.runScene) {
      Promise.resolve(ctx.clients.automation.runScene(sceneId)).catch((e) => console.warn('[n8n] arrival scene failed:', e.message));
    }
    res.json({ success: true, data: rec });
  });

  router.post('/hotel/checkout', requireAdmin, (req, res) => {
    const room = String(req.body?.room || '').trim();
    if (!room) return res.status(400).json({ success: false, error: 'room is required' });
    const rooms = n8n.loadRooms();
    const prev = rooms[room] || {};
    delete rooms[room];
    try { n8n.saveRooms(rooms); } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
    const openLaundry = laundry.openForRoom(room);
    const out = { room, guest: prev.guest || '', at: Date.now(), openLaundry };
    n8n.emit('hotel.checkout', out);
    if (openLaundry.length) {
      n8n.emit('laundry.checkout-open', out);
      try { ctx.clients?.automation?.notify('warning', `Room ${room} checked out with ${openLaundry.length} laundry order(s) still open`, 'laundry'); } catch { /* best-effort */ }
    }
    res.json({ success: true, data: out });
  });
};
