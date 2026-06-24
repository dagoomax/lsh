'use strict';

const net            = require('net');
const EventEmitter   = require('events');
const platformStatus = require('./platform-status');

const POLL_MS         = 10_000;
const QUERY_TIMEOUT   = 3_000;
const RECONNECT_DELAY = 30_000;

// ── Protocol helpers ──────────────────────────────────────────────────────

function crc16(data) {
  let crc = 0x147A;
  for (const b of data) {
    crc = ((crc << 1) & 0xFFFF) | (crc >> 15); // 16-bit rotate left
    crc ^= 0xFFFF;
    crc = (crc + (crc >> 8) + b) & 0xFFFF;
  }
  return crc;
}

function escapeFE(buf) {
  const out = [];
  for (const b of buf) { out.push(b); if (b === 0xFE) out.push(0xFD); }
  return Buffer.from(out);
}

function unescapeFE(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0xFE && i + 1 < buf.length && buf[i + 1] === 0xFD) { out.push(0xFE); i++; }
    else out.push(buf[i]);
  }
  return Buffer.from(out);
}

function buildFrame(payload) {
  const c = crc16(payload);
  const full = Buffer.concat([payload, Buffer.from([c >> 8, c & 0xFF])]);
  return Buffer.concat([Buffer.from([0xFE, 0xFE]), escapeFE(full), Buffer.from([0xFE, 0x0D])]);
}

function parseFrames(buf) {
  const frames = [];
  let i = 0;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xFE || buf[i + 1] !== 0xFE) { i++; continue; }
    let j = i + 2;
    while (j < buf.length - 1) {
      if (buf[j] === 0xFE && buf[j + 1] === 0x0D) break;
      if (buf[j] === 0xFE && j + 1 < buf.length) j += 2; else j++;
    }
    if (j >= buf.length - 1) break; // incomplete frame
    const raw = unescapeFE(buf.slice(i + 2, j));
    if (raw.length >= 3) {
      const payload = raw.slice(0, -2);
      const recv = (raw[raw.length - 2] << 8) | raw[raw.length - 1];
      if (crc16(payload) === recv) frames.push(payload);
    }
    i = j + 2;
  }
  return { frames, remaining: buf.slice(i) };
}

function encodeBcd(code) {
  const s = String(code).replace(/\D/g, '').padEnd(8, 'F').slice(0, 8);
  return Buffer.from([
    (parseInt(s[0], 16) << 4) | parseInt(s[1], 16),
    (parseInt(s[2], 16) << 4) | parseInt(s[3], 16),
    (parseInt(s[4], 16) << 4) | parseInt(s[5], 16),
    (parseInt(s[6], 16) << 4) | parseInt(s[7], 16),
  ]);
}

function partitionMask(num) {
  const buf = Buffer.alloc(4, 0);
  buf[Math.floor((num - 1) / 8)] |= 1 << ((num - 1) % 8);
  return buf;
}

// ── Client ────────────────────────────────────────────────────────────────

class SatelClient extends EventEmitter {
  constructor(config, store, sensorRegistry) {
    super();
    this.cfg            = config.satel;
    this.store          = store;
    this.sensorRegistry = sensorRegistry;
    this.socket         = null;
    this.rxBuf          = Buffer.alloc(0);
    this.pollTimer      = null;
    this.reconnTimer    = null;
    this.registered     = new Set();
  }

  async start() {
    await this._connect();
    await this._pollAll();
    this.pollTimer = setInterval(() => this._pollAll().catch(() => {}), POLL_MS);
    console.log(`[Satel] Started — ${this.cfg.host}:${this.cfg.port || 7094}`);
  }

  stop() {
    clearInterval(this.pollTimer);
    clearTimeout(this.reconnTimer);
    this.socket?.destroy();
    this.socket = null;
  }

  // ── Control ───────────────────────────────────────────────

  async armPartition(num) {
    const code = this.cfg.armCode;
    if (code) {
      await this._send(Buffer.concat([Buffer.from([0x80]), encodeBcd(code), partitionMask(num)]));
    } else {
      await this._send(Buffer.concat([Buffer.from([0x84]), partitionMask(num)]));
    }
  }

  async disarmPartition(num) {
    await this._send(
      Buffer.concat([Buffer.from([0x85]), encodeBcd(this.cfg.armCode || ''), partitionMask(num)])
    );
  }

  // ── Transport ─────────────────────────────────────────────

  _connect() {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      sock.setTimeout(10_000);
      sock.connect(this.cfg.port || 7094, this.cfg.host, () => {
        platformStatus.set('satel', true);
        this.socket = sock;
        resolve();
      });
      sock.on('data', chunk => {
        this.rxBuf = Buffer.concat([this.rxBuf, chunk]);
        const { frames, remaining } = parseFrames(this.rxBuf);
        this.rxBuf = remaining;
        for (const f of frames) this.emit('frame', f);
      });
      sock.on('error', err => {
        console.error(`[Satel] ${err.message}`);
        if (sock.connecting) reject(err);
      });
      sock.on('close', () => {
        this.socket = null;
        platformStatus.set('satel', false);
        console.warn('[Satel] Disconnected — reconnecting in 30 s');
        this.reconnTimer = setTimeout(() => this._connect().catch(() => {}), RECONNECT_DELAY);
      });
    });
  }

  _send(data) {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'));
      this.socket.write(buildFrame(data), err => err ? reject(err) : resolve());
    });
  }

  _query(cmd) {
    return new Promise(resolve => {
      const onFrame = frame => {
        if (frame[0] === cmd) { this.off('frame', onFrame); resolve(frame.slice(1)); }
      };
      this.on('frame', onFrame);
      this._send(Buffer.from([cmd])).catch(() => {});
      setTimeout(() => { this.off('frame', onFrame); resolve(null); }, QUERY_TIMEOUT);
    });
  }

  // ── Polling ───────────────────────────────────────────────

  async _pollAll() {
    const violations = await this._query(0x00); // zone violations (16 bytes = 128 zones)
    if (violations) this._updateZones(violations);
  }

  _updateZones(data) {
    const nums = this.cfg.zones
      ? this.cfg.zones
      : Array.from({ length: this.cfg.zoneCount || 32 }, (_, i) => i + 1);

    for (const num of nums) {
      const b = Math.floor((num - 1) / 8), bit = (num - 1) % 8;
      const violated = data[b] != null && !!(data[b] & (1 << bit));
      this.store.update(`satel/zone/${num}/state`, violated ? 1 : 0);
      if (!this.registered.has(`z${num}`)) this._registerZone(num);
    }
  }

  // ── Device registration ────────────────────────────────────

  _registerZone(num) {
    this.registered.add(`z${num}`);
    const label = this.cfg.zoneNames?.[num] || this.cfg.zoneNames?.[String(num)] || `Zone ${num}`;
    this.sensorRegistry.registerDevice({
      key:      `satel/zone/${num}`,
      type:     'satel',
      instance: `zone-${num}`,
      label,
      icon:     '🚪',
      color:    'blue',
      sensors:  [{ path: 'state', name: 'State', format: 'on-off', homekit: 'contact' }],
      homekit:  ['contact'],
    });
  }


}

module.exports = SatelClient;
