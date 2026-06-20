'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_DIR  = path.join(__dirname, '..', 'logs');
const MAX_SIZE = 2 * 1024 * 1024; // rotate at 2 MB

// [PREFIX] → log filename
const PREFIX_MAP = {
  'mqtt':          'mqtt',
  'connection':    'connection',
  'vrm':           'vrm',
  'smartthings':   'smartthings',
  'shelly':        'shelly',
  'satel':         'satel',
  'unifi protect': 'unifi',
  'unifi':         'unifi',
  'homekit':       'homekit',
  'server':        'server',
  'sensors':       'sensors',
  'solaredge':     'solaredge',
  'ws':            'websocket',
  'config':        'server',
};

class Logger {
  constructor() {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    this._streams = {};
    this._sizes   = {};
  }

  // ── Public API ──────────────────────────────────────────────────────────

  log(...args)   { this._write('info',  args); }
  error(...args) { this._write('error', args); }
  warn(...args)  { this._write('warn',  args); }

  /** Returns sorted list of available category names (without .log extension). */
  categories() {
    try {
      return fs.readdirSync(LOG_DIR)
        .filter(f => f.endsWith('.log'))
        .map(f => f.slice(0, -4))
        .sort((a, b) => a === 'app' ? -1 : b === 'app' ? 1 : a.localeCompare(b));
    } catch { return []; }
  }

  /** Returns the last `limit` lines of a log file as an array of strings. */
  tail(name, limit = 300) {
    const file = path.join(LOG_DIR, `${name}.log`);
    try {
      const content = fs.readFileSync(file, 'utf8');
      const lines   = content.split('\n').filter(Boolean);
      return lines.slice(-limit);
    } catch { return []; }
  }

  /** Clears (truncates) a log file. */
  clear(name) {
    const file = path.join(LOG_DIR, `${name}.log`);
    fs.writeFileSync(file, '', 'utf8');
    delete this._sizes[name];
    if (this._streams[name]) {
      this._streams[name].end();
      delete this._streams[name];
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────

  _write(level, args) {
    const msg      = args.map(a => (a instanceof Error) ? a.stack : (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    const ts       = new Date().toISOString();
    const line     = `${ts} [${level.toUpperCase()}] ${msg}\n`;
    const category = this._category(msg);

    this._append('app',      line);
    if (category !== 'app') this._append(category, line);
  }

  _category(msg) {
    const m = msg.match(/^\[([^\]]+)\]/);
    if (!m) return 'app';
    const key = m[1].toLowerCase();
    return PREFIX_MAP[key] || 'app';
  }

  _append(name, line) {
    const stream = this._stream(name);
    stream.write(line);
    this._sizes[name] = (this._sizes[name] || 0) + Buffer.byteLength(line);
    if (this._sizes[name] > MAX_SIZE) this._rotate(name);
  }

  _stream(name) {
    if (!this._streams[name]) {
      const file = path.join(LOG_DIR, `${name}.log`);
      this._streams[name] = fs.createWriteStream(file, { flags: 'a' });
      try { this._sizes[name] = fs.statSync(file).size; } catch { this._sizes[name] = 0; }
    }
    return this._streams[name];
  }

  _rotate(name) {
    const file   = path.join(LOG_DIR, `${name}.log`);
    const backup = path.join(LOG_DIR, `${name}.1.log`);
    if (this._streams[name]) { this._streams[name].end(); delete this._streams[name]; }
    try { fs.renameSync(file, backup); } catch { /* ignore */ }
    this._sizes[name] = 0;
    // Reopen stream (will create new empty file)
    this._stream(name);
  }
}

const logger = new Logger();

/** Installs logger as global console — call once in server.js entry point. */
logger.install = function () {
  const origLog   = console.log.bind(console);
  const origError = console.error.bind(console);
  const origWarn  = console.warn.bind(console);

  console.log = (...a) => { origLog(...a);   logger.log(...a);   };
  console.error = (...a) => { origError(...a); logger.error(...a); };
  console.warn  = (...a) => { origWarn(...a);  logger.warn(...a);  };
};

module.exports = logger;
