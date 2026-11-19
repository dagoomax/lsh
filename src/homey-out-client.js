'use strict';

const platformStatus = require('./platform-status');

/**
 * Pushes live store values to Homey as Logic variables — the outbound
 * counterpart of `homey-client.js` (which imports Homey devices into LSH).
 * Homey does not let an outside system create a real *device* (devices come
 * from Homey apps/drivers), but Logic variables can be set over the Web API
 * and used in Flows, so an LSH value (e.g. the Yale keypad's presence) becomes
 * usable inside Homey.
 *
 * Reuses the existing `config.homey` connection (host + token, local or cloud)
 * — no separate credentials. Configure what to push under `config.homeyOut`:
 *
 *   "homeyOut": {
 *     "mappings": [
 *       { "storeKey": "yale-keypad-ble/keypad_wejscie/online", "variable": "Keypad Wejście obecny", "type": "boolean" },
 *       { "storeKey": "yale-keypad-ble/keypad_wejscie/rssi",   "variable": "Keypad Wejście sygnał",  "type": "number"  },
 *       { "storePrefix": "satel/zone/", "variablePrefix": "LSH zone ", "type": "boolean" }
 *     ]
 *   }
 *
 * A prefix rule maps every key under `storePrefix`; the remainder (/ → space)
 * is appended to `variablePrefix`. Homey Logic names allow spaces/unicode, so
 * names are kept as written. Missing variables are created on first push.
 */
class HomeyOutClient {
  constructor(config, store) {
    this._config = config;
    this._store = store;
    this._keyMap = {};      // storeKey → { variable, type }
    this._prefixes = [];    // [{ storePrefix, variablePrefix, type }]
    this._ids = new Map();  // variable name → Homey variable id
    this._types = new Map(); // variable name → type
    this._timers = {};
    this._last = new Map();  // variable → last value string sent
  }

  _homeyBase() {
    const h = this._config.homey || {};
    if (h.host) return `http://${h.host}`;
    if (h.homeyId) return `https://${h.homeyId}.connect.athom.com`;
    return '';
  }

  async start() {
    const cfg = this._config.homeyOut;
    if (!cfg?.mappings?.length) return;
    const h = this._config.homey || {};
    this._base = this._homeyBase();
    this._token = h.token;
    if (!this._base || !this._token) {
      console.warn('[HomeyOut] Needs config.homey (host/homeyId + token) — not starting');
      return;
    }

    for (const m of cfg.mappings) {
      if (m.storeKey && m.variable) this._keyMap[m.storeKey] = { variable: String(m.variable), type: m.type };
      else if (m.storePrefix && m.variablePrefix) this._prefixes.push(m);
    }

    try {
      const vars = await this._request('GET', '/api/manager/logic/variable');
      const list = Array.isArray(vars) ? vars : Object.values(vars || {});
      for (const v of list) { if (v?.name) { this._ids.set(v.name, v.id); this._types.set(v.name, v.type); } }
      platformStatus.set('homeyOut', true);
    } catch (err) {
      console.error(`[HomeyOut] Cannot list Logic variables: ${err.message}`);
      platformStatus.set('homeyOut', false);
      // keep going — variables are also created lazily on first push
    }

    const all = this._store.getAll();
    for (const [key, value] of Object.entries(all)) {
      const t = this._targetFor(key);
      if (t) this._push(t.variable, t.type, value);
    }

    this._store.on('change', ({ key, value }) => {
      const t = this._targetFor(key);
      if (!t) return;
      clearTimeout(this._timers[key]);
      this._timers[key] = setTimeout(() => this._push(t.variable, t.type, value), 200);
    });

    const rules = Object.keys(this._keyMap).length + this._prefixes.length;
    console.log(`[HomeyOut] Started — ${rules} mapping rule(s) → ${this._base}`);
  }

  stop() {
    for (const t of Object.values(this._timers)) clearTimeout(t);
    this._timers = {};
  }

  _targetFor(key) {
    if (this._keyMap[key]) return this._keyMap[key];
    for (const p of this._prefixes) {
      if (key.startsWith(p.storePrefix)) {
        return { variable: p.variablePrefix + key.slice(p.storePrefix.length).replace(/\//g, ' '), type: p.type };
      }
    }
    return null;
  }

  // Homey Logic variables are typed; coerce the store value to the target type.
  _coerce(value, type) {
    const t = type || (typeof value === 'boolean' ? 'boolean' : (Number.isFinite(Number(value)) && value !== '' && value != null ? 'number' : 'string'));
    if (t === 'boolean') return { type: 'boolean', value: value === true || value === 1 || value === '1' || value === 'on' };
    if (t === 'number') return { type: 'number', value: Number(value) || 0 };
    return { type: 'string', value: String(value ?? '') };
  }

  async _push(name, typeHint, raw) {
    const { type, value } = this._coerce(raw, typeHint);
    const str = `${type}:${value}`;
    if (this._last.get(name) === str) return;
    this._last.set(name, str);
    try {
      let id = this._ids.get(name);
      if (!id) {
        const created = await this._request('POST', '/api/manager/logic/variable', { name, type, value });
        id = created?.id || created?._id;
        if (!id) throw new Error('create returned no id');
        this._ids.set(name, id);
        this._types.set(name, type);
        console.log(`[HomeyOut] Created Logic variable "${name}" (${type})`);
      } else {
        await this._request('PUT', `/api/manager/logic/variable/${encodeURIComponent(id)}`, { value });
      }
      platformStatus.set('homeyOut', true);
    } catch (err) {
      this._last.delete(name); // failed: retry on next change
      console.error(`[HomeyOut] ${name}=${value}: ${err.message}`);
      platformStatus.set('homeyOut', false);
    }
  }

  async _request(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${this._base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this._token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const raw = await res.text();
      if (!res.ok) { const e = new Error(`HTTP ${res.status}${raw ? `: ${raw.slice(0, 120)}` : ''}`); e.status = res.status; throw e; }
      try { return raw ? JSON.parse(raw) : null; } catch { return null; }
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('timed out');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = HomeyOutClient;
