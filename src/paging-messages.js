'use strict';

// Voice messages for room-to-room paging — the "leave a message" counterpart
// to the live channel in paging.js, for when the target room isn't online
// (startPage() refuses if either side has no device connected) or the
// sender just prefers an async note. Same singleton-module + disk-
// persistence shape as private-events.js; audio blobs live as separate
// files since JSON can't hold binary, indexed by a small metadata list.
//
// Messages are ephemeral by default — voicemail nobody explicitly saves
// shouldn't pile up forever — and disappear 24h after being left. Either
// side can mark one `kept` to exempt it from that expiry indefinitely.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR  = path.join(__dirname, '..', 'persist', 'paging-messages');
const FILE = path.join(DIR, 'index.json');
const MAX_MESSAGES = 50;                 // oldest non-kept (audio + entry) pruned past this — safety cap on disk use
const EXPIRE_MS    = 24 * 60 * 60 * 1000; // un-kept messages disappear this long after being left
const SWEEP_MS     = 15 * 60 * 1000;      // how often the background expiry sweep runs

class PagingMessages {
  constructor() {
    this._items = this._load();
    this._sweepExpired();
    this._sweepTimer = setInterval(() => this._sweepExpired(), SWEEP_MS);
    this._sweepTimer.unref?.(); // a cleanup timer alone shouldn't keep the process alive
  }

  _load() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
  }

  _save() {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(this._items, null, 2));
  }

  _audioPath(id) { return path.join(DIR, `${id}.webm`); }

  _isExpired(item) {
    return !item.kept && (Date.now() - item.at) > EXPIRE_MS;
  }

  _sweepExpired() {
    const keep = [];
    let removed = 0;
    for (const item of this._items) {
      if (this._isExpired(item)) {
        try { fs.unlinkSync(this._audioPath(item.id)); } catch { /* already gone */ }
        removed++;
      } else {
        keep.push(item);
      }
    }
    if (removed) {
      this._items = keep;
      this._save();
      console.log(`[PagingMessages] Expired ${removed} voice message(s) past 24h`);
    }
  }

  /** Messages waiting for `roomId`, newest first. Expired-and-not-kept ones are filtered even if the sweep hasn't run yet. */
  getFor(roomId) {
    return this._items
      .filter((m) => m.to === roomId && !this._isExpired(m))
      .sort((a, b) => b.at - a.at)
      .map(({ id, from, to, at, mimeType, kept }) => ({ id, from, to, at, mimeType, kept: !!kept }));
  }

  add({ from, to, buffer, mimeType }) {
    this._sweepExpired(); // opportunistic — keeps disk tidy without waiting for the timer
    const id = crypto.randomUUID();
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(this._audioPath(id), buffer);
    const item = { id, from, to, at: Date.now(), mimeType: mimeType || 'audio/webm', kept: false };
    this._items.push(item);
    this._prune();
    this._save();
    return item;
  }

  _prune() {
    // Prefer evicting the oldest non-kept message first, so "keep" is a real
    // guarantee under normal use; only touches a kept one if literally every
    // stored message is kept (an absolute backstop against unbounded growth).
    while (this._items.length > MAX_MESSAGES) {
      let idx = this._items.findIndex((m) => !m.kept);
      if (idx === -1) idx = 0;
      const [oldest] = this._items.splice(idx, 1);
      try { fs.unlinkSync(this._audioPath(oldest.id)); } catch { /* already gone */ }
    }
  }

  get(id) { return this._items.find((m) => m.id === id) || null; }

  audioFile(id) {
    const item = this.get(id);
    return item ? this._audioPath(item.id) : null;
  }

  /** Exempt (or re-expose to) the 24h expiry. Returns the updated entry, or null if unknown. */
  setKept(id, kept) {
    const item = this.get(id);
    if (!item) return null;
    item.kept = !!kept;
    this._save();
    return item;
  }

  remove(id) {
    const before = this._items.length;
    this._items = this._items.filter((m) => m.id !== id);
    if (this._items.length !== before) {
      try { fs.unlinkSync(this._audioPath(id)); } catch { /* already gone */ }
      this._save();
    }
    return this._items.length !== before;
  }
}

module.exports = new PagingMessages();
