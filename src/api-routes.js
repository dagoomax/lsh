const { Router, raw } = require('express');
const fs   = require('fs');
const path = require('path');
const http = require('http');
const { generateSetupUri, generateSetupID } = require('./homekit-uri');
const cameraLog = require('./camera-log');
const privateEvents = require('./private-events');
const pagingMessages = require('./paging-messages');
const callLog = require('./call-log');
const motionLog = require('./motion-log');
const detectionBoxes = require('./detection-boxes');
const { getDb } = require('./mongo');
const { fetchMedia: fetchSmartThingsMedia } = require('./smartthings-media');
const engineExports = require('./automation-engine');

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

const VIRTUAL_TYPES = new Set(['switch', 'dimmer', 'sensor', 'text', 'button']);

// Ids are the store key (virtual/<id>/value) — two devices sharing one
// silently collide onto the same value, and one device's type could then
// look like a stale mismatch under the other's id. The stock UI never sends
// a duplicate, but the route accepts a raw id from any caller, so re-roll a
// fresh one rather than let a collision through. Pure (no I/O) so it's
// testable without mocking Express or the filesystem.
function dedupeVirtualDevices(devices) {
  const crypto = require('crypto');
  const seenIds = new Set();
  return devices.map((d) => {
    let id = String(d.id || '').trim() || crypto.randomUUID().slice(0, 8);
    if (seenIds.has(id)) id = crypto.randomUUID().slice(0, 8);
    seenIds.add(id);
    const type = VIRTUAL_TYPES.has(d.type) ? d.type : 'switch';
    const out = {
      id,
      name: String(d.name || '').trim(),
      type,
      unit: String(d.unit || '').trim(),
    };
    // min/max only mean anything for 'sensor' — default range (-1000/1000)
    // is fine for most values, so only persist an override when the caller
    // actually supplied one (keeps existing configs' JSON unchanged).
    if (type === 'sensor') {
      if (d.min !== undefined && d.min !== '' && Number.isFinite(Number(d.min))) out.min = Number(d.min);
      if (d.max !== undefined && d.max !== '' && Number.isFinite(Number(d.max))) out.max = Number(d.max);
    }
    return out;
  }).filter((d) => d.name);
}

function createApiRoutes(store, relayController, sensorRegistry, connectionMgr, clients = {}) {
  const { unifiProtect, reolink, kenik, mobotix, axis, simulators, mqttExplorer, auth, isSecure, ffmpegRtsp, sipServer, pagingManager, openweather, objectDetection, airplayClient } = clients;
  const manualSnapCache = new Map(); // manual camera idx → { at, buffer }, for /camera/snapshot/:idx

  // Secure cookie flag per request, not per server: with both HTTP and HTTPS
  // listeners up, a login over plain http (e.g. phone → http://<lan-ip>:3001)
  // must not get a Secure cookie — browsers silently drop it and the user
  // loops on the login screen. Only localhost is exempt from that rule, which
  // is why the bug never shows on the dev machine itself.
  const reqIsSecure = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';
  const router = Router();

  // Gate a route to admin-role users. The blanket auth.middleware() only
  // proves a request is authenticated as *someone* — 'viewer' is a real,
  // separately-issued role (see POST /auth/users) meant for read-only
  // access, so anything that writes config, controls a device/relay, or
  // touches credentials/tokens/alarm/automation needs this on top of that.
  // Deliberately NOT applied to: self-service routes (logout, own password
  // change), PIN *verify* endpoints (no state change), live-call handling
  // (SIP answer/reject/hangup/talk), paging/Sonos/agenda (shared household
  // features), running an already-defined scene/flow, or camera *viewing*
  // (WebRTC offer, on-demand snapshot) — those stay available to viewers.
  const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required' });
    next();
  };

  // Gate a route to a specific per-user capability (currently 'flows' or
  // 'claudeCode') — a layer *above* requireAdmin, not a replacement for it:
  // an admin no longer automatically has these, they must be granted the
  // flag explicitly (via requireInstallerMode below). API tokens are exempt
  // — they're already "deliberately handed out by an admin" (see the
  // API_TOKEN_USER comment near the top of this file), not an interactive
  // session someone could click into Flows/Claude Code from.
  const requirePermission = (key) => (req, res, next) => {
    if (req.user?.id === 'api-token') return next();
    if (!auth || !auth.hasPermission(req.user?.id, key)) {
      return res.status(403).json({ success: false, error: `Missing '${key}' permission — ask an admin with installer mode enabled to grant it in Settings → Security` });
    }
    next();
  };

  // Gate a route to only work while config.json's top-level `installerMode`
  // is true. This is what makes granting flows/claudeCode permissions harder
  // to reach than just being a web admin — flipping it requires filesystem
  // access to the box LSH runs on, not just a browser session. Deliberately
  // config-file-only, no in-app toggle (an in-app toggle would defeat the
  // point). Read fresh via readConfigFile() so it applies immediately, no
  // restart needed, same as every other config.json-driven route here.
  const requireInstallerMode = (req, res, next) => {
    if (readConfigFile().installerMode !== true) {
      return res.status(403).json({ success: false, error: 'Installer mode is off — set "installerMode": true in config.json to grant permissions' });
    }
    next();
  };

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
      auth.setCookie(res, token, reqIsSecure(req));
      res.json({ success: true, user });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/auth/login', async (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    if (auth.isLoginRateLimited(req.ip)) {
      console.warn(`[Auth] Login rate-limited for ${req.ip} — too many recent failures`);
      return res.status(429).json({ success: false, error: 'Too many failed login attempts. Try again in a few minutes.' });
    }
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'username and password required' });
    }
    const user = await auth.authenticate(username, password);
    console.log(`[Auth] Login ${user ? 'OK' : 'FAILED'} for "${username}" from ${req.ip} over ${reqIsSecure(req) ? 'https' : 'http'} — ${(req.headers['user-agent'] || '?').slice(0, 200)}`);
    if (!user) { auth.recordLoginFailure(req.ip); return res.status(401).json({ success: false, error: 'Invalid username or password' }); }
    auth.recordLoginSuccess(req.ip);
    const token = auth.signToken(user);
    auth.setCookie(res, token, reqIsSecure(req));
    res.json({ success: true, user });
  });

  router.post('/auth/logout', (req, res) => {
    if (auth) auth.clearCookie(res);
    res.json({ success: true });
  });

  router.get('/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    // req.user comes straight off the JWT (id/username/role only) — enrich
    // with a fresh permissions read so a revoked flag reflects immediately
    // instead of waiting for the session to expire. API tokens have no
    // underlying user record; they're already admin-equivalent everywhere
    // (see requirePermission above), so report both capabilities as granted.
    const permissions = req.user.id === 'api-token'
      ? { flows: true, claudeCode: true }
      : (auth?.getUsers().find((u) => u.id === req.user.id)?.permissions || { flows: false, claudeCode: false });
    res.json({ success: true, data: { ...req.user, permissions } });
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
    res.json({ success: true, data: auth.getUsers(), installerMode: readConfigFile().installerMode === true });
  });

  // Grant/revoke the flows/claudeCode capability flags — see requirePermission
  // and requireInstallerMode above for why both gates are needed here.
  router.put('/auth/users/:id/permissions', requireAdmin, requireInstallerMode, (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    const { flows, claudeCode } = req.body || {};
    try {
      let permissions;
      if (flows !== undefined) permissions = auth.setPermission(req.params.id, 'flows', flows);
      if (claudeCode !== undefined) permissions = auth.setPermission(req.params.id, 'claudeCode', claudeCode);
      res.json({ success: true, data: permissions });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
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

  router.get('/auth/tokens', requireAdmin, (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    res.json({ success: true, data: auth.getApiTokens() });
  });

  router.post('/auth/tokens', requireAdmin, (req, res) => {
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

  router.delete('/auth/tokens/:id', requireAdmin, (req, res) => {
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

  router.post('/relay/:index/state', requireAdmin, async (req, res) => {
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

  router.post('/device/:deviceKey(*)/command', requireAdmin, async (req, res) => {
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
  // ?hours=N — anything within the in-memory ring buffer's ~6h window (no
  // param, or a small one) is served straight from RAM exactly as before;
  // wider ranges only touch Mongo when explicitly asked for, so the default
  // 1h/6h chart views keep costing nothing extra.
  router.get('/history/:key(*)', async (req, res) => {
    const hours = req.query.hours ? Number(req.query.hours) : null;
    if (!hours || hours <= 6) {
      return res.json({ success: true, key: req.params.key, points: store.getHistory(req.params.key) });
    }
    const points = await store.getHistoryRange(req.params.key, hours);
    res.json({ success: true, key: req.params.key, points });
  });

  router.get('/history-status', (req, res) => {
    res.json({ success: true, data: store.historyStatus() });
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

  router.get('/rooms', (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    res.json({ success: true, rooms: sensorRegistry.getRoomMeta() });
  });

  router.post('/room/:name/icon', (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    if (!editPinOk(req)) return res.status(403).json({ success: false, error: 'PIN_REQUIRED' });
    try {
      res.json({ success: true, rooms: sensorRegistry.setRoomIcon(req.params.name, req.body?.icon) });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/plan-decor', (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    res.json({ success: true, decor: sensorRegistry.getDecor() });
  });

  router.post('/plan-decor', (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    if (!editPinOk(req)) return res.status(403).json({ success: false, error: 'PIN_REQUIRED' });
    const { op, floor, emoji, image, hideAuto, id, x, y } = req.body || {};
    try {
      let decor;
      if (op === 'add') decor = sensorRegistry.addDecor(floor, emoji, x, y, { image, hideAuto });
      else if (op === 'move') decor = sensorRegistry.moveDecor(id, x, y);
      else if (op === 'remove') decor = sensorRegistry.removeDecor(id);
      else if (op === 'hide') decor = sensorRegistry.hideAutoDecor(id);
      else return res.status(400).json({ success: false, error: `Unknown op '${op}'` });
      res.json({ success: true, decor });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // ── Uploaded furniture pictures for the home plan ─────────
  // Body: { name, data } with data a base64 image data-URI. Stored in
  // persist/plan-decor/ and served back through the authed route below.
  const DECOR_IMG_DIR = path.join(__dirname, '..', 'persist', 'plan-decor');
  const DECOR_IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

  router.post('/plan-decor/upload', (req, res) => {
    if (!editPinOk(req)) return res.status(403).json({ success: false, error: 'PIN_REQUIRED' });
    const m = String(req.body?.data || '').match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return res.status(400).json({ success: false, error: 'data must be a png/jpeg/webp/gif data-URI' });
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) return res.status(400).json({ success: false, error: 'Empty image' });
    if (buf.length > 3 * 1024 * 1024) return res.status(400).json({ success: false, error: 'Image too large (max 3 MB)' });
    const base = String(req.body?.name || 'furniture').replace(/\.[^.]*$/, '')
      .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'furniture';
    const file = `${base}-${Date.now().toString(36)}.${DECOR_IMG_EXT[m[1]]}`;
    fs.mkdirSync(DECOR_IMG_DIR, { recursive: true });
    fs.writeFileSync(path.join(DECOR_IMG_DIR, file), buf);
    res.json({ success: true, url: `/api/plan-decor/img/${file}` });
  });

  router.get('/plan-decor/img/:file', (req, res) => {
    const file = String(req.params.file || '');
    if (!/^[a-z0-9-]+-[a-z0-9]+\.(png|jpg|webp|gif)$/.test(file)) return res.status(400).end();
    res.sendFile(path.join(DECOR_IMG_DIR, file), (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });

  // ── Home plan (isometric floor plan for the dashboard) ────
  router.get('/home-plan', (req, res) => {
    res.json({ success: true, plan: readConfigFile().homePlan || { rooms: [] } });
  });

  // ── EV charging visualization (which Sketchfab car embeds on the Energy
  // tab's EV card) — modelId/modelName are optional; the client falls back to
  // its own default (2025 Mercedes-Benz G-Class AMG G63) when unset. ────
  const DEFAULT_EV_MODEL_ID = 'f583b5bfc17346c08573dc4f1edebefe';
  const DEFAULT_EV_MODEL_NAME = '2025 Mercedes-Benz G-Class AMG G63';

  router.get('/ev-visual', (req, res) => {
    const ev = readConfigFile().evVisual || {};
    res.json({
      success: true,
      modelId: ev.modelId || DEFAULT_EV_MODEL_ID,
      modelName: ev.modelName || DEFAULT_EV_MODEL_NAME,
    });
  });

  router.post('/settings/ev-visual', requireAdmin, (req, res) => {
    const modelId = String(req.body?.modelId || '').trim();
    if (modelId && !/^[a-f0-9]{32}$/.test(modelId)) {
      return res.status(400).json({ success: false, error: 'Invalid Sketchfab model id' });
    }
    const modelName = String(req.body?.modelName || '').trim().slice(0, 120);
    try {
      const cfg = readConfigFile();
      cfg.evVisual = { modelId, modelName };
      writeConfigFile(cfg);
      res.json({ success: true, message: modelId ? `EV visualization set to "${modelName || modelId}".` : 'EV visualization reset to default.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/home-plan', requireAdmin, (req, res) => {
    const rooms = (Array.isArray(req.body?.rooms) ? req.body.rooms : [])
      .map((r) => ({
        name: String(r.name || '').trim().slice(0, 40),
        x: Math.max(0, Math.min(40, Number(r.x) || 0)),
        y: Math.max(0, Math.min(40, Number(r.y) || 0)),
        w: Math.max(1, Math.min(20, Number(r.w) || 2)),
        d: Math.max(1, Math.min(20, Number(r.d) || 2)),
        floor: ['cellar', 'floor1', 'floor2'].includes(r.floor) ? r.floor : 'floor1',
      }))
      .filter((r) => r.name);
    const floors = {};
    if (req.body?.floors && typeof req.body.floors === 'object') {
      for (const f of ['cellar', 'floor1', 'floor2']) {
        const src = req.body.floors[f];
        if (!src) continue;
        const image = String(src.image || '').trim().slice(0, 400);
        if (!image) continue;
        floors[f] = {
          image,
          w: Math.max(4, Math.min(40, Number(src.w) || 12)),
          h: Math.max(4, Math.min(40, Number(src.h) || 9)),
        };
      }
    }
    const defaultLayers = {};
    if (req.body?.defaultLayers && typeof req.body.defaultLayers === 'object') {
      for (const k of ['furniture', 'appliances', 'power', 'walls', 'textures', 'satellite', 'surroundings']) {
        if (typeof req.body.defaultLayers[k] === 'boolean') defaultLayers[k] = req.body.defaultLayers[k];
      }
    }
    try {
      const cfg = readConfigFile();
      cfg.homePlan = { rooms, floors, singleFloor: !!req.body?.singleFloor, defaultLayers };
      writeConfigFile(cfg);
      res.json({ success: true, message: `Saved ${rooms.length} room(s), ${Object.keys(floors).length} floor image(s)` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Electricity tariff (peak/off-peak pricing shown on the Home Plan's
  // power-flow overlay) ──────────────────────────────────────────────
  // Resolves which configured window covers `now`, and which one is next —
  // windows may wrap midnight (start > end, e.g. 23:00-16:00).
  function resolveTariff(windows, now = new Date()) {
    if (!Array.isArray(windows) || !windows.length) return { current: null, next: null };
    const mins = now.getHours() * 60 + now.getMinutes();
    const toMin = (t) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
      return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : null;
    };
    let current = null;
    let next = null;
    let bestUntilStart = Infinity;
    for (const w of windows) {
      const start = toMin(w.start);
      const end = toMin(w.end);
      if (start == null || end == null) continue;
      const inWindow = start <= end ? (mins >= start && mins < end) : (mins >= start || mins < end);
      if (inWindow) current = w;
      const untilStart = start > mins ? start - mins : start + 1440 - mins;
      if (untilStart > 0 && untilStart < bestUntilStart) { bestUntilStart = untilStart; next = w; }
    }
    return { current, next, nextInMinutes: next ? bestUntilStart : null };
  }

  router.get('/tariff', (req, res) => {
    const cfg = readConfigFile().tariff || {};
    const { current, next, nextInMinutes } = resolveTariff(cfg.windows);
    res.json({ success: true, data: { currency: cfg.currency || '£', current, next, nextInMinutes } });
  });

  router.post('/settings/tariff', requireAdmin, (req, res) => {
    const currency = String(req.body?.currency || '£').trim().slice(0, 4);
    const windows = (Array.isArray(req.body?.windows) ? req.body.windows : [])
      .map((w) => ({
        label: String(w.label || '').trim().slice(0, 30),
        price: Math.max(0, Number(w.price) || 0),
        start: /^\d{1,2}:\d{2}$/.test(w.start) ? w.start : '00:00',
        end: /^\d{1,2}:\d{2}$/.test(w.end) ? w.end : '00:00',
      }))
      .filter((w) => w.label);
    try {
      const cfg = readConfigFile();
      cfg.tariff = { currency, windows };
      writeConfigFile(cfg);
      res.json({ success: true, message: `Saved ${windows.length} tariff window(s)` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Private (locally-added) agenda events — never synced to/from Google ─
  router.post('/agenda/private', (req, res) => {
    const { date, title, time } = req.body || {};
    if (!date || !title) return res.status(400).json({ success: false, error: 'date and title required' });
    const item = privateEvents.add({ date, title, time });
    res.json({ success: true, data: item });
  });

  router.delete('/agenda/private/:id', (req, res) => {
    const ok = privateEvents.remove(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  });

  // ── Missed calls (SIP doorbell) ──────────────────────────────────────────
  router.get('/call-log', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    res.json({ success: true, data: callLog.getRecent(limit) });
  });

  // ── Google Calendar (OAuth, read-only) ───────────────────────────────────
  router.get('/google-calendar/oauth/start', (req, res) => {
    const gc = clients.googleCalendar;
    if (!gc) return res.status(503).send('Google Calendar not configured — set clientId/clientSecret in Settings first.');
    const redirectUri = `${req.protocol}://${req.get('host')}/api/google-calendar/oauth/callback`;
    try {
      res.redirect(gc.getAuthUrl(redirectUri));
    } catch (err) {
      res.status(500).send(err.message);
    }
  });

  router.get('/google-calendar/oauth/callback', async (req, res) => {
    const gc = clients.googleCalendar;
    if (!gc) return res.status(503).send('Google Calendar not configured.');
    const { code, error } = req.query;
    if (error) return res.redirect('/react/?gc_error=' + encodeURIComponent(error));
    if (!code) return res.status(400).send('Missing code');
    const redirectUri = `${req.protocol}://${req.get('host')}/api/google-calendar/oauth/callback`;
    try {
      await gc.exchangeCode(code, redirectUri);
      res.redirect('/react/?gc_connected=1');
    } catch (err) {
      res.redirect('/react/?gc_error=' + encodeURIComponent(err.message));
    }
  });

  router.get('/google-calendar/status', (req, res) => {
    const gc = clients.googleCalendar;
    res.json({ success: true, data: { configured: !!gc, connected: !!gc?.isConnected() } });
  });

  router.post('/settings/google-calendar', requireAdmin, (req, res) => {
    const clientId = String(req.body?.clientId || '').trim();
    const clientSecret = String(req.body?.clientSecret || '').trim();
    const calendarId = String(req.body?.calendarId || '').trim() || 'primary';
    try {
      const cfg = readConfigFile();
      cfg.googleCalendar = { clientId, clientSecret, calendarId };
      writeConfigFile(cfg);
      res.json({ success: true, message: 'Saved — restart LSH, then use "Connect with Google".' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Unified agenda feed for the Wall Dashboard: Google Calendar + private
  // events + missed calls + motion detections, merged and time-sorted ─────
  router.get('/agenda', (req, res) => {
    const events = [];
    const gc = clients.googleCalendar;
    if (gc?.isConnected()) {
      for (const ev of gc.getEvents()) events.push({ ...ev, kind: 'calendar' });
    }
    for (const ev of privateEvents.getAll()) events.push({ ...ev, kind: 'private' });
    for (const c of callLog.getRecent(10)) {
      const d = new Date(c.ts);
      events.push({ date: d.toISOString().slice(0, 10), title: `Missed call — ${c.caller}`, time: d.toTimeString().slice(0, 5), kind: 'call' });
    }
    for (const m of motionLog.getRecent(10)) {
      const d = new Date(m.ts);
      events.push({ date: d.toISOString().slice(0, 10), title: `Motion — ${m.device}`, time: d.toTimeString().slice(0, 5), kind: 'motion' });
    }
    events.sort((a, b) => `${a.date}T${a.time || '00:00'}`.localeCompare(`${b.date}T${b.time || '00:00'}`));
    res.json({ success: true, data: events });
  });

  // ── Dashboard lock PIN (screen lock, default 0000) ────────
  router.post('/dashboard-pin/verify', (req, res) => {
    const pin = String(readConfigFile().dashboardPin || '0000');
    res.json({ success: true, ok: String(req.body?.pin || '') === pin });
  });

  router.post('/settings/dashboard-pin', requireAdmin, (req, res) => {
    const pin = String(req.body?.pin ?? '').trim();
    if (pin && !/^\d{4,8}$/.test(pin)) {
      return res.status(400).json({ success: false, error: 'PIN must be 4–8 digits' });
    }
    try {
      const cfg = readConfigFile();
      cfg.dashboardPin = pin; // empty falls back to the default 0000
      writeConfigFile(cfg);
      res.json({ success: true, message: pin ? 'Dashboard PIN set' : 'Dashboard PIN reset to default 0000' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/edit-pin', requireAdmin, (req, res) => {
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
    // Both builders return an array of XML documents, auto-split so no single
    // Virtual Input/Output exceeds Loxone Config's per-block command limit.
    const parts = kind === 'inputs' ? buildInputsXml(devices, opts) : buildOutputsXml(devices, opts);
    if (!parts.length) {
      return res.status(404).json({
        success: false,
        error: kind === 'outputs'
          ? 'Matching devices have no controllable sensors — use inputs.xml for read-only devices'
          : 'Matching devices have no readable sensors',
      });
    }
    const base = ['lsh-loxone', kind, req.query.type || (req.query.device || '').replace(/\//g, '-')]
      .filter(Boolean).join('-');
    if (parts.length === 1) {
      res.set('Content-Type', 'application/xml; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${base}.xml"`);
      return res.send(parts[0]);
    }
    // Multiple blocks → bundle as a ZIP of individually-importable files.
    const { zipStore } = require('./zip');
    const files = parts.map((xml, i) => ({ name: `${base}-${i + 1}.xml`, data: xml }));
    const zip = zipStore(files);
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${base}.zip"`);
    res.send(zip);
  };
  router.get('/loxone/inputs.xml',  loxoneXmlHandler('inputs'));
  router.get('/loxone/outputs.xml', loxoneXmlHandler('outputs'));
  // Friendly fixed alias for the SIP doorbell's one controllable action
  // (open door) — equivalent to outputs.xml?type=sip, just a stable URL.
  router.get('/loxone/sipout.xml', (req, res) => {
    req.query.type = 'sip';
    return loxoneXmlHandler('outputs')(req, res);
  });

  // ── Automation (rules / scenes / notifications) ───────────
  if (clients.automation) {
    const automation = clients.automation;

    router.get('/automation/rules', (req, res) => res.json({ success: true, data: automation.rules }));
    router.post('/automation/rules', requireAdmin, (req, res) => {
      try { res.json({ success: true, data: automation.saveRule(req.body) }); }
      catch (err) { res.status(400).json({ success: false, error: err.message }); }
    });
    router.delete('/automation/rules/:id', requireAdmin, (req, res) => {
      automation.deleteRule(req.params.id);
      res.json({ success: true });
    });

    router.get('/automation/scenes', (req, res) => res.json({ success: true, data: automation.scenes }));
    router.post('/automation/scenes', requireAdmin, (req, res) => {
      try { res.json({ success: true, data: automation.saveScene(req.body) }); }
      catch (err) { res.status(400).json({ success: false, error: err.message }); }
    });
    router.delete('/automation/scenes/:id', requireAdmin, (req, res) => {
      automation.deleteScene(req.params.id);
      res.json({ success: true });
    });
    router.post('/automation/scenes/:id/run', async (req, res) => {
      try { res.json({ success: true, data: await automation.runScene(req.params.id) }); }
      catch (err) { res.status(400).json({ success: false, error: err.message }); }
    });

    // ── Flows (Node-RED-style) ──
    router.get('/automation/flows', (req, res) => res.json({ success: true, data: automation.flows }));
    router.post('/automation/flows', requireAdmin, requirePermission('flows'), (req, res) => {
      try { res.json({ success: true, data: automation.saveFlow(req.body) }); }
      catch (err) { res.status(400).json({ success: false, error: err.message }); }
    });
    router.delete('/automation/flows/:id', requireAdmin, requirePermission('flows'), (req, res) => {
      automation.deleteFlow(req.params.id);
      res.json({ success: true });
    });
    router.post('/automation/flows/:id/run', async (req, res) => {
      try { res.json({ success: true, data: await automation.runFlow(req.params.id) }); }
      catch (err) { res.status(400).json({ success: false, error: err.message }); }
    });

    // Serves JPEGs captured by an `http` node's `saveAs` option — point a
    // camera's snapshotUrl at this to use any flow-fetched image like a
    // regular camera snapshot. No auth beyond the usual API middleware, same
    // as other snapshot proxies (mobotix/axis/kenik) — filename is sanitized
    // on write (automation-engine.js), so this can't escape SNAPSHOTS_DIR.
    router.get('/flow-snapshots/:name', (req, res) => {
      const name = engineExports.sanitizeSnapshotName(req.params.name.replace(/\.jpe?g$/i, ''));
      const file = path.join(engineExports.SNAPSHOTS_DIR, `${name}.jpg`);
      res.set('Cache-Control', 'no-store');
      res.sendFile(file, (err) => { if (err && !res.headersSent) res.status(404).json({ success: false, error: 'No snapshot saved yet' }); });
    });

    // Serves the Loxone Virtual Input XML (re)generated by a `loxoneXml`
    // flow node — import this once into Loxone Config, same filename
    // sanitization/scoping as the snapshot route above.
    router.get('/flow-loxone/:name', (req, res) => {
      const name = engineExports.sanitizeSnapshotName(req.params.name.replace(/\.xml$/i, ''));
      const file = path.join(engineExports.LOXONE_XML_DIR, `${name}.xml`);
      res.set('Content-Type', 'application/xml; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${name}.xml"`);
      res.sendFile(file, (err) => { if (err && !res.headersSent) res.status(404).json({ success: false, error: 'No XML generated yet — run the flow at least once' }); });
    });

    router.get('/automation/notifications', (req, res) => res.json({ success: true, data: automation.getNotifications() }));
    // External systems (Node-RED, scripts) can push a notification → toast + log
    router.post('/automation/notifications', requireAdmin, (req, res) => {
      const { level, message, source } = req.body || {};
      if (!message) return res.status(400).json({ success: false, error: 'message required' });
      res.json({ success: true, data: automation.notify(level || 'info', String(message), source || 'api') });
    });
    router.delete('/automation/notifications', requireAdmin, (req, res) => {
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
  router.post('/satel/output/:num', requireAdmin, async (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    try {
      await sensorRegistry.sendCommand(`satel/output/${req.params.num}`, 'state', req.body?.state);
      res.json({ success: true });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
  });

  // Arm / disarm a partition
  router.post('/satel/partition/:num/:action(arm|disarm)', requireAdmin, async (req, res) => {
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
    const kenikCams   = kenik ? kenik.getCameras() : [];
    const mobotixCams = mobotix ? mobotix.getCameras() : [];
    const axisCams    = axis ? axis.getCameras() : [];
    // Manual cameras with an `onvif` section get PTZ through the generic proxy;
    // ones with an RTSP `url` but no snapshot/MJPEG source of their own (e.g.
    // WHEP-only) get a thumbnail via the generic ffmpeg-grab-a-frame proxy.
    const manualCams = (cfg.cameras || []).map((c, idx) => ({
      ...c,
      ...(c.onvif ? {
        onvif: { ...c.onvif, password: c.onvif.password ? '••••••••' : '' },
        ptzUrl:    `/api/camera/ptz/${idx}`,
        presetUrl: `/api/camera/preset/${idx}`,
        irUrl:     `/api/camera/ir/${idx}`,
      } : {}),
      ...(c.url && !c.snapshotUrl && !c.mjpegUrl ? { snapshotUrl: `/api/camera/snapshot/${idx}` } : {}),
    }));
    res.json({ success: true, data: [...manualCams, ...unifiCams, ...reolinkCams, ...kenikCams, ...mobotixCams, ...axisCams, ...stCams] });
  });

  // ── Local object detection (COCO-SSD) model selection ──────
  // Weights aren't vendored — switching downloads the chosen base model
  // fresh from its CDN and validates it loads before persisting the choice,
  // so a bad/offline pick doesn't silently break detection on next restart.
  router.get('/settings/object-detection/model', (req, res) => {
    if (!objectDetection) {
      const { MODEL_BASES } = require('./object-detection');
      return res.json({ success: true, data: { base: null, loading: false, loaded: false, error: null, options: MODEL_BASES } });
    }
    res.json({ success: true, data: objectDetection.getModelStatus() });
  });

  router.post('/settings/object-detection/model', requireAdmin, async (req, res) => {
    if (!objectDetection) {
      return res.status(503).json({ success: false, error: 'Object detection not running — add at least one camera under objectDetection.cameras first' });
    }
    try {
      const data = await objectDetection.setModel((req.body || {}).model);
      const current = readConfigFile();
      writeConfigFile({ ...current, objectDetection: { ...(current.objectDetection || {}), model: data.base } });
      res.json({ success: true, data });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Cameras list + tunables — separate from the model-switch route above
  // since that one validates by actually downloading/loading the model
  // synchronously, while this is a plain config write (see src/object-
  // detection.js's header for why any RTSP URL works here, not just
  // brand-specific integrations).
  router.post('/settings/object-detection', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { cameras, pollInterval, minConfidence, petVerification, requirePetVerification, autoCreateFlows } = req.body || {};
    try {
      const objectDetectionCfg = { ...current.objectDetection };
      if (Array.isArray(cameras)) {
        objectDetectionCfg.cameras = cameras
          .filter((c) => c && c.name && c.url)
          .map((c) => ({
            name: String(c.name).trim(), url: String(c.url).trim(),
            ...(c.model ? { model: String(c.model).trim() } : {}),
          }));
      }
      if (pollInterval !== undefined) objectDetectionCfg.pollInterval = Math.max(5, Number(pollInterval) || 15);
      if (minConfidence !== undefined) objectDetectionCfg.minConfidence = Math.max(0, Math.min(1, Number(minConfidence)));
      if (petVerification !== undefined) objectDetectionCfg.petVerification = !!petVerification;
      if (requirePetVerification !== undefined) objectDetectionCfg.requirePetVerification = !!requirePetVerification;
      if (autoCreateFlows !== undefined) objectDetectionCfg.autoCreateFlows = !!autoCreateFlows;
      writeConfigFile({ ...current, objectDetection: objectDetectionCfg });
      res.json({ success: true, message: 'Object detection settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
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

  // Daily forecast for the dashboard's forecast strip — current conditions
  // are already reachable through the generic device/readings mechanism
  // (openweather/weather), but a multi-day array doesn't fit that scalar
  // per-sensor shape, so it gets its own small endpoint, same as /api/cameras
  // or /api/relays.
  router.get('/openweather/forecast', (req, res) => {
    if (!openweather) return res.status(503).json({ success: false, error: 'OpenWeatherMap not configured' });
    res.json({ success: true, data: openweather.getForecast() });
  });

  router.post('/sip/open-door', requireAdmin, async (req, res) => {
    if (!sipServer) return res.status(503).json({ success: false, error: 'SIP server not enabled' });
    try {
      await sipServer.openDoor();
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Live listen: proxies the audio bridge's local ffmpeg MP3 stream straight
  // through to the browser <audio> element — no buffering here, whatever
  // ffmpeg produces goes out as it arrives.
  router.get('/sip/listen', (req, res) => {
    const port = sipServer?.audioListenPort;
    if (!port) return res.status(503).json({ success: false, error: 'No active call with audio' });
    const upstream = http.get(`http://127.0.0.1:${port}/`, (up) => {
      res.set('Content-Type', 'audio/mpeg');
      up.pipe(res);
    });
    upstream.on('error', (err) => {
      if (!res.headersSent) res.status(502).json({ success: false, error: err.message });
    });
    req.on('close', () => upstream.destroy());
  });

  // Live talk: the browser posts live MediaRecorder chunks here as they're
  // captured; each chunk is fed straight into the audio bridge's ffmpeg
  // stdin. No JSON — raw audio/webm body.
  router.post('/sip/talk', raw({ type: '*/*', limit: '256kb' }), (req, res) => {
    if (!sipServer) return res.status(503).json({ success: false, error: 'SIP server not enabled' });
    sipServer.writeTalkChunk(req.body);
    res.json({ success: true });
  });

  // ── Room-to-room paging (intercom) ────────────────────────────────────
  // The live audio channel itself runs over Socket.IO (see src/websocket.js
  // and src/paging.js) — these REST routes are for status and for starting/
  // ending a page from outside a paging-aware browser session, e.g. a Flow
  // editor `http` node, a bearer-token API client, or curl.
  router.get('/paging/rooms', (req, res) => {
    res.json({ success: true, data: pagingManager ? pagingManager.getRoomsStatus() : [] });
  });

  router.post('/paging/start', (req, res) => {
    if (!pagingManager) return res.status(503).json({ success: false, error: 'Paging not enabled' });
    const { from, to } = req.body || {};
    try {
      res.json({ success: true, data: pagingManager.startPage(from, to) });
    } catch (err) {
      res.status(409).json({ success: false, error: err.message });
    }
  });

  router.post('/paging/:pageId/end', (req, res) => {
    if (!pagingManager) return res.status(503).json({ success: false, error: 'Paging not enabled' });
    res.json({ success: pagingManager.endPage(req.params.pageId, 'ended-via-api') });
  });

  // Voice messages — the "leave a message" counterpart to the live channel
  // above, for when the target room isn't online (startPage() requires both
  // sides connected) or the sender just prefers an async note. `from`/`to`
  // travel as query params since the request body is the raw audio blob.
  router.post('/paging/message', raw({ type: '*/*', limit: '5mb' }), (req, res) => {
    if (!pagingManager) return res.status(503).json({ success: false, error: 'Paging not enabled' });
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ success: false, error: 'from and to are required' });
    if (!pagingManager.roomExists(from) || !pagingManager.roomExists(to)) {
      return res.status(400).json({ success: false, error: 'Unknown paging room' });
    }
    if (!req.body?.length) return res.status(400).json({ success: false, error: 'Empty recording' });
    const message = pagingMessages.add({ from, to, buffer: req.body, mimeType: req.get('content-type') });
    pagingManager.notifyRoom(to, 'paging:message', { id: message.id, from, to, at: message.at });
    console.log(`[Paging] Voice message ${from} → ${to} (${message.id}, ${req.body.length}b)`);
    res.json({ success: true, data: { id: message.id, at: message.at } });
  });

  router.get('/paging/messages', (req, res) => {
    if (!pagingManager) return res.status(503).json({ success: false, error: 'Paging not enabled' });
    const room = req.query.room;
    if (!room) return res.status(400).json({ success: false, error: 'room is required' });
    res.json({ success: true, data: pagingMessages.getFor(room) });
  });

  router.get('/paging/message/:id/audio', (req, res) => {
    const message = pagingMessages.get(req.params.id);
    const file = pagingMessages.audioFile(req.params.id);
    if (!message || !file) return res.status(404).json({ success: false, error: 'Message not found' });
    res.setHeader('Content-Type', message.mimeType || 'audio/webm');
    res.sendFile(file);
  });

  router.delete('/paging/message/:id', (req, res) => {
    res.json({ success: pagingMessages.remove(req.params.id) });
  });

  // Voice messages disappear 24h after being left unless kept — this exempts
  // (or re-exposes) one to/from that expiry.
  router.post('/paging/message/:id/keep', (req, res) => {
    const kept = req.body?.keep !== false; // default true — the common case is "keep this one"
    const item = pagingMessages.setKept(req.params.id, kept);
    if (!item) return res.status(404).json({ success: false, error: 'Message not found' });
    res.json({ success: true, data: { id: item.id, kept: item.kept } });
  });

  // ── AirPlay — play prerecorded audio out to a configured speaker ──────
  // src/airplay-client.js. Household broadcast feature, same "any
  // authenticated user" tier as paging/Sonos above — not a config write.
  router.get('/airplay/speakers', (req, res) => {
    res.json({ success: true, data: airplayClient ? airplayClient.getSpeakers() : [] });
  });

  // mDNS scan for AirPlay receivers, independent of whether AirPlay is
  // enabled/configured yet (see AirplayClient.discover doc comment) — the
  // Settings UI's "Scan network" button. requireAdmin: nudges a device on
  // the LAN into responding to a probe, same tier as the config write below.
  router.get('/airplay/discover', requireAdmin, async (req, res) => {
    const AirplayClient = require('./airplay-client');
    const found = await AirplayClient.discover();
    res.json({ success: true, data: found });
  });

  // Replay one of the paging voice messages (src/paging-messages.js) out
  // loud on a speaker — the actual "post prerecorded messages" use case.
  router.post('/airplay/:id/play-message', async (req, res) => {
    if (!airplayClient) return res.status(503).json({ success: false, error: 'AirPlay not configured' });
    const file = pagingMessages.audioFile(req.body?.messageId);
    if (!file) return res.status(404).json({ success: false, error: 'Voice message not found' });
    try {
      await airplayClient.play(req.params.id, file);
      res.json({ success: true });
    } catch (err) {
      res.status(502).json({ success: false, error: err.message });
    }
  });

  // Play an arbitrary uploaded audio clip (any format ffmpeg reads) —
  // written to a scratch temp file only for the duration of playback.
  router.post('/airplay/:id/play', raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
    if (!airplayClient) return res.status(503).json({ success: false, error: 'AirPlay not configured' });
    if (!req.body?.length) return res.status(400).json({ success: false, error: 'Empty audio body' });
    const tmpFile = path.join(require('os').tmpdir(), `lsh-airplay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    try {
      fs.writeFileSync(tmpFile, req.body);
      await airplayClient.play(req.params.id, tmpFile);
      res.json({ success: true });
    } catch (err) {
      res.status(502).json({ success: false, error: err.message });
    } finally {
      fs.unlink(tmpFile, () => {}); // best-effort cleanup, playback has already finished reading it
    }
  });

  router.post('/settings/airplay', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { enabled, speakers } = req.body;
    try {
      const airplay = { ...current.airplay };
      if (enabled !== undefined) airplay.enabled = !!enabled;
      if (Array.isArray(speakers)) {
        airplay.speakers = speakers
          .filter((s) => s && s.id && s.host)
          .map((s) => ({
            id: String(s.id).trim(),
            name: String(s.name || s.id).trim(),
            host: String(s.host).trim(),
            port: Number(s.port) || 5000,
            airplay2: s.airplay2 !== false,
            volume: Math.max(0, Math.min(100, Number(s.volume) || 60)),
          }));
      }
      writeConfigFile({ ...current, airplay });
      res.json({ success: true, message: 'AirPlay settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
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

  // Fetches a SmartThings AV Platform media URL and proxies the bytes onto res.
  // The image attribute is marked "sensitive" in SmartThings' capability schema,
  // and its media host (…ec2.st-av.net) enforces that at the media layer, not
  // just the device-status layer: an OAuth SmartApp access token gets a 400
  // ("Request missing Bearer token") — turns out it *was* sending one, the
  // media host just rejects OAuth-scoped tokens for sensitive media outright
  // (confirmed: same request, same code, 500 "Error response from AV Platform"
  // even with a valid OAuth token and a freshly-captured image). A Personal
  // Access Token works. PATs created after Dec 2024 expire in 24h, so this
  // needs a fresh one periodically from https://account.smartthings.com/tokens
  // — falls back to the OAuth/legacy token if unset, which will 500 upstream
  // but at least degrades to the existing "no snapshot" behavior instead of
  // silently sending no auth at all.
  async function proxySmartThingsMedia(url, res) {
    try {
      const { buffer, contentType } = await fetchSmartThingsMedia(url, clients.smartThings);
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'no-cache');
      res.send(buffer);
    } catch (err) {
      res.status(502).send('Image fetch failed: ' + err.message);
    }
  }

  // SmartThings camera snapshot proxy — always the device's *current* image.
  router.get('/smartthings-camera/:deviceId/snapshot', async (req, res) => {
    const { deviceId } = req.params;
    const imageUrl = store.get(`smartthings/${deviceId}/image`);
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
      return res.status(404).send('No snapshot available — trigger a capture first');
    }
    await proxySmartThingsMedia(imageUrl, res);
  });

  // Same proxy, but for an arbitrary past capture's URL — lets the camera
  // event log's "Snapshot updated" entries stay clickable after a newer
  // capture has replaced the device's *current* image (which is all the
  // route above can ever serve). Host allowlisted to SmartThings' own media
  // domain so this can't be turned into an open image-fetching proxy.
  router.get('/smartthings-camera/image-proxy', async (req, res) => {
    const { url } = req.query;
    if (!url || !/^https:\/\/[a-z0-9.-]+\.ec2\.st-av\.net\//i.test(url)) {
      return res.status(400).send('Invalid or disallowed image URL');
    }
    await proxySmartThingsMedia(url, res);
  });

  // Trigger SmartThings imageCapture.take command
  // Sends a device command through SmartThings' regular (OAuth-fine, unlike
  // the sensitive-media routes above) command endpoint.
  // clients.smartThings (not a destructured local) — the client is registered
  // onto apiClients after createApiRoutes() already ran, so a destructured
  // copy taken at the top of this function would stay undefined forever.
  async function sendSmartThingsCommand(deviceId, capability, command, args = []) {
    const smartThings = clients.smartThings;
    const token = smartThings ? await smartThings.getToken().catch(() => null)
                              : readConfigFile().smartthings?.token;
    if (!token) throw new Error('No SmartThings token configured');
    const r = await fetch(`https://api.smartthings.com/v1/devices/${deviceId}/commands`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: [{ component: 'main', capability, command, arguments: args }] }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return token;
  }

  router.post('/smartthings-camera/:deviceId/take', async (req, res) => {
    const { deviceId } = req.params;
    try {
      await sendSmartThingsCommand(deviceId, 'imageCapture', 'take');
      // Resolve camera name from registry for log
      const dev = sensorRegistry?.getDevices?.()?.find?.(d => d.instance === deviceId);
      cameraLog.push(dev?.label || deviceId, 'capture-triggered');
      res.json({ success: true, message: 'Capture triggered — snapshot will update within a few seconds' });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Camera position presets (cameraPreset capability) — SmartThings exposes
  // save/recall of named positions for this camera, not live directional
  // pan/tilt/zoom movement (no "move" command exists in its capability set,
  // confirmed against the live capability schema). "create" with no data
  // argument has the device capture its own current position; there's no
  // API-level way to move the camera first, so this only usefully saves
  // wherever it's already pointed (e.g. after repositioning it by hand or
  // via the SmartThings app itself).
  router.get('/smartthings-camera/:deviceId/presets', async (req, res) => {
    const { deviceId } = req.params;
    const smartThings = clients.smartThings;
    const token = smartThings ? await smartThings.getToken().catch(() => null)
                              : readConfigFile().smartthings?.token;
    if (!token) return res.status(401).json({ success: false, error: 'No SmartThings token configured' });
    try {
      const r = await fetch(`https://api.smartthings.com/v1/devices/${deviceId}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const status = await r.json();
      res.json({ success: true, data: status.components?.main?.cameraPreset?.presets?.value || [] });
    } catch (err) {
      res.status(502).json({ success: false, error: err.message });
    }
  });

  router.post('/smartthings-camera/:deviceId/presets', requireAdmin, async (req, res) => {
    const { deviceId } = req.params;
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    try {
      await sendSmartThingsCommand(deviceId, 'cameraPreset', 'create', [name]);
      res.json({ success: true, message: 'Preset saved' });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/smartthings-camera/:deviceId/presets/:presetId/execute', requireAdmin, async (req, res) => {
    const { deviceId, presetId } = req.params;
    try {
      await sendSmartThingsCommand(deviceId, 'cameraPreset', 'execute', [presetId]);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.delete('/smartthings-camera/:deviceId/presets/:presetId', requireAdmin, async (req, res) => {
    const { deviceId, presetId } = req.params;
    try {
      await sendSmartThingsCommand(deviceId, 'cameraPreset', 'delete', [presetId]);
      res.json({ success: true });
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

  // Latest object-detection bounding boxes for a camera (initial state for
  // the modal's live overlay — live updates arrive over the 'detection-boxes'
  // socket event).
  router.get('/detection-boxes', (req, res) => {
    res.json({ success: true, data: detectionBoxes.get(req.query.camera || '') });
  });

  // Detection counts per class ("12 person, 3 cat today") from the Mongo
  // history object-detection.js writes (see its _saveDetectionRecords) —
  // requires config.mongo.uri; without it there's simply no history to
  // count from. objectDetections.camera is written under
  // objectDetection.cameras[].name, which can differ from the display
  // camera name passed here (see motionSource elsewhere) — resolve the
  // same way homekit-bridge.js does, just in reverse.
  router.get('/objectdetect/stats', async (req, res) => {
    const displayName = req.query.camera;
    if (!displayName) return res.status(400).json({ success: false, error: 'camera is required' });

    const db = getDb();
    if (!db) return res.json({ success: true, data: { today: [], week: [] } });

    const cfg = readConfigFile();
    const camCfg = (cfg.cameras || []).find((c) => c.name === displayName);
    const odCamera = camCfg?.motionSource || displayName;

    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek  = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const countsSince = (since) => db.collection('objectDetections').aggregate([
      { $match: { camera: odCamera, ts: { $gte: since } } },
      { $group: { _id: '$class', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray();

    try {
      const [today, week] = await Promise.all([countsSince(startOfToday), countsSince(startOfWeek)]);
      res.json({
        success: true,
        data: {
          today: today.map((r) => ({ class: r._id, count: r.count })),
          week:  week.map((r) => ({ class: r._id, count: r.count })),
        },
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Detection timeline: a thumbnail gallery of the annotated snapshots
  // object-detection.js already saves to Mongo (see _saveDetectionRecords).
  // Grouped by poll (exact ts), not by individual class — every prediction
  // kept from the same poll shares one annotated frame (all boxes drawn on
  // it together), so showing one thumbnail per detected class would repeat
  // the identical image several times in a row.
  router.get('/objectdetect/timeline', async (req, res) => {
    const displayName = req.query.camera;
    if (!displayName) return res.status(400).json({ success: false, error: 'camera is required' });

    const db = getDb();
    if (!db) return res.json({ success: true, data: [] });

    const cfg = readConfigFile();
    const camCfg = (cfg.cameras || []).find((c) => c.name === displayName);
    const odCamera = camCfg?.motionSource || displayName;
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);

    try {
      const groups = await db.collection('objectDetections').aggregate([
        { $match: { camera: odCamera } },
        { $sort: { ts: -1 } },
        { $group: { _id: '$ts', classes: { $push: { class: '$class', score: '$score' } }, imageId: { $first: '$_id' } } },
        { $sort: { _id: -1 } },
        { $limit: limit },
      ]).toArray();
      res.json({
        success: true,
        data: groups.map((g) => ({ ts: g._id, classes: g.classes, imageId: g.imageId.toString() })),
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Serves one detection's annotated JPEG by Mongo _id (shared across every
  // class detected in that same poll — see the timeline route above).
  // Detection images are immutable once written, so this is cached hard.
  router.get('/objectdetect/image/:id', async (req, res) => {
    const db = getDb();
    if (!db) return res.status(404).end();
    let ObjectId;
    try { ({ ObjectId } = require('mongodb')); } catch { return res.status(404).end(); }
    try {
      const doc = await db.collection('objectDetections').findOne({ _id: new ObjectId(req.params.id) });
      if (!doc?.image) return res.status(404).end();
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=604800, immutable');
      res.send(doc.image.buffer);
    } catch {
      res.status(404).end();
    }
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

  // MOBOTIX snapshot proxy — keeps camera credentials server-side
  router.get('/mobotix/snapshot/:idx', (req, res) => {
    if (!mobotix) return res.status(503).end();
    mobotix.proxySnapshot(req.params.idx, res);
  });

  // Axis snapshot proxy — keeps camera credentials server-side
  router.get('/axis/snapshot/:idx', (req, res) => {
    if (!axis) return res.status(503).end();
    axis.proxySnapshot(req.params.idx, res);
  });

  // KENIK snapshot proxy — one ffmpeg-grabbed RTSP frame, credentials stay server-side
  router.get('/kenik/snapshot/:idx', (req, res) => {
    if (!kenik) return res.status(503).end();
    kenik.proxySnapshot(req.params.idx, res);
  });

  // ── Hardware simulators (scripts/*-simulator.js) ──────────
  router.get('/simulators', (req, res) => {
    if (!simulators) return res.status(503).json({ success: false, error: 'Simulator manager unavailable' });
    res.json({ success: true, data: simulators.list() });
  });

  // Enable/disable a simulator at runtime; the choice persists in config.json
  router.post('/simulators/:name', (req, res) => {
    if (!simulators) return res.status(503).json({ success: false, error: 'Simulator manager unavailable' });
    const { enabled, port } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Body must include enabled: true|false' });
    }
    try {
      const status  = simulators.setEnabled(req.params.name, enabled, port ? Number(port) : undefined);
      const current = readConfigFile();
      writeConfigFile({
        ...current,
        simulators: {
          ...(current.simulators || {}),
          [req.params.name]: { enabled, ...(status.port ? { port: status.port } : {}) },
        },
      });
      res.json({ success: true, data: status });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // ── Camera PTZ ────────────────────────────────────────────
  // Continuous move: the client POSTs { op } on press and { op: 'stop' } on
  // release. op: left | right | up | down | zoomin | zoomout | stop
  const PTZ_OPS = ['left', 'right', 'up', 'down', 'zoomin', 'zoomout', 'stop'];
  const ptzHandler = (fn) => async (req, res) => {
    const { op, speed } = req.body || {};
    if (!PTZ_OPS.includes(op)) {
      return res.status(400).json({ success: false, error: `op must be one of ${PTZ_OPS.join('/')}` });
    }
    try {
      await fn(req.params.idx, op, speed);
      res.json({ success: true });
    } catch (err) {
      res.status(502).json({ success: false, error: err.message });
    }
  };

  router.post('/reolink/ptz/:idx', requireAdmin, ptzHandler((idx, op, speed) => {
    if (!reolink) throw new Error('Reolink unavailable');
    return reolink.ptz(idx, op, speed);
  }));

  router.post('/kenik/ptz/:idx', requireAdmin, ptzHandler((idx, op, speed) => {
    if (!kenik) throw new Error('KENIK unavailable');
    return kenik.ptz(idx, op, speed);
  }));

  router.post('/axis/ptz/:idx', requireAdmin, ptzHandler((idx, op, speed) => {
    if (!axis) throw new Error('Axis unavailable');
    return axis.ptz(idx, op, speed);
  }));

  // Manual `cameras` entries with an `onvif: { host, port, username, password }` section
  router.post('/camera/ptz/:idx', requireAdmin, ptzHandler((idx, op, speed) => {
    const cam = (readConfigFile().cameras || [])[Number(idx)];
    if (!cam?.onvif?.host) throw new Error('Camera has no ONVIF config');
    return require('./onvif-ptz').ptz(cam.onvif, op, speed);
  }));

  // Manual `cameras` entries with an `onvif` section — shared by the preset
  // and IR routes below.
  const onvifCfgFor = (idx) => {
    const cam = (readConfigFile().cameras || [])[Number(idx)];
    if (!cam?.onvif?.host) throw new Error('Camera has no ONVIF config');
    return cam.onvif;
  };

  // ── PTZ presets ───────────────────────────────────────────
  // Shape varies genuinely by vendor (Reolink's CGI API has no documented
  // "save preset" call — presets are created on-camera via the Reolink app
  // and only listed/goto'd here; Axis and ONVIF support the full
  // list/save/goto/remove set), so each backend registers only the routes
  // it can actually back:
  //   GET    /api/<backend>/preset/:idx            → [{id, name}], `writable`
  //   POST   /api/<backend>/preset/:idx             {name?} → save current position
  //   POST   /api/<backend>/preset/:idx/:id/goto    → move to preset
  //   DELETE /api/<backend>/preset/:idx/:id         → remove preset
  function registerPresetRoutes(prefix, backend) {
    router.get(`/${prefix}/preset/:idx`, async (req, res) => {
      try { res.json({ success: true, data: await backend.list(req.params.idx), writable: !!backend.save }); }
      catch (err) { res.status(502).json({ success: false, error: err.message }); }
    });
    router.post(`/${prefix}/preset/:idx/:id/goto`, requireAdmin, async (req, res) => {
      try { await backend.goto(req.params.idx, req.params.id); res.json({ success: true }); }
      catch (err) { res.status(502).json({ success: false, error: err.message }); }
    });
    if (backend.save) {
      router.post(`/${prefix}/preset/:idx`, requireAdmin, async (req, res) => {
        try { res.json({ success: true, data: await backend.save(req.params.idx, (req.body || {}).name) }); }
        catch (err) { res.status(502).json({ success: false, error: err.message }); }
      });
    }
    if (backend.remove) {
      router.delete(`/${prefix}/preset/:idx/:id`, requireAdmin, async (req, res) => {
        try { await backend.remove(req.params.idx, req.params.id); res.json({ success: true }); }
        catch (err) { res.status(502).json({ success: false, error: err.message }); }
      });
    }
  }

  registerPresetRoutes('reolink', {
    list: (idx) => { if (!reolink) throw new Error('Reolink unavailable'); return reolink.listPresets(idx); },
    goto: (idx, id) => { if (!reolink) throw new Error('Reolink unavailable'); return reolink.gotoPreset(idx, id); },
  });
  registerPresetRoutes('kenik', {
    list:   (idx) => { if (!kenik) throw new Error('KENIK unavailable'); return kenik.listPresets(idx); },
    goto:   (idx, id) => { if (!kenik) throw new Error('KENIK unavailable'); return kenik.gotoPreset(idx, id); },
    save:   (idx, name) => { if (!kenik) throw new Error('KENIK unavailable'); return kenik.savePreset(idx, name); },
    remove: (idx, id) => { if (!kenik) throw new Error('KENIK unavailable'); return kenik.removePreset(idx, id); },
  });
  registerPresetRoutes('axis', {
    list:   (idx) => { if (!axis) throw new Error('Axis unavailable'); return axis.listPresets(idx); },
    goto:   (idx, id) => { if (!axis) throw new Error('Axis unavailable'); return axis.gotoPreset(idx, id); },
    save:   (idx, name) => { if (!axis) throw new Error('Axis unavailable'); return axis.savePreset(idx, name); },
    remove: (idx, id) => { if (!axis) throw new Error('Axis unavailable'); return axis.removePreset(idx, id); },
  });
  registerPresetRoutes('camera', {
    list:   (idx) => require('./onvif-ptz').listPresets(onvifCfgFor(idx)),
    goto:   (idx, id) => require('./onvif-ptz').gotoPreset(onvifCfgFor(idx), id),
    save:   (idx, name) => require('./onvif-ptz').setPreset(onvifCfgFor(idx), name),
    remove: (idx, id) => require('./onvif-ptz').removePreset(onvifCfgFor(idx), id),
  });

  // ── Patrol (Reolink only — the only backend with a documented start/stop
  // call; best-effort, reported unreliable on some models/firmware) ───────
  router.post('/reolink/patrol/:idx', requireAdmin, async (req, res) => {
    if (!reolink) return res.status(503).json({ success: false, error: 'Reolink unavailable' });
    const { action, id } = req.body || {};
    if (!['start', 'stop'].includes(action)) {
      return res.status(400).json({ success: false, error: "action must be 'start' or 'stop'" });
    }
    try {
      await (action === 'start' ? reolink.startPatrol(req.params.idx, id) : reolink.stopPatrol(req.params.idx));
      res.json({ success: true });
    } catch (err) {
      res.status(502).json({ success: false, error: err.message });
    }
  });

  // ── Siren + floodlight (Reolink only) ────────────────────
  router.post('/reolink/siren/:idx', requireAdmin, async (req, res) => {
    if (!reolink) return res.status(503).json({ success: false, error: 'Reolink unavailable' });
    try { await reolink.triggerSiren(req.params.idx, (req.body || {}).times); res.json({ success: true }); }
    catch (err) { res.status(502).json({ success: false, error: err.message }); }
  });

  router.get('/reolink/floodlight/:idx', async (req, res) => {
    if (!reolink) return res.status(503).json({ success: false, error: 'Reolink unavailable' });
    try { res.json({ success: true, data: await reolink.getFloodlight(req.params.idx) }); }
    catch (err) { res.status(502).json({ success: false, error: err.message }); }
  });

  router.post('/reolink/floodlight/:idx', requireAdmin, async (req, res) => {
    if (!reolink) return res.status(503).json({ success: false, error: 'Reolink unavailable' });
    const { on } = req.body || {};
    if (typeof on !== 'boolean') return res.status(400).json({ success: false, error: 'Body must include on: true|false' });
    try { await reolink.setFloodlight(req.params.idx, on); res.json({ success: true }); }
    catch (err) { res.status(502).json({ success: false, error: err.message }); }
  });

  // ── IR / night-mode toggle — GET current mode, POST {mode: 'on'|'off'|'auto'}
  const irHandler = (getFn, setFn) => ({
    get: async (req, res) => {
      try { res.json({ success: true, data: await getFn(req.params.idx) }); }
      catch (err) { res.status(502).json({ success: false, error: err.message }); }
    },
    post: async (req, res) => {
      const { mode } = req.body || {};
      if (!['on', 'off', 'auto'].includes(mode)) {
        return res.status(400).json({ success: false, error: "mode must be 'on', 'off', or 'auto'" });
      }
      try { await setFn(req.params.idx, mode); res.json({ success: true }); }
      catch (err) { res.status(502).json({ success: false, error: err.message }); }
    },
  });

  {
    const h = irHandler(
      (idx) => { if (!reolink) throw new Error('Reolink unavailable'); return reolink.getIr(idx); },
      (idx, mode) => { if (!reolink) throw new Error('Reolink unavailable'); return reolink.setIr(idx, mode); },
    );
    router.get('/reolink/ir/:idx', h.get);
    router.post('/reolink/ir/:idx', requireAdmin, h.post);
  }
  {
    const h = irHandler(
      (idx) => { if (!kenik) throw new Error('KENIK unavailable'); return kenik.getIr(idx); },
      (idx, mode) => { if (!kenik) throw new Error('KENIK unavailable'); return kenik.setIr(idx, mode); },
    );
    router.get('/kenik/ir/:idx', h.get);
    router.post('/kenik/ir/:idx', requireAdmin, h.post);
  }
  {
    const h = irHandler(
      (idx) => { if (!axis) throw new Error('Axis unavailable'); return axis.getIr(idx); },
      (idx, mode) => { if (!axis) throw new Error('Axis unavailable'); return axis.setIr(idx, mode); },
    );
    router.get('/axis/ir/:idx', h.get);
    router.post('/axis/ir/:idx', requireAdmin, h.post);
  }
  {
    const onvifImaging = () => require('./onvif-imaging');
    const h = irHandler(
      (idx) => onvifImaging().getIr(onvifCfgFor(idx)),
      (idx, mode) => onvifImaging().setIr(onvifCfgFor(idx), mode),
    );
    router.get('/camera/ir/:idx', h.get);
    router.post('/camera/ir/:idx', requireAdmin, h.post);
  }

  // WS-Discovery scan for ONVIF cameras on the LAN — used by the Settings
  // "Discover" button so the user doesn't need to already know camera IPs.
  router.get('/onvif/discover', async (req, res) => {
    try {
      const devices = await require('./onvif-discovery').discover();
      res.json({ success: true, data: devices });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Given ONVIF credentials (from discovery or typed in by hand), fetch the
  // camera's real RTSP/snapshot URIs — the Settings "Fetch via ONVIF" button.
  router.post('/onvif/probe', requireAdmin, async (req, res) => {
    const { host, port, username, password } = req.body || {};
    if (!host) return res.status(400).json({ success: false, error: 'host is required' });
    try {
      const result = await require('./onvif-media').probe({ host, port: Number(port) || 80, username, password });
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Manual `cameras` entries with only an RTSP `url` (no vendor snapshot API,
  // e.g. WHEP-only sources) — one JPEG frame via ffmpeg, cached 10 s.
  router.get('/camera/snapshot/:idx', (req, res) => {
    const idx = Number(req.params.idx);
    const cam = (readConfigFile().cameras || [])[idx];
    if (!cam?.url) return res.status(404).end();

    const cached = manualSnapCache.get(idx);
    if (cached && Date.now() - cached.at < 10000) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache');
      return res.end(cached.buffer);
    }

    const ffmpegPath = readConfigFile().ffmpegRtsp?.ffmpegPath || 'ffmpeg';
    require('./rtsp-snapshot').grabFrame(cam.url, ffmpegPath)
      .then((buffer) => {
        manualSnapCache.set(idx, { at: Date.now(), buffer });
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(buffer);
      })
      .catch((err) => {
        console.error(`[Camera] Snapshot failed (${cam.name || cam.url}): ${err.message}`);
        res.status(502).end();
      });
  });

  router.post('/settings/cameras', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const cameras = req.body;
    if (!Array.isArray(cameras)) {
      return res.status(400).json({ success: false, error: 'Body must be an array of cameras' });
    }
    // `onvif` (PTZ + stream/snapshot auto-fetch) comes from the Settings form
    // now, but fall back to whatever's already saved for that index in case
    // it's missing (e.g. a config-file-only entry the form re-saves as-is).
    // Password comes back masked (••••••••) on an untouched resubmit — GET
    // /api/cameras never sends the real one — so preserve the existing value
    // rather than overwriting it with the placeholder.
    const cleaned = cameras.map(({ name, url, snapshotUrl, mjpegUrl, webrtcUrl, twoWayAudio, onvif }, i) => {
      const prevOnvif = current.cameras?.[i]?.onvif;
      const resolvedOnvif = (onvif && typeof onvif === 'object')
        ? { ...onvif, password: (onvif.password && !onvif.password.includes('•')) ? onvif.password : (prevOnvif?.password || '') }
        : prevOnvif;
      return {
        ...(resolvedOnvif ? { onvif: resolvedOnvif } : {}),
        name:        String(name        || '').trim(),
        url:         String(url         || '').trim(),
        snapshotUrl: String(snapshotUrl || '').trim(),
        mjpegUrl:    String(mjpegUrl    || '').trim(),
        webrtcUrl:   String(webrtcUrl   || '').trim(),
        twoWayAudio: !!twoWayAudio,
      };
    }).filter((c) => c.name || c.url);
    try {
      writeConfigFile({ ...current, cameras: cleaned });
      res.json({ success: true, message: 'Cameras saved' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/virtual', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const devices = req.body;
    if (!Array.isArray(devices)) {
      return res.status(400).json({ success: false, error: 'Body must be an array of virtual devices' });
    }
    const cleaned = dedupeVirtualDevices(devices);
    try {
      writeConfigFile({ ...current, virtual: { devices: cleaned } });
      res.json({ success: true, message: `${cleaned.length} virtual device(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Reolink PoE cameras ───────────────────────────────────
  router.post('/settings/reolink', requireAdmin, (req, res) => {
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
      webrtcUrl:  String(c.webrtcUrl || '').trim(),
      ptz:        !!c.ptz,
      ir:         !!c.ir,
      floodlight: !!c.floodlight,
      siren:      !!c.siren,
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
  router.post('/settings/test-reolink', requireAdmin, async (req, res) => {
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

  // ── MOBOTIX ───────────────────────────────────────────────
  router.post('/settings/mobotix', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const cams = req.body?.cameras ?? req.body;
    if (!Array.isArray(cams)) return res.status(400).json({ success: false, error: 'Body must include a cameras array' });
    const prev = current.mobotix?.cameras || [];
    const cleaned = cams.map((c, i) => {
      const out = {
        name:       String(c.name || '').trim(),
        host:       String(c.host || '').trim(),
        username:   String(c.username || '').trim(),
        password:   (c.password && !String(c.password).includes('•')) ? String(c.password) : (prev[i]?.password || ''),
        https:      !!c.https,
        port:       parseInt(c.port) || 0,
        rtspPort:   parseInt(c.rtspPort) || 554,
        streamPath: String(c.streamPath || '').trim() || 'mobotix.mobotix.h264',
        door:       !!c.door,
      };
      if (prev[i]?.outputs) out.outputs = prev[i].outputs; // preserve door/relay outputs (config-only)
      return out;
    }).filter((c) => c.host);
    try {
      writeConfigFile({ ...current, mobotix: { ...current.mobotix, pollInterval: parseInt(req.body?.pollInterval) || current.mobotix?.pollInterval || 30, cameras: cleaned } });
      res.json({ success: true, message: `${cleaned.length} MOBOTIX camera(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-mobotix', requireAdmin, async (req, res) => {
    const cam = req.body || {};
    if (!cam.host) return res.status(400).json({ success: false, error: 'host is required' });
    try {
      const { buffer } = await require('./mobotix-client').fetchSnapshot(cam);
      res.json({ success: true, message: `Snapshot OK — ${(buffer.length / 1024).toFixed(0)} KB` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ── Axis (VAPIX) ──────────────────────────────────────────
  router.post('/settings/axis', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const cams = req.body?.cameras ?? req.body;
    if (!Array.isArray(cams)) return res.status(400).json({ success: false, error: 'Body must include a cameras array' });
    const prev = current.axis?.cameras || [];
    const cleaned = cams.map((c, i) => {
      const out = {
        name:       String(c.name || '').trim(),
        host:       String(c.host || '').trim(),
        username:   String(c.username || '').trim(),
        password:   (c.password && !String(c.password).includes('•')) ? String(c.password) : (prev[i]?.password || ''),
        auth:       c.auth === 'basic' ? 'basic' : 'digest',
        https:      !!c.https,
        port:       parseInt(c.port) || 0,
        rtspPort:   parseInt(c.rtspPort) || 554,
        ptz:        !!c.ptz,
        ir:         !!c.ir,
        resolution: String(c.resolution || '').trim(),
      };
      if (prev[i]?.outputs) out.outputs = prev[i].outputs; // preserve relay outputs (config-only)
      return out;
    }).filter((c) => c.host);
    try {
      writeConfigFile({ ...current, axis: { ...current.axis, pollInterval: parseInt(req.body?.pollInterval) || current.axis?.pollInterval || 30, cameras: cleaned } });
      res.json({ success: true, message: `${cleaned.length} Axis camera(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-axis', requireAdmin, async (req, res) => {
    const cam = req.body || {};
    if (!cam.host) return res.status(400).json({ success: false, error: 'host is required' });
    try {
      const { buffer } = await require('./axis-client').fetchSnapshot(cam);
      res.json({ success: true, message: `Snapshot OK — ${(buffer.length / 1024).toFixed(0)} KB` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ── SolarEdge ─────────────────────────────────────────────

  router.get('/solaredge', (req, res) => {
    res.json({ success: true, data: store.getGrouped().solaredge });
  });

  router.post('/settings/test-solaredge', requireAdmin, async (req, res) => {
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

  router.post('/settings/solaredge', requireAdmin, (req, res) => {
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

  router.post('/settings/test-smartthings', requireAdmin, async (req, res) => {
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

  router.post('/settings/smartthings', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { token, deviceIds, webhookUrl, webhookSecret } = req.body;
    const updated = {
      ...current,
      smartthings: {
        token: (token && !token.includes('•')) ? token : (current.smartthings?.token ?? ''),
        deviceIds: Array.isArray(deviceIds) ? deviceIds : (current.smartthings?.deviceIds ?? []),
        webhookUrl: webhookUrl || (current.smartthings?.webhookUrl ?? ''),
        webhookSecret: (webhookSecret && !webhookSecret.includes('•')) ? webhookSecret : (current.smartthings?.webhookSecret ?? ''),
      },
    };
    try {
      writeConfigFile(updated);
      res.json({ success: true, message: 'SmartThings settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // SmartThings webhook endpoint for real-time state updates. Public (see
  // PUBLIC_API in auth.js) since SmartThings' servers, not a logged-in
  // browser, call it — so it must verify itself instead of relying on the
  // session/token auth every other route gets. A shared secret (set in
  // Settings → SmartThings, and configured as a header/query param on the
  // SmartThings-side HTTP action that calls this URL) is required before any
  // event is trusted; without one, an internet-reachable install would let
  // anyone who finds this URL spoof arbitrary sensor state for real devices.
  router.post('/webhooks/smartthings', (req, res) => {
    const smartThings = clients.smartThings; // see note on the /take route above
    if (!smartThings) return res.status(503).json({ success: false, error: 'SmartThings not configured' });

    const configuredSecret = readConfigFile().smartthings?.webhookSecret || '';
    if (!configuredSecret) {
      console.warn('[SmartThings Webhook] Rejected — no webhookSecret configured (Settings → SmartThings)');
      return res.status(503).json({ success: false, error: 'Webhook secret not configured — set one in Settings → SmartThings' });
    }
    const suppliedSecret = req.headers['x-webhook-secret'] || req.query?.secret || '';
    if (suppliedSecret !== configuredSecret) {
      console.warn(`[SmartThings Webhook] Rejected — bad secret from ${req.ip}`);
      return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
    }

    try {
      smartThings.handleWebhookEvent(req.body);
      res.json({ success: true });
    } catch (err) {
      console.error(`[SmartThings Webhook] Error: ${err.message}`);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // ── Satel ────────────────────────────────────────────────

  router.post('/settings/test-satel', requireAdmin, async (req, res) => {
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

  router.post('/settings/satel', requireAdmin, (req, res) => {
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

  router.post('/settings/test-unifi', requireAdmin, async (req, res) => {
    const https = require('https');
    const { host, username, password, apiKey } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'Host is required' });
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['X-API-Key'] = apiKey;
      const p = new Promise((resolve, reject) => {
        const body = JSON.stringify({ username, password });
        const r = https.request({
          hostname: host, path: apiKey ? '/proxy/protect/integration/v1/meta/info' : '/api/auth/login',
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

  router.post('/settings/unifi', requireAdmin, (req, res) => {
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
  router.post('/settings/test-vrm', requireAdmin, async (req, res) => {
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

  router.post('/settings/test-vrm-live', requireAdmin, async (req, res) => {
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

  router.post('/settings/vrm', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { email, password, apiToken, installationId } = req.body;
    const updated = {
      ...current,
      vrm: {
        ...current.vrm,
        apiToken: (apiToken && !apiToken.includes('•')) ? apiToken : (current.vrm?.apiToken ?? ''),
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
  router.get('/settings/export', requireAdmin, (req, res) => {
    const cfg = readConfigFile();
    const filename = `victron-config-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(cfg, null, 2));
  });

  router.post('/settings/import', requireAdmin, (req, res) => {
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

  // ── UI preferences ───────────────────────────────────────
  // Lightweight read for the shared header (common.js) to hide nav links.
  // Also carries the app version — read once at module load (a restart is
  // already required to pick up a new package.json anyway) rather than
  // hitting the filesystem on every request.
  const { version: appVersion } = require('../package.json');
  router.get('/ui-prefs', (req, res) => {
    const cfg = readConfigFile();
    res.json({ success: true, data: {
      hideMqtt: !!cfg.ui?.hideMqtt,
      hideLogs: !!cfg.ui?.hideLogs,
      hideCssEditor: !!cfg.ui?.hideCssEditor,
      version: appVersion,
    } });
  });

  router.post('/settings/ui', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { hideMqtt, hideLogs, hideCssEditor, customCss } = req.body;
    try {
      writeConfigFile({
        ...current,
        ui: {
          ...current.ui,
          hideMqtt: !!hideMqtt,
          hideLogs: !!hideLogs,
          hideCssEditor: !!hideCssEditor,
          ...(customCss !== undefined ? { customCss: String(customCss) } : {}),
        },
      });
      res.json({ success: true, message: 'Interface settings saved.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Custom CSS themes ────────────────────────────────────
  // "Built-in" themes ship with the app (react-dashboard/public/css-themes/
  // — bundled into dist/ by Vite, read-only from here); "custom" ones are
  // whatever an admin has saved from the CSS editor's Themes row, living in
  // persist/css-themes/ like every other user-generated file (plan-decor
  // images, flow snapshots, …). Loading a theme just copies its text into
  // the live Custom CSS field client-side — these routes never touch
  // ui.customCss themselves.
  const BUILTIN_THEME_DIR = path.join(__dirname, '..', 'react-dashboard', 'public', 'css-themes');
  const CUSTOM_THEME_DIR = path.join(__dirname, '..', 'persist', 'css-themes');

  // Same sanitization as plan-decor uploads above — keeps the filename
  // confined to its directory (no `..`, no path separators) regardless of
  // what a client sends.
  function sanitizeThemeName(raw) {
    return String(raw || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }
  function listCssThemes(dir) {
    try {
      return fs.readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => f.slice(0, -4)).sort();
    } catch {
      return [];
    }
  }

  router.get('/settings/css-themes', (req, res) => {
    res.json({ success: true, data: {
      builtin: listCssThemes(BUILTIN_THEME_DIR),
      custom: listCssThemes(CUSTOM_THEME_DIR),
    } });
  });

  router.get('/settings/css-themes/:kind/:name', (req, res) => {
    const dir = req.params.kind === 'builtin' ? BUILTIN_THEME_DIR
      : req.params.kind === 'custom' ? CUSTOM_THEME_DIR : null;
    const name = sanitizeThemeName(req.params.name);
    if (!dir || !name) return res.status(400).json({ success: false, error: 'kind must be builtin or custom, name required' });
    try {
      const css = fs.readFileSync(path.join(dir, `${name}.css`), 'utf8');
      res.json({ success: true, data: { css } });
    } catch {
      res.status(404).json({ success: false, error: 'Theme not found' });
    }
  });

  router.post('/settings/css-themes/custom/:name', requireAdmin, (req, res) => {
    const name = sanitizeThemeName(req.params.name);
    if (!name) return res.status(400).json({ success: false, error: 'Invalid theme name' });
    const css = String((req.body || {}).css ?? '');
    if (css.length > 200 * 1024) return res.status(400).json({ success: false, error: 'CSS too large (max 200 KB)' });
    fs.mkdirSync(CUSTOM_THEME_DIR, { recursive: true });
    fs.writeFileSync(path.join(CUSTOM_THEME_DIR, `${name}.css`), css);
    res.json({ success: true, data: { name } });
  });

  router.delete('/settings/css-themes/custom/:name', requireAdmin, (req, res) => {
    const name = sanitizeThemeName(req.params.name);
    if (!name) return res.status(400).json({ success: false, error: 'Invalid theme name' });
    try { fs.unlinkSync(path.join(CUSTOM_THEME_DIR, `${name}.css`)); } catch { /* already gone */ }
    res.sendStatus(204);
  });

  // ── Embedded Claude Code chat ────────────────────────────
  // Real code-editing agent (see src/claude-code-client.js) — admin-only,
  // 'claudeCode' permission-flag-only (installer-mode-granted, see above),
  // AND local/LAN-only, all three gated below on every route, not just the
  // read ones.
  const claudeCode = require('./claude-code-client');
  const requireLocalAdmin = [requireAdmin, requirePermission('claudeCode'), (req, res, next) => {
    if (!claudeCode.isLocalRequest(req)) {
      return res.status(403).json({ success: false, error: 'Claude Code chat is only reachable from localhost/LAN, not over remote access' });
    }
    next();
  }];

  router.get('/claude-code/status', requireLocalAdmin, (req, res) => {
    const cc = claudeCode.readClaudeCodeConfig();
    res.json({ success: true, data: { enabled: cc.enabled, configured: !!cc.apiKey, model: cc.model } });
  });

  router.get('/claude-code/history', requireLocalAdmin, (req, res) => {
    res.json({ success: true, data: { messages: claudeCode.getHistory() } });
  });

  router.post('/claude-code/message', requireLocalAdmin, async (req, res) => {
    const text = String((req.body || {}).message || '').trim();
    if (!text) return res.status(400).json({ success: false, error: 'message is required' });
    try {
      const result = await claudeCode.sendMessage(text);
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[ClaudeCode] message failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/claude-code/reset', requireLocalAdmin, (req, res) => {
    claudeCode.resetConversation();
    res.sendStatus(204);
  });

  // Note: the public (unauthenticated) GET /custom.css this settings key
  // feeds is registered in server.js, not here — auth.js's middleware never
  // exempts anything under /api/* (by design: dynamic data must stay gated
  // even when a path looks like a static asset), so it has to live outside
  // the /api prefix to actually be reachable pre-login, same as /i18n/*.json
  // vs the gated /api/i18n/*.json.

  // ── Settings ─────────────────────────────────────────────
  router.get('/settings', (req, res) => {
    const cfg = readConfigFile();
    // Strip secrets from response for security
    const safe = JSON.parse(JSON.stringify(cfg));
    if (safe.vrm?.password) safe.vrm.password = '••••••••';
    if (safe.mongo?.uri) safe.mongo.uri = '••••••••'; // may embed credentials
    if (safe.vrm?.apiToken) safe.vrm.apiToken = '••••••••';
    if (safe.solaredge?.apiKey) safe.solaredge.apiKey = '••••••••';
    if (safe.smartthings?.token) safe.smartthings.token = '••••••••';
    if (safe.editPin) safe.editPin = '••••••••';
    if (safe.dashboardPin) safe.dashboardPin = '••••••••';
    if (safe.smartthings?.clientSecret) safe.smartthings.clientSecret = '••••••••';
    if (safe.smartthings?.webhookSecret) safe.smartthings.webhookSecret = '••••••••';
    if (safe.satel?.armCode) safe.satel.armCode = '••••••••';
    if (safe.unifi?.password) safe.unifi.password = '••••••••';
    if (safe.unifi?.apiKey) safe.unifi.apiKey = '••••••••';
    if (safe.googleCalendar?.clientSecret) safe.googleCalendar.clientSecret = '••••••••';
    // Defensive — these integrations have no write route in this file (config.json-only),
    // but redact anyway in case a secret ends up in one of these fields by hand-editing.
    if (safe.unifiAccess?.password) safe.unifiAccess.password = '••••••••';
    if (safe.unifiAccess?.apiKey) safe.unifiAccess.apiKey = '••••••••';
    if (safe.aqara?.token) safe.aqara.token = '••••••••';
    if (safe.ampio?.password) safe.ampio.password = '••••••••';
    if (safe.smarttub?.password) safe.smarttub.password = '••••••••';
    if (safe.zway?.password) safe.zway.password = '••••••••';
    if (safe.wirenboard?.password) safe.wirenboard.password = '••••••••';
    if (safe.kenik?.password) safe.kenik.password = '••••••••';
    if (safe.loxone?.password)  safe.loxone.password  = '••••••••';
    if (safe.dirigera?.token)   safe.dirigera.token   = '••••••••';
    if (safe.tradfri?.psk)      safe.tradfri.psk      = '••••••••';
    if (safe.sip?.password)     safe.sip.password     = '••••••••';
    if (safe.tradfri?.securityCode) safe.tradfri.securityCode = '••••••••';
    if (safe.homey?.token)          safe.homey.token          = '••••••••';
    if (safe.homeConnect?.clientSecret) safe.homeConnect.clientSecret = '••••••••';
    if (safe.miele?.clientSecret)   safe.miele.clientSecret   = '••••••••';
    if (safe.miele?.password)       safe.miele.password       = '••••••••';
    if (safe.fibaro?.password)      safe.fibaro.password      = '••••••••';
    if (safe.bayrol?.password)      safe.bayrol.password      = '••••••••';
    if (safe.somfy?.password)       safe.somfy.password       = '••••••••';
    if (safe.vicare?.password)      safe.vicare.password      = '••••••••';
    if (safe.thermomix?.password)   safe.thermomix.password   = '••••••••';
    if (safe.grenton?.token)        safe.grenton.token        = '••••••••';
    if (safe.suppla?.token)         safe.suppla.token         = '••••••••';
    if (Array.isArray(safe.reolink?.cameras)) safe.reolink.cameras.forEach((c) => { if (c.password) c.password = '••••••••'; });
    if (Array.isArray(safe.mobotix?.cameras)) safe.mobotix.cameras.forEach((c) => { if (c.password) c.password = '••••••••'; });
    if (Array.isArray(safe.axis?.cameras)) safe.axis.cameras.forEach((c) => { if (c.password) c.password = '••••••••'; });
    if (Array.isArray(safe.cameras)) safe.cameras.forEach((c) => { if (c.onvif?.password) c.onvif.password = '••••••••'; });
    if (safe.somfy?.token)          safe.somfy.token          = '••••••••';
    if (safe.loxoneOut?.password)   safe.loxoneOut.password   = '••••••••';
    if (safe.fibaroOut?.password)   safe.fibaroOut.password   = '••••••••';
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
    if (safe.karcher?.password) safe.karcher.password = '••••••••';
    if (safe.landroid?.password) safe.landroid.password = '••••••••';
    if (safe.sony?.psk) safe.sony.psk = '••••••••';
    if (safe.openweather?.apiKey) safe.openweather.apiKey = '••••••••';
    if (safe.airly?.apiKey) safe.airly.apiKey = '••••••••';
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

  router.post('/settings', requireAdmin, (req, res) => {
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

  router.post('/settings/test-mqtt', requireAdmin, async (req, res) => {
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

  // ── MongoDB ────────────────────────────────────────────────────────────

  router.post('/settings/mongo', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { uri, db } = req.body;
    // masked (dots) means "keep the stored URI"; empty means disable Mongo
    const keepUri = (uri && !uri.includes('•')) ? uri.trim() : (current.mongo?.uri || '');
    try {
      const next = { ...current };
      if (keepUri) next.mongo = { ...current.mongo, uri: keepUri, db: (db || current.mongo?.db || 'lsh').trim() };
      else delete next.mongo;
      writeConfigFile(next);
      res.json({ success: true, message: 'MongoDB settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-mongo', requireAdmin, async (req, res) => {
    let { uri, db } = req.body;
    if (!uri || uri.includes('•')) uri = readConfigFile().mongo?.uri || '';
    if (!uri) return res.status(400).json({ success: false, error: 'Connection URI is required' });

    let MongoClient;
    try { ({ MongoClient } = require('mongodb')); }
    catch { return res.json({ success: false, error: 'mongodb package not installed — run npm install' }); }

    const client = new MongoClient(uri.trim(), { serverSelectionTimeoutMS: 5000 });
    try {
      await client.connect();
      await client.db((db || 'lsh').trim()).command({ ping: 1 });
      res.json({ success: true, message: `Connected to "${(db || 'lsh').trim()}"` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    } finally {
      try { await client.close(); } catch {}
    }
  });

  // ── Dreame ─────────────────────────────────────────────────────────────

  router.post('/settings/test-dreame', requireAdmin, async (req, res) => {
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

  router.post('/settings/dreame', requireAdmin, (req, res) => {
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

  router.post('/settings/mc6', requireAdmin, (req, res) => {
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

  // clients.mc6 (not a destructured local) — see the note on the SmartThings
  // sendSmartThingsCommand() helper above for why: the client is registered
  // onto apiClients after createApiRoutes() already ran.
  function mc6Client() {
    const mc6 = clients.mc6;
    if (!mc6) throw new Error('MC6 not configured');
    return mc6;
  }

  const normalizeMac = mac => (mac || '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase();

  router.get('/mc6/:mac/schedule', (req, res) => {
    try {
      res.json({ success: true, data: mc6Client().listSchedules(normalizeMac(req.params.mac)) });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/mc6/:mac/timer', requireAdmin, (req, res) => {
    const { minutes, action } = req.body;
    try {
      const data = mc6Client().setCountdownTimer(normalizeMac(req.params.mac), parseFloat(minutes), action || 'off');
      res.json({ success: true, data });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/mc6/:mac/timer', requireAdmin, (req, res) => {
    try {
      mc6Client().clearCountdownTimer(normalizeMac(req.params.mac));
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/mc6/:mac/schedule', requireAdmin, (req, res) => {
    const { time, action, days, enabled } = req.body;
    try {
      const entry = mc6Client().addDailySchedule(normalizeMac(req.params.mac), { time, action, days, enabled });
      res.json({ success: true, data: entry });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/mc6/:mac/schedule/:id', requireAdmin, (req, res) => {
    try {
      const removed = mc6Client().removeDailySchedule(normalizeMac(req.params.mac), req.params.id);
      if (!removed) return res.status(404).json({ success: false, error: 'Schedule entry not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

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
    try { karcher = require('./karcher-client'); }
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
    try { ({ testLogin } = require('./landroid-client')); }
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
    // Prefer the dedicated up/down sensors (real RTS up()/down() commands);
    // fall back to the open/close toggle for covers that don't expose them.
    const hasUpDown = (dev.sensors || []).some((s) => s.path === 'up');
    const MAP = {
      open: ['switch', 1], close: ['switch', 0],
      on:   ['switch', 1], off:   ['switch', 0],   // TaHoma lights / on-off modules
      up:   hasUpDown ? ['up', 1]   : ['switch', 1],
      down: hasUpDown ? ['down', 1] : ['switch', 0],
      stop: ['stop', 1], my: ['my', 1],
      position: ['level', value], level: ['level', value], tilt: ['tilt', value],
      brightness: ['level', value],                 // alias for lights
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

  router.post('/settings/test-homey', requireAdmin, async (req, res) => {
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

  router.post('/settings/homeconnect', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { clientId, clientSecret, simulator } = req.body;
    try {
      writeConfigFile({
        ...current,
        homeConnect: {
          ...current.homeConnect,
          clientId:     clientId || current.homeConnect?.clientId || '',
          clientSecret: (clientSecret && !clientSecret.includes('•')) ? clientSecret : (current.homeConnect?.clientSecret || ''),
          simulator:    !!simulator,
        },
      });
      res.json({ success: true, message: 'Home Connect settings saved. Run scripts/homeconnect-auth.js to authorize, then restart.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/miele', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { clientId, clientSecret, username, password, country } = req.body;
    try {
      writeConfigFile({
        ...current,
        miele: {
          ...current.miele,
          clientId:     clientId || current.miele?.clientId || '',
          clientSecret: (clientSecret && !clientSecret.includes('•')) ? clientSecret : (current.miele?.clientSecret || ''),
          username:     username || current.miele?.username || '',
          password:     (password && !password.includes('•')) ? password : (current.miele?.password || ''),
          country:      country || current.miele?.country || 'de-DE',
        },
      });
      res.json({ success: true, message: 'Miele settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── OpenWeatherMap ───────────────────────────────────────────────────────
  router.post('/settings/openweather', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { lat, lon, name, units, pollInterval } = req.body;
    let { apiKey } = req.body;
    if (!apiKey || apiKey.includes('•')) apiKey = current.openweather?.apiKey || '';
    try {
      writeConfigFile({
        ...current,
        openweather: {
          apiKey,
          lat:          lat !== undefined && lat !== '' ? Number(lat) : current.openweather?.lat,
          lon:          lon !== undefined && lon !== '' ? Number(lon) : current.openweather?.lon,
          name:         (name || '').trim(),
          units:        units === 'imperial' ? 'imperial' : 'metric',
          pollInterval: Math.max(parseInt(pollInterval) || 600, 60),
        },
      });
      res.json({ success: true, message: 'OpenWeatherMap settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-openweather', requireAdmin, async (req, res) => {
    const current = readConfigFile();
    let { apiKey, lat, lon, units } = req.body;
    if (!apiKey || apiKey.includes('•')) apiKey = current.openweather?.apiKey || '';
    if (!apiKey) return res.json({ success: false, error: 'API key is required' });
    if (lat === undefined || lat === '') lat = current.openweather?.lat;
    if (lon === undefined || lon === '') lon = current.openweather?.lon;
    if (lat == null || lon == null) return res.json({ success: false, error: 'Latitude and longitude are required' });
    try {
      const u = units === 'imperial' ? 'imperial' : 'metric';
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=${u}&appid=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.json({ success: false, error: data?.message || `HTTP ${response.status}` });
      }
      const temp = data.main?.temp;
      const desc = data.weather?.[0]?.description;
      res.json({
        success: true,
        message: `Connected — ${data.name || `${lat},${lon}`}: ${temp != null ? `${temp}°${u === 'imperial' ? 'F' : 'C'}` : '?'}${desc ? `, ${desc}` : ''}`,
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ── MCP Server ───────────────────────────────────────────────────────────
  router.post('/settings/mcp', requireAdmin, (req, res) => {
    const current = readConfigFile();
    try {
      writeConfigFile({ ...current, mcp: { enabled: !!req.body.enabled } });
      res.json({ success: true, message: 'MCP server settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Airly ────────────────────────────────────────────────────────────────
  router.post('/settings/airly', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { lat, lon, name, pollInterval } = req.body;
    let { apiKey } = req.body;
    if (!apiKey || apiKey.includes('•')) apiKey = current.airly?.apiKey || '';
    try {
      writeConfigFile({
        ...current,
        airly: {
          apiKey,
          lat:          lat !== undefined && lat !== '' ? Number(lat) : current.airly?.lat,
          lon:          lon !== undefined && lon !== '' ? Number(lon) : current.airly?.lon,
          name:         (name || '').trim(),
          pollInterval: Math.max(parseInt(pollInterval) || 900, 300),
        },
      });
      res.json({ success: true, message: 'Airly settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-airly', requireAdmin, async (req, res) => {
    const current = readConfigFile();
    let { apiKey, lat, lon } = req.body;
    if (!apiKey || apiKey.includes('•')) apiKey = current.airly?.apiKey || '';
    if (!apiKey) return res.json({ success: false, error: 'API key is required' });
    if (lat === undefined || lat === '') lat = current.airly?.lat;
    if (lon === undefined || lon === '') lon = current.airly?.lon;
    if (lat == null || lon == null) return res.json({ success: false, error: 'Latitude and longitude are required' });
    try {
      const qs  = `lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lon)}`;
      const url = `https://airapi.airly.eu/v2/measurements/point?${qs}`;
      const response = await fetch(url, { headers: { apikey: apiKey } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.json({ success: false, error: data?.message || `HTTP ${response.status}` });
      }
      const caqi = (data.current?.indexes || []).find((i) => i.name === 'AIRLY_CAQI') || data.current?.indexes?.[0];
      res.json({
        success: true,
        message: `Connected — ${lat},${lon}: ${caqi ? `CAQI ${Math.round(caqi.value)} (${caqi.level})` : 'no current index'}`,
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ── Viessmann ViCare ───────────────────────────────────────────────────────

  router.post('/settings/vicare', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { user, password, clientId, redirectUri, pollInterval } = req.body;
    try {
      writeConfigFile({
        ...current,
        vicare: {
          ...current.vicare,
          user:         user || current.vicare?.user || '',
          password:     (password && !password.includes('•')) ? password : (current.vicare?.password || ''),
          clientId:     clientId || current.vicare?.clientId || '',
          redirectUri:  redirectUri || current.vicare?.redirectUri || 'http://localhost:4200/',
          pollInterval: parseInt(pollInterval) || 120,
        },
      });
      res.json({ success: true, message: 'ViCare settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Thermomix / Cookidoo ────────────────────────────────────
  router.post('/settings/thermomix', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { email, password, country, pollSeconds } = req.body;
    try {
      writeConfigFile({
        ...current,
        thermomix: {
          ...current.thermomix,
          email:       email || current.thermomix?.email || '',
          password:    (password && !password.includes('•')) ? password : (current.thermomix?.password || ''),
          country:     country || current.thermomix?.country || 'pl',
          pollSeconds: parseInt(pollSeconds) || 300,
        },
      });
      res.json({ success: true, message: 'Thermomix settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Dyson (local MQTT; account login happens offline via
  // scripts/dyson-auth.js, not through this route) ────────────
  router.get('/settings/dyson-devices', requireAdmin, (req, res) => {
    const tokensPath = path.join(__dirname, '..', 'persist', 'dyson-tokens.json');
    if (!fs.existsSync(tokensPath)) return res.json({ success: true, devices: [] });
    try {
      const saved = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
      const devices = (saved.devices || []).map((d) => ({ name: d.name, serial: d.serial, productType: d.productType, ip: d.ip || '' }));
      res.json({ success: true, devices });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/dyson', requireAdmin, (req, res) => {
    const current = readConfigFile();
    try {
      writeConfigFile({
        ...current,
        dyson: { ...current.dyson, enabled: !!req.body?.enabled },
      });
      res.json({ success: true, message: 'Dyson settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Grenton (GATE HTTP) ─────────────────────────────────────
  router.post('/settings/grenton', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { host, port, path: gpath, token, pollInterval, devices } = req.body;
    if (!Array.isArray(devices)) return res.status(400).json({ success: false, error: 'devices array is required' });
    // Preserve advanced per-device fields (scale/getIndex/commands) by object
    // name — they're config-only, not exposed in the Settings form.
    const prevByObj = {};
    for (const p of (current.grenton?.devices || [])) if (p.object) prevByObj[p.object] = p;
    const cleaned = devices.map((d) => {
      const out = {
        name:   String(d.name || '').trim(),
        object: String(d.object || '').trim(),
        type:   d.type || 'switch',
      };
      const p = prevByObj[out.object];
      if (p) for (const k of ['scale', 'getIndex', 'commands']) if (p[k] !== undefined) out[k] = p[k];
      return out;
    }).filter((d) => d.object);
    try {
      writeConfigFile({
        ...current,
        grenton: {
          ...current.grenton,
          host:         host || current.grenton?.host || '',
          port:         parseInt(port) || current.grenton?.port || 80,
          path:         gpath || current.grenton?.path || '/lsh',
          token:        (token && !token.includes('•')) ? token : (current.grenton?.token || ''),
          pollInterval: parseInt(pollInterval) || 5,
          devices:      cleaned,
        },
      });
      res.json({ success: true, message: `Grenton saved — ${cleaned.length} device(s). Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── WLED ─────────────────────────────────────────────────────────────────────

  router.post('/settings/wled', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const devs = req.body?.devices ?? req.body;
    if (!Array.isArray(devs)) return res.status(400).json({ success: false, error: 'Body must include a devices array' });
    const cleaned = devs.map((d) => ({
      name: String(d.name || '').trim(),
      host: String(d.host || '').trim(),
      port: parseInt(d.port) || 80,
    })).filter((d) => d.host);
    try {
      writeConfigFile({
        ...current,
        wled: {
          ...current.wled,
          pollInterval: parseInt(req.body?.pollInterval) || current.wled?.pollInterval || 5,
          devices: cleaned,
        },
      });
      res.json({ success: true, message: `${cleaned.length} WLED controller(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-wled', requireAdmin, async (req, res) => {
    const d = req.body || {};
    if (!d.host) return res.status(400).json({ success: false, error: 'host is required' });
    try {
      const j = await require('./wled-client').fetchState(d);
      const info = j.info || {};
      const leds = info.leds?.count;
      res.json({ success: true, message: `${info.name || 'WLED'} — ${leds != null ? leds + ' LEDs' : 'connected'}${info.ver ? ' · v' + info.ver : ''}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/homey', requireAdmin, (req, res) => {
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

  router.post('/settings/test-somfy', requireAdmin, async (req, res) => {
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

  router.post('/settings/somfy', requireAdmin, (req, res) => {
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

  router.post('/settings/test-bayrol', requireAdmin, async (req, res) => {
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

  router.post('/settings/bayrol', requireAdmin, (req, res) => {
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

  router.post('/settings/test-loxone', requireAdmin, async (req, res) => {
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

  router.post('/settings/loxone', requireAdmin, (req, res) => {
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

  router.post('/settings/loxone-out', requireAdmin, (req, res) => {
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

  router.post('/settings/fibaro-out', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { host, port, username, password, mappings } = req.body;
    try {
      writeConfigFile({
        ...current,
        fibaroOut: {
          host:     host     || current.fibaroOut?.host     || '',
          port:     parseInt(port || 80),
          username: username || current.fibaroOut?.username || 'admin',
          password: (password && !password.includes('•')) ? password : (current.fibaroOut?.password || ''),
          mappings: Array.isArray(mappings) ? mappings : (current.fibaroOut?.mappings || []),
        },
      });
      res.json({ success: true, message: 'Fibaro outbound settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-fibaro-out', requireAdmin, async (req, res) => {
    const http = require('http');
    const { host, port, username, password } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'Host is required' });
    // masked password (dots) means "use the stored one"
    const pass = (password && !password.includes('•')) ? password : (readConfigFile().fibaroOut?.password || '');
    const auth = Buffer.from(`${username || 'admin'}:${pass}`).toString('base64');
    try {
      const count = await new Promise((resolve, reject) => {
        const r = http.get({
          hostname: host, port: parseInt(port || 80), path: '/api/globalVariables',
          timeout: 6000, headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
        }, res2 => {
          let d = '';
          res2.on('data', c => d += c);
          res2.on('end', () => {
            if (res2.statusCode !== 200) return reject(new Error(`HTTP ${res2.statusCode}`));
            try { resolve(JSON.parse(d).length); } catch { reject(new Error('Non-JSON response')); }
          });
        });
        r.on('error', reject);
        r.on('timeout', () => { r.destroy(); reject(new Error('Timeout')); });
      });
      res.json({ success: true, message: `Connected — ${count} global variable(s) on the Home Center` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/auxair', requireAdmin, (req, res) => {
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

  router.post('/settings/denon', requireAdmin, (req, res) => {
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

  router.post('/settings/test-denon', requireAdmin, async (req, res) => {
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

  router.post('/settings/sony', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { host, name, maxVolume, pollInterval, inputs } = req.body;
    let { psk } = req.body;
    if (!psk || psk.includes('•')) psk = current.sony?.psk || '';
    try {
      writeConfigFile({
        ...current,
        sony: {
          host:         (host || current.sony?.host || '').trim(),
          psk,
          name:         (name || '').trim(),
          maxVolume:    parseInt(maxVolume || 100),
          pollInterval: parseInt(pollInterval || 10),
          inputs:       (inputs && typeof inputs === 'object') ? inputs : (current.sony?.inputs || {}),
        },
      });
      res.json({ success: true, message: 'Sony TV settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-sony', requireAdmin, async (req, res) => {
    const current = readConfigFile();
    const host = req.body.host || current.sony?.host || '';
    let psk    = req.body.psk;
    if (!psk || psk.includes('•')) psk = current.sony?.psk || '';
    if (!host) return res.json({ success: false, error: 'No host specified' });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`http://${host}/sony/system`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-PSK': psk || '' },
        body: JSON.stringify({ method: 'getPowerStatus', id: 1, params: [], version: '1.0' }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) return res.json({ success: false, error: `HTTP ${response.status}` });
      const json = await response.json();
      if (json.error) return res.json({ success: false, error: json.error[1] || `Error ${json.error[0]}` });
      const status = json.result?.[0]?.status || 'unknown';
      res.json({ success: true, message: `Connected — TV is ${status}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/sonos', requireAdmin, (req, res) => {
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

  router.post('/settings/test-boneio', requireAdmin, async (req, res) => {
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

  router.post('/settings/boneio', requireAdmin, (req, res) => {
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

  router.post('/settings/sip', requireAdmin, (req, res) => {
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

  // The SmartThings client (server.js) writes its current OAuth bearer token
  // here every 24h — the Aeotec 360 is a SmartThings cloud device (no local
  // RTSP), so this is the token needed for direct SmartThings API calls.
  router.get('/settings/smartthings-token', requireAdmin, (req, res) => {
    const tokFile = path.join(__dirname, '..', 'persist', 'smartthings-token-latest.txt');
    try {
      const [token, deliveredLine] = fs.readFileSync(tokFile, 'utf8').trim().split('\n');
      const deliveredAt = deliveredLine?.replace('delivered_at:', '').trim() || null;
      res.json({ success: true, token, deliveredAt });
    } catch {
      res.json({ success: false, error: 'No token delivered yet — restart LSH with SmartThings OAuth configured' });
    }
  });

  router.post('/settings/test-aeotec', requireAdmin, async (req, res) => {
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

  router.post('/settings/scan-snapshot', requireAdmin, async (req, res) => {
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

  router.post('/settings/test-dirigera', requireAdmin, async (req, res) => {
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

  router.post('/settings/dirigera', requireAdmin, (req, res) => {
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

  router.post('/settings/sip', requireAdmin, (req, res) => {
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

  router.post('/settings/paging', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { enabled, rooms } = req.body;
    try {
      const paging = { ...current.paging };
      if (enabled !== undefined) paging.enabled = !!enabled;
      if (Array.isArray(rooms)) {
        paging.rooms = rooms
          .filter((r) => r && r.id)
          .map((r) => ({ id: String(r.id).trim(), label: String(r.label || r.id).trim() }));
      }
      writeConfigFile({ ...current, paging });
      res.json({ success: true, message: 'Paging settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/tradfri', requireAdmin, (req, res) => {
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

  router.post('/settings/test-shelly', requireAdmin, async (req, res) => {
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

  router.post('/settings/shelly', requireAdmin, (req, res) => {
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

  router.post('/settings/test-waveshare', requireAdmin, async (req, res) => {
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

  router.post('/settings/waveshare', requireAdmin, (req, res) => {
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

  router.post('/broadlink/learn/ir', requireAdmin, async (req, res) => {
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

  router.post('/broadlink/learn/rf', requireAdmin, async (req, res) => {
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

  router.post('/broadlink/send', requireAdmin, async (req, res) => {
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

  router.delete('/broadlink/codes', requireAdmin, (req, res) => {
    const bl = clients.broadlink;
    if (!bl) return res.status(503).json({ success: false, error: 'BroadLink not configured' });
    const { host, name } = req.body;
    if (!host || !name) return res.status(400).json({ success: false, error: 'host and name required' });
    bl.deleteCode(host, name);
    res.json({ success: true });
  });

  router.post('/settings/test-broadlink', requireAdmin, (req, res) => {
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

  router.post('/settings/broadlink', requireAdmin, (req, res) => {
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

  router.post('/settings/test-esphome', requireAdmin, async (req, res) => {
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

  router.post('/settings/esphome', requireAdmin, (req, res) => {
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
  router.post('/settings/lgthinq-login', requireAdmin, async (req, res) => {
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

  router.post('/settings/test-lgthinq', requireAdmin, async (req, res) => {
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

  router.post('/settings/lgthinq', requireAdmin, (req, res) => {
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

  router.post('/settings/test-fibaro', requireAdmin, async (req, res) => {
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

  router.post('/settings/fibaro', requireAdmin, (req, res) => {
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

  router.post('/settings/test-smartbob', requireAdmin, (req, res) => {
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

  router.post('/settings/smartbob', requireAdmin, (req, res) => {
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

  router.post('/settings/arduino', requireAdmin, (req, res) => {
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

  router.post('/settings/test-suppla', requireAdmin, async (req, res) => {
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

  router.post('/settings/suppla', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { token, server, pollInterval } = req.body;
    try {
      writeConfigFile({
        ...current,
        suppla: {
          token:        (token && !token.includes('•')) ? token.trim() : (current.suppla?.token || ''),
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

  router.post('/settings/test-knx', requireAdmin, (req, res) => {
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

  router.post('/settings/knx', requireAdmin, (req, res) => {
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

  // ── Domatiq CAN bus ──────────────────────────────────────────────────────

  router.post('/settings/test-domatiq', requireAdmin, (req, res) => {
    const { host, port = 10001 } = req.body;
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

  router.post('/settings/domatiq', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { host, port, modules } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });
    const sanitized = (modules || []).map(m => ({
      addr:  parseInt(m.addr),
      label: (m.label || '').trim() || undefined,
    })).filter(m => Number.isFinite(m.addr) && m.addr >= 0 && m.addr <= 0x1fff);
    try {
      writeConfigFile({ ...current, domatiq: { host: host.trim(), port: parseInt(port) || 10001, modules: sanitized } });
      res.json({ success: true, message: `Domatiq settings saved (${sanitized.length} module label(s)). Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── FFmpeg RTSP proxy ──────────────────────────────────────────────────

  router.get('/rtsp-proxy', (req, res) => {
    if (!ffmpegRtsp) return res.json({ success: true, enabled: false, streams: [] });
    res.json({ success: true, enabled: true, streams: ffmpegRtsp.getStreams() });
  });

  router.post('/settings/ffmpeg-rtsp', requireAdmin, (req, res) => {
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

  router.delete('/logs/:name', requireAdmin, (req, res) => {
    const name = req.params.name.replace(/[^a-z0-9_-]/gi, '');
    logger.clear(name);
    res.json({ success: true });
  });

  router.post('/admin/restart', requireAdmin, (req, res) => {
    res.json({ success: true, message: 'Server restarting…' });
    setTimeout(() => process.exit(0), 300);
  });

  router.post('/admin/reset-config', requireAdmin, (req, res) => {
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

  router.post('/mqtt-explorer/publish', requireAdmin, async (req, res) => {
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

  router.post('/mqtt-explorer/subscribe', requireAdmin, (req, res) => {
    if (!mqttExplorer) return res.status(503).json({ success: false, error: 'MQTT explorer not available' });
    const { pattern } = req.body;
    if (!pattern) return res.status(400).json({ success: false, error: 'pattern required' });
    mqttExplorer.subscribe(pattern);
    res.json({ success: true });
  });

  router.post('/mqtt-explorer/clear', requireAdmin, (req, res) => {
    if (!mqttExplorer) return res.status(503).json({ success: false, error: 'MQTT explorer not available' });
    mqttExplorer.clear();
    res.json({ success: true });
  });

  // ── HTTPS / TLS settings ───────────────────────────────────────────────────

  router.post('/settings/https', requireAdmin, (req, res) => {
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
module.exports.dedupeVirtualDevices = dedupeVirtualDevices;
