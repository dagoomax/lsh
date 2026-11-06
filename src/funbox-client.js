'use strict';

/**
 * Orange Funbox 10 (Sagemcom) home gateway client.
 *
 * Funbox is Orange Poland's rebranded Livebox; the Funbox 10 is a Sagemcom
 * F@st unit. Like every Livebox/Funbox generation it exposes the local
 * "sysbus" API over HTTP at http://<gateway>/ws — a JSON call envelope:
 *
 *   POST /ws
 *   Content-Type: application/x-sah-ws-4-call+json
 *   Authorization: X-Sah-Login            (login) / X-Context on later calls
 *   { "service": "<svc>", "method": "<m>", "parameters": { … } }
 *
 * Auth is a two-step session: createContext with the admin password (the one
 * printed on the router label / set in the Orange UI) returns a contextID +
 * a session cookie, which authenticate every later call.
 *
 * This client is READ-ONLY: WAN link/connection state, public IP, line
 * up/down rates, active-device count, uptime, model and firmware. No reboot
 * or config writes (kept out on purpose — add later behind an explicit
 * command if wanted).
 *
 * ⚠️ NOT verified against a real Funbox 10. The sysbus envelope, the
 * createContext login and the NMC/DeviceInfo/Devices calls are the
 * well-documented Livebox API used by community libraries (e.g.
 * github.com/Beatmaxx/aiosysbus, the Home Assistant "livebox" integration),
 * but the exact field names/units on the Funbox 10 firmware have not been
 * confirmed on hardware. Field access is defensive and a poll throws if the
 * expected data is missing, so a shape mismatch shows as "disconnected"
 * rather than silently reporting nothing.
 */

const PollingClient = require('./polling-client');

const DEFAULT_HOST = '192.168.1.1';
const DEFAULT_USER = 'admin';
const DEFAULT_POLL_SECONDS = 60;
const MIN_POLL_SECONDS = 15;
const SYSBUS_CT = 'application/x-sah-ws-4-call+json';

class FunboxClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'funbox', logTag: 'Funbox' });
    const cfg = config.funbox || {};
    this._store = store;
    this._registry = sensorRegistry;
    this._host = String(cfg.host || DEFAULT_HOST).replace(/^https?:\/\//, '').replace(/\/+$/, '');
    this._user = cfg.username || DEFAULT_USER;
    this._password = cfg.password || '';
    this._pollMs = Math.max(MIN_POLL_SECONDS, Number(cfg.pollSeconds) || DEFAULT_POLL_SECONDS) * 1000;
    this._base = `http://${this._host}`;
    this._key = 'funbox/gateway';
    this._contextId = null;
    this._cookie = null;
  }

  async start() {
    if (!this._password) { console.warn('[Funbox] No funbox.password set — not starting'); return; }
    console.warn('[Funbox] ⚠️ Untested against real hardware — reports may be empty until the sysbus field names are confirmed on a Funbox 10.');
    this._registry.registerDevice({
      key: this._key,
      label: 'Funbox 10',
      type: 'gateway',
      category: 'network',
      sensors: [
        { path: 'connection', label: 'Internet', sensorType: 'sensor', type: 'label' },
        { path: 'link', label: 'Line', sensorType: 'sensor', type: 'label' },
        { path: 'wanIp', label: 'Public IP', sensorType: 'sensor', type: 'label' },
        { path: 'down', label: 'Downstream', sensorType: 'sensor', type: 'number', unit: 'Mbps', precision: 1 },
        { path: 'up', label: 'Upstream', sensorType: 'sensor', type: 'number', unit: 'Mbps', precision: 1 },
        { path: 'devices', label: 'Active devices', sensorType: 'sensor', type: 'number' },
        { path: 'uptime', label: 'Uptime', sensorType: 'sensor', type: 'number', unit: 's' },
        { path: 'model', label: 'Model', sensorType: 'sensor', type: 'label' },
        { path: 'firmware', label: 'Firmware', sensorType: 'sensor', type: 'label' },
      ],
    });
    console.log(`[Funbox] Registered ${this._key} (${this._host}), polling every ${this._pollMs / 1000}s`);
    await this.startPolling(this._pollMs);
  }

  stop() { this.stopPolling(); }

  // ── sysbus transport ──────────────────────────────────────────────────────

  async _call(service, method, parameters = {}, isLogin = false) {
    const headers = { 'Content-Type': SYSBUS_CT, Authorization: 'X-Sah-Login' };
    if (!isLogin) {
      if (!this._contextId) throw new Error('no session');
      headers['X-Context'] = this._contextId;
      if (this._cookie) headers.Cookie = this._cookie;
    }
    const res = await fetch(`${this._base}/ws`, {
      method: 'POST', headers,
      body: JSON.stringify({ service, method, parameters }),
      signal: AbortSignal.timeout(10_000),
    });
    if (isLogin) {
      const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
      if (sc.length) this._cookie = sc.map((c) => String(c).split(';')[0]).join('; ');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${service}:${method}`);
    const json = await res.json().catch(() => null);
    if (!json || (json.status !== undefined && json.status !== 0 && !json.data)) {
      throw new Error(`sysbus ${service}:${method} returned status ${json ? json.status : '?'}`);
    }
    return json.data !== undefined ? json.data : json;
  }

  async _login() {
    const data = await this._call('sah.Device.Information', 'createContext', {
      applicationName: 'so_sdkut', username: this._user, password: this._password,
    }, true);
    const ctx = data && (data.contextID || data.contextId);
    if (!ctx) throw new Error('login failed — no contextID (wrong password?)');
    this._contextId = ctx;
  }

  // ── poll ────────────────────────────────────────────────────────────────

  async _pollImpl() {
    if (!this._contextId) await this._login();
    let wan;
    try {
      wan = await this._call('NMC', 'getWANStatus');
    } catch (err) {
      // session likely expired — re-login once, then retry
      this._contextId = null; this._cookie = null;
      await this._login();
      wan = await this._call('NMC', 'getWANStatus');
    }
    const info = await this._call('DeviceInfo', 'get').catch(() => ({}));
    const devices = await this._activeDeviceCount().catch(() => null);

    const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
    const kbpsToMbps = (v) => { const n = num(v); return n === null ? null : Math.round(n / 100) / 10; };

    const u = this._store.update.bind(this._store);
    u(`${this._key}/connection`, wan.ConnectionState || wan.LinkState || 'unknown');
    u(`${this._key}/link`, wan.LinkState || 'unknown');
    u(`${this._key}/wanIp`, wan.IPAddress || wan.IPv6Address || '—');
    u(`${this._key}/down`, kbpsToMbps(wan.DownstreamCurrRate));
    u(`${this._key}/up`, kbpsToMbps(wan.UpstreamCurrRate));
    if (devices !== null) u(`${this._key}/devices`, devices);
    if (info.UpTime !== undefined) u(`${this._key}/uptime`, num(info.UpTime));
    if (info.ModelName || info.ProductClass) u(`${this._key}/model`, info.ModelName || info.ProductClass);
    if (info.SoftwareVersion) u(`${this._key}/firmware`, info.SoftwareVersion);

    // A poll that produced no WAN state at all is a failure (wrong API shape).
    if (!wan.ConnectionState && !wan.LinkState) throw new Error('no WAN status in response');
  }

  async _activeDeviceCount() {
    const data = await this._call('Devices', 'get', { expression: { ACTIVE: '.Active==true' } });
    const list = Array.isArray(data) ? data : (Array.isArray(data?.status) ? data.status : []);
    // Count real, currently-active hosts (ignore the gateway's own interfaces).
    return list.filter((d) => d && d.Active === true && d.Key && (d.IPAddress || d.PhysAddress)).length;
  }
}

module.exports = FunboxClient;
