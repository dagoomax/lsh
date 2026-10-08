'use strict';

const { EventEmitter } = require('events');

class PlatformStatus extends EventEmitter {
  constructor() {
    super();
    this._s = {};
    this._everConnected = new Set();
  }

  set(name, connected) {
    if (connected) this._everConnected.add(name);
    if (this._s[name] === connected) return;
    this._s[name] = connected;
    this.emit('change', this.getAll());
  }

  // Every platform that has reported, connected or not (MCP, diagnostics).
  getAll() { return { ...this._s }; }

  // What the dashboard's platform bar shows: only platforms that have
  // connected at least once since startup. One that has never connected —
  // unreachable from this box, wrong host, never logged in — is left out
  // instead of sitting there red; one that worked and then dropped still
  // shows (red), which is the case the bar exists for.
  getVisible() {
    const out = {};
    for (const [name, connected] of Object.entries(this._s)) {
      if (this._everConnected.has(name)) out[name] = connected;
    }
    return out;
  }
}

module.exports = new PlatformStatus();
