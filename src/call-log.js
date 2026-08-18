'use strict';

// Missed-call ring buffer for the SIP doorbell/intercom — same
// singleton-EventEmitter shape as camera-log.js, plus disk persistence
// (plain fs.writeFileSync, same convention as the OAuth token files) since
// a missed call is meaningful enough to survive a restart.

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'persist', 'call-log.json');

class CallLog extends EventEmitter {
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
      console.error(`[CallLog] Save failed: ${err.message}`);
    }
  }

  push(caller) {
    const entry = { ts: Date.now(), caller: caller || 'Unknown' };
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

module.exports = new CallLog();
