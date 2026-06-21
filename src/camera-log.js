'use strict';

const { EventEmitter } = require('events');

class CameraLog extends EventEmitter {
  constructor(maxEntries = 500) {
    super();
    this._entries = [];
    this._max     = maxEntries;
  }

  push(camera, type, detail = '') {
    const entry = { ts: Date.now(), camera, type, detail };
    this._entries.unshift(entry);
    if (this._entries.length > this._max) this._entries.length = this._max;
    this.emit('entry', entry);
    return entry;
  }

  getRecent(n = 100, camera = null) {
    const src = camera ? this._entries.filter(e => e.camera === camera) : this._entries;
    return src.slice(0, n);
  }
}

module.exports = new CameraLog();
