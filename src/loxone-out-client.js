'use strict';

// Loxone Outbound Push — sends LSH store values to Loxone Virtual Inputs as
// they change: GET http://<miniserver>/dev/sps/io/<name>/<value> (Basic auth).
// Numbers go to a Virtual Input, text to a Virtual Text Input — e.g. the media
// player's "now playing" line (radio/<speaker>/nowPlaying, spotify/player/…).
//
// config.loxoneOut = { host, port = 80, username = 'admin', password,
//   mappings: [{ storeKey, virtualInput }] }
// On start every mapped key that already has a value is sent once, so Loxone
// isn't blank until the next change. Settings → Loxone → Outbound Push saves
// and restarts it live (src/routes/loxone.js).

const http           = require('http');
const platformStatus = require('./platform-status');

const DEBOUNCE_MS = 200;
const MAX_TEXT = 512; // Loxone text inputs take short strings; URLs past ~2 kB fail

class LoxoneOutClient {
  constructor(config, store) {
    this._config  = config;
    this._store   = store;
    this._keyMap  = {}; // storeKey → [virtualInputName]
    this._timers  = {}; // storeKey → debounce timer
    this._last    = new Map(); // virtualInput → last value sent (LSH re-emits unchanged values; send real changes only)
    this._onChange = ({ key, value }) => {
      if (!this._keyMap[key]) return;
      clearTimeout(this._timers[key]);
      this._timers[key] = setTimeout(() => this._send(key, value), DEBOUNCE_MS);
    };
    this.lastError = null;
    this.sent = 0;
  }

  start() {
    const cfg = this._config.loxoneOut;
    if (!cfg?.host || !cfg?.mappings?.length) return;
    for (const m of cfg.mappings) {
      if (m.storeKey && m.virtualInput) (this._keyMap[m.storeKey] ||= []).push(m.virtualInput);
    }
    this._store.on('change', this._onChange);
    console.log(`[LoxoneOut] Started — ${cfg.mappings.length} mapping(s) → ${cfg.host}`);
    platformStatus.set('loxoneOut', true);
    // what's there already
    for (const key of Object.keys(this._keyMap)) {
      const v = this._store.get(key);
      if (v !== null && v !== undefined) this._send(key, v);
    }
  }

  stop() {
    this._store.off?.('change', this._onChange);
    for (const t of Object.values(this._timers)) clearTimeout(t);
    this._timers = {};
  }

  _send(key, value) {
    const v = typeof value === 'boolean' ? (value ? 1 : 0) : value ?? 0;
    for (const vi of this._keyMap[key] || []) {
      if (this._last.get(vi) === String(v)) continue;
      this._last.set(vi, String(v));
      this.push(vi, v).catch(() => this._last.delete(vi)); // failed: try again on the next change
    }
  }

  // → Promise<status code>; rejects with what went wrong
  push(virtualInput, value) {
    const cfg  = this._config.loxoneOut;
    const auth = Buffer.from(`${cfg.username || 'admin'}:${cfg.password || ''}`).toString('base64');
    let v = value ?? 0;
    if (typeof v === 'boolean') v = v ? 1 : 0;
    v = String(v).slice(0, MAX_TEXT);
    const path = `/dev/sps/io/${encodeURIComponent(virtualInput)}/${encodeURIComponent(v)}`;
    return new Promise((resolve, reject) => {
      const fail = (msg) => {
        this.lastError = `${virtualInput}: ${msg}`;
        console.error(`[LoxoneOut] ${this.lastError}`);
        reject(new Error(msg));
      };
      const req = http.get({ hostname: cfg.host, port: cfg.port || 80, path, timeout: 5_000, headers: { Authorization: `Basic ${auth}` } }, (res) => {
        let body = '';
        res.on('data', (c) => { if (body.length < 2000) body += c });
        res.on('end', () => {
          // the Miniserver answers 200 with <LL … Code="200"/> — or Code="404" when no input has that name
          const code = Number(/Code="(\d+)"/.exec(body)?.[1]) || res.statusCode;
          if (res.statusCode === 401) return fail('the Miniserver refused the user name / password (HTTP 401)');
          if (code >= 400) return fail(`no Virtual Input called “${virtualInput}” on the Miniserver (${code})`);
          this.sent++;
          this.lastError = null;
          resolve(code);
        });
      });
      req.on('error', (err) => fail(err.message));
      req.on('timeout', () => { req.destroy(); fail('timed out') });
    });
  }
}

module.exports = LoxoneOutClient;
