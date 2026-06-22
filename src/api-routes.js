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
  const { unifiProtect, mqttExplorer, auth, isSecure } = clients;
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

    res.json({ success: true, data: [...(cfg.cameras || []), ...unifiCams, ...stCams] });
  });

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
    const token = readConfigFile().smartthings?.token;
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
    const { token, deviceIds } = req.body;
    const updated = {
      ...current,
      smartthings: {
        token: (token && !token.includes('•')) ? token : (current.smartthings?.token ?? ''),
        deviceIds: Array.isArray(deviceIds) ? deviceIds : (current.smartthings?.deviceIds ?? []),
      },
    };
    try {
      writeConfigFile(updated);
      res.json({ success: true, message: 'SmartThings settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
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
    const { host, port, armCode, zoneCount, partitions, zoneNames, partitionNames } = req.body;
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
    const required = ['mqtt', 'vrm', 'relays', 'server', 'homekit'];
    const missing = required.filter((k) => !(k in body));
    if (missing.length) {
      return res.status(400).json({
        success: false,
        error: `Invalid config file — missing keys: ${missing.join(', ')}`,
      });
    }
    if (!Array.isArray(body.relays)) {
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
    if (safe.satel?.armCode) safe.satel.armCode = '••••••••';
    if (safe.unifi?.password) safe.unifi.password = '••••••••';
    if (safe.unifi?.apiKey) safe.unifi.apiKey = '••••••••';
    if (safe.loxone?.password)  safe.loxone.password  = '••••••••';
    if (safe.dirigera?.token)   safe.dirigera.token   = '••••••••';
    if (safe.tradfri?.psk)      safe.tradfri.psk      = '••••••••';
    if (safe.sip?.password)     safe.sip.password     = '••••••••';
    if (safe.tradfri?.securityCode) safe.tradfri.securityCode = '••••••••';
    if (safe.homey?.token)          safe.homey.token          = '••••••••';
    if (safe.dreame?.devices) {
      safe.dreame.devices = safe.dreame.devices.map(d =>
        d.token ? { ...d, token: '••••••••' } : d
      );
    }
    if (safe.shelly?.devices) {
      safe.shelly.devices = safe.shelly.devices.map(d =>
        d.password ? { ...d, password: '••••••••' } : d
      );
    }
    delete safe.jwtSecret; // never expose JWT signing secret
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
