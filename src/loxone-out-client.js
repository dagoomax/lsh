'use strict';

const http           = require('http');
const platformStatus = require('./platform-status');

class LoxoneOutClient {
  constructor(config, store) {
    this._config  = config;
    this._store   = store;
    this._keyMap  = {}; // storeKey → virtualInputName
    this._timers  = {}; // storeKey → debounce timer
  }

  start() {
    const cfg = this._config.loxoneOut;
    if (!cfg?.host || !cfg?.mappings?.length) return;

    for (const m of cfg.mappings) {
      if (m.storeKey && m.virtualInput) this._keyMap[m.storeKey] = m.virtualInput;
    }

    this._store.on('change', ({ key, value }) => {
      const vi = this._keyMap[key];
      if (!vi) return;
      // Debounce 200 ms so rapid bursts send only the latest value
      clearTimeout(this._timers[key]);
      this._timers[key] = setTimeout(() => this._push(vi, value), 200);
    });

    console.log(`[LoxoneOut] Started — ${Object.keys(this._keyMap).length} mapping(s) → ${cfg.host}`);
    platformStatus.set('loxoneOut', true);
  }

  stop() {
    for (const t of Object.values(this._timers)) clearTimeout(t);
    this._timers = {};
  }

  _push(virtualInput, value) {
    const cfg  = this._config.loxoneOut;
    const auth = Buffer.from(`${cfg.username || 'admin'}:${cfg.password || ''}`).toString('base64');
    const path = `/dev/sps/io/${encodeURIComponent(virtualInput)}/${encodeURIComponent(String(value ?? 0))}`;

    const req = http.get({
      hostname: cfg.host,
      port:     cfg.port || 80,
      path,
      timeout:  5_000,
      headers:  { Authorization: `Basic ${auth}` },
    }, res => {
      if (res.statusCode >= 400)
        console.error(`[LoxoneOut] HTTP ${res.statusCode} for ${virtualInput}=${value}`);
      res.resume();
    });
    req.on('error',   err => console.error(`[LoxoneOut] ${virtualInput}: ${err.message}`));
    req.on('timeout', ()  => req.destroy());
  }
}

module.exports = LoxoneOutClient;
