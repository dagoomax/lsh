'use strict';

// Sensibo Sky / Air / Air Pro / Elements — the official Sensibo cloud API
// (home.sensibo.com/api/v2, API key from home.sensibo.com/me/api). A Sensibo
// drives almost any IR-remote air conditioner, so this is also the way to
// bring brands with no open API (Fujitsu, Panasonic, Toshiba, Hitachi,
// Haier, Hisense, Sharp…) into LSH.
//
//   GET  /users/me/pods?fields=id,room,acState,measurements,connectionStatus,remoteCapabilities
//   POST /pods/<id>/acStates  { acState: { on, mode, targetTemperature, temperatureUnit, fanLevel, swing } }
//
//   mode cool / heat / fan / dry / auto · fanLevel quiet, low, medium_low,
//   medium, medium_high, high, strong, auto (what the remote has: remoteCapabilities)
//   swing stopped / rangeFull / …
//
// One LSH device per pod, `sensibo/<id>`, with the shared AC model of
// src/ac-common.js; humidity from the pod's own sensor.
//
// config.sensibo = { apiKey, pollInterval = 60 (s) }   (apiBase overrides for tests)
// Tested against scripts/sensibo-simulator.js (test/sensibo.test.js) — not
// yet against a real pod.

const PollingClient = require('./polling-client');
const { registerAc, publishAc } = require('./ac-common');

const TIMEOUT_MS = 15000;
// LSH fan 0–5 → Sensibo levels to try, in order
const FAN_PREF = [['auto'], ['quiet', 'low'], ['low', 'medium_low', 'quiet'], ['medium', 'medium_low', 'medium_high'], ['high', 'medium_high', 'strong'], ['strong', 'high']];
const FAN_FROM = { auto: 0, quiet: 1, low: 2, medium_low: 2, medium: 3, medium_high: 4, high: 4, strong: 5 };

class SensiboClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'sensibo', logTag: 'Sensibo' });
    this.cfg = config.sensibo || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.api = (this.cfg.apiBase || 'https://home.sensibo.com/api/v2').replace(/\/+$/, '');
    this.pods = new Map(); // id → { id, key, state, caps }
  }

  async start() {
    if (!this.cfg.apiKey) throw new Error('config.sensibo needs apiKey (home.sensibo.com/me/api)');
    await this.startPolling(Math.max(30, Number(this.cfg.pollInterval) || 60) * 1000);
  }

  async _call(method, p, body) {
    const sep = p.includes('?') ? '&' : '?';
    const res = await fetch(`${this.api}${p}${sep}apiKey=${encodeURIComponent(this.cfg.apiKey)}`, {
      method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) throw new Error('Sensibo: API key rejected');
    if (res.status === 429) throw new Error('Sensibo: too many requests — raise pollInterval');
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.status !== 'success') throw new Error(`Sensibo ${p.split('?')[0]}: ${j.reason || j.message || `HTTP ${res.status}`}`);
    return j.result;
  }

  async _pollImpl() {
    const pods = await this._call('GET', '/users/me/pods?fields=id,room,acState,measurements,connectionStatus,remoteCapabilities');
    if (!Array.isArray(pods) || !pods.length) throw new Error('Sensibo: no devices on this account');
    for (const p of pods) {
      let u = this.pods.get(p.id);
      if (!u) {
        u = { id: p.id, key: `sensibo/${String(p.id).replace(/[^A-Za-z0-9_-]/g, '')}` };
        this.pods.set(p.id, u);
        const temps = Object.values(p.remoteCapabilities?.modes || {}).flatMap((m) => m.temperatures?.C?.values || []);
        registerAc(this.registry, {
          key: u.key, label: p.room?.name || `Sensibo ${p.id}`, type: 'sensibo', model: 'Sensibo',
          features: {
            swing: Object.values(p.remoteCapabilities?.modes || {}).some((m) => (m.swing || []).length > 1), humidity: true,
            minTemp: temps.length ? Math.min(...temps) : 16, maxTemp: temps.length ? Math.max(...temps) : 30, step: 1,
          },
          set: (patch) => this.set(u, patch),
        });
        console.log(`[Sensibo] ${p.room?.name || p.id}`);
      }
      u.state = p.acState || {};
      u.caps = p.remoteCapabilities || {};
      const a = u.state, m = p.measurements || {};
      const toC = (v) => (v == null ? undefined : a.temperatureUnit === 'F' ? Math.round(((v - 32) * 5) / 9 * 2) / 2 : v);
      publishAc(this.store, u.key, {
        online: p.connectionStatus?.isAlive !== false, power: !!a.on, mode: a.mode, targetTemp: toC(a.targetTemperature),
        fan: FAN_FROM[a.fanLevel], swing: a.swing !== undefined ? a.swing !== 'stopped' : undefined,
        temperature: m.temperature, humidity: m.humidity,
      });
    }
  }

  async set(u, patch) {
    if (!u.state) throw new Error('Sensibo: no state read yet');
    const a = { ...u.state };
    if (patch.power !== undefined) a.on = patch.power;
    if (patch.mode) {
      if (u.caps.modes && !u.caps.modes[patch.mode]) throw new Error(`Sensibo: this AC has no ${patch.mode} mode`);
      a.mode = patch.mode;
    }
    const caps = u.caps.modes?.[a.mode] || {};
    if (patch.targetTemp !== undefined) { a.targetTemperature = Math.round(patch.targetTemp); a.temperatureUnit = 'C' }
    if (patch.fan !== undefined) {
      const have = caps.fanLevels || [];
      a.fanLevel = FAN_PREF[patch.fan].find((l) => !have.length || have.includes(l)) || have[0];
    }
    if (patch.swing !== undefined) a.swing = patch.swing ? ((caps.swing || []).find((s) => s !== 'stopped') || 'rangeFull') : 'stopped';
    // keep only what the API takes, dropping fields the mode doesn't support
    const acState = { on: a.on, mode: a.mode, targetTemperature: a.targetTemperature, temperatureUnit: a.temperatureUnit || 'C', fanLevel: a.fanLevel, swing: a.swing };
    if (!(caps.fanLevels || []).includes(acState.fanLevel)) delete acState.fanLevel;
    if (!(caps.swing || []).includes(acState.swing)) delete acState.swing;
    if (!caps.temperatures) delete acState.targetTemperature;
    for (const k of Object.keys(acState)) if (acState[k] === undefined) delete acState[k];
    await this._call('POST', `/pods/${encodeURIComponent(u.id)}/acStates`, { acState });
    u.state = { ...u.state, ...acState };
    publishAc(this.store, u.key, patch);
  }
}

module.exports = SensiboClient;
