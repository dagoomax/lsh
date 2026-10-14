'use strict';

// Mitsubishi Electric air conditioners (air-to-air, "ATA") through MELCloud —
// the cloud behind the MELCloud app and the MAC-5xx Wi-Fi interfaces. Not an
// official public API (the one the app uses, as in pymelcloud); it can change.
// MELCloud Home (the newer melcloudhome.com service some accounts were moved
// to) is a different API and isn't covered.
//
//   POST /Login/ClientLogin {Email, Password, …}   → LoginData.ContextKey
//   GET  /User/ListDevices                          → buildings → floors / areas → devices,
//        each with its current state in .Device (header X-MitsContextKey)
//   GET  /Device/Get?id&buildingID                  → the full ATA state object
//   POST /Device/SetAta  that object, changed + EffectiveFlags + HasPendingCommand
//        flags: Power 0x1, OperationMode 0x2, SetTemperature 0x4, SetFanSpeed 0x8, VaneVertical 0x10
//
//   OperationMode 1 heat, 2 dry, 3 cool, 7 fan, 8 auto
//   fan 0 auto, 1…NumberOfFanSpeeds · VaneVertical 0 auto, 1–5, 7 swing
//
// MELCloud throttles (HTTP 429) — keep pollInterval ≥ 60 s; the units
// themselves report to the cloud about once a minute.
//
// One LSH device per indoor unit, `melcloud/<DeviceID>`, with the shared AC
// model of src/ac-common.js.
//
// config.melcloud = { email, password, pollInterval = 60 (s) }   (apiBase overrides for tests)
// Tested against scripts/melcloud-simulator.js (test/melcloud.test.js) — not
// yet against a real account.

const PollingClient = require('./polling-client');
const { registerAc, publishAc } = require('./ac-common');

const TIMEOUT_MS = 15000;
const MODE_FROM = { 1: 'heat', 2: 'dry', 3: 'cool', 7: 'fan', 8: 'auto' };
const MODE_TO = { heat: 1, dry: 2, cool: 3, fan: 7, auto: 8 };
const FLAG = { power: 0x1, mode: 0x2, targetTemp: 0x4, fan: 0x8, swing: 0x10 };

// every device in a ListDevices answer
function allDevices(buildings) {
  const out = [];
  const take = (list) => { for (const d of list || []) out.push(d) };
  for (const b of buildings || []) {
    const s = b.Structure || {};
    take(s.Devices);
    for (const a of s.Areas || []) take(a.Devices);
    for (const f of s.Floors || []) { take(f.Devices); for (const a of f.Areas || []) take(a.Devices) }
  }
  return out;
}

class MelcloudClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'melcloud', logTag: 'MELCloud' });
    this.cfg = config.melcloud || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.api = (this.cfg.apiBase || 'https://app.melcloud.com/Mitsubishi.Wifi.Client').replace(/\/+$/, '');
    this.token = null;
    this.units = new Map(); // DeviceID → { id, buildingId, key, n (fan speeds) }
  }

  async start() {
    if (!this.cfg.email || !this.cfg.password) throw new Error('config.melcloud needs email and password (the MELCloud app account)');
    await this.startPolling(Math.max(30, Number(this.cfg.pollInterval) || 60) * 1000);
  }

  async _call(method, p, body, retry = true) {
    if (!this.token && p !== '/Login/ClientLogin') await this.login();
    const res = await fetch(`${this.api}${p}`, {
      method, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(this.token ? { 'X-MitsContextKey': this.token } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 && retry && p !== '/Login/ClientLogin') { this.token = null; return this._call(method, p, body, false) }
    if (res.status === 429) throw new Error('MELCloud: too many requests — raise pollInterval');
    if (!res.ok) throw new Error(`MELCloud ${p}: HTTP ${res.status}`);
    return res.json();
  }

  async login() {
    const r = await this._call('POST', '/Login/ClientLogin', { Email: this.cfg.email, Password: this.cfg.password, Language: 0, AppVersion: '1.34.12.0', Persist: true, CaptchaResponse: null });
    if (r.ErrorId != null || !r.LoginData?.ContextKey) {
      throw new Error(r.ErrorId === 1 ? 'MELCloud login failed — check the e-mail and password' : `MELCloud login failed (error ${r.ErrorId ?? '?'}${r.ErrorMessage ? `: ${r.ErrorMessage}` : ''})`);
    }
    this.token = r.LoginData.ContextKey;
  }

  async _pollImpl() {
    const list = allDevices(await this._call('GET', '/User/ListDevices')).filter((d) => d?.Device && (d.Device.DeviceType ?? 0) === 0);
    if (!list.length) throw new Error('MELCloud: no air conditioners (ATA) on this account');
    for (const d of list) {
      const id = String(d.DeviceID);
      let u = this.units.get(id);
      const s = d.Device;
      if (!u) {
        u = { id, buildingId: d.BuildingID, key: `melcloud/${id}`, n: Number(s.NumberOfFanSpeeds) || 5 };
        this.units.set(id, u);
        const lo = Math.min(Number(s.MinTempHeat) || 10, Number(s.MinTempCoolDry) || 16), hi = Math.max(Number(s.MaxTempHeat) || 31, Number(s.MaxTempCoolDry) || 31);
        registerAc(this.registry, {
          key: u.key, label: d.DeviceName || `MELCloud ${id}`, type: 'melcloud', model: 'Mitsubishi Electric',
          features: { swing: true, outdoor: !!s.HasOutdoorTemperature || s.OutdoorTemperature != null, minTemp: lo, maxTemp: hi },
          set: (patch) => this.set(u, patch),
        });
        console.log(`[MELCloud] ${d.DeviceName || id} (${id})`);
      }
      publishAc(this.store, u.key, {
        online: !s.Offline, power: !!s.Power, mode: MODE_FROM[s.OperationMode], targetTemp: s.SetTemperature,
        temperature: s.RoomTemperature, outdoorTemp: s.OutdoorTemperature ?? undefined,
        fan: this._fanFrom(u, s.FanSpeed ?? s.SetFanSpeed), swing: (s.VaneVerticalDirection ?? s.VaneVertical) === 7,
      });
    }
  }

  _fanFrom(u, v) { if (v === undefined || v === null) return undefined; return v === 0 ? 0 : Math.max(1, Math.min(5, Math.round((v * 5) / u.n))) }
  _fanTo(u, n) { return n === 0 ? 0 : Math.max(1, Math.min(u.n, Math.round((n * u.n) / 5))) }

  async set(u, patch) {
    const st = await this._call('GET', `/Device/Get?id=${encodeURIComponent(u.id)}&buildingID=${encodeURIComponent(u.buildingId)}`);
    let flags = 0;
    if (patch.power !== undefined) { st.Power = patch.power; flags |= FLAG.power }
    if (patch.mode) { st.OperationMode = MODE_TO[patch.mode]; flags |= FLAG.mode }
    if (patch.targetTemp !== undefined) { st.SetTemperature = patch.targetTemp; flags |= FLAG.targetTemp }
    if (patch.fan !== undefined) { st.SetFanSpeed = this._fanTo(u, patch.fan); flags |= FLAG.fan }
    if (patch.swing !== undefined) { st.VaneVertical = patch.swing ? 7 : 0; flags |= FLAG.swing }
    await this._call('POST', '/Device/SetAta', { ...st, EffectiveFlags: flags, HasPendingCommand: true });
    publishAc(this.store, u.key, patch);
  }
}

module.exports = MelcloudClient;
module.exports.allDevices = allDevices;
