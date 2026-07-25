'use strict';

const http           = require('http');
const platformStatus = require('./platform-status');

/**
 * Pushes live store values to Fibaro Home Center (HC2/HC3) global variables,
 * the outbound counterpart of `fibaro-client.js` — same idea as
 * `loxone-out-client.js` for Loxone Virtual Inputs. Scenes on the Home Center
 * can then trigger on the variables (e.g. Satel zones/partitions from LSH).
 *
 * Two mapping forms (mix freely):
 *   { "storeKey": "satel/partition/1/armed", "variable": "LSH_SatelArmed" }
 *   { "storePrefix": "satel/zone/", "variablePrefix": "LSH_satel_zone_" }
 *
 * A prefix rule maps every key under `storePrefix` — the key remainder is
 * appended to `variablePrefix` with `/` → `_` (satel/zone/3/state →
 * LSH_satel_zone_3_state). Missing variables are created automatically.
 */
class FibaroOutClient {
  constructor(config, store) {
    this._config   = config;
    this._store    = store;
    this._keyMap   = {};   // storeKey → variable name (exact mappings)
    this._prefixes = [];   // [{ storePrefix, variablePrefix }]
    this._existing = new Set(); // variable names known to exist on the HC
    this._timers   = {};   // storeKey → debounce timer
  }

  async start() {
    const cfg = this._config.fibaroOut;
    if (!cfg?.host || !cfg?.mappings?.length) return;

    for (const m of cfg.mappings) {
      if (m.storeKey && m.variable) this._keyMap[m.storeKey] = _sanitize(m.variable);
      else if (m.storePrefix && m.variablePrefix) this._prefixes.push(m);
    }

    try {
      const vars = await this._request('GET', '/api/globalVariables');
      for (const v of vars) this._existing.add(v.name);
      platformStatus.set('fibaroOut', true);
    } catch (err) {
      console.error(`[FibaroOut] Cannot list global variables: ${err.message}`);
      platformStatus.set('fibaroOut', false);
      // keep going — variables are also created lazily on first push
    }

    // Push current values so the HC starts in sync
    const all = this._store.getAll();
    for (const [key, value] of Object.entries(all)) {
      const name = this._variableFor(key);
      if (name) this._push(key, name, value);
    }

    this._store.on('change', ({ key, value }) => {
      const name = this._variableFor(key);
      if (!name) return;
      // Debounce 200 ms so rapid bursts send only the latest value
      clearTimeout(this._timers[key]);
      this._timers[key] = setTimeout(() => this._push(key, name, value), 200);
    });

    const rules = Object.keys(this._keyMap).length + this._prefixes.length;
    console.log(`[FibaroOut] Started — ${rules} mapping rule(s) → ${cfg.host}`);
  }

  stop() {
    for (const t of Object.values(this._timers)) clearTimeout(t);
    this._timers = {};
  }

  _variableFor(key) {
    if (this._keyMap[key]) return this._keyMap[key];
    for (const p of this._prefixes) {
      if (key.startsWith(p.storePrefix)) {
        return _sanitize(p.variablePrefix + key.slice(p.storePrefix.length));
      }
    }
    return null;
  }

  async _push(key, name, value) {
    const str = _stringify(value);
    try {
      if (!this._existing.has(name)) {
        await this._request('POST', '/api/globalVariables', { name, value: str });
        this._existing.add(name);
        console.log(`[FibaroOut] Created global variable ${name}`);
      } else {
        await this._request('PUT', `/api/globalVariables/${encodeURIComponent(name)}`, { name, value: str });
      }
      platformStatus.set('fibaroOut', true);
    } catch (err) {
      // 409 on POST: variable appeared since we listed — remember it and retry as update
      if (err.status === 409 && !this._existing.has(name)) {
        this._existing.add(name);
        return this._push(key, name, value);
      }
      console.error(`[FibaroOut] ${name}=${str}: ${err.message}`);
      platformStatus.set('fibaroOut', false);
    }
  }

  _request(method, path, body) {
    const cfg     = this._config.fibaroOut;
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const auth    = Buffer.from(`${cfg.username || 'admin'}:${cfg.password || ''}`).toString('base64');
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: cfg.host,
        port:     cfg.port || 80,
        path,
        method,
        timeout:  8000,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept:        'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        },
      }, res => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const e = new Error(`HTTP ${res.statusCode}${raw ? `: ${raw.slice(0, 120)}` : ''}`);
            e.status = res.statusCode;
            return reject(e);
          }
          try { resolve(raw ? JSON.parse(raw) : null); } catch { resolve(null); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      if (payload) req.write(payload);
      req.end();
    });
  }
}

/** HC variable names: letters, digits, underscore. */
function _sanitize(name) {
  return String(name).replace(/[^A-Za-z0-9_]/g, '_');
}

/** HC global variable values are strings; booleans become 1/0 for scene logic. */
function _stringify(value) {
  if (value === true)  return '1';
  if (value === false) return '0';
  return String(value ?? 0);
}

module.exports = FibaroOutClient;
