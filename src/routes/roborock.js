'use strict';

// Roborock — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, sensorRegistry, store } = ctx;

  // ── Roborock ───────────────────────────────────────────────────────────

  router.post('/settings/test-roborock', requireAdmin, async (req, res) => {
    const { host, token } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host is required' });
    if (!token || token.includes('•')) return res.status(400).json({ success: false, error: 'token is required' });
    const tokenClean = token.replace(/\s/g, '');
    if (tokenClean.length !== 32) return res.json({ success: false, error: 'token must be 32 hex characters' });

    const crypto = require('crypto');
    const dgram  = require('dgram');
    const HELLO  = Buffer.from('21310020ffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');

    const tryHello = () => new Promise((resolve, reject) => {
      const sock = dgram.createSocket('udp4');
      const t    = setTimeout(() => { sock.close(); reject(new Error('No response — check IP and that device is on the same network')); }, 5000);
      sock.on('message', msg => { clearTimeout(t); sock.close(); resolve(msg); });
      sock.on('error',   err => { clearTimeout(t); sock.close(); reject(err); });
      sock.send(HELLO, 54321, host);
    });

    try {
      const msg      = await tryHello();
      const deviceId = msg.readUInt32BE(8);
      res.json({ success: true, message: `Connected — device ID ${deviceId}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/roborock', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const devices = req.body;
    if (!Array.isArray(devices)) return res.status(400).json({ success: false, error: 'Expected array of devices' });
    const sanitized = devices.map(d => {
      const prev = (current.roborock?.devices ?? []).find(x => x.host === d.host);
      return {
        name:  (d.name  || '').trim(),
        host:  (d.host  || '').trim(),
        token: (d.token && !d.token.includes('•')) ? d.token.replace(/\s/g, '') : (prev?.token || ''),
      };
    }).filter(d => d.host && d.token);
    try {
      writeConfigFile({ ...current, roborock: { ...current.roborock, devices: sanitized } });
      res.json({ success: true, message: `${sanitized.length} device(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Roborock cloud (Roborock-app devices, e.g. Q Revo) — login test + save
  router.post('/settings/test-roborock-cloud', requireAdmin, async (req, res) => {
    const current = readConfigFile();
    const { email } = req.body;
    let { password } = req.body;
    if (password && password.includes('•')) password = current.roborock?.cloud?.password || '';
    if (!email || !password) return res.status(400).json({ success: false, error: 'email and password are required' });

    let roborockLogin;
    try { ({ roborockLogin } = require('../roborock-cloud-client')); }
    catch (err) { return res.status(500).json({ success: false, error: `Module load failed: ${err.message}` }); }

    try {
      const { devices } = await roborockLogin(email.trim(), password);
      res.json({
        success: true,
        message: `Login OK — ${devices.length} device(s) found`,
        data: { devices: devices.map(d => ({ name: d.name, model: d.model, duid: d.duid, pv: d.pv, online: d.online })) },
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/roborock-cloud', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { email, duid } = req.body;
    let { password } = req.body;
    const prev = current.roborock?.cloud || {};
    if (!password || password.includes('•')) password = prev.password || '';
    const cloud = { email: (email || '').trim(), password, duid: (duid || '').trim() };
    if (!cloud.email || !cloud.password) return res.status(400).json({ success: false, error: 'email and password are required' });
    try {
      writeConfigFile({ ...current, roborock: { ...current.roborock, cloud } });
      res.json({ success: true, message: 'Roborock cloud saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Kärcher Home Robots (RCV5/RCV3/RCF5 vacuums) — login test + save.
  // See src/karcher-client.js header for protocol provenance.
  router.post('/settings/test-karcher', requireAdmin, async (req, res) => {
    const current = readConfigFile();
    const { region } = req.body;
    const { email } = req.body;
    let { password } = req.body;
    if (password && password.includes('•')) password = current.karcher?.password || '';
    if (!email || !password) return res.status(400).json({ success: false, error: 'email and password are required' });

    let karcher;
    try { karcher = require('../karcher-client'); }
    catch (err) { return res.status(500).json({ success: false, error: `Module load failed: ${err.message}` }); }

    try {
      const baseUrl = karcher.REGION_URLS[region] || karcher.REGION_URLS.eu;
      const urls = await karcher.getUrls(baseUrl);
      const session = await karcher.login(urls.appApi, email.trim(), password);
      const devices = await karcher.getDevices(urls.appApi, session);
      res.json({
        success: true,
        message: `Login OK — ${devices.length} device(s) found`,
        data: { devices: devices.map((d) => ({ nickname: d.nickname, model: d.model, sn: d.sn, online: d.online })) },
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/karcher', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { email, region, sn } = req.body;
    let { password } = req.body;
    const prev = current.karcher || {};
    if (!password || password.includes('•')) password = prev.password || '';
    const karcher = {
      email: (email || '').trim(),
      password,
      region: ['eu', 'us', 'cn'].includes(region) ? region : 'eu',
      sn: (sn || '').trim(),
    };
    if (!karcher.email || !karcher.password) return res.status(400).json({ success: false, error: 'email and password are required' });
    try {
      writeConfigFile({ ...current, karcher });
      res.json({ success: true, message: 'Kärcher settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Landroid (Worx / Kress / Landxcape robot mower) — login test + save
  router.post('/settings/test-landroid', requireAdmin, async (req, res) => {
    const current = readConfigFile();
    const { brand, email } = req.body;
    let { password } = req.body;
    if (password && password.includes('•')) password = current.landroid?.password || '';
    if (!email || !password) return res.status(400).json({ success: false, error: 'email and password are required' });

    let testLogin;
    try { ({ testLogin } = require('../landroid-client')); }
    catch (err) { return res.status(500).json({ success: false, error: `Module load failed: ${err.message}` }); }

    try {
      const { mowers } = await testLogin(brand || 'worx', email.trim(), password);
      res.json({
        success: true,
        message: `Login OK — ${mowers.length} mower(s) found`,
        data: { mowers },
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/landroid', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { brand, email, pollInterval } = req.body;
    let { password } = req.body;
    const prev = current.landroid || {};
    if (!password || password.includes('•')) password = prev.password || '';
    const landroid = {
      brand: (brand || 'worx').trim(),
      email: (email || '').trim(),
      password,
      pollInterval: Number(pollInterval) || 60,
    };
    if (!landroid.email || !landroid.password) return res.status(400).json({ success: false, error: 'email and password are required' });
    try {
      writeConfigFile({ ...current, landroid });
      res.json({ success: true, message: 'Landroid saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // List Roborock cloud devices that have a live map (for the dashboard).
  router.get('/roborock/devices', (req, res) => {
    const rc = clients.roborockCloud;
    res.json({ success: true, devices: rc ? rc.listDevices() : [] });
  });

  // Loxone-friendly flat status (HTTP Virtual Input can parse each field).
  //   GET /api/roborock/:duid/status?token=<apiToken>
  router.get('/roborock/:duid/status', (req, res) => {
    const k = `roborock/${req.params.duid}`;
    const g = (p) => store.get(`${k}/${p}`);
    res.json({
      success:    true,
      duid:       req.params.duid,
      battery:    g('battery'),
      state:      g('state'),
      error:      g('error'),
      cleaning:   g('cleaning'),
      fan:        g('fan'),
      water:      g('water'),
      clean_time: g('clean_time'),
      clean_area: g('clean_area'),
      main_brush: g('main_brush'),
      side_brush: g('side_brush'),
      filter:     g('filter'),
      sensor:     g('sensor'),
    });
  });

  // Loxone-friendly single command endpoint (Virtual Output → HTTP GET).
  //   GET /api/roborock/:duid/cmd/<action>?token=<apiToken>
  //   actions: start | dock | pause | stop | locate | empty | wash | dry
  //            fan?value=0..3 | water?value=0..3 | clean?rooms=16,17
  router.get('/roborock/:duid/cmd/:action', async (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    const key    = `roborock/${req.params.duid}`;
    const action = String(req.params.action).toLowerCase();
    const value  = req.query.value ?? req.query.level;
    const SENSOR = {
      start: ['cleaning', 1], dock: ['dock', 1], return: ['dock', 1], stop: ['dock', 1],
      pause: ['cleaning', 0], locate: ['locate', 1], find: ['locate', 1],
      empty: ['dock_empty', 1], wash: ['dock_wash', 1], dry: ['dock_dry', 1],
      fan: ['fan', value], water: ['water', value],
    };
    try {
      if (action === 'clean' || action === 'rooms') {
        const rc = clients.roborockCloud;
        if (!rc) return res.status(503).json({ success: false, error: 'Roborock cloud client not running' });
        const segs = String(req.query.rooms ?? req.query.segments ?? '').split(',').map(s => s.trim()).filter(Boolean);
        const cleaned = await rc.cleanRoom(req.params.duid, segs);
        return res.json({ success: true, action, segments: cleaned });
      }
      const m = SENSOR[action];
      if (!m) return res.status(400).json({ success: false, error: `Unknown action '${action}'` });
      if (m[1] === undefined) return res.status(400).json({ success: false, error: `Action '${action}' requires ?value=` });
      await sensorRegistry.sendCommand(key, m[0], m[1]);
      res.json({ success: true, action });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Room list (segment ids + names) for a Roborock cloud device.
  router.get('/roborock/:duid/rooms', (req, res) => {
    const rc = clients.roborockCloud;
    if (!rc) return res.status(503).json({ success: false, error: 'Roborock cloud client not running' });
    res.json({ success: true, rooms: rc.getRooms(req.params.duid) });
  });

  // Start a room/segment clean. Body: { segments: [16, 17] } or { segment: 16 }.
  router.post('/roborock/:duid/clean-room', requireAdmin, async (req, res) => {
    const rc = clients.roborockCloud;
    if (!rc) return res.status(503).json({ success: false, error: 'Roborock cloud client not running' });
    const segs = req.body.segments ?? req.body.segment;
    try {
      const cleaned = await rc.cleanRoom(req.params.duid, segs);
      res.json({ success: true, message: `Cleaning segment(s) ${cleaned.join(', ')}`, segments: cleaned });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // On-demand live map PNG for a Roborock cloud device (rendered server-side,
  // cached ~5 s). Used by an <img> in the dashboard graphs section.
  router.get('/roborock/:duid/map.png', async (req, res) => {
    const rc = clients.roborockCloud;
    if (!rc) return res.status(503).send('Roborock cloud client not running');
    try {
      const buf = await rc.fetchMapPng(req.params.duid);
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'no-cache');
      res.send(buf);
    } catch (err) {
      res.status(500).send('Map error: ' + err.message);
    }
  });

  // Rendered map PNG for a Kärcher robot (cached ~30 s in the client). Also
  // the snapshotUrl of the robot's pseudo-camera in /api/cameras.
  router.get('/karcher/:sn/map.png', async (req, res) => {
    const kc = clients.karcher;
    if (!kc) return res.status(503).send('Kärcher client not running');
    try {
      const buf = await kc.fetchMapPng(req.params.sn);
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'no-cache');
      res.send(buf);
    } catch (err) {
      res.status(500).send('Map error: ' + err.message);
    }
  });
};
