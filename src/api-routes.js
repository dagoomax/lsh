const { Router } = require('express');
const fs   = require('fs');
const path = require('path');
const http = require('http');
const { generateSetupUri, generateSetupID } = require('./homekit-uri');
const cameraLog = require('./camera-log');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function readConfigFile() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
  return {};
}

function writeConfigFile(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function createApiRoutes(store, relayController, sensorRegistry, connectionMgr, clients = {}) {
  const { unifiProtect, reolink, mqttExplorer, auth, isSecure, ffmpegRtsp, sipServer, smartThings } = clients;
  const router = Router();

  // ── Auth ──────────────────────────────────────────────────────────────────

  router.post('/auth/setup', async (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    if (auth.hasUsers()) return res.status(409).json({ success: false, error: 'Already set up. Go to /login.html' });
    const { adminUsername, adminPassword } = req.body;
    if (!adminUsername || !adminPassword) {
      return res.status(400).json({ success: false, error: 'adminUsername and adminPassword required' });
    }
    if (adminPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }
    try {
      const user  = await auth.createUser(adminUsername.trim(), adminPassword, 'admin');
      const token = auth.signToken(user);
      auth.setCookie(res, token, isSecure);
      res.json({ success: true, user });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/auth/login', async (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'username and password required' });
    }
    const user = await auth.authenticate(username, password);
    if (!user) return res.status(401).json({ success: false, error: 'Invalid username or password' });
    const token = auth.signToken(user);
    auth.setCookie(res, token, isSecure);
    res.json({ success: true, user });
  });

  router.post('/auth/logout', (req, res) => {
    if (auth) auth.clearCookie(res);
    res.json({ success: true });
  });

  router.get('/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    res.json({ success: true, data: req.user });
  });

  router.post('/auth/change-password', async (req, res) => {
    if (!auth || !req.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'currentPassword and newPassword required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
    }
    const ok = await auth.authenticate(req.user.username, currentPassword);
    if (!ok) return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    try {
      await auth.changePassword(req.user.id, newPassword);
      res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/auth/users', (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required' });
    res.json({ success: true, data: auth.getUsers() });
  });

  router.post('/auth/users', async (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required' });
    const { username, password, role = 'viewer' } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'username and password required' });
    if (password.length < 8) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    if (!['admin', 'viewer'].includes(role)) return res.status(400).json({ success: false, error: 'role must be admin or viewer' });
    try {
      const user = await auth.createUser(username, password, role);
      res.json({ success: true, data: user });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/auth/users/:id', (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required' });
    try {
      auth.deleteUser(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/auth/tokens', (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    res.json({ success: true, data: auth.getApiTokens() });
  });

  router.post('/auth/tokens', (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Token name required' });
    try {
      const token = auth.createApiToken(name);
      res.json({ success: true, token });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.delete('/auth/tokens/:id', (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    try {
      auth.deleteApiToken(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/connection', (req, res) => {
    res.json({ success: true, data: connectionMgr ? connectionMgr.getStatus() : { source: null } });
  });

  router.get('/status', (req, res) => {
    const grouped = store.getGrouped();
    grouped.relays = relayController.getAll();
    res.json({ success: true, data: grouped });
  });

  router.get('/battery', (req, res) => {
    res.json({ success: true, data: store.getGrouped().battery });
  });

  router.get('/solar', (req, res) => {
    res.json({ success: true, data: store.getGrouped().solar });
  });

  router.get('/grid', (req, res) => {
    res.json({ success: true, data: store.getGrouped().grid });
  });

  router.get('/loads', (req, res) => {
    const grouped = store.getGrouped();
    res.json({
      success: true,
      data: { ac: grouped.acLoads, dc: grouped.dcLoads },
    });
  });

  router.get('/relays', (req, res) => {
    res.json({ success: true, data: relayController.getAll() });
  });

  router.post('/relay/:index/state', async (req, res) => {
    const index = parseInt(req.params.index);
    const { on } = req.body;

    if (typeof on !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Body must contain { "on": true/false }' });
    }

    const relay = relayController.config.relays.find((r) => r.index === index);
    if (!relay) {
      return res.status(404).json({ success: false, error: 'Relay not found' });
    }

    try {
      await relayController.setState(index, on);
      res.json({ success: true, data: { index, on } });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Devices / Sensors ─────────────────────────────────────
  router.get('/devices', (req, res) => {
    const devices = sensorRegistry ? sensorRegistry.getAllReadings() : [];
    res.json({ success: true, data: devices });
  });

  router.get('/devices/:deviceKey(*)', (req, res) => {
    if (!sensorRegistry) return res.json({ success: true, data: null });
    const data = sensorRegistry.getDeviceReadings(req.params.deviceKey);
    if (!data) return res.status(404).json({ success: false, error: 'Device not found' });
    const { sensor } = req.query;
    if (sensor) {
      const reading = data.readings?.[sensor];
      if (!reading) return res.status(404).json({ success: false, error: `Sensor '${sensor}' not found` });
      return res.send(String(reading.value));
    }
    res.json({ success: true, data });
  });

  router.post('/device/:deviceKey(*)/command', async (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    const { sensor, value, on } = req.body;
    const cmdValue = value !== undefined ? value : on; // support both 'value' and legacy 'on'
    if (typeof sensor !== 'string' || cmdValue === undefined) {
      return res.status(400).json({ success: false, error: 'Body must contain { sensor: string, value: any }' });
    }
    try {
      await sensorRegistry.sendCommand(req.params.deviceKey, sensor, cmdValue);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // GET version — browser/Loxone friendly: /api/device/{key}/set?sensor=…&value=…&token=…
  router.get('/device/:deviceKey(*)/set', async (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    const { sensor, value } = req.query;
    if (typeof sensor !== 'string' || value === undefined) {
      return res.status(400).json({ success: false, error: 'Query must contain sensor and value' });
    }
    try {
      await sensorRegistry.sendCommand(req.params.deviceKey, sensor, value);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // ── History ───────────────────────────────────────────────
  router.get('/history/:key(*)', (req, res) => {
    res.json({ success: true, key: req.params.key, points: store.getHistory(req.params.key) });
  });

  // ── Device customization (room / icon / label) ────────────
  // Optionally locked with a PIN (config.editPin, set in Settings → Security).
  const editPinOk = (req) => {
    const pin = String(readConfigFile().editPin || '');
    return !pin || String(req.body?.pin || '') === pin;
  };

  router.get('/edit-pin/status', (req, res) => {
    res.json({ success: true, enabled: !!readConfigFile().editPin });
  });

  router.post('/edit-pin/verify', (req, res) => {
    res.json({ success: true, ok: editPinOk(req) });
  });

  router.post('/device/:key/customize', (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    if (!editPinOk(req)) return res.status(403).json({ success: false, error: 'PIN_REQUIRED' });
    try {
      const dev = sensorRegistry.setOverride(req.params.key, req.body || {});
      res.json({ success: true, device: { key: dev.key, label: dev.label, room: dev.room || null, customIcon: dev.customIcon || null } });
    } catch (err) {
      res.status(404).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/edit-pin', (req, res) => {
    const pin = String(req.body?.pin ?? '').trim();
    if (pin && !/^\d{4,8}$/.test(pin)) {
      return res.status(400).json({ success: false, error: 'PIN must be 4–8 digits' });
    }
    try {
      const cfg = readConfigFile();
      cfg.editPin = pin;
      writeConfigFile(cfg);
      res.json({ success: true, message: pin ? 'Edit PIN enabled' : 'Edit PIN disabled' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Loxone Config XML templates ───────────────────────────
  // Ready-to-import Virtual Output / Virtual HTTP Input templates.
  // ?device=<key> or ?type=<integration> filters; ?host= overrides the LSH
  // address embedded in the XML; ?token= is embedded into command URLs.
  const loxoneXmlHandler = (kind) => (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    const { buildInputsXml, buildOutputsXml } = require('./loxone-xml');

    let devices = sensorRegistry.getDevices();
    if (req.query.device) devices = devices.filter((d) => d.key === req.query.device);
    if (req.query.type) {
      const types = new Set(String(req.query.type).split(',').map((t) => t.trim()).filter(Boolean));
      devices = devices.filter((d) => types.has(d.type));
    }
    // ?named=1 — skip devices with generic fallback labels (e.g. unnamed Satel
    // zones "Zone 33"); devices without the flag are always kept
    if (req.query.named === '1' || req.query.named === 'true') {
      devices = devices.filter((d) => d.named !== false);
    }
    if (!devices.length)  return res.status(404).json({ success: false, error: 'No matching devices' });

    // ?tokenId= resolves an API token server-side (used by the Settings UI,
    // where token values are never exposed to the browser)
    let embedToken = req.query.token;
    if (!embedToken && req.query.tokenId && auth) embedToken = auth.getApiTokenValue(req.query.tokenId);

    const opts = {
      host:      req.query.host || req.get('host'),
      token:     embedToken || 'YOUR_API_TOKEN',
      pollingMs: Math.max(1000, Number(req.query.polling) || 5000),
    };
    const xml  = kind === 'inputs' ? buildInputsXml(devices, opts) : buildOutputsXml(devices, opts);
    if (!xml) {
      return res.status(404).json({
        success: false,
        error: kind === 'outputs'
          ? 'Matching devices have no controllable sensors — use inputs.xml for read-only devices'
          : 'Matching devices have no readable sensors',
      });
    }
    const name = ['lsh-loxone', kind, req.query.type || (req.query.device || '').replace(/\//g, '-')]
      .filter(Boolean).join('-') + '.xml';
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    res.send(xml);
  };
  router.get('/loxone/inputs.xml',  loxoneXmlHandler('inputs'));
  router.get('/loxone/outputs.xml', loxoneXmlHandler('outputs'));

  // ── Automation (rules / scenes / notifications) ───────────
  if (clients.automation) {
    const automation = clients.automation;

    router.get('/automation/rules', (req, res) => res.json({ success: true, data: automation.rules }));
    router.post('/automation/rules', (req, res) => {
      try { res.json({ success: true, data: automation.saveRule(req.body) }); }
      catch (err) { res.status(400).json({ success: false, error: err.message }); }
    });
    router.delete('/automation/rules/:id', (req, res) => {
      automation.deleteRule(req.params.id);
      res.json({ success: true });
    });

    router.get('/automation/scenes', (req, res) => res.json({ success: true, data: automation.scenes }));
    router.post('/automation/scenes', (req, res) => {
      try { res.json({ success: true, data: automation.saveScene(req.body) }); }
      catch (err) { res.status(400).json({ success: false, error: err.message }); }
    });
    router.delete('/automation/scenes/:id', (req, res) => {
      automation.deleteScene(req.params.id);
      res.json({ success: true });
    });
    router.post('/automation/scenes/:id/run', async (req, res) => {
      try { res.json({ success: true, data: await automation.runScene(req.params.id) }); }
      catch (err) { res.status(400).json({ success: false, error: err.message }); }
    });

    router.get('/automation/notifications', (req, res) => res.json({ success: true, data: automation.getNotifications() }));
    // External systems (Node-RED, scripts) can push a notification → toast + log
    router.post('/automation/notifications', (req, res) => {
      const { level, message, source } = req.body || {};
      if (!message) return res.status(400).json({ success: false, error: 'message required' });
      res.json({ success: true, data: automation.notify(level || 'info', String(message), source || 'api') });
    });
    router.delete('/automation/notifications', (req, res) => {
      automation.clearNotifications();
      res.json({ success: true });
    });
  }

  // ── Satel INTEGRA ─────────────────────────────────────────
  // Live state + control for zones (inputs), outputs and partitions.
  const satelList = (kind) => (sensorRegistry ? sensorRegistry.getDevices() : [])
    .filter((d) => d.type === 'satel' && d.key.startsWith(`satel/${kind}/`))
    .map((d) => sensorRegistry.getDeviceReadings(d.key))
    .sort((a, b) => (+a.key.split('/').pop()) - (+b.key.split('/').pop()));
  const rv = (d, path) => (d.readings?.[path]?.value ?? 0) === 1;
  const zoneKind = (d) => (d.homekit || []).includes('motion') ? 'motion'
    : (d.homekit || []).includes('contact') ? 'contact' : 'other';

  router.get('/satel/zones', (req, res) => {
    res.json({ success: true, data: satelList('zone').map((d) => ({
      num: +d.key.split('/').pop(), key: d.key, label: d.label, kind: zoneKind(d),
      violation: rv(d, 'state'), tamper: rv(d, 'tamper'), alarm: rv(d, 'alarm'),
    })) });
  });

  router.get('/satel/outputs', (req, res) => {
    res.json({ success: true, data: satelList('output').map((d) => ({
      num: +d.key.split('/').pop(), key: d.key, label: d.label, on: rv(d, 'state'),
    })) });
  });

  router.get('/satel/partitions', (req, res) => {
    res.json({ success: true, data: satelList('partition').map((d) => ({
      num: +d.key.split('/').pop(), key: d.key, label: d.label,
      armed: rv(d, 'armed'), alarm: rv(d, 'alarm'), fireAlarm: rv(d, 'fire_alarm'),
    })) });
  });

  router.get('/satel/status', (req, res) => {
    const zones = satelList('zone'), outputs = satelList('output'), partitions = satelList('partition');
    res.json({ success: true, data: {
      configured: !!readConfigFile().satel?.host,
      zones:      { total: zones.length,   open: zones.filter((d) => rv(d, 'state')).length },
      outputs:    { total: outputs.length, on:   outputs.filter((d) => rv(d, 'state')).length },
      partitions: partitions.map((d) => ({
        num: +d.key.split('/').pop(), label: d.label, armed: rv(d, 'armed'), alarm: rv(d, 'alarm'),
      })),
    } });
  });

  // Control an output — body: { state: true | false | "on" | "off" }
  router.post('/satel/output/:num', async (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    try {
      await sensorRegistry.sendCommand(`satel/output/${req.params.num}`, 'state', req.body?.state);
      res.json({ success: true });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
  });

  // Arm / disarm a partition
  router.post('/satel/partition/:num/:action(arm|disarm)', async (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    try {
      await sensorRegistry.sendCommand(`satel/partition/${req.params.num}`, 'armed', req.params.action === 'arm');
      res.json({ success: true });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
  });

  // ── Cameras ───────────────────────────────────────────────

  router.get('/cameras', (req, res) => {
    const cfg = readConfigFile();
    const unifiCams = unifiProtect ? unifiProtect.getCameras() : [];

    // Auto-include SmartThings cameras (devices with imageCapture capability)
    const stCams = sensorRegistry
      ? sensorRegistry.getDevices()
          .filter((d) => d.type === 'smartthings' && d.sensors.some((s) => s.path === 'image'))
          .map((d) => {
            const deviceId = d.key.replace('smartthings/', '');
            return {
              name:        d.label,
              url:         '',
              snapshotUrl: `/api/smartthings-camera/${deviceId}/snapshot`,
              mjpegUrl:    '',
              webrtcUrl:   '',
              _smartthings: true,
              _deviceId:   deviceId,
            };
          })
      : [];

    const reolinkCams = reolink ? reolink.getCameras() : [];
    res.json({ success: true, data: [...(cfg.cameras || []), ...unifiCams, ...reolinkCams, ...stCams] });
  });

  // ── SIP doorbell intercom ─────────────────────────────────

  router.get('/sip/status', (req, res) => {
    if (!sipServer) return res.json({ success: true, data: { active: false, state: 'disabled' } });
    res.json({ success: true, data: sipServer.getState() });
  });

  router.post('/sip/answer', (req, res) => {
    if (!sipServer) return res.status(503).json({ success: false, error: 'SIP server not enabled' });
    res.json({ success: sipServer.answer() });
  });

  router.post('/sip/reject', (req, res) => {
    if (!sipServer) return res.status(503).json({ success: false, error: 'SIP server not enabled' });
    res.json({ success: sipServer.reject() });
  });

  router.post('/sip/hangup', (req, res) => {
    if (!sipServer) return res.status(503).json({ success: false, error: 'SIP server not enabled' });
    res.json({ success: sipServer.hangup() });
  });

  router.post('/sip/open-door', async (req, res) => {
    if (!sipServer) return res.status(503).json({ success: false, error: 'SIP server not enabled' });
    try {
      await sipServer.openDoor();
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // ── Sonos: URL playback + TTS announcements ───────────────
  // GET + POST so Loxone/automations can trigger with a simple query too.
  const sonosParam = (req, name) => req.body?.[name] ?? req.query[name];

  router.get('/sonos/players', (req, res) => {
    const sonos = clients.sonos;
    res.json({ success: true, data: sonos ? sonos.getPlayers() : [] });
  });

  const announceHandler = async (req, res) => {
    const sonos = clients.sonos;
    if (!sonos) return res.status(503).json({ success: false, error: 'Sonos not enabled' });
    const text = sonosParam(req, 'text');
    if (!text) return res.status(400).json({ success: false, error: 'text required' });
    const volume = sonosParam(req, 'volume');
    try {
      const players = await sonos.announceMany(sonosParam(req, 'host'), String(text), {
        lang: sonosParam(req, 'lang'),
        volume: volume != null && volume !== '' ? Number(volume) : undefined,
      });
      res.json({ success: true, players });
    } catch (err) {
      res.status(err.message.includes('No matching') ? 404 : 500).json({ success: false, error: err.message });
    }
  };
  router.post('/sonos/announce', announceHandler);
  router.get('/sonos/announce', announceHandler);

  const playUrlHandler = async (req, res) => {
    const sonos = clients.sonos;
    if (!sonos) return res.status(503).json({ success: false, error: 'Sonos not enabled' });
    const url = sonosParam(req, 'url');
    if (!url) return res.status(400).json({ success: false, error: 'url required' });
    try {
      const players = await sonos.playUrlMany(sonosParam(req, 'host'), String(url), sonosParam(req, 'meta'));
      res.json({ success: true, players });
    } catch (err) {
      res.status(err.message.includes('No matching') ? 404 : 500).json({ success: false, error: err.message });
    }
  };
  router.post('/sonos/play-url', playUrlHandler);
  router.get('/sonos/play-url', playUrlHandler);

  // SmartThings camera snapshot proxy — fetches the stored image URL and proxies the bytes
  router.get('/smartthings-camera/:deviceId/snapshot', async (req, res) => {
    const { deviceId } = req.params;
    const imageUrl = store.get(`smartthings/${deviceId}/image`);
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
      return res.status(404).send('No snapshot available — trigger a capture first');
    }
    try {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) return res.status(502).send(`Upstream error: HTTP ${imgRes.status}`);
      res.set('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
      res.set('Cache-Control', 'no-cache');
      res.send(Buffer.from(await imgRes.arrayBuffer()));
    } catch (err) {
      res.status(502).send('Snapshot fetch failed: ' + err.message);
    }
  });

  // Trigger SmartThings imageCapture.take command
  router.post('/smartthings-camera/:deviceId/take', async (req, res) => {
    const { deviceId } = req.params;
    const token = smartThings ? await smartThings.getToken().catch(() => null)
                              : readConfigFile().smartthings?.token;
    if (!token) return res.status(401).json({ success: false, error: 'No SmartThings token configured' });
    try {
      const r = await fetch(`https://api.smartthings.com/v1/devices/${deviceId}/commands`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands: [{ component: 'main', capability: 'imageCapture', command: 'take' }] }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Resolve camera name from registry for log
      const dev = sensorRegistry?.getDevices?.()?.find?.(d => d.instance === deviceId);
      cameraLog.push(dev?.label || deviceId, 'capture-triggered');
      res.json({ success: true, message: 'Capture triggered — snapshot will update within a few seconds' });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Camera event log
  router.get('/camera-log', (req, res) => {
    const camera = req.query.camera || null;
    const limit  = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json({ success: true, data: cameraLog.getRecent(limit, camera) });
  });

  // UniFi Protect snapshot proxy (avoids CORS + self-signed TLS in browser)
  router.get('/unifi/snapshot/:cameraId', (req, res) => {
    if (!unifiProtect) return res.status(503).end();
    unifiProtect.proxySnapshot(req.params.cameraId, res);
  });

  // Reolink snapshot proxy — keeps camera credentials server-side
  router.get('/reolink/snapshot/:idx', (req, res) => {
    if (!reolink) return res.status(503).end();
    reolink.proxySnapshot(req.params.idx, res);
  });

  router.post('/settings/cameras', (req, res) => {
    const current = readConfigFile();
    const cameras = req.body;
    if (!Array.isArray(cameras)) {
      return res.status(400).json({ success: false, error: 'Body must be an array of cameras' });
    }
    const cleaned = cameras.map(({ name, url, snapshotUrl, mjpegUrl, webrtcUrl }) => ({
      name:        String(name        || '').trim(),
      url:         String(url         || '').trim(),
      snapshotUrl: String(snapshotUrl || '').trim(),
      mjpegUrl:    String(mjpegUrl    || '').trim(),
      webrtcUrl:   String(webrtcUrl   || '').trim(),
    })).filter((c) => c.name || c.url);
    try {
      writeConfigFile({ ...current, cameras: cleaned });
      res.json({ success: true, message: 'Cameras saved' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Reolink PoE cameras ───────────────────────────────────
  router.post('/settings/reolink', (req, res) => {
    const current = readConfigFile();
    const cams = req.body?.cameras ?? req.body;
    if (!Array.isArray(cams)) return res.status(400).json({ success: false, error: 'Body must be an array of cameras' });
    const cleaned = cams.map((c) => ({
      name:     String(c.name || '').trim(),
      host:     String(c.host || '').trim(),
      username: String(c.username || '').trim(),
      password: (c.password && !String(c.password).includes('•')) ? String(c.password) : undefined,
      channel:  parseInt(c.channel) || 0,
      stream:   c.stream === 'sub' ? 'sub' : 'main',
      https:    !!c.https,
      port:     parseInt(c.port) || 0,
      webrtcUrl: String(c.webrtcUrl || '').trim(),
    })).filter((c) => c.host);
    // Preserve saved passwords when the UI sends a masked placeholder
    const prev = current.reolink?.cameras || [];
    cleaned.forEach((c, i) => { if (c.password === undefined) c.password = prev[i]?.password || ''; });
    try {
      writeConfigFile({ ...current, reolink: { cameras: cleaned } });
      res.json({ success: true, message: 'Reolink cameras saved' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Test a single Reolink camera by pulling one snapshot
  router.post('/settings/test-reolink', async (req, res) => {
    const cam = req.body || {};
    if (!cam.host) return res.status(400).json({ success: false, error: 'host is required' });
    try {
      const ReolinkClient = require('./reolink-client');
      const { buffer } = await ReolinkClient.fetchSnapshot(cam);
      res.json({ success: true, message: `Snapshot OK — ${(buffer.length / 1024).toFixed(0)} KB`, data: { bytes: buffer.length } });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ── SolarEdge ─────────────────────────────────────────────

  router.get('/solaredge', (req, res) => {
    res.json({ success: true, data: store.getGrouped().solaredge });
  });

  router.post('/settings/test-solaredge', async (req, res) => {
    const { siteId, apiKey } = req.body;
    if (!siteId || !apiKey) {
      return res.status(400).json({ success: false, error: 'siteId and apiKey are required' });
    }
    try {
      const r = await fetch(
        `https://monitoringapi.solaredge.com/site/${siteId}/overview?api_key=${apiKey}`
      );
      if (r.status === 403 || r.status === 401) {
        return res.json({ success: false, error: 'Invalid API key or site ID' });
      }
      if (!r.ok) {
        return res.json({ success: false, error: `SolarEdge returned HTTP ${r.status}` });
      }
      const data = await r.json();
      const power = data?.overview?.currentPower?.power ?? null;
      const energy = data?.overview?.lastDayData?.energy ?? null;
      res.json({
        success: true,
        message: `Connected — site ${siteId}`,
        data: { currentPower: power, dailyEnergy: energy },
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/solaredge', (req, res) => {
    const current = readConfigFile();
    const { siteId, apiKey } = req.body;
    const updated = {
      ...current,
      solaredge: {
        siteId: siteId ?? current.solaredge?.siteId ?? '',
        apiKey: (apiKey && !apiKey.includes('•')) ? apiKey : (current.solaredge?.apiKey ?? ''),
      },
    };
    try {
      writeConfigFile(updated);
      res.json({ success: true, message: 'SolarEdge settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── SmartThings ───────────────────────────────────────────

  router.post('/settings/test-smartthings', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, error: 'token is required' });
    try {
      const r = await fetch('https://api.smartthings.com/v1/devices', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 401 || r.status === 403) {
        return res.json({ success: false, error: 'Invalid token' });
      }
      if (!r.ok) return res.json({ success: false, error: `SmartThings returned HTTP ${r.status}` });
      const data = await r.json();
      const count = data?.items?.length ?? 0;
      res.json({ success: true, message: `Connected — ${count} device(s) found`, data: { count } });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/smartthings', (req, res) => {
    const current = readConfigFile();
    const { token, deviceIds, webhookUrl } = req.body;
    const updated = {
      ...current,
      smartthings: {
        token: (token && !token.includes('•')) ? token : (current.smartthings?.token ?? ''),
        deviceIds: Array.isArray(deviceIds) ? deviceIds : (current.smartthings?.deviceIds ?? []),
        webhookUrl: webhookUrl || (current.smartthings?.webhookUrl ?? ''),
      },
    };
    try {
      writeConfigFile(updated);
      res.json({ success: true, message: 'SmartThings settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // SmartThings webhook endpoint for real-time state updates
  router.post('/webhooks/smartthings', (req, res) => {
    if (!smartThings) return res.status(503).json({ success: false, error: 'SmartThings not configured' });

    try {
      smartThings.handleWebhookEvent(req.body);
      res.json({ success: true });
    } catch (err) {
      console.error(`[SmartThings Webhook] Error: ${err.message}`);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // ── Satel ────────────────────────────────────────────────

  router.post('/settings/test-satel', async (req, res) => {
    const { host, port } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'Host is required' });
    const net = require('net');
    const sock = new net.Socket();
    const p = parseInt(port) || 7094;
    const timer = setTimeout(() => { sock.destroy(); res.json({ success: false, error: 'Connection timed out' }); }, 5000);
    sock.connect(p, host, () => {
      clearTimeout(timer);
      sock.destroy();
      res.json({ success: true, message: `Connected to ${host}:${p}` });
    });
    sock.on('error', err => { clearTimeout(timer); res.json({ success: false, error: err.message }); });
  });

  router.post('/settings/satel', (req, res) => {
    const current = readConfigFile();
    const { host, port, armCode, zoneCount, partitions, zoneNames, partitionNames, outputCount, outputNames } = req.body;
    const updated = {
      ...current,
      satel: {
        ...current.satel,
        host:      host || current.satel?.host || '',
        port:      parseInt(port) || 7094,
        armCode:   (armCode && !armCode.includes('•')) ? armCode : (current.satel?.armCode || ''),
        zoneCount: parseInt(zoneCount) || 32,
        partitions: Array.isArray(partitions)
          ? partitions.map(Number)
          : (partitions ? String(partitions).split(',').map(s => parseInt(s.trim())).filter(Boolean) : [1]),
        zoneNames:      (zoneNames      && typeof zoneNames      === 'object') ? zoneNames      : (current.satel?.zoneNames      || {}),
        partitionNames: (partitionNames && typeof partitionNames === 'object') ? partitionNames : (current.satel?.partitionNames || {}),
        outputCount:    parseInt(outputCount) || 0,
        outputNames:    (outputNames && typeof outputNames === 'object') ? outputNames : (current.satel?.outputNames || {}),
      },
    };
    try {
      writeConfigFile(updated);
      res.json({ success: true, message: 'Satel settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── UniFi Protect ─────────────────────────────────────────

  router.post('/settings/test-unifi', async (req, res) => {
    const https = require('https');
    const { host, username, password, apiKey } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'Host is required' });
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['X-API-Key'] = apiKey;
      const p = new Promise((resolve, reject) => {
        const body = JSON.stringify({ username, password });
        const r = https.request({
          hostname: host, path: apiKey ? '/proxy/protect/api/cameras' : '/api/auth/login',
          method: apiKey ? 'GET' : 'POST', headers, rejectUnauthorized: false,
        }, res2 => {
          let d = '';
          res2.on('data', c => d += c);
          res2.on('end', () => resolve(res2.statusCode));
        });
        r.on('error', reject);
        if (!apiKey) r.write(body);
        r.end();
      });
      const status = await p;
      if (status === 200) res.json({ success: true, message: `Connected to ${host}` });
      else res.json({ success: false, error: `HTTP ${status}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/unifi', (req, res) => {
    const current = readConfigFile();
    const { host, username, password, apiKey } = req.body;
    const updated = {
      ...current,
      unifi: {
        host:     host     || current.unifi?.host     || '',
        username: username || current.unifi?.username || '',
        password: (password && !password.includes('•')) ? password : (current.unifi?.password || ''),
        apiKey:   (apiKey   && !apiKey.includes('•'))   ? apiKey   : (current.unifi?.apiKey   || ''),
      },
    };
    try {
      writeConfigFile(updated);
      res.json({ success: true, message: 'UniFi Protect settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── VRM helpers ───────────────────────────────────────────

  /** Extract a readable string from VRM API error responses */
  function vrmError(data, fallback = 'Authentication failed') {
    const e = data?.errors ?? data?.error ?? data?.error_description;
    if (!e) return fallback;
    if (typeof e === 'string') return e;
    if (Array.isArray(e)) return e.join(', ');
    if (typeof e === 'object') {
      return Object.entries(e)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join(' | ');
    }
    return String(e);
  }

  /**
   * Resolve VRM credentials → { authHeader }
   * Supports two modes:
   *   - API token:       x-authorization: Token {apiToken}   (no login needed)
   *   - Email/password:  x-authorization: Bearer {loginToken} (login required)
   */
  async function vrmResolveAuth({ apiToken, email, password }) {
    if (apiToken && apiToken.trim()) {
      // API token — use directly, no login step
      return { authHeader: `Token ${apiToken.trim()}` };
    }
    if (!email || !password) {
      throw new Error('Provide either an API token or email + password');
    }
    const r = await fetch('https://vrmapi.victronenergy.com/v2/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password }),
    });
    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch {
      throw new Error(`VRM returned non-JSON (HTTP ${r.status}): ${raw.slice(0, 120)}`);
    }
    if (!r.ok || !data.token) throw new Error(vrmError(data));
    return { authHeader: `Bearer ${data.token}` };
  }

  /** Fetch installation name via auth header */
  async function vrmGetInstallation(installationId, authHeader) {
    const r = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${installationId}/overview`,
      { headers: { 'x-authorization': authHeader } }
    );
    if (!r.ok) throw new Error(`Installation "${installationId}" not found (HTTP ${r.status})`);
    const data = await r.json();
    return data?.records?.name || String(installationId);
  }

  // ── VRM test + partial save ───────────────────────────────
  router.post('/settings/test-vrm', async (req, res) => {
    const { email, password, apiToken, installationId } = req.body;
    try {
      const { authHeader } = await vrmResolveAuth({ apiToken, email, password });
      const method = apiToken?.trim() ? 'API token' : 'email/password';

      if (installationId) {
        const name = await vrmGetInstallation(installationId, authHeader);
        return res.json({ success: true, message: `Connected via ${method} — installation: "${name}"` });
      }
      res.json({ success: true, message: `VRM login successful via ${method}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-vrm-live', async (req, res) => {
    const { email, password, apiToken, installationId } = req.body;
    if (!installationId) {
      return res.status(400).json({ success: false, error: 'Installation ID is required' });
    }
    if (!apiToken && (!email || !password)) {
      return res.status(400).json({ success: false, error: 'Provide an API token or email + password' });
    }

    try {
      // Step 1: Resolve auth
      const { authHeader } = await vrmResolveAuth({ apiToken, email, password });
      const headers = { 'x-authorization': authHeader };

      // Step 2: Get installation name
      const instName = await vrmGetInstallation(installationId, headers['x-authorization']);

      // Step 3: Fetch live diagnostics
      const diagRes = await fetch(
        `https://vrmapi.victronenergy.com/v2/installations/${installationId}/diagnostics?count=1000`,
        { headers }
      );
      if (!diagRes.ok) {
        return res.json({ success: false, error: `Could not fetch live data (${diagRes.status})` });
      }
      const diagData = await diagRes.json();
      const records = diagData?.records || [];

      // Map diagnostic idDataAttributes to readable values
      const find = (codes) => {
        for (const code of codes) {
          const r = records.find((x) => x.idDataAttribute === code);
          if (r && r.formattedValue !== undefined) return r.formattedValue;
          if (r && r.rawValue !== undefined) return r.rawValue;
        }
        return null;
      };

      // VRM attribute IDs for common values
      const live = {
        installationName: instName,
        soc:         find([852, 855]),          // Battery SOC %
        voltage:     find([859, 806]),          // Battery voltage V
        solar:       find([855, 743, 790]),     // PV power W
        grid:        find([860, 808]),          // Grid power W
        consumption: find([817, 858]),          // AC consumption W
        state:       find([846, 847]),          // System state
        timestamp:   records[0]?.timestamp ?? null,
      };

      res.json({ success: true, data: live });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/vrm', (req, res) => {
    const current = readConfigFile();
    const { email, password, apiToken, installationId } = req.body;
    const updated = {
      ...current,
      vrm: {
        ...current.vrm,
        apiToken: (apiToken !== undefined) ? apiToken : (current.vrm?.apiToken ?? ''),
        email: email ?? current.vrm?.email ?? '',
        installationId: installationId ?? current.vrm?.installationId ?? '',
        password: (password && !password.includes('•'))
          ? password
          : current.vrm?.password || '',
      },
    };
    try {
      writeConfigFile(updated);
      res.json({ success: true, message: 'VRM settings saved' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Config backup / restore ───────────────────────────────
  router.get('/settings/export', (req, res) => {
    const cfg = readConfigFile();
    const filename = `victron-config-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(cfg, null, 2));
  });

  router.post('/settings/import', (req, res) => {
    const body = req.body;
    // Basic structure validation
    const required = ['mqtt', 'vrm', 'server', 'homekit'];
    const missing = required.filter((k) => !(k in body));
    if (missing.length) {
      return res.status(400).json({
        success: false,
        error: `Invalid config file — missing keys: ${missing.join(', ')}`,
      });
    }
    if ('relays' in body && !Array.isArray(body.relays)) {
      return res.status(400).json({ success: false, error: '"relays" must be an array' });
    }
    try {
      writeConfigFile(body);
      relayController.config.relays = body.relays;
      res.json({ success: true, message: 'Configuration restored. Restart the server to apply connection changes.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── HomeKit QR ────────────────────────────────────────────
  router.get('/homekit/setup-uri', (req, res) => {
    const cfg = readConfigFile();
    const pin = cfg.homekit?.pin || '031-45-154';
    const setupID = cfg.homekit?.setupID || 'HEJX';
    try {
      const uri = generateSetupUri(pin, setupID);
      res.json({ success: true, data: { uri, pin, setupID } });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // ── Settings ─────────────────────────────────────────────
  router.get('/settings', (req, res) => {
    const cfg = readConfigFile();
    // Strip secrets from response for security
    const safe = JSON.parse(JSON.stringify(cfg));
    if (safe.vrm?.password) safe.vrm.password = '••••••••';
    if (safe.vrm?.apiToken) safe.vrm.apiToken = '••••••••';
    if (safe.solaredge?.apiKey) safe.solaredge.apiKey = '••••••••';
    if (safe.smartthings?.token) safe.smartthings.token = '••••••••';
    if (safe.editPin) safe.editPin = '••••••••';
    if (safe.smartthings?.clientSecret) safe.smartthings.clientSecret = '••••••••';
    if (safe.satel?.armCode) safe.satel.armCode = '••••••••';
    if (safe.unifi?.password) safe.unifi.password = '••••••••';
    if (safe.unifi?.apiKey) safe.unifi.apiKey = '••••••••';
    if (safe.loxone?.password)  safe.loxone.password  = '••••••••';
    if (safe.dirigera?.token)   safe.dirigera.token   = '••••••••';
    if (safe.tradfri?.psk)      safe.tradfri.psk      = '••••••••';
    if (safe.sip?.password)     safe.sip.password     = '••••••••';
    if (safe.tradfri?.securityCode) safe.tradfri.securityCode = '••••••••';
    if (safe.homey?.token)          safe.homey.token          = '••••••••';
    if (safe.fibaro?.password)      safe.fibaro.password      = '••••••••';
    if (safe.bayrol?.password)      safe.bayrol.password      = '••••••••';
    if (safe.somfy?.password)       safe.somfy.password       = '••••••••';
    if (Array.isArray(safe.reolink?.cameras)) safe.reolink.cameras.forEach((c) => { if (c.password) c.password = '••••••••'; });
    if (safe.somfy?.token)          safe.somfy.token          = '••••••••';
    if (safe.loxoneOut?.password)   safe.loxoneOut.password   = '••••••••';
    if (safe.auxair?.password)      safe.auxair.password      = '••••••••';
    if (safe.dreame?.devices) {
      safe.dreame.devices = safe.dreame.devices.map(d =>
        d.token ? { ...d, token: '••••••••' } : d
      );
    }
    if (safe.roborock?.devices) {
      safe.roborock.devices = safe.roborock.devices.map(d =>
        d.token ? { ...d, token: '••••••••' } : d
      );
    }
    if (safe.roborock?.cloud?.password) safe.roborock.cloud.password = '••••••••';
    if (safe.esphome?.devices) {
      safe.esphome.devices = safe.esphome.devices.map(d =>
        d.password ? { ...d, password: '••••••••' } : d
      );
    }
    if (safe.shelly?.devices) {
      safe.shelly.devices = safe.shelly.devices.map(d =>
        d.password ? { ...d, password: '••••••••' } : d
      );
    }
    delete safe.jwtSecret; // never expose JWT signing secret
    // Indicate whether LG tokens are persisted without exposing them
    if (safe.lgthinq) {
      const tokFile = path.join(__dirname, '..', 'persist', 'lgthinq-tokens.json');
      try {
        const tok = JSON.parse(fs.readFileSync(tokFile, 'utf8'));
        safe.lgthinq.hasTokens  = !!tok.access_token;
        safe.lgthinq.userNumber = tok.user_number || '';
      } catch { safe.lgthinq.hasTokens = false; safe.lgthinq.userNumber = ''; }
      delete safe.lgthinq.username;
      delete safe.lgthinq.password;
    }
    res.json({ success: true, data: safe });
  });

  router.post('/settings', (req, res) => {
    const current = readConfigFile();
    const body = req.body;

    // Deep merge incoming fields
    const updated = {
      ...current,
      mqtt: { ...current.mqtt, ...body.mqtt },
      vrm: {
        ...current.vrm,
        ...body.vrm,
        // Don't overwrite secrets if placeholder was sent back
        password: (body.vrm?.password && !body.vrm.password.includes('•'))
          ? body.vrm.password
          : current.vrm?.password || '',
        apiToken: (body.vrm?.apiToken && !body.vrm.apiToken.includes('•'))
          ? body.vrm.apiToken
          : current.vrm?.apiToken || '',
      },
      solaredge: {
        siteId: body.solaredge?.siteId ?? current.solaredge?.siteId ?? '',
        apiKey: (body.solaredge?.apiKey && !body.solaredge.apiKey.includes('•'))
          ? body.solaredge.apiKey
          : current.solaredge?.apiKey ?? '',
      },
      smartthings: {
        token: (body.smartthings?.token && !body.smartthings.token.includes('•'))
          ? body.smartthings.token
          : current.smartthings?.token ?? '',
        clientId: body.smartthings?.clientId ?? current.smartthings?.clientId ?? '',
        clientSecret: (body.smartthings?.clientSecret && !body.smartthings.clientSecret.includes('•'))
          ? body.smartthings.clientSecret
          : current.smartthings?.clientSecret ?? '',
        deviceIds: body.smartthings?.deviceIds ?? current.smartthings?.deviceIds ?? [],
      },
      relays: body.relays || current.relays,
      server: { ...current.server, ...body.server },
      homekit: {
        ...current.homekit,
        ...body.homekit,
        // Regenerate setupID when PIN changes so QR code stays in sync
        setupID: (body.homekit?.pin && body.homekit.pin !== current.homekit?.pin)
          ? generateSetupID()
          : (body.homekit?.setupID || current.homekit?.setupID || generateSetupID()),
      },
    };

    try {
      writeConfigFile(updated);
      relayController.config.relays = updated.relays;
      res.json({ success: true, message: 'Settings saved. Restart the server to apply connection changes.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-mqtt', async (req, res) => {
    const { host, port } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });

    const mqtt = require('mqtt');
    const client = mqtt.connect(`mqtt://${host}:${port || 1883}`, { connectTimeout: 5000 });

    const timeout = setTimeout(() => {
      client.end(true);
      res.json({ success: false, error: 'Connection timed out' });
    }, 6000);

    client.on('connect', () => {
      clearTimeout(timeout);
      client.end();
      res.json({ success: true, message: 'MQTT connection successful' });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      client.end(true);
      res.json({ success: false, error: err.message });
    });
  });

  // ── Dreame ─────────────────────────────────────────────────────────────

  router.post('/settings/test-dreame', async (req, res) => {
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
      const t    = setTimeout(() => { sock.close(); reject(new Error('No response — check IP and that the device is on the same network')); }, 5000);
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

  router.post('/settings/dreame', (req, res) => {
    const current = readConfigFile();
    const devices = req.body;
    if (!Array.isArray(devices)) return res.status(400).json({ success: false, error: 'Expected array of devices' });
    const sanitized = devices.map(d => {
      const prev = (current.dreame?.devices ?? []).find(x => x.host === d.host);
      return {
        name:  (d.name  || '').trim(),
        host:  (d.host  || '').trim(),
        token: (d.token && !d.token.includes('•')) ? d.token.replace(/\s/g, '') : (prev?.token || ''),
        type:  d.type === 'purifier' ? 'purifier' : 'vacuum',
      };
    }).filter(d => d.host && d.token);
    try {
      writeConfigFile({ ...current, dreame: { devices: sanitized } });
      res.json({ success: true, message: `${sanitized.length} device(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── MC6 Thermostats ────────────────────────────────────────────────────

  router.post('/settings/mc6', (req, res) => {
    const current = readConfigFile();
    const { broker, port, username, password, devices } = req.body;
    if (!broker) return res.status(400).json({ success: false, error: 'broker is required' });
    if (!Array.isArray(devices) || !devices.length)
      return res.status(400).json({ success: false, error: 'devices array is required' });

    const sanitized = devices.map(d => ({
      name: (d.name || '').trim(),
      mac:  (d.mac  || '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase(),
    })).filter(d => d.mac.length === 12);

    try {
      writeConfigFile({
        ...current,
        mc6: {
          broker,
          port:     port ? parseInt(port) : 1883,
          username: username || '',
          password: password || '',
          devices:  sanitized,
        },
      });
      res.json({ success: true, message: `${sanitized.length} MC6 device(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Roborock ───────────────────────────────────────────────────────────

  router.post('/settings/test-roborock', async (req, res) => {
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

  router.post('/settings/roborock', (req, res) => {
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
  router.post('/settings/test-roborock-cloud', async (req, res) => {
    const current = readConfigFile();
    const { email } = req.body;
    let { password } = req.body;
    if (password && password.includes('•')) password = current.roborock?.cloud?.password || '';
    if (!email || !password) return res.status(400).json({ success: false, error: 'email and password are required' });

    let roborockLogin;
    try { ({ roborockLogin } = require('./roborock-cloud-client')); }
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

  router.post('/settings/roborock-cloud', (req, res) => {
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
  router.post('/roborock/:duid/clean-room', async (req, res) => {
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

  // ── Somfy covers (casablanca TaHoma) — token/Loxone-friendly per-cover API ──
  // Cover keys look like somfy/io___<pin>_<id>; :id is the trailing device id.
  const somfyFind = (id) => (sensorRegistry ? sensorRegistry.getDevices() : [])
    .find((d) => d.type === 'somfy' && d.key.split('_').pop() === String(id));

  //   GET /api/somfy/devices?token=…  → list of covers with capabilities
  router.get('/somfy/devices', (req, res) => {
    const list = (sensorRegistry ? sensorRegistry.getDevices() : [])
      .filter((d) => d.type === 'somfy')
      .map((d) => ({
        id:    d.key.split('_').pop(),
        key:   d.key,
        label: d.label,
        my:    (d.sensors || []).some((s) => s.path === 'my'),
        tilt:  (d.sensors || []).some((s) => s.path === 'tilt'),
      }));
    res.json({ success: true, devices: list });
  });

  //   GET /api/somfy/:id/status?token=…  → position / tilt (Virtual HTTP Input)
  router.get('/somfy/:id/status', (req, res) => {
    const dev = somfyFind(req.params.id);
    if (!dev) return res.status(404).json({ success: false, error: 'Cover not found' });
    const g = (p) => store.get(`${dev.key}/${p}`);
    res.json({ success: true, id: req.params.id, key: dev.key, label: dev.label, position: g('level'), tilt: g('tilt') });
  });

  //   GET /api/somfy/:id/cmd/<action>?token=…  (Virtual Output → HTTP GET)
  //   actions: open | close | stop | my | position?value=0..100 | tilt?value=0..100
  router.get('/somfy/:id/cmd/:action', async (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    const dev = somfyFind(req.params.id);
    if (!dev) return res.status(404).json({ success: false, error: 'Cover not found' });
    const action = String(req.params.action).toLowerCase();
    const value  = req.query.value ?? req.query.level;
    const MAP = {
      open: ['switch', 1], up: ['switch', 1], close: ['switch', 0], down: ['switch', 0],
      stop: ['stop', 1], my: ['my', 1],
      position: ['level', value], level: ['level', value], tilt: ['tilt', value],
    };
    const m = MAP[action];
    if (!m) return res.status(400).json({ success: false, error: `Unknown action '${action}'` });
    if (m[1] === undefined) return res.status(400).json({ success: false, error: `Action '${action}' requires ?value=` });
    try {
      await sensorRegistry.sendCommand(dev.key, m[0], m[1]);
      res.json({ success: true, id: req.params.id, action });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // ── Homey ──────────────────────────────────────────────────────────────

  router.post('/settings/test-homey', async (req, res) => {
    const { mode = 'local', host, homeyId, token } = req.body;
    if (!token) return res.status(400).json({ success: false, error: 'token is required' });

    let baseUrl;
    if (mode === 'cloud') {
      if (!homeyId) return res.status(400).json({ success: false, error: 'homeyId is required for cloud mode' });
      baseUrl = `https://${homeyId}.connect.athom.com`;
    } else {
      if (!host) return res.status(400).json({ success: false, error: 'host is required for local mode' });
      baseUrl = `http://${host}`;
    }

    try {
      const r = await fetch(`${baseUrl}/api/manager/devices/device`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return res.json({ success: false, error: `HTTP ${r.status} — check host and token` });
      const data = await r.json();
      const count = Array.isArray(data) ? data.length : Object.keys(data).length;
      res.json({ success: true, message: `Connected — ${count} device(s) found` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/homey', (req, res) => {
    const current = readConfigFile();
    const { mode, host, homeyId, token, pollInterval } = req.body;
    try {
      writeConfigFile({
        ...current,
        homey: {
          mode:         mode         || current.homey?.mode         || 'local',
          host:         host         || current.homey?.host         || '',
          homeyId:      homeyId      || current.homey?.homeyId      || '',
          token:        (token && !token.includes('•')) ? token : (current.homey?.token || ''),
          pollInterval: pollInterval != null ? parseInt(pollInterval) : (current.homey?.pollInterval ?? 10),
        },
      });
      res.json({ success: true, message: 'Homey settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Somfy ──────────────────────────────────────────────────────────────

  router.post('/settings/test-somfy', async (req, res) => {
    const { mode, region = 'europe', host, port = 8443, email, password } = req.body;
    const https = require('https');

    // Cloud mode: Somfy SSO password grant → Bearer token → list devices.
    if (mode === 'cloud') {
      if (!email || !password)
        return res.status(400).json({ success: false, error: 'email and password are required' });
      const CLOUD_HOSTS = { europe: 'ha101-1.overkiz.com', oceania: 'ha201-1.overkiz.com', north_america: 'ha401-1.overkiz.com' };
      const cloudHost = CLOUD_HOSTS[region];
      if (!cloudHost) return res.status(400).json({ success: false, error: `Unknown region: ${region}` });
      const SOMFY_CLIENT_ID     = '0d8e920c-1478-11e7-a377-02dd59bd3041_1ewvaqmclfogo4kcsoo0c8k4kso884owg08sg8c40sk4go4ksg';
      const SOMFY_CLIENT_SECRET = '12k73w1n540g8o4cokg0cw84cog840k84cwggscwg884004kgk';
      const post = (hostname, path, formBody, headers) => new Promise((resolve, reject) => {
        const r = https.request({ hostname, port: 443, path, method: formBody ? 'POST' : 'GET',
          headers: { Accept: 'application/json', ...headers }, timeout: 12000 }, rr => {
          let d = ''; rr.on('data', c => (d += c)); rr.on('end', () => resolve({ status: rr.statusCode, body: d }));
        });
        r.on('error', reject); r.on('timeout', () => { r.destroy(); reject(new Error('Connection timeout')); });
        if (formBody) r.write(formBody); r.end();
      });
      try {
        const form = new URLSearchParams({ grant_type: 'password', client_id: SOMFY_CLIENT_ID, client_secret: SOMFY_CLIENT_SECRET, username: email, password }).toString();
        const tok = await post('accounts.somfy.com', '/oauth/oauth/v2/token/jwt', form, { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) });
        let tj; try { tj = JSON.parse(tok.body); } catch { tj = {}; }
        if (!tj.access_token) {
          return res.json({ success: false, error: tj.error === 'invalid_grant' ? 'Invalid Somfy account email or password' : (tj.error_description || tj.error || `SSO HTTP ${tok.status}`) });
        }
        const dev = await post(cloudHost, '/enduser-mobile-web/enduserAPI/setup/devices', null, { Authorization: `Bearer ${tj.access_token}` });
        let arr; try { arr = JSON.parse(dev.body); } catch { arr = null; }
        if (!Array.isArray(arr)) return res.json({ success: false, error: `Token OK but device list failed (HTTP ${dev.status})` });
        return res.json({ success: true, message: `Cloud login OK — ${arr.length} device(s) found`, data: { count: arr.length } });
      } catch (err) {
        return res.json({ success: false, error: err.message });
      }
    }

    // Local mode: TaHoma box login → JSESSIONID cookie.
    if (!host || !email || !password)
      return res.status(400).json({ success: false, error: 'host, email and password are required' });
    const agent = new https.Agent({ rejectUnauthorized: false });
    const body  = `userId=${encodeURIComponent(email)}&userPassword=${encodeURIComponent(password)}`;
    try {
      await new Promise((resolve, reject) => {
        const reqH = https.request({
          hostname: host, port, agent,
          path: '/enduser-mobile-web/1/enduserAPI/login', method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
          timeout: 10000,
        }, r => {
          const cookies = [].concat(r.headers['set-cookie'] || []);
          r.resume();
          if (cookies.find(c => c.startsWith('JSESSIONID='))) resolve();
          else reject(new Error('Login failed — no session cookie (check credentials)'));
        });
        reqH.on('error', reject);
        reqH.on('timeout', () => { reqH.destroy(); reject(new Error('Connection timeout — check host/port')); });
        reqH.write(body);
        reqH.end();
      });
      res.json({ success: true, message: 'Login successful — TaHoma box reachable' });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/somfy', (req, res) => {
    const current = readConfigFile();
    const { mode, region, host, port, token, email, password, devices, pollInterval } = req.body;
    try {
      writeConfigFile({
        ...current,
        somfy: {
          mode:         (mode === 'cloud' || mode === 'local') ? mode : (current.somfy?.mode || 'local'),
          region:       region       || current.somfy?.region       || 'europe',
          host:         host         || current.somfy?.host         || '',
          port:         port         ?? current.somfy?.port         ?? 8443,
          token:        (token    && !token.includes('•'))    ? token    : (current.somfy?.token    || ''),
          email:        email        || current.somfy?.email        || '',
          password:     (password && !password.includes('•')) ? password : (current.somfy?.password || ''),
          devices:      Array.isArray(devices) ? devices : (current.somfy?.devices ?? []),
          pollInterval: pollInterval != null ? parseInt(pollInterval) : (current.somfy?.pollInterval ?? 30),
        },
      });
      res.json({ success: true, message: 'Somfy settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Bayrol ─────────────────────────────────────────────────────────────

  router.post('/settings/test-bayrol', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'email and password are required' });
    const https = require('https');
    const HOST  = 'www.bayrol-poolaccess.de';

    // Cookie-aware request helper — mirrors bayrol-client.js so the test
    // exercises the same login flow the poller actually uses.
    let session = '';
    const request = (method, path, body) => new Promise((resolve, reject) => {
      const headers = {};
      if (session) headers['Cookie'] = session;
      if (body) {
        headers['Content-Type']   = 'application/x-www-form-urlencoded';
        headers['Content-Length'] = Buffer.byteLength(body);
      }
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reqH.destroy(); reject(new Error('Connection timeout')); } }, 10000);
      const reqH = https.request({ hostname: HOST, port: 443, path, method, headers }, r => {
        const sess = [].concat(r.headers['set-cookie'] || []).find(c => c.startsWith('PHPSESSID='));
        if (sess) session = sess.split(';')[0];
        let data = '';
        r.on('data', d => (data += d));
        r.on('end', () => { done = true; clearTimeout(timer); resolve({ status: r.statusCode, body: data }); });
      });
      reqH.on('error', err => { if (!done) { done = true; clearTimeout(timer); reject(err); } });
      if (body) reqH.write(body);
      reqH.end();
    });

    try {
      // 1. GET login page → initial PHPSESSID
      await request('GET', '/webview/p/login.php?r=reg');
      // 2. POST credentials
      const loginBody = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&login=Anmelden`;
      await request('POST', '/webview/p/login.php?r=reg', loginBody);
      // 3. Confirm by loading the plants page — only reachable when logged in
      const { body } = await request('GET', '/webview/p/plants.php');
      if (/var\s+clients\s*=\s*\[/.test(body) || /[?&]c=\d+/.test(body)) {
        res.json({ success: true, message: 'Login successful — credentials are valid' });
      } else {
        res.json({ success: false, error: 'Login failed (check credentials)' });
      }
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/bayrol', (req, res) => {
    const current = readConfigFile();
    const { poolName, username, password, pollInterval } = req.body;
    try {
      writeConfigFile({
        ...current,
        bayrol: {
          poolName:     poolName     != null ? poolName : (current.bayrol?.poolName || ''),
          username:     username     || current.bayrol?.username     || '',
          password:     (password && !password.includes('•')) ? password : (current.bayrol?.password || ''),
          pollInterval: pollInterval != null ? parseInt(pollInterval) : (current.bayrol?.pollInterval ?? 60),
        },
      });
      res.json({ success: true, message: 'Bayrol settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Loxone ─────────────────────────────────────────────────────────────

  router.post('/settings/test-loxone', async (req, res) => {
    const { host, port = 80, username, password } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host is required' });
    const auth = Buffer.from(`${username || 'admin'}:${password || ''}`).toString('base64');
    const reqHttp = http.get(
      { hostname: host, port: parseInt(port), path: '/jdev/cfg/version', timeout: 5000,
        headers: { Authorization: `Basic ${auth}` } },
      r => {
        let body = '';
        r.on('data', d => body += d);
        r.on('end', () => {
          try {
            const json = JSON.parse(body);
            const ver  = json.LL?.value?.version || json.LL?.value || 'unknown';
            res.json({ success: true, message: `Connected — Loxone OS ${ver}` });
          } catch {
            // some firmware just returns 200 text
            res.json({ success: r.statusCode === 200, message: r.statusCode === 200 ? 'Connected' : `HTTP ${r.statusCode}` });
          }
        });
      }
    );
    reqHttp.on('error', err => res.json({ success: false, error: err.message }));
    reqHttp.on('timeout', () => { reqHttp.destroy(); res.json({ success: false, error: 'Connection timed out' }); });
  });

  router.post('/settings/loxone', (req, res) => {
    const current = readConfigFile();
    const { host, port, username, password } = req.body;
    try {
      writeConfigFile({
        ...current,
        loxone: {
          host:     host     || current.loxone?.host     || '',
          port:     parseInt(port || 80),
          username: username || current.loxone?.username || 'admin',
          password: (password && !password.includes('•')) ? password : (current.loxone?.password || ''),
        },
      });
      res.json({ success: true, message: 'Loxone settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/loxone-out', (req, res) => {
    const current = readConfigFile();
    const { host, port, username, password, mappings } = req.body;
    try {
      writeConfigFile({
        ...current,
        loxoneOut: {
          host:     host     || current.loxoneOut?.host     || '',
          port:     parseInt(port || 80),
          username: username || current.loxoneOut?.username || 'admin',
          password: (password && !password.includes('•')) ? password : (current.loxoneOut?.password || ''),
          mappings: Array.isArray(mappings) ? mappings : (current.loxoneOut?.mappings || []),
        },
      });
      res.json({ success: true, message: 'Loxone outbound settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/auxair', (req, res) => {
    const current = readConfigFile();
    const { region, email, password, pollInterval } = req.body;
    try {
      writeConfigFile({
        ...current,
        auxair: {
          region:       region       || current.auxair?.region       || 'eu',
          email:        email        || current.auxair?.email        || '',
          password:     (password && !password.includes('•')) ? password : (current.auxair?.password || ''),
          pollInterval: parseInt(pollInterval || 30),
        },
      });
      res.json({ success: true, message: 'AuxAir settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/denon', (req, res) => {
    const current = readConfigFile();
    const { host, port, name, maxVolume, inputs } = req.body;
    try {
      const inputList = Array.isArray(inputs)
        ? inputs.filter(Boolean)
        : (typeof inputs === 'string' ? inputs.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : (current.denon?.inputs || []));
      writeConfigFile({
        ...current,
        denon: {
          host:      (host || current.denon?.host || '').trim(),
          port:      parseInt(port || 23),
          name:      (name || '').trim(),
          maxVolume: parseInt(maxVolume || 80),
          inputs:    inputList,
        },
      });
      res.json({ success: true, message: 'Denon settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-denon', async (req, res) => {
    const net  = require('net');
    const host = req.body.host || readConfigFile().denon?.host || '';
    const port = parseInt(req.body.port) || 23;
    if (!host) return res.json({ success: false, error: 'No host specified' });
    const socket = net.createConnection({ host, port }, () => {
      socket.write('PW?\r');
    });
    let response = '';
    const timer = setTimeout(() => {
      socket.destroy();
      res.json({ success: false, error: `No response from ${host}:${port} within 5 s` });
    }, 5000);
    socket.setEncoding('utf8');
    socket.on('data', data => {
      response += data;
      if (response.includes('PW')) {
        clearTimeout(timer);
        socket.destroy();
        const state = response.includes('PWON') ? 'ON' : 'STANDBY';
        res.json({ success: true, message: `Connected — receiver is ${state}` });
      }
    });
    socket.on('error', err => {
      clearTimeout(timer);
      res.json({ success: false, error: err.message });
    });
  });

  router.post('/settings/sonos', (req, res) => {
    const current = readConfigFile();
    const { hosts, discover, pollInterval } = req.body;
    try {
      const hostList = Array.isArray(hosts)
        ? hosts.filter(Boolean)
        : (typeof hosts === 'string' ? hosts.split(/[\n,]+/).map(h => h.trim()).filter(Boolean) : (current.sonos?.hosts || []));
      writeConfigFile({
        ...current,
        sonos: {
          hosts:        hostList,
          discover:     discover !== false,
          pollInterval: parseInt(pollInterval || 5),
        },
      });
      res.json({ success: true, message: 'Sonos settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-boneio', async (req, res) => {
    const mqttLib = require('mqtt');
    const cfg     = readConfigFile();
    const host    = req.body.host || cfg.mqtt?.host || 'localhost';
    const port    = parseInt(req.body.port || cfg.mqtt?.port || 1883);
    const client  = mqttLib.connect(`mqtt://${host}:${port}`, { connectTimeout: 5000, reconnectPeriod: 0 });
    const timer   = setTimeout(() => { client.end(true); res.json({ success: false, error: `Cannot reach ${host}:${port} — connection timed out` }); }, 6000);
    client.once('connect', () => {
      clearTimeout(timer);
      client.end(true);
      res.json({ success: true, message: `Connected to ${host}:${port}` });
    });
    client.once('error', err => {
      clearTimeout(timer);
      client.end(true);
      res.json({ success: false, error: err.message });
    });
  });

  router.post('/settings/boneio', (req, res) => {
    const current = readConfigFile();
    const { host, port } = req.body;
    try {
      const boneio = { ...current.boneio };
      if (host !== undefined) boneio.host = host.trim();
      if (port)               boneio.port = parseInt(port);
      writeConfigFile({ ...current, boneio });
      res.json({ success: true, message: 'BoneIO settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/sip', (req, res) => {
    const current = readConfigFile();
    const { enabled, port, domain, allowFrom, cameraName, doorRelay, doorPulseMs, autoAnswer } = req.body;
    try {
      const sip = { ...current.sip };
      if (enabled    !== undefined) sip.enabled    = !!enabled;
      if (port)                     sip.port       = parseInt(port);
      if (domain     !== undefined) sip.domain     = String(domain).trim();
      if (allowFrom  !== undefined) sip.allowFrom  = String(allowFrom).trim();
      if (cameraName !== undefined) sip.cameraName = String(cameraName).trim();
      if (doorRelay  !== undefined) sip.doorRelay  = (doorRelay === '' || doorRelay === null) ? null : parseInt(doorRelay);
      if (doorPulseMs)              sip.doorPulseMs = parseInt(doorPulseMs);
      if (autoAnswer !== undefined) sip.autoAnswer = !!autoAnswer;
      writeConfigFile({ ...current, sip });
      res.json({ success: true, message: 'SIP settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-aeotec', async (req, res) => {
    const { ip, username = 'admin', password = '' } = req.body;
    if (!ip) return res.status(400).json({ success: false, error: 'IP address required' });
    const http = require('http');
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    const tryPath = (path) => new Promise((resolve, reject) => {
      const r = http.request({ hostname: ip, port: 80, path, method: 'GET', timeout: 6000,
        headers: { Authorization: `Basic ${auth}` } }, (res2) => {
        res2.resume();
        resolve(res2.statusCode);
      });
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('Timeout')); });
      r.end();
    });
    try {
      const status = await tryPath('/snapshot.jpg');
      if (status === 200)  return res.json({ success: true,  message: `Camera reachable at ${ip} — snapshot endpoint OK` });
      if (status === 401)  return res.json({ success: false, error:   'Authentication failed — check username/password' });
      // Fallback: try root
      const root = await tryPath('/');
      res.json({ success: root < 400, message: root < 400 ? `Camera HTTP server reachable at ${ip}` : `Camera returned HTTP ${root}` });
    } catch (err) {
      res.json({ success: false, error: `Cannot reach ${ip}: ${err.message}` });
    }
  });

  router.post('/settings/scan-snapshot', async (req, res) => {
    const { ip, username = '', password = '' } = req.body;
    if (!ip) return res.status(400).json({ success: false, error: 'IP address required' });

    const PATHS = [
      '/snapshot.jpg',
      '/snapshot',
      '/image.jpg',
      '/cgi-bin/snapshot.cgi',
      '/onvif/snapshot',
      '/Streaming/Channels/101/picture',
      '/cgi-bin/currentpic.cgi',
      '/axis-cgi/jpg/image.cgi',
      '/shot.jpg',
      '/tmpfs/auto.jpg',
    ];

    const auth = (username || password)
      ? 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
      : null;

    const tryPath = (urlPath) => new Promise((resolve) => {
      const headers = auth ? { Authorization: auth } : {};
      const req2 = http.request(
        { hostname: ip, port: 80, path: urlPath, method: 'HEAD', timeout: 3000, headers },
        (r) => { r.resume(); resolve(r.statusCode === 200 ? `http://${ip}${urlPath}` : null); }
      );
      req2.on('error',   () => resolve(null));
      req2.on('timeout', () => { req2.destroy(); resolve(null); });
      req2.end();
    });

    try {
      // Try all paths in parallel, return first successful URL
      const results = await Promise.all(PATHS.map(tryPath));
      const found = results.find(Boolean);
      if (found) {
        res.json({ success: true, url: found });
      } else {
        res.json({ success: false, error: `No common snapshot URL found on ${ip}` });
      }
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-dirigera', async (req, res) => {
    const { host, token } = req.body;
    if (!host || !token) return res.status(400).json({ success: false, error: 'host and token required' });
    const https = require('https');
    const agent = new https.Agent({ rejectUnauthorized: false });
    try {
      const result = await new Promise((resolve, reject) => {
        const req2 = https.request({ hostname: host, port: 8443, path: '/v1/devices', method: 'GET', agent,
          headers: { Authorization: `Bearer ${token}` } }, (r) => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => {
            if (r.statusCode === 401) return reject(new Error('Invalid token'));
            if (r.statusCode >= 400) return reject(new Error(`HTTP ${r.statusCode}`));
            try { resolve(JSON.parse(d)); } catch { reject(new Error('Non-JSON response')); }
          });
        });
        req2.setTimeout(8000, () => { req2.destroy(); reject(new Error('Timeout')); });
        req2.on('error', reject);
        req2.end();
      });
      const count = Array.isArray(result) ? result.length : '?';
      res.json({ success: true, message: `Connected — ${count} device(s) found` });
    } catch (err) {
      res.json({ success: false, error: `Cannot reach ${host}: ${err.message}` });
    }
  });

  router.post('/settings/dirigera', (req, res) => {
    const current = readConfigFile();
    const { host, token } = req.body;
    try {
      const dirigera = { ...current.dirigera };
      if (host  !== undefined) dirigera.host  = (host || '').trim();
      if (token !== null)      dirigera.token = token || current.dirigera?.token || '';
      writeConfigFile({ ...current, dirigera });
      res.json({ success: true, message: 'Dirigera settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/sip', (req, res) => {
    const current = readConfigFile();
    const { wsUrl, username, domain, password, displayName, dtmfUnlock, relayIndex } = req.body;
    try {
      const sip = { ...current.sip };
      if (wsUrl       !== undefined) sip.wsUrl       = (wsUrl       || '').trim();
      if (username    !== undefined) sip.username    = (username    || '').trim();
      if (domain      !== undefined) sip.domain      = (domain      || '').trim();
      if (displayName !== undefined) sip.displayName = (displayName || '').trim();
      if (dtmfUnlock  !== undefined) sip.dtmfUnlock  = dtmfUnlock  || '#';
      if (relayIndex  !== undefined) sip.relayIndex  = relayIndex;  // null means DTMF-only
      if (password !== null && password !== undefined) {
        sip.password = password || current.sip?.password || '';
      }
      writeConfigFile({ ...current, sip });
      res.json({ success: true, message: 'SIP settings saved. Reload the dashboard to register.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/tradfri', (req, res) => {
    const current = readConfigFile();
    const { host, securityCode, identity, psk } = req.body;
    try {
      const tradfri = { ...current.tradfri };
      if (host         !== undefined) tradfri.host         = (host || '').trim();
      if (securityCode)               tradfri.securityCode = securityCode.trim();
      if (identity)                   tradfri.identity     = identity.trim();
      if (psk !== null && psk !== undefined) tradfri.psk   = psk || current.tradfri?.psk || '';
      writeConfigFile({ ...current, tradfri });
      res.json({ success: true, message: 'Tradfri settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-shelly', async (req, res) => {
    const { host, username, password } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host is required' });
    const http = require('http');
    const tryPath = (path) => new Promise((resolve, reject) => {
      const headers = {};
      if (username) headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password || ''}`).toString('base64');
      const req2 = http.get({ hostname: host, port: 80, path, timeout: 5000, headers }, r => {
        let body = '';
        r.on('data', d => body += d);
        r.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Non-JSON')); } });
      });
      req2.on('error', reject);
      req2.on('timeout', () => { req2.destroy(); reject(new Error('Timeout')); });
    });
    try {
      let info, gen;
      try { info = await tryPath('/shelly'); gen = 1; }
      catch { info = await tryPath('/rpc/Shelly.GetDeviceInfo'); gen = 2; }
      const model = info.model || info.type || info.app || 'Unknown';
      res.json({ success: true, message: `Connected — ${model} (Gen${gen})` });
    } catch (err) {
      res.json({ success: false, error: `Cannot reach ${host}: ${err.message}` });
    }
  });

  router.post('/settings/shelly', (req, res) => {
    const current = readConfigFile();
    const devices = req.body;
    if (!Array.isArray(devices)) return res.status(400).json({ success: false, error: 'Expected array of devices' });
    const sanitized = devices.map(d => ({
      host:     (d.host     || '').trim(),
      name:     (d.name     || '').trim(),
      username: (d.username || '').trim(),
      password: (d.password && !d.password.includes('•')) ? d.password : (
        (current.shelly?.devices || []).find(x => x.host === d.host)?.password || ''
      ),
    })).filter(d => d.host);
    try {
      writeConfigFile({ ...current, shelly: { devices: sanitized } });
      res.json({ success: true, message: `${sanitized.length} device(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Waveshare Modbus TCP ───────────────────────────────────────────────

  router.post('/settings/test-waveshare', async (req, res) => {
    const { host, port = 502, slaveId = 1 } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host is required' });
    const net = require('net');
    const sock = new net.Socket();
    const timeout = setTimeout(() => {
      sock.destroy();
      res.json({ success: false, error: `Cannot reach ${host}:${port} — connection timed out` });
    }, 5000);
    sock.connect(parseInt(port), host, () => {
      // Send FC01 read 1 coil to probe the slave
      const txId = 1;
      const frame = Buffer.from([
        txId >> 8, txId & 0xFF,   // Transaction ID
        0x00, 0x00,                // Protocol ID
        0x00, 0x06,                // Length
        slaveId & 0xFF,            // Unit ID
        0x01,                      // FC01 Read Coils
        0x00, 0x00,                // Start addr
        0x00, 0x01,                // Quantity = 1
      ]);
      sock.write(frame);
    });
    sock.once('data', (data) => {
      clearTimeout(timeout);
      sock.destroy();
      const fc = data[7];
      if (fc === 0x01 || fc === 0x81) {
        // 0x01 = valid response, 0x81 = exception (slave exists but rejected)
        res.json({ success: true, message: `Slave ${slaveId} responded at ${host}:${port}` });
      } else {
        res.json({ success: false, error: `Unexpected response from ${host}:${port}` });
      }
    });
    sock.on('error', (err) => {
      clearTimeout(timeout);
      res.json({ success: false, error: `${host}:${port} — ${err.message}` });
    });
  });

  router.post('/settings/waveshare', (req, res) => {
    const current = readConfigFile();
    const devices = req.body;
    if (!Array.isArray(devices)) return res.status(400).json({ success: false, error: 'Expected array of devices' });
    const sanitized = devices.map(d => ({
      name:       (d.name || '').trim(),
      host:       (d.host || '').trim(),
      port:       parseInt(d.port) || 502,
      slaveId:    parseInt(d.slaveId) || 1,
      relayCount: parseInt(d.relayCount) || 8,
    })).filter(d => d.host);
    try {
      writeConfigFile({ ...current, waveshare: { devices: sanitized } });
      res.json({ success: true, message: `${sanitized.length} device(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── BroadLink IR/RF ───────────────────────────────────────────────────────

  router.get('/broadlink/codes', (req, res) => {
    const bl = clients.broadlink;
    if (!bl) return res.json({});
    res.json(bl.getAllCodes());
  });

  router.post('/broadlink/learn/ir', async (req, res) => {
    const bl = clients.broadlink;
    if (!bl) return res.status(503).json({ success: false, error: 'BroadLink not configured' });
    const { host, name } = req.body;
    if (!host || !name) return res.status(400).json({ success: false, error: 'host and name are required' });
    // Streaming status via ndjson
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    const send = (obj) => { try { res.write(JSON.stringify(obj) + '\n'); } catch { /* client gone */ } };
    try {
      const hex = await bl.learnIR(host, name, (status) => send({ status }));
      send({ success: true, name, bytes: hex.length / 2 });
    } catch (err) {
      send({ success: false, error: err.message });
    }
    res.end();
  });

  router.post('/broadlink/learn/rf', async (req, res) => {
    const bl = clients.broadlink;
    if (!bl) return res.status(503).json({ success: false, error: 'BroadLink not configured' });
    const { host, name } = req.body;
    if (!host || !name) return res.status(400).json({ success: false, error: 'host and name are required' });
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    const send = (obj) => { try { res.write(JSON.stringify(obj) + '\n'); } catch { /* client gone */ } };
    try {
      const hex = await bl.learnRF(host, name, (status) => send({ status }));
      send({ success: true, name, bytes: hex.length / 2 });
    } catch (err) {
      send({ success: false, error: err.message });
    }
    res.end();
  });

  router.post('/broadlink/send', async (req, res) => {
    const bl = clients.broadlink;
    if (!bl) return res.status(503).json({ success: false, error: 'BroadLink not configured' });
    const { host, name } = req.body;
    if (!host || !name) return res.status(400).json({ success: false, error: 'host and name required' });
    try {
      await bl.sendCode(host, name);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.delete('/broadlink/codes', (req, res) => {
    const bl = clients.broadlink;
    if (!bl) return res.status(503).json({ success: false, error: 'BroadLink not configured' });
    const { host, name } = req.body;
    if (!host || !name) return res.status(400).json({ success: false, error: 'host and name required' });
    bl.deleteCode(host, name);
    res.json({ success: true });
  });

  router.post('/settings/test-broadlink', (req, res) => {
    const { host } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });
    const dgram = require('dgram');
    // Send a minimal auth packet; any UDP response means the device is reachable
    const probe = Buffer.alloc(0x38, 0);
    probe[0x00] = 0x5a; probe[0x01] = 0xa5; probe[0x02] = 0xaa; probe[0x03] = 0x55;
    probe[0x04] = 0x5a; probe[0x05] = 0xa5; probe[0x06] = 0xaa; probe[0x07] = 0x55;
    probe[0x24] = 0x2a; probe[0x25] = 0x27;
    probe[0x26] = 0x65; // auth command low byte
    const sock = dgram.createSocket('udp4');
    let done = false;
    const finish = (json) => { if (done) return; done = true; try { sock.close(); } catch {} res.json(json); };
    setTimeout(() => finish({ success: false, error: `No response from ${host}:80 — check IP and device power` }), 4000);
    sock.on('message', () => finish({ success: true, message: `Device at ${host} is online` }));
    sock.on('error', err  => finish({ success: false, error: err.message }));
    sock.send(probe, 80, host);
  });

  router.post('/settings/broadlink', (req, res) => {
    const current  = readConfigFile();
    const devices  = req.body;
    if (!Array.isArray(devices)) return res.status(400).json({ success: false, error: 'Expected array' });
    const sanitized = devices.map(d => ({
      name: (d.name || '').trim(),
      host: (d.host || '').trim(),
      mac:  (d.mac  || '').trim(),
    })).filter(d => d.host);
    try {
      writeConfigFile({ ...current, broadlink: { devices: sanitized } });
      res.json({ success: true, message: `${sanitized.length} device(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── ESPHome ──────────────────────────────────────────────────────────

  router.post('/settings/test-esphome', async (req, res) => {
    const { host, port = 80, password } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });
    const headers = { 'Accept': 'text/event-stream' };
    if (password) headers['Authorization'] = 'Basic ' + Buffer.from(`:${password}`).toString('base64');
    const http2 = require('http');
    let done = false;
    const req2 = http2.get({ hostname: host, port, path: '/events', timeout: 6000, headers }, r => {
      let count = 0;
      r.on('data', chunk => {
        const text = chunk.toString();
        count += (text.match(/event:\s*state/g) || []).length;
        if (count >= 1 && !done) {
          done = true;
          req2.destroy();
          if (!res.headersSent) res.json({ success: true, message: `ESPHome device reachable — ${count}+ entity event(s) detected` });
        }
      });
      r.on('end', () => { if (!done && !res.headersSent) res.json({ success: r.statusCode < 300, message: 'Device reachable (no entity events)' }); });
    });
    req2.on('error', err => { if (!res.headersSent) res.json({ success: false, error: err.message }); });
    req2.on('timeout', () => { req2.destroy(); if (!res.headersSent) res.json({ success: false, error: `Cannot reach ${host}:${port}` }); });
  });

  router.post('/settings/esphome', (req, res) => {
    const current = readConfigFile();
    const devices = req.body;
    if (!Array.isArray(devices)) return res.status(400).json({ success: false, error: 'Expected array' });
    const sanitized = devices.map(d => ({
      host:     (d.host || '').trim(),
      port:     parseInt(d.port) || 80,
      name:     (d.name || '').trim(),
      password: (d.password && !d.password.includes('•')) ? d.password : (
        (current.esphome?.devices || []).find(x => x.host === d.host)?.password || ''
      ),
    })).filter(d => d.host);
    try {
      writeConfigFile({ ...current, esphome: { devices: sanitized } });
      res.json({ success: true, message: `${sanitized.length} device(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── LG ThinQ ─────────────────────────────────────────────────────────

  // One-time login to fetch tokens + user number (password never stored)
  router.post('/settings/lgthinq-login', async (req, res) => {
    const { username, password, country = 'EU' } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'Email and password required' });

    const crypto   = require('crypto');
    const https    = require('https');
    const APP_ID   = 'LGAO221A02';
    const OAUTH_ID = 'LGAO221A02';
    const OAUTH_SECRET = 'c053c2a6ddeb7ad97cb0eed0dcb31cf8';
    const REDIRECT_URI = 'lgaccount.lgsmartthinq://';
    const countryUp = country.toUpperCase();
    const EMP_HOSTS = { US: 'us.m.lgaccount.com', EU: 'eu.m.lgaccount.com', KR: 'kr.m.lgaccount.com', AU: 'au.m.lgaccount.com', CA: 'ca.m.lgaccount.com', JP: 'jp.m.lgaccount.com' };
    const empHost = EMP_HOSTS[countryUp] || 'eu.m.lgaccount.com';

    function httpsReq(method, hostname, reqPath, body, headers = {}) {
      return new Promise((resolve, reject) => {
        let payload = null;
        if (body != null) {
          payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
          if (!headers['Content-Type']) headers['Content-Type'] = typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json';
          headers['Content-Length'] = payload.length;
        }
        const req2 = https.request({ hostname, path: reqPath, method, timeout: 12000, headers }, r => {
          const chunks = [];
          r.on('data', d => chunks.push(d));
          r.on('end', () => {
            const text = Buffer.concat(chunks).toString();
            if (r.statusCode >= 300) return reject(new Error(`HTTP ${r.statusCode}: ${text.slice(0, 300)}`));
            try { resolve(JSON.parse(text)); } catch { reject(new Error(`Non-JSON: ${text.slice(0, 200)}`)); }
          });
        });
        req2.on('error', reject);
        req2.on('timeout', () => { req2.destroy(); reject(new Error('Timeout')); });
        if (payload) req2.write(payload);
        req2.end();
      });
    }

    try {
      const state  = crypto.randomBytes(4).toString('hex');
      const b64pw  = Buffer.from(password).toString('base64');
      const pre = await httpsReq('POST', empHost, `/spx/common/oauthapps/${APP_ID}/preLogin`, {
        user_auth2: b64pw, redirect_uri: REDIRECT_URI, state, username,
        log_param: `login request / redirect_uri=${REDIRECT_URI} / user_auth2=${b64pw} / state=${state}`,
      }, { 'Content-Type': 'application/json' });

      const redir = pre.redirect_uri || pre.redirectUri || '';
      const codeMatch = redir.match(/[?&]code=([^&]+)/);
      if (!codeMatch) return res.json({ success: false, error: `Login failed — no auth code returned. Response: ${JSON.stringify(pre).slice(0, 200)}` });
      const code = decodeURIComponent(codeMatch[1]);

      const creds  = Buffer.from(`${OAUTH_ID}:${OAUTH_SECRET}`).toString('base64');
      const tokens = await httpsReq('POST', empHost, '/oauth2/token',
        `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
        { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' }
      );

      // Extract user number: may be in token response or decodable from JWT
      let userNumber = tokens.user_number || tokens.userNumber || tokens.sub || '';
      if (!userNumber && tokens.access_token && tokens.access_token.includes('.')) {
        try {
          const payload = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64').toString());
          userNumber = payload.sub || payload.user_number || payload.userNumber || '';
        } catch {}
      }

      res.json({
        success: true,
        message: `Logged in${userNumber ? ` — user number: ${userNumber}` : ' — check token fields'}`,
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
        user_number:   userNumber,
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-lgthinq', async (req, res) => {
    const { country = 'US', lang } = req.body;
    // Probe the LG gateway — no credentials needed, just verify connectivity
    const https   = require('https');
    const headers = {
      'x-api-key':        'VGhpblEyLjAgU0VSVklDRQ==',
      'x-client-id':      'LGAO221A02',
      'x-country-code':   country.toUpperCase(),
      'x-language-code':  (lang || 'en-US').replace('-', '_'),
      'x-message-id':     Math.random().toString(36).slice(2),
      'x-service-id':     'SVC202',
      'x-service-phase':  'OP',
      'x-thinq-app-ver':  '3.6.1200',
      'x-thinq-app-type': 'NUTS',
      'x-thinq-app-os':   'ANDROID',
      'Accept':           'application/json',
    };
    const req2 = https.get({
      hostname: 'aic-service.lgthinq.com',
      path: `/service/users/gateways?countryCode=${country.toUpperCase()}&langCode=${(lang||'en-US').replace('-','_')}`,
      timeout: 8000,
      headers,
    }, r => {
      const chunks = [];
      r.on('data', d => chunks.push(d));
      r.on('end', () => {
        if (r.statusCode >= 300) return res.json({ success: false, error: `LG gateway returned HTTP ${r.statusCode}` });
        try {
          const gw = JSON.parse(Buffer.concat(chunks));
          const empHost = (gw.result || gw).empPath || (gw.result || gw).empApiHost || '';
          res.json({ success: true, message: `LG gateway reachable — ${empHost || 'connected'}. Save and restart to activate.` });
        } catch {
          res.json({ success: r.statusCode < 300, message: 'LG gateway reachable' });
        }
      });
    });
    req2.on('error', err => { if (!res.headersSent) res.json({ success: false, error: err.message }); });
    req2.on('timeout', () => { req2.destroy(); if (!res.headersSent) res.json({ success: false, error: 'Connection timed out' }); });
  });

  router.post('/settings/lgthinq', (req, res) => {
    const current = readConfigFile();
    const { access_token, refresh_token, user_number, country, lang } = req.body;
    try {
      const prev = current.lgthinq || {};
      const resolvedCountry = (country || prev.country || 'US').trim().toUpperCase();
      const resolvedLang    = (lang    || prev.lang    || 'en-US').trim();

      // Persist tokens to the tokens file if provided
      const tokFile = path.join(__dirname, '..', 'persist', 'lgthinq-tokens.json');
      let existing = {};
      try { existing = JSON.parse(fs.readFileSync(tokFile, 'utf8')); } catch {}
      const EMP_HOSTS = { US: 'us.m.lgaccount.com', EU: 'eu.m.lgaccount.com', KR: 'kr.m.lgaccount.com', AU: 'au.m.lgaccount.com', CA: 'ca.m.lgaccount.com', JP: 'jp.m.lgaccount.com' };
      const tokData = {
        ...existing,
        ...(access_token  && !access_token.includes('•')  ? { access_token }  : {}),
        ...(refresh_token && !refresh_token.includes('•') ? { refresh_token } : {}),
        user_number: (user_number || existing.user_number || '').trim(),
        apiHost: `${resolvedCountry.toLowerCase()}.api.lge.com`,
        empHost: EMP_HOSTS[resolvedCountry] || 'm.lgaccount.com',
      };
      fs.mkdirSync(path.dirname(tokFile), { recursive: true });
      fs.writeFileSync(tokFile, JSON.stringify(tokData, null, 2), 'utf8');

      writeConfigFile({
        ...current,
        lgthinq: { country: resolvedCountry, lang: resolvedLang },
      });
      res.json({ success: true, message: 'LG ThinQ tokens saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Fibaro Home Center ────────────────────────────────────────────────

  router.post('/settings/test-fibaro', async (req, res) => {
    const { host, port = 80, username = 'admin', password = '' } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host is required' });
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    const reqHttp = http.get(
      { hostname: host, port: parseInt(port), path: '/api/loginStatus', timeout: 6000,
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
      r => {
        const chunks = [];
        r.on('data', d => chunks.push(d));
        r.on('end', () => {
          if (r.statusCode === 401) return res.json({ success: false, error: 'Authentication failed — check username/password' });
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            const type = json.type || json.serialNumber || 'Home Center';
            res.json({ success: r.statusCode < 300, message: `Connected — ${type}` });
          } catch {
            res.json({ success: r.statusCode < 300, message: r.statusCode < 300 ? 'Connected' : `HTTP ${r.statusCode}` });
          }
        });
      }
    );
    reqHttp.on('error', err => res.json({ success: false, error: err.message }));
    reqHttp.on('timeout', () => { reqHttp.destroy(); res.json({ success: false, error: 'Connection timed out' }); });
  });

  router.post('/settings/fibaro', (req, res) => {
    const current = readConfigFile();
    const { host, port, username, password } = req.body;
    try {
      writeConfigFile({
        ...current,
        fibaro: {
          host:     (host     || current.fibaro?.host     || '').trim(),
          port:     parseInt(port || 80),
          username: (username || current.fibaro?.username || 'admin').trim(),
          password: (password && !password.includes('•')) ? password : (current.fibaro?.password || ''),
        },
      });
      res.json({ success: true, message: 'Fibaro settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── WebRTC WHEP proxy ──────────────────────────────────────────────────
  // Proxies the WHEP SDP offer to avoid CORS and allow self-signed TLS on
  // local media servers (go2rtc, mediamtx, Frigate, etc.).

  router.post('/webrtc/offer', (req, res) => {
    const { url, sdp } = req.body;
    if (!url || !sdp) return res.status(400).json({ error: 'url and sdp required' });

    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'invalid url' }); }

    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? require('https') : require('http');
    const body    = Buffer.from(sdp, 'utf8');

    const proxyReq = lib.request({
      hostname:           parsed.hostname,
      port:               parsed.port || (isHttps ? 443 : 80),
      path:               parsed.pathname + parsed.search,
      method:             'POST',
      headers:            { 'Content-Type': 'application/sdp', 'Content-Length': body.length },
      rejectUnauthorized: false,
      timeout:            10000,
    }, proxyRes => {
      const chunks = [];
      proxyRes.on('data', c => chunks.push(c));
      proxyRes.on('end', () => {
        const answer = Buffer.concat(chunks).toString('utf8');
        if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
          res.json({ sdp: answer });
        } else {
          res.status(502).json({ error: `WHEP server returned ${proxyRes.statusCode}` });
        }
      });
    });

    proxyReq.on('error',   err => res.status(502).json({ error: err.message }));
    proxyReq.on('timeout', ()  => { proxyReq.destroy(); res.status(504).json({ error: 'WHEP timeout' }); });
    proxyReq.write(body);
    proxyReq.end();
  });

  // ── SmartBob ──────────────────────────────────────────────────────────

  router.post('/settings/test-smartbob', (req, res) => {
    const { host, port = 1883 } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });
    const net = require('net');
    const sock = new net.Socket();
    let done = false;
    const finish = (ok, msg) => {
      if (done) return; done = true;
      sock.destroy();
      res.json({ success: ok, [ok ? 'message' : 'error']: msg });
    };
    sock.setTimeout(5000);
    sock.connect(parseInt(port), host, () => finish(true, `TCP connection to ${host}:${port} succeeded (MQTT broker reachable)`));
    sock.on('error',   err => finish(false, err.message));
    sock.on('timeout', ()  => finish(false, `Connection to ${host}:${port} timed out`));
  });

  router.post('/settings/smartbob', (req, res) => {
    const current = readConfigFile();
    const { host, port, name, username, password, entities } = req.body;
    const sanitized = (entities || []).map(e => ({
      name:         (e.name         || '').trim(),
      stateTopic:   (e.stateTopic   || '').trim(),
      commandTopic: (e.commandTopic || '').trim() || undefined,
      type:         (e.type         || 'switch').trim(),
      payloadOn:    (e.payloadOn    || 'ON').trim(),
      payloadOff:   (e.payloadOff   || 'OFF').trim(),
      unit:         (e.unit         || '').trim() || undefined,
      homekitType:  (e.homekitType  || '').trim() || undefined,
    })).filter(e => e.stateTopic);
    try {
      writeConfigFile({
        ...current,
        smartbob: {
          host:     (host || '').trim(),
          port:     parseInt(port) || 1883,
          name:     (name || 'SmartBob').trim(),
          username: (username || '').trim(),
          password: (password && !password.includes('•')) ? password : (current.smartbob?.password || ''),
          entities: sanitized,
        },
      });
      res.json({ success: true, message: `SmartBob saved (${sanitized.length} entity(s)). Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Arduino MQTT ──────────────────────────────────────────────────────

  router.post('/settings/arduino', (req, res) => {
    const current = readConfigFile();
    const { host, port, username, password, devices } = req.body;
    let parsed = [];
    if (Array.isArray(devices)) {
      parsed = devices;
    } else if (typeof devices === 'string') {
      try { parsed = JSON.parse(devices); } catch { return res.status(400).json({ success: false, error: 'Invalid devices JSON' }); }
    }
    const sanitized = parsed
      .filter(d => d.name && (d.stateTopic || (d.sensors || []).some(s => s.stateTopic)))
      .map(d => ({
        name:         (d.name         || '').trim(),
        key:          (d.key          || '').trim() || undefined,
        stateTopic:   (d.stateTopic   || '').trim() || undefined,
        commandTopic: (d.commandTopic || '').trim() || undefined,
        sensors:      (d.sensors || []).map(s => ({
          path:         (s.path         || '').trim(),
          label:        (s.label        || '').trim() || undefined,
          unit:         (s.unit         || '').trim() || undefined,
          type:         (s.type         || '').trim() || undefined,
          stateTopic:   (s.stateTopic   || '').trim() || undefined,
          commandTopic: (s.commandTopic || '').trim() || undefined,
          payloadOn:    (s.payloadOn    || '').trim() || undefined,
          payloadOff:   (s.payloadOff   || '').trim() || undefined,
          min:          s.min != null ? Number(s.min) : undefined,
          max:          s.max != null ? Number(s.max) : undefined,
          jsonKey:      (s.jsonKey      || '').trim() || undefined,
        })).filter(s => s.path),
      }));
    try {
      writeConfigFile({
        ...current,
        arduino: {
          host:     (host || '').trim(),
          port:     parseInt(port) || 1883,
          username: (username || '').trim(),
          password: (password && !password.includes('•')) ? password : (current.arduino?.password || ''),
          devices:  sanitized,
        },
      });
      res.json({ success: true, message: `Arduino saved (${sanitized.length} device(s)). Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Suppla ────────────────────────────────────────────────────────────

  router.post('/settings/test-suppla', async (req, res) => {
    const https = require('https');
    const http  = require('http');
    const { token, server = 'https://cloud.supla.org' } = req.body;
    if (!token) return res.status(400).json({ success: false, error: 'token required' });
    try {
      const parsed  = new URL(server);
      const mod     = parsed.protocol === 'https:' ? https : http;
      const port    = parsed.port ? parseInt(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
      const payload = await new Promise((resolve, reject) => {
        const rq = mod.request({
          hostname: parsed.hostname, port,
          path: '/api/v2.4.0/server-info',
          method: 'GET', timeout: 8000,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }, resp => {
          const c = [];
          resp.on('data', d => c.push(d));
          resp.on('end', () => {
            if (resp.statusCode === 401) return reject(new Error('Invalid token — check your personal access token'));
            if (resp.statusCode < 200 || resp.statusCode >= 300) return reject(new Error(`HTTP ${resp.statusCode}`));
            try { resolve(JSON.parse(Buffer.concat(c).toString())); }
            catch { reject(new Error('Non-JSON response')); }
          });
        });
        rq.on('error', reject);
        rq.on('timeout', () => { rq.destroy(); reject(new Error('Connection timed out')); });
        rq.end();
      });
      res.json({ success: true, message: `Connected — server ${payload.serverAddress || server}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/suppla', (req, res) => {
    const current = readConfigFile();
    const { token, server, pollInterval } = req.body;
    try {
      writeConfigFile({
        ...current,
        suppla: {
          token:        (token  || current.suppla?.token  || '').trim(),
          server:       (server || current.suppla?.server || 'https://cloud.supla.org').trim(),
          pollInterval: parseInt(pollInterval) || 30,
        },
      });
      res.json({ success: true, message: 'Suppla saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── KNX ───────────────────────────────────────────────────────────────

  router.post('/settings/test-knx', (req, res) => {
    const { host, port = 3671 } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });
    const net = require('net');
    const sock = new net.Socket();
    let done = false;
    const finish = (ok, msg) => {
      if (done) return; done = true;
      sock.destroy();
      res.json({ success: ok, message: ok ? msg : undefined, error: ok ? undefined : msg });
    };
    sock.setTimeout(5000);
    sock.connect(parseInt(port), host, () => finish(true, `TCP connection to ${host}:${port} succeeded`));
    sock.on('error', err => finish(false, err.message));
    sock.on('timeout', () => finish(false, `Connection to ${host}:${port} timed out`));
  });

  router.post('/settings/knx', (req, res) => {
    const current = readConfigFile();
    const { host, port, groupAddresses } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });
    const sanitized = (groupAddresses || []).map(ga => ({
      address:     (ga.address || '').trim(),
      name:        (ga.name    || '').trim(),
      dpt:         (ga.dpt     || 'DPT1').trim(),
      unit:        (ga.unit    || '').trim() || undefined,
      readable:    ga.readable  !== false,
      writable:    !!ga.writable,
      homekitType: (ga.homekitType || '').trim() || undefined,
    })).filter(ga => ga.address);
    try {
      writeConfigFile({ ...current, knx: { host: host.trim(), port: parseInt(port) || 3671, groupAddresses: sanitized } });
      res.json({ success: true, message: `KNX settings saved (${sanitized.length} group address(es)). Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── FFmpeg RTSP proxy ──────────────────────────────────────────────────

  router.get('/rtsp-proxy', (req, res) => {
    if (!ffmpegRtsp) return res.json({ success: true, enabled: false, streams: [] });
    res.json({ success: true, enabled: true, streams: ffmpegRtsp.getStreams() });
  });

  router.post('/settings/ffmpeg-rtsp', (req, res) => {
    const current = readConfigFile();
    const { enabled, basePort, ffmpegPath } = req.body;
    try {
      writeConfigFile({
        ...current,
        ffmpegRtsp: {
          enabled:    !!enabled,
          basePort:   parseInt(basePort)  || 8554,
          ffmpegPath: (ffmpegPath || 'ffmpeg').trim(),
        },
      });
      res.json({ success: true, message: 'FFmpeg RTSP settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Logs ───────────────────────────────────────────────────────────────

  const logger = require('./logger');

  router.get('/logs', (req, res) => {
    res.json({ success: true, categories: logger.categories() });
  });

  router.get('/logs/:name', (req, res) => {
    const name  = req.params.name.replace(/[^a-z0-9_-]/gi, '');
    const limit = Math.min(parseInt(req.query.lines) || 300, 2000);
    const lines = logger.tail(name, limit);
    res.json({ success: true, name, lines });
  });

  router.delete('/logs/:name', (req, res) => {
    const name = req.params.name.replace(/[^a-z0-9_-]/gi, '');
    logger.clear(name);
    res.json({ success: true });
  });

  router.post('/admin/restart', (req, res) => {
    res.json({ success: true, message: 'Server restarting…' });
    setTimeout(() => process.exit(0), 300);
  });

  router.post('/admin/reset-config', (req, res) => {
    const blank = {
      mqtt:         { host: '', port: 1883, portalId: '' },
      vrm:          { email: '', password: '', apiToken: '', installationId: '' },
      solaredge:    { siteId: '', apiKey: '' },
      smartthings:  { token: '', deviceIds: [] },
      satel:        { host: '', port: 7094, armCode: '', zoneCount: 32, partitions: [1], zoneNames: {}, partitionNames: {} },
      unifi:        { host: '', username: '', password: '', apiKey: '' },
      loxone:       { host: '', port: 80, username: 'admin', password: '' },
      shelly:       { devices: [] },
      cameras:      [],
      relays:       [{ index: 0, name: 'Relay 1' }, { index: 1, name: 'Relay 2' }],
      server:       { port: 3000 },
      homekit:      { pin: '031-45-154', port: 47128, username: 'CC:22:3D:E3:CE:F6' },
    };
    try {
      writeConfigFile(blank);
      res.json({ success: true, message: 'Configuration erased. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── MQTT Explorer ──────────────────────────────────────────────────────

  router.get('/mqtt-explorer/topics', (req, res) => {
    if (!mqttExplorer) return res.json({ success: true, data: [], connected: false });
    res.json({
      success:   true,
      connected: mqttExplorer.connected,
      data:      mqttExplorer.getTopics(),
    });
  });

  router.get('/mqtt-explorer/history', (req, res) => {
    if (!mqttExplorer) return res.json({ success: true, data: [] });
    const topic = req.query.topic;
    if (!topic) return res.status(400).json({ success: false, error: 'topic query param required' });
    res.json({ success: true, data: mqttExplorer.getHistory(topic) });
  });

  router.post('/mqtt-explorer/publish', async (req, res) => {
    if (!mqttExplorer) return res.status(503).json({ success: false, error: 'MQTT explorer not available' });
    const { topic, payload, retain } = req.body;
    if (!topic) return res.status(400).json({ success: false, error: 'topic required' });
    try {
      await mqttExplorer.publish(topic, payload ?? '', !!retain);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/mqtt-explorer/subscribe', (req, res) => {
    if (!mqttExplorer) return res.status(503).json({ success: false, error: 'MQTT explorer not available' });
    const { pattern } = req.body;
    if (!pattern) return res.status(400).json({ success: false, error: 'pattern required' });
    mqttExplorer.subscribe(pattern);
    res.json({ success: true });
  });

  router.post('/mqtt-explorer/clear', (req, res) => {
    if (!mqttExplorer) return res.status(503).json({ success: false, error: 'MQTT explorer not available' });
    mqttExplorer.clear();
    res.json({ success: true });
  });

  // ── HTTPS / TLS settings ───────────────────────────────────────────────────

  router.post('/settings/https', (req, res) => {
    const current = readConfigFile();
    const {
      httpsEnabled, httpsPort, certFile, keyFile,
      leEnabled, lePort, leDomain, leEmail, leStaging, leCertsDir,
    } = req.body;

    const server = { ...current.server };

    if (httpsEnabled !== undefined) {
      server.https = {
        ...(server.https || {}),
        enabled:  !!httpsEnabled,
        port:     parseInt(httpsPort  || server.https?.port  || 3443),
        certFile: (certFile ?? server.https?.certFile ?? '').trim(),
        keyFile:  (keyFile  ?? server.https?.keyFile  ?? '').trim(),
      };
    }

    if (leEnabled !== undefined) {
      server.letsEncrypt = {
        ...(server.letsEncrypt || {}),
        enabled:  !!leEnabled,
        port:     parseInt(lePort     || server.letsEncrypt?.port     || 443),
        domain:   (leDomain   ?? server.letsEncrypt?.domain   ?? '').trim(),
        email:    (leEmail    ?? server.letsEncrypt?.email    ?? '').trim(),
        staging:  leStaging !== undefined ? !!leStaging : !!(server.letsEncrypt?.staging),
        certsDir: (leCertsDir ?? server.letsEncrypt?.certsDir ?? './certs').trim(),
      };
    }

    try {
      writeConfigFile({ ...current, server });
      res.json({ success: true, message: 'HTTPS settings saved. Restart server to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createApiRoutes;
