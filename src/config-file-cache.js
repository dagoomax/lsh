'use strict';

// Several polling integration clients (reolink, mobotix, axis, kenik) each
// re-read the whole config.json from disk on their own poll timer — some as
// often as every 5s — purely so Settings-page edits apply without a
// restart. That's a full synchronous read + JSON.parse of every other
// integration's config too, repeated redundantly per client, per tick.
//
// fs.statSync is metadata-only and far cheaper than a full read+parse, so
// re-parse only when the file's mtime has actually changed (i.e. only right
// after a Settings save) instead of unconditionally on every poll.
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

let _cached = null;
let _cachedMtimeMs = 0;

function readConfigCached() {
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch {
    return _cached || {};
  }
  if (_cached && mtimeMs === _cachedMtimeMs) return _cached;
  try {
    _cached = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    _cachedMtimeMs = mtimeMs;
  } catch {
    if (!_cached) _cached = {};
  }
  return _cached;
}

module.exports = { readConfigCached, CONFIG_PATH };
