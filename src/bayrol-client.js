'use strict';

const https          = require('https');
const mqtt           = require('mqtt');
const platformStatus = require('./platform-status');

const BASE_HOST = 'www.bayrol-poolaccess.de';

// MQTT value UIDs
const UID_STATUS = '1';
const UID_PH     = '4.78';
const UID_ORP    = '4.82';
const UID_TEMP   = '4.98';
const UID_SALT   = '4.100';
const VALUE_UIDS = [UID_STATUS, UID_PH, UID_ORP, UID_TEMP, UID_SALT];

class BayrolClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._session  = null;
    this._clients  = []; // mqtt clients, one per pool
  }

  async start() {
    const cfg = this._config.bayrol;
    if (!cfg?.username || !cfg?.password) return;

    console.log('[Bayrol] Starting…');
    await this._login(cfg.username, cfg.password);

    let pools = cfg.pools?.filter(p => p.cid) || [];
    if (!pools.length) pools = await this._discoverPools(cfg.poolName);

    for (const pool of pools) {
      try {
        await this._connectPool(pool);
      } catch (err) {
        console.error(`[Bayrol] Pool ${pool.name || pool.cid} error: ${err.message}`);
      }
    }

    platformStatus.set('bayrol', true);
  }

  stop() {
    for (const c of this._clients) c.end(true);
    this._clients = [];
  }

  // ── HTTP login ─────────────────────────────────────────────────────────────

  async _login(username, password) {
    // GET login page → initial PHPSESSID
    await this._httpGet('/webview/p/login.php?r=reg');
    // POST credentials
    const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&login=Anmelden`;
    await this._httpPost('/webview/p/login.php?r=reg', body);
    console.log('[Bayrol] Login complete');
  }

  // ── Pool discovery ─────────────────────────────────────────────────────────

  async _discoverPools(poolName) {
    const { body } = await this._httpGet('/webview/p/plants.php');
    // JS array: var clients = [19048, 12345];
    const arrMatch = body.match(/var\s+clients\s*=\s*\[([^\]]+)\]/);
    const cids = arrMatch
      ? arrMatch[1].split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s))
      : [...new Set([...body.matchAll(/[?&]c=(\d+)/g)].map(m => m[1]))];
    console.log(`[Bayrol] Discovered CIDs: ${cids.join(', ') || '(none)'}`);
    return cids.map((cid, i) => ({
      cid,
      name: (cids.length === 1 && poolName) ? poolName : (poolName ? `${poolName} ${i + 1}` : `Pool ${cid}`),
    }));
  }

  // ── Per-pool MQTT setup ────────────────────────────────────────────────────

  async _connectPool(pool) {
    const { cid, name } = pool;

    // GET device page → extract code from iframe src
    const { body: deviceHtml } = await this._httpGet(`/webview/p/device.php?c=${cid}`);
    const codeMatch = deviceHtml.match(/index\.html\?code=([^&"]+)&/);
    if (!codeMatch) throw new Error(`Code not found in device page (cid=${cid})`);

    // Exchange code for MQTT credentials
    const { body: tokenBody } = await this._httpGet(`/api/?code=${encodeURIComponent(codeMatch[1])}`);
    let token;
    try { token = JSON.parse(tokenBody); } catch { throw new Error(`Bad token JSON (cid=${cid}): ${tokenBody.slice(0, 80)}`); }

    const { accessToken, deviceSerial } = token;
    if (!accessToken || !deviceSerial) throw new Error(`Incomplete token (cid=${cid}): ${tokenBody}`);

    console.log(`[Bayrol] ${name} serial=${deviceSerial} — connecting MQTT`);

    const deviceKey = `bayrol/${cid}`;
    this._registry.registerDevice({
      key:     deviceKey,
      label:   name,
      type:    'bayrol',
      homekit: ['temperature'],
      sensors: [
        { path: 'ph',          label: 'pH',          unit: 'pH',  precision: 1 },
        { path: 'orp',         label: 'ORP',         unit: 'mV',  precision: 0 },
        { path: 'temperature', label: 'Temperature', unit: '°C',  precision: 1, homekit: 'temperature' },
        { path: 'salt',        label: 'Salt',        unit: 'g/L', precision: 1 },
      ],
    });

    this._startMqtt(deviceKey, name, accessToken, deviceSerial);
  }

  _startMqtt(deviceKey, name, accessToken, deviceSerial) {
    const prefix = `d02/${deviceSerial}`;

    const client = mqtt.connect('wss://www.bayrol-poolaccess.de:8083', {
      username:        accessToken,
      password:        '*',
      reconnectPeriod: 30_000,
    });
    this._clients.push(client);

    client.on('connect', () => {
      console.log(`[Bayrol] MQTT connected: ${name}`);
      client.subscribe(`${prefix}/v/#`, err => {
        if (err) { console.error(`[Bayrol] Subscribe error: ${err.message}`); return; }
        // Request current values
        for (const uid of VALUE_UIDS) client.publish(`${prefix}/g/${uid}`, '');
      });
    });

    client.on('message', (topic, buf) => {
      try {
        const uid  = topic.split('/').pop();
        const data = JSON.parse(buf.toString());
        const v    = data.v;

        if      (uid === UID_PH)   this._store.update(`${deviceKey}/ph`,          Number(v) / 10);
        else if (uid === UID_ORP)  this._store.update(`${deviceKey}/orp`,         Number(v));
        else if (uid === UID_TEMP) this._store.update(`${deviceKey}/temperature`, Number(v) / 10);
        else if (uid === UID_SALT) this._store.update(`${deviceKey}/salt`,        Number(v) / 10);
        // UID_STATUS ("1"): v is a string like "17.4" — skip for now
      } catch (err) {
        console.error(`[Bayrol] Parse error (${topic}): ${err.message}`);
      }
    });

    client.on('error', err => console.error(`[Bayrol] MQTT error (${name}): ${err.message}`));
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  async _httpGet(path) {
    return this._httpReq('GET', path);
  }

  async _httpPost(path, body) {
    return this._httpReq('POST', path, body);
  }

  _httpReq(method, path, body) {
    return new Promise((resolve, reject) => {
      const headers = {
        'User-Agent': 'LSH-Dashboard/1.0',
        Accept:       'text/html,application/json,*/*',
        ...(this._session ? { Cookie: this._session } : {}),
      };
      if (body) {
        headers['Content-Type']   = 'application/x-www-form-urlencoded';
        headers['Content-Length'] = Buffer.byteLength(body);
      }

      // Wall-clock timeout covers TCP connect + TLS handshake (options.timeout doesn't)
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        req.destroy();
        reject(new Error('HTTP timeout'));
      }, 15_000);

      const req = https.request(
        { hostname: BASE_HOST, port: 443, path, method, headers },
        res => {
          // Capture session cookie
          const cookies = [].concat(res.headers['set-cookie'] || []);
          const sess = cookies.find(c => c.startsWith('PHPSESSID='));
          if (sess) this._session = sess.split(';')[0];

          let data = '';
          res.on('data', d => (data += d));
          res.on('end', () => { done = true; clearTimeout(timer); resolve({ status: res.statusCode, headers: res.headers, body: data }); });
        }
      );
      req.on('error', err => { if (!done) { done = true; clearTimeout(timer); reject(err); } });
      if (body) req.write(body);
      req.end();
    });
  }
}

module.exports = BayrolClient;
