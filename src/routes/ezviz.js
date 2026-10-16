'use strict';

// EZVIZ — Settings (account, region), the e-mail verification code, each
// camera's verification code (local RTSP) and adding cameras to LSH's camera
// list. Client: src/ezviz-client.js.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

const MASK = '••••••••';
const CODE_RE = /^[A-Za-z0-9]{4,16}$/;

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store, sensorRegistry } = ctx;
  const ez = () => clients.ezviz;
  const restart = async (cfg) => {
    ez()?.stop();
    delete clients.ezviz;
    if (!cfg.username) return null;
    const EzvizClient = require('../ezviz-client');
    const c = new EzvizClient({ ezviz: cfg }, store, sensorRegistry);
    clients.ezviz = c;
    await c.start();
    return c;
  };

  router.get('/settings/ezviz', requireAdmin, (req, res) => {
    const e = readConfigFile().ezviz || {};
    res.json({ success: true, data: {
      username: e.username || '', password: e.password ? MASK : '', region: e.region || 'eu', pollInterval: e.pollInterval || 30,
      codes: Object.fromEntries(Object.keys(e.codes || {}).map((k) => [k, MASK])),
      status: ez()?.status() || { configured: false },
    } });
  });

  // account: saved, then signed in right away (an account with 2-step sign-in gets an e-mailed code)
  router.post('/settings/ezviz', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const cur = readConfigFile();
    const prev = cur.ezviz || {};
    const region = String(b.region || prev.region || 'eu').trim();
    if (!/^([a-z]{2}|[a-z0-9.-]+\.[a-z]{2,})$/i.test(region)) return res.status(400).json({ success: false, error: 'Region is eu, us, sa, as… or a full API host' });
    const ezviz = {
      ...prev,
      username: String(b.username ?? prev.username ?? '').trim() || undefined,
      password: String(b.password || '').includes('•') ? prev.password : String(b.password || '') || undefined,
      region, pollInterval: Math.max(15, Number(b.pollInterval) || prev.pollInterval || 30),
    };
    writeConfigFile({ ...cur, ezviz });
    try {
      const c = await restart(ezviz);
      const st = c?.status();
      if (c && !st.signedIn) return res.json({ success: false, error: c.error || 'Couldn’t sign in to EZVIZ', data: st });
      res.json({ success: true, message: c ? `Signed in — ${st.devices.length} device(s)` : 'Saved', data: st });
    } catch (err) { res.json({ success: false, error: err.message }) }
  });

  router.post('/ezviz/verify', requireAdmin, async (req, res) => {
    const c = ez();
    if (!c) return res.status(409).json({ success: false, error: 'Save the EZVIZ account first' });
    try { await c.login(String(req.body?.code || '').trim()); await c._pollImpl(); res.json({ success: true, message: `Signed in — ${c.status().devices.length} device(s)`, data: c.status() }) }
    catch (err) { res.json({ success: false, error: err.message }) }
  });

  // each camera's verification code (the 6 capital letters on its sticker) — its local RTSP password
  router.post('/ezviz/codes', requireAdmin, (req, res) => {
    const cur = readConfigFile();
    const codes = { ...(cur.ezviz?.codes || {}) };
    for (const [serial, code] of Object.entries(req.body?.codes || {})) {
      const v = String(code || '').trim();
      if (!v) delete codes[serial];
      else if (v.includes('•')) continue;
      else if (!CODE_RE.test(v)) return res.status(400).json({ success: false, error: `“${v}” doesn’t look like a verification code (letters on the device’s sticker)` });
      else codes[serial] = v;
    }
    writeConfigFile({ ...cur, ezviz: { ...(cur.ezviz || {}), codes } });
    if (ez()) ez().cfg.codes = codes;
    res.json({ success: true, message: 'Saved' });
  });

  // cameras with an address and a code → LSH's camera list (Cameras view, snapshots, recording, HomeKit video)
  router.post('/ezviz/add-cameras', requireAdmin, (req, res) => {
    const c = ez();
    if (!c) return res.status(409).json({ success: false, error: 'Sign in to EZVIZ first' });
    const cur = readConfigFile();
    const cams = [...(cur.cameras || [])];
    let added = 0, updated = 0;
    const skipped = [];
    for (const d of c.status().devices.filter((x) => x.camera)) {
      const url = c.rtspUrl(d.serial);
      if (!url) { skipped.push(`${d.name} (${!d.localIp ? 'no local address' : 'no verification code'})`); continue }
      const i = cams.findIndex((x) => x.ezvizSerial === d.serial);
      const entry = { ...(i >= 0 ? cams[i] : {}), name: i >= 0 ? cams[i].name : `EZVIZ ${d.name}`, url, ezvizSerial: d.serial };
      if (i >= 0) { cams[i] = entry; updated++ } else { cams.push(entry); added++ }
    }
    writeConfigFile({ ...cur, cameras: cams });
    res.json({ success: true, message: `${added} added, ${updated} updated${skipped.length ? `; skipped: ${skipped.join(', ')}` : ''}. Restart LSH for HomeKit video.` });
  });

  router.get('/ezviz/status', (req, res) => res.json({ success: true, data: ez()?.status() || { configured: false } }));
};
