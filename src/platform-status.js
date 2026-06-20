'use strict';

const { EventEmitter } = require('events');

class PlatformStatus extends EventEmitter {
  constructor() {
    super();
    this._s = {};
  }

  set(name, connected) {
    if (this._s[name] === connected) return;
    this._s[name] = connected;
    this.emit('change', this.getAll());
  }

  getAll() { return { ...this._s }; }
}

module.exports = new PlatformStatus();
