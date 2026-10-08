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

// Every server-side config.json write goes through here. Write to a temp
// file and rename over the original: rename is atomic, so a crash or a
// concurrent reader (the poll timers above, claude-code-client, a restart
// mid-save) sees either the old file or the new one, never half of each —
// a truncated config.json used to mean LSH wouldn't start at all. The
// previous version is kept as config.json.bak (config.js falls back to it).
const BACKUP_PATH = `${CONFIG_PATH}.bak`;

function writeConfigFile(data, configPath = CONFIG_PATH) {
  const json = JSON.stringify(data, null, 2);
  const tmp = `${configPath}.${process.pid}.tmp`;
  let mode = 0o600; // holds credentials — keep an existing file's mode, else owner-only
  try { mode = fs.statSync(configPath).mode & 0o777; } catch {}
  const fd = fs.openSync(tmp, 'w', mode);
  try {
    fs.writeSync(fd, json);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // Only back up a file that parses — never let a broken config.json
  // overwrite the last good backup.
  try {
    JSON.parse(fs.readFileSync(configPath, 'utf8'));
    fs.copyFileSync(configPath, `${configPath}.bak`);
  } catch { /* first write, or current file is broken */ }
  fs.renameSync(tmp, configPath);
  if (configPath === CONFIG_PATH) {
    _cached = data;
    try { _cachedMtimeMs = fs.statSync(CONFIG_PATH).mtimeMs; } catch { _cachedMtimeMs = 0; }
  }
}

module.exports = { readConfigCached, writeConfigFile, CONFIG_PATH, BACKUP_PATH };
