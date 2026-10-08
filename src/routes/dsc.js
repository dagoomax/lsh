'use strict';

// DSC PowerSeries Neo (ITv2 via TL280) — status, settings and partition /
// zone commands. Client: src/dsc-client.js.
const crypto = require('crypto');
const os = require('os');
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

const MASK = '••••••••';

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal && !/^100\./.test(a.address))
    .map((a) => a.address);
}

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;

  router.get('/dsc/status', (req, res) => {
    const c = clients.dsc;
    res.json({ success: true, data: c ? c.getStatus() : null });
  });

  // Settings, with secrets masked. Also returns what the installer needs to
  // program at the keypad ([851] section values).
  router.get('/settings/dsc', requireAdmin, (req, res) => {
    const d = readConfigFile().dsc || {};
    const port = Number(d.port) || 3072;
    res.json({
      success: true,
      data: {
        enabled: !!d.enabled, port, name: d.name || '', integrationId: d.integrationId || '',
        type2Key: d.type2Key ? MASK : '', type1Code: d.type1Code ? MASK : '', userCode: d.userCode ? MASK : '',
        allZones: !!d.allZones, zoneTypes: d.zoneTypes || {},
        hostAddresses: lanAddresses(),
        portHex: port.toString(16).toUpperCase().padStart(4, '0'),
      },
    });
  });

  router.post('/settings/dsc/generate-key', requireAdmin, (req, res) => {
    res.json({ success: true, data: { key: crypto.randomBytes(16).toString('hex').toUpperCase() } });
  });

  router.post('/settings/dsc', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const prev = current.dsc || {};
    const b = req.body || {};
    const keep = (v, old) => (String(v ?? '').includes('•') ? old : String(v ?? '').trim());
    const type2Key = keep(b.type2Key, prev.type2Key).toLowerCase();
    const type1Code = keep(b.type1Code, prev.type1Code);
    const userCode = keep(b.userCode, prev.userCode);
    const port = Number(b.port) || 3072;
    const errors = [];
    if (type2Key && !/^[0-9a-f]{32}$/.test(type2Key)) errors.push('Type 2 access key must be 32 hex characters (same as [851][700])');
    if (type1Code && !/^\d{8}$/.test(type1Code)) errors.push('Type 1 access code must be 8 digits ([851][423])');
    if (type1Code && !/^\d{12}$/.test(String(b.integrationId || prev.integrationId || ''))) errors.push('Type 1 encryption also needs the 12-digit Integration ID ([851][422])');
    if (userCode && !/^\d{4,8}$/.test(userCode)) errors.push('User code must be 4–8 digits');
    if (b.enabled && !type2Key && !type1Code) errors.push('Set a Type 2 access key (recommended) or a Type 1 access code');
    if (port < 1 || port > 65535) errors.push('Port must be 1–65535');
    if (errors.length) return res.status(400).json({ success: false, error: errors.join(' · ') });

    const zoneTypes = {};
    for (const [k, v] of Object.entries(b.zoneTypes || prev.zoneTypes || {})) {
      if (/^\d+$/.test(k) && ['motion', 'contact', 'none'].includes(v)) zoneTypes[k] = v;
    }
    const dsc = {
      enabled: !!b.enabled, port, name: String(b.name ?? prev.name ?? '').trim() || undefined,
      integrationId: String(b.integrationId ?? prev.integrationId ?? '').replace(/\D/g, '') || undefined,
      type2Key: type2Key || undefined, type1Code: type1Code || undefined, userCode: userCode || undefined,
      allZones: !!b.allZones, zoneTypes,
    };
    try {
      writeConfigFile({ ...current, dsc });
      res.json({ success: true, message: 'Saved. Restart LSH to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  const live = (res) => {
    const c = clients.dsc;
    if (!c) { res.status(409).json({ success: false, error: 'DSC integration is not running' }); return null; }
    return c;
  };
  const run = async (res, fn) => {
    try { res.json({ success: true, data: await fn() }); }
    catch (err) { res.status(/not connected/.test(err.message) ? 503 : 400).json({ success: false, error: err.message }); }
  };

  router.post('/dsc/partition/:n/arm', requireAdmin, (req, res) => {
    const c = live(res); if (!c) return;
    run(res, () => c.arm(Number(req.params.n), req.body?.mode || 'away', req.body?.code || undefined));
  });
  router.post('/dsc/partition/:n/disarm', requireAdmin, (req, res) => {
    const c = live(res); if (!c) return;
    run(res, () => c.disarm(Number(req.params.n), req.body?.code || undefined));
  });
  router.post('/dsc/zone/:n/bypass', requireAdmin, (req, res) => {
    const c = live(res); if (!c) return;
    run(res, () => c.bypass(Number(req.body?.partition) || 1, Number(req.params.n), req.body?.bypass !== false));
  });
};
