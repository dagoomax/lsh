'use strict';

// Locally-added agenda events — never synced from/to Google, just a plain
// persisted list. Same singleton-module shape as camera-log.js so it can be
// required directly wherever needed, but with disk persistence (plain
// fs.writeFileSync, same convention as persist/smartthings-oauth.json)
// since these are user-entered and must survive restarts.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'persist', 'private-events.json');

class PrivateEvents {
  constructor() {
    this._items = this._load();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch {
      return [];
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(this._items, null, 2));
  }

  getAll() {
    return this._items;
  }

  add({ date, title, time }) {
    const item = {
      id: crypto.randomUUID(),
      date: String(date || '').slice(0, 10),
      title: String(title || '').trim().slice(0, 120),
      time: time ? String(time).slice(0, 5) : null,
    };
    this._items.push(item);
    this._save();
    return item;
  }

  remove(id) {
    const before = this._items.length;
    this._items = this._items.filter((e) => e.id !== id);
    if (this._items.length !== before) this._save();
    return this._items.length !== before;
  }
}

module.exports = new PrivateEvents();
