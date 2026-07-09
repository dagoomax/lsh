'use strict';

// VENTS / Blauberg decentralised HRV (e.g. VENTS A21, TwinFresh Expert, Vento
// Expert) over the local UDP protocol on port 4000.
//
// Protocol framing (well documented / reverse-engineered):
//   FD FD | 02 | idLen id… | pwdLen pwd… | func | data… | chkLo chkHi
//   checksum = 16-bit sum of every byte from the protocol-type byte through the
//   last data byte, appended little-endian (the two FD lead bytes are excluded).
//   Read  (0x01): data = list of parameter ids to fetch.
//   Write (0x03): data = [id, value] pairs (1-byte values here).
//   Responses carry [id, value] pairs; 0xFE sets the value size for what
//   follows, 0xFF sets the high byte (page) for ids > 0xFF.
//
// The *framing* is model-independent, but the *parameter ids* differ per model.
// DEFAULT_PARAMS below is the common Vento/TwinFresh map; override any id in
// config.vents.params if your A21 reports different registers (see README).

const dgram          = require('dgram');
const platformStatus = require('./platform-status');

const HEADER   = [0xFD, 0xFD];
const PROTOCOL = 0x02;
const FUNC     = { READ: 0x01, WRITE: 0x03, WRITEREAD: 0x06 };
const SIZE_MARK = 0xFE, PAGE_MARK = 0xFF;

// name → { id, size, write?, signed?, scale? }
const DEFAULT_PARAMS = {
  state:       { id: 0x01, size: 1, write: true },              // 0 off / 1 on
  speed:       { id: 0x02, size: 1, write: true },              // 1..3
  boost:       { id: 0x06, size: 1, write: true },              // 0 / 1
  manualSpeed: { id: 0x44, size: 1, write: true },              // 0..255 (manual %)
  humidity:    { id: 0x25, size: 1 },                           // % RH
  temperature: { id: 0x35, size: 2, signed: true, scale: 0.1 },  // °C (×10)
  filterDays:  { id: 0x64, size: 2 },                           // filter countdown
  filterAlarm: { id: 0x88, size: 1 },                           // 0 / 1
};

class VentsClient {
  constructor(config, store, sensorRegistry) {
    this.cfg      = config.vents || {};
    this.store    = store;
    this.registry = sensorRegistry;
    this.params   = { ...DEFAULT_PARAMS, ...(this.cfg.params || {}) };
    this.idToName = {};
    for (const [name, p] of Object.entries(this.params)) this.idToName[p.id] = name;
    this.key      = `vents/${this.cfg.deviceId || this.cfg.host}`;
    this.sock     = null;
    this.pollTimer = null;
  }

  async start() {
    const { host, deviceId } = this.cfg;
    if (!host) return;
    if (!deviceId) console.warn('[VENTS] No deviceId set — reads may be rejected by the unit');

    this.sock = dgram.createSocket('udp4');
    this.sock.on('message', (msg) => this._onMessage(msg));
    this.sock.on('error', (err) => console.error(`[VENTS] Socket error: ${err.message}`));
    await new Promise((res) => this.sock.bind(res));

    this._registerDevice();
    platformStatus.set('vents', true);

    const secs = this.cfg.pollInterval || 30;
    this._poll();
    this.pollTimer = setInterval(() => this._poll(), secs * 1000);
    console.log(`[VENTS] Started — ${host}:${this.cfg.port || 4000}, polling every ${secs}s`);
  }

  stop() {
    clearInterval(this.pollTimer);
    if (this.sock) { try { this.sock.close(); } catch {} this.sock = null; }
  }

  // ── Device registration ──────────────────────────────────────────────────

  _registerDevice() {
    const sensors = [
      { path: 'state', name: 'Power', type: 'boolean', controllable: true,
        capabilityId: 'state', writeOn: 'on', writeOff: 'off', homekit: 'switch-rw' },
      { path: 'speed', name: 'Speed', type: 'range', controllable: true,
        capabilityId: 'speed', writeCmd: 'setSpeed', min: 1, max: 3 },
      { path: 'boost', name: 'Boost', type: 'boolean', controllable: true,
        capabilityId: 'boost', writeOn: 'on', writeOff: 'off' },
      { path: 'manualSpeed', name: 'Manual %', type: 'range', controllable: true,
        capabilityId: 'manualSpeed', writeCmd: 'setManual', min: 0, max: 100, unit: '%' },
      { path: 'temperature', name: 'Temperature', type: 'number', unit: '°C', homekit: 'temperature' },
      { path: 'humidity',    name: 'Humidity',    type: 'number', unit: '%',  homekit: 'humidity' },
      { path: 'filterDays',  name: 'Filter',      type: 'number', unit: 'd' },
      { path: 'filterAlarm', name: 'Filter alarm', type: 'boolean' },
    ].filter((s) => this.params[s.path]); // only expose configured params

    const device = {
      key:     this.key,
      type:    'vents',
      label:   this.cfg.name || 'Ventilation',
      icon:    '🌀',
      color:   'teal',
      homekit: [...new Set(sensors.map((s) => s.homekit).filter(Boolean))],
      sensors,
      _writeCapability: (capId, command, args = []) => this._write(capId, command, args[0]),
    };
    this.registry.registerDevice(device);
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  _write(capId, command, value) {
    const p = this.params[capId];
    if (!p || !p.write) throw new Error(`VENTS: '${capId}' is not writable`);
    let v;
    if (capId === 'state' || capId === 'boost') v = command === 'on' ? 1 : 0;
    else if (capId === 'manualSpeed')           v = Math.round(Math.max(0, Math.min(100, Number(value))) * 255 / 100);
    else                                        v = Math.round(Number(value)); // speed
    this._send(FUNC.WRITEREAD, [p.id, v & 0xFF]);
    // refresh shortly after so the dashboard/HomeKit reflect the new state
    setTimeout(() => this._poll(), 400);
    return Promise.resolve();
  }

  // ── Polling ──────────────────────────────────────────────────────────────

  _poll() {
    // request every configured parameter id (all ≤ 0xFF here)
    const ids = Object.values(this.params).map((p) => p.id);
    this._send(FUNC.READ, ids);
  }

  // ── UDP packet build / parse ─────────────────────────────────────────────

  _send(func, data) {
    if (!this.sock) return;
    const id  = Buffer.from(String(this.cfg.deviceId || ''), 'ascii');
    const pwd = Buffer.from(String(this.cfg.password || '1111'), 'ascii');
    const body = [PROTOCOL, id.length, ...id, pwd.length, ...pwd, func, ...data];
    let chk = 0;
    for (const b of body) chk = (chk + b) & 0xFFFF;
    const pkt = Buffer.from([...HEADER, ...body, chk & 0xFF, (chk >> 8) & 0xFF]);
    this.sock.send(pkt, this.cfg.port || 4000, this.cfg.host, (err) => {
      if (err) console.error(`[VENTS] Send failed: ${err.message}`);
    });
  }

  _onMessage(buf) {
    if (buf.length < 6 || buf[0] !== 0xFD || buf[1] !== 0xFD) return;
    let i = 3;                       // skip FD FD + protocol byte
    i += 1 + buf[i];                 // idLen + id
    if (i >= buf.length) return;
    i += 1 + buf[i];                 // pwdLen + pwd
    i += 1;                          // function byte
    const end = buf.length - 2;      // exclude checksum

    let size = 1, page = 0;
    while (i < end) {
      const b = buf[i++];
      if (b === SIZE_MARK) { size = buf[i++]; continue; }
      if (b === PAGE_MARK) { page = buf[i++]; continue; }
      const id = (page << 8) | b;
      let raw = 0;
      for (let k = 0; k < size && i < end; k++) raw |= buf[i++] << (8 * k);
      this._apply(id, raw, size);
    }
    platformStatus.set('vents', true);
  }

  _apply(id, raw, size) {
    const name = this.idToName[id];
    if (!name) return;
    const p = this.params[name];
    let val = raw;
    if (p.signed) {
      const bits = (p.size || size) * 8;
      if (val >= (1 << (bits - 1))) val -= (1 << bits);
    }
    if (p.scale) val = Math.round(val * p.scale * 10) / 10;
    if (name === 'manualSpeed') val = Math.round(val * 100 / 255); // report as %
    if (name === 'state' || name === 'boost' || name === 'filterAlarm') val = val ? 1 : 0;
    this.store.update(`${this.key}/${name}`, val);
  }
}

module.exports = VentsClient;
