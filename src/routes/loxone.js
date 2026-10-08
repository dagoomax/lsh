'use strict';

// Loxone — split out of src/api-routes.js; registered in order by createApiRoutes().
const fs   = require('fs');
const path = require('path');
const http = require('http');
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

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

  router.post('/settings/test-loxone-weather', requireAdmin, async (req, res) => {
    const lat = parseFloat(req.body.lat);
    const lon = parseFloat(req.body.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.json({ success: false, error: 'lat/lon must be numbers' });
    }
    try {
      const r = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&forecast_days=1`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!r.ok) return res.json({ success: false, error: `Open-Meteo returned HTTP ${r.status}` });
      const data = await r.json();
      const temp = data.hourly?.temperature_2m?.[0];
      res.json({ success: true, message: `Reachable — current forecast temperature ${temp}°C` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/loxone-weather', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { port, lat, lon, asl, name, country, timezone } = req.body;
    const c = current.loxoneWeather || {};
    try {
      writeConfigFile({
        ...current,
        loxoneWeather: {
          port:     port != null && port !== '' ? parseInt(port) : (c.port ?? 6066),
          lat:      lat != null && lat !== '' ? Number(lat) : (c.lat ?? 50.2649),
          lon:      lon != null && lon !== '' ? Number(lon) : (c.lon ?? 19.0238),
          asl:      asl != null && asl !== '' ? parseInt(asl) : (c.asl ?? 266),
          name:     name || c.name || '',
          country:  country || c.country || '',
          timezone: timezone || c.timezone || 'UTC',
        },
      });
      res.json({ success: true, message: 'Loxone Weather settings saved. Restart to apply.' });
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

  router.post('/settings/googlehome', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { devices, pollInterval } = req.body;
    try {
      const list = Array.isArray(devices)
        ? devices
            .map(d => (typeof d === 'string'
              ? { host: d.trim() }
              : { host: String(d.host || '').trim(), ...(d.name ? { name: String(d.name).trim() } : {}) }))
            .filter(d => d.host)
        : (current.googlehome?.devices || []);
      writeConfigFile({
        ...current,
        googlehome: {
          devices: list,
          pollInterval: parseInt(pollInterval || 10),
        },
      });
      res.json({ success: true, message: 'Google Home settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
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
    const tokFile = path.join(__dirname, '..', '..', 'persist', 'smartthings-token-latest.txt');
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
};
