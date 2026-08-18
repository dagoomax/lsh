'use strict';

// Motion-detection event ring buffer for the agenda — same shape as
// call-log.js (in-memory + disk-persisted singleton). Populated by the
// listener wired up in server.js (main()), not by any single integration
// client, since motion sensors exist across many platforms.

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'persist', 'motion-log.json');

class MotionLog extends EventEmitter {
  constructor(maxEntries = 50) {
    super();
    this._max = maxEntries;
    this._entries = this._load();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch {
      return [];
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(this._entries, null, 2));
    } catch (err) {
      console.error(`[MotionLog] Save failed: ${err.message}`);
    }
  }

  push(deviceLabel) {
    const entry = { ts: Date.now(), device: deviceLabel };
    this._entries.unshift(entry);
    if (this._entries.length > this._max) this._entries.length = this._max;
    this._save();
    this.emit('entry', entry);
    return entry;
  }

  getRecent(n = 20) {
    return this._entries.slice(0, n);
  }
}

module.exports = new MotionLog();
