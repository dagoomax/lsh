'use strict';

// Guest portal for rental stays (src/tenant-portal.js) — settings, the
// upcoming stays with their guest links and door PINs, link reset, and the
// PIN check for keypads / flows.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

const str = (v, max = 4000) => String(v ?? '').trim().slice(0, max);

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;
  const portal = () => clients.tenantPortal;

  // Every property's current and upcoming stays: guest link, PIN, window
  router.get('/tenant/stays', requireAdmin, (req, res) => {
    const p = portal();
    if (!p) return res.json({ success: true, data: [] });
    const base = str(readConfigFile().tenant?.publicUrl).replace(/\/+$/, '');
    res.json({
      success: true,
      data: p.properties().map((prop) => ({
        id: prop.id, name: prop.name, listing: prop.listing,
        stays: p.stays(prop).map((s) => ({
          start: s.start, end: s.end, from: s.from, to: s.to, status: s.status, guest: s.guest, pin: s.pin,
          link: `${base}/guest/${s.token}`,
        })),
      })),
    });
  });

  // A keypad, lock bridge or flow asks: does this PIN open the door now?
  // (any signed-in user or API token — a keypad uses a token)
  router.post('/tenant/check-pin', (req, res) => {
    const p = portal();
    if (!p) return res.json({ success: true, data: { valid: false } });
    const r = p.checkPin(req.body?.pin, req.body?.property);
    console.log(`[Tenant] PIN check${req.body?.property ? ` for ${str(req.body.property, 60)}` : ''}: ${r.valid ? `valid (${r.property})` : 'rejected'}`);
    res.json({ success: true, data: r });
  });

  // New secret: every guest link and derived PIN changes at once
  router.post('/tenant/reset-links', requireAdmin, (req, res) => {
    const p = portal();
    if (!p) return res.status(503).json({ success: false, error: 'Guest portal unavailable' });
    p.resetSecret();
    p.publish();
    console.log('[Tenant] All guest links reset');
    res.json({ success: true, message: 'All guest links and generated PINs changed — send guests their new links.' });
  });

  router.post('/settings/tenant', requireAdmin, (req, res) => {
    const b = req.body || {};
    const publicUrl = str(b.publicUrl, 300).replace(/\/+$/, '');
    if (publicUrl && !/^https?:\/\/[^\s/]+/.test(publicUrl)) {
      return res.status(400).json({ success: false, error: 'Public address must start with https:// (or http://)' });
    }
    const properties = (Array.isArray(b.properties) ? b.properties : []).map((p) => ({
      name: str(p?.name, 100),
      listing: str(p?.listing, 200),
      devices: [...new Set((Array.isArray(p?.devices) ? p.devices : []).map((d) => str(d, 200)).filter(Boolean))],
      wifi: { ssid: str(p?.wifi?.ssid, 64), password: str(p?.wifi?.password, 128) },
      info: str(p?.info),
      rules: str(p?.rules),
      pin: { mode: p?.pin?.mode === 'random' ? 'random' : 'phone4', digits: Math.min(8, Math.max(4, Number(p?.pin?.digits) || 4)) },
      earlyHours: Math.min(48, Math.max(0, Number(p?.earlyHours) || 0)),
      lateHours: Math.min(48, Math.max(0, Number(p?.lateHours ?? 1) || 0)),
    })).filter((p) => p.listing);
    const tenant = { enabled: !!b.enabled, publicUrl, properties };
    try {
      writeConfigFile({ ...readConfigFile(), tenant });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    portal()?.publish();
    res.json({ success: true, message: 'Saved and applied.' });
  });
};
