'use strict';

const crypto = require('crypto');
const dgram  = require('dgram');
const fs     = require('fs');
const path   = require('path');

let platformStatus;
try { platformStatus = require('./platform-status'); } catch { platformStatus = { set: () => {} }; }

const BROADLINK_PORT = 80;
const DEFAULT_KEY    = Buffer.from('097628343fe99e23765c1513accfd925', 'hex');
const DEFAULT_IV     = Buffer.from('562e17996d093d28ddb3ba695a2e6f58', 'hex');
const CODES_FILE     = path.join(__dirname, '..', 'persist', 'broadlink-codes.json');

// ── Crypto ──────────────────────────────────────────────────────────────────

function aesEncrypt(key, iv, data) {
  const pad = (16 - (data.length % 16)) % 16;
  const buf = pad ? Buffer.concat([data, Buffer.alloc(pad)]) : data;
  const c = crypto.createCipheriv('aes-128-cbc', key, iv);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(buf), c.final()]);
}

function aesDecrypt(key, iv, data) {
  const c = crypto.createDecipheriv('aes-128-cbc', key, iv);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data), c.final()]);
}

function cs16(buf) {
  let cs = 0xbeaf;
  for (const b of buf) cs = (cs + b) & 0xffff;
  return cs;
}

// ── Packet ──────────────────────────────────────────────────────────────────

function buildPacket({ command, mac, id, key, iv, payload, count }) {
  const pad = (16 - (payload.length % 16)) % 16;
  const raw = pad ? Buffer.concat([payload, Buffer.alloc(pad)]) : payload;

  const hdr = Buffer.alloc(0x38, 0);
  hdr[0x00] = 0x5a; hdr[0x01] = 0xa5; hdr[0x02] = 0xaa; hdr[0x03] = 0x55;
  hdr[0x04] = 0x5a; hdr[0x05] = 0xa5; hdr[0x06] = 0xaa; hdr[0x07] = 0x55;
  hdr[0x24] = 0x2a; hdr[0x25] = 0x27;
  hdr[0x26] = command & 0xff;
  hdr[0x27] = (command >> 8) & 0xff;
  hdr[0x28] = count & 0xff;
  hdr[0x29] = (count >> 8) & 0xff;
  mac.copy(hdr, 0x2a);
  id.copy(hdr, 0x30);
  const pcs = cs16(raw);
  hdr[0x34] = pcs & 0xff;
  hdr[0x35] = (pcs >> 8) & 0xff;

  const enc = aesEncrypt(key, iv, raw);
  const pkt = Buffer.concat([hdr, enc]);
  const cs  = cs16(pkt);
  pkt[0x20]  = cs & 0xff;
  pkt[0x21]  = (cs >> 8) & 0xff;
  return pkt;
}

function parseResponse(data, key, iv) {
  if (data.length < 0x38) return null;
  const errCode = data.readUInt16LE(0x22);
  if (errCode !== 0) throw new Error(`Device error 0x${errCode.toString(16)}`);
  if (data.length <= 0x38) return Buffer.alloc(0);
  return aesDecrypt(key, iv, data.slice(0x38));
}

// ── Device ──────────────────────────────────────────────────────────────────

class BroadlinkDevice {
  constructor(host, macStr) {
    this.host   = host;
    this.mac    = macStr ? Buffer.from(macStr.replace(/[:\-]/g, ''), 'hex') : Buffer.alloc(6);
    this.key    = Buffer.from(DEFAULT_KEY);
    this.iv     = Buffer.from(DEFAULT_IV);
    this.id     = Buffer.alloc(4);
    this._count = 0;
    this.authed = false;
  }

  _tick() { return (this._count = (this._count + 1) & 0xffff); }

  _send(pkt, ms = 5000) {
    return new Promise((resolve, reject) => {
      const sock  = dgram.createSocket('udp4');
      const timer = setTimeout(() => { sock.close(); reject(new Error(`Timeout: ${this.host}`)); }, ms);
      sock.on('message', msg => { clearTimeout(timer); sock.close(); resolve(msg); });
      sock.on('error',   err => { clearTimeout(timer); sock.close(); reject(err); });
      sock.send(pkt, BROADLINK_PORT, this.host, err => {
        if (err) { clearTimeout(timer); sock.close(); reject(err); }
      });
    });
  }

  async auth() {
    const payload = Buffer.alloc(0x50, 0);
    for (let i = 0x04; i <= 0x12; i++) payload[i] = 0x31;
    payload[0x1e] = 0x01;
    payload[0x2d] = 0x01;
    Buffer.from('LSH\x00\x00\x00').copy(payload, 0x30);

    const pkt = buildPacket({ command: 0x0065, mac: this.mac, id: this.id, key: this.key, iv: this.iv, payload, count: this._tick() });
    const resp = await this._send(pkt);
    const dec  = parseResponse(resp, this.key, this.iv);
    this.id    = dec.slice(0x00, 0x04);
    this.key   = dec.slice(0x04, 0x14);
    this.authed = true;
  }

  async _cmd(payload) {
    if (!this.authed) await this.auth();
    const pkt  = buildPacket({ command: 0x006a, mac: this.mac, id: this.id, key: this.key, iv: this.iv, payload, count: this._tick() });
    const resp = await this._send(pkt);
    return parseResponse(resp, this.key, this.iv);
  }

  async sendCode(dataHex) {
    const data = Buffer.from(dataHex, 'hex');
    await this._cmd(Buffer.concat([Buffer.from([0x02, 0x00, 0x00, 0x00]), data]));
  }

  async enterLearning() {
    await this._cmd(Buffer.from([0x03, 0x00, 0x00, 0x00]));
  }

  async checkIRData() {
    const dec = await this._cmd(Buffer.from([0x04, 0x00, 0x00, 0x00]));
    if (!dec || dec.length < 5 || dec[0] !== 0) return null;
    return dec.slice(0x04).toString('hex');
  }

  async cancelLearning() {
    try { await this._cmd(Buffer.from([0x1e, 0x00, 0x00, 0x00])); } catch { /* ignore */ }
  }

  // RF (RM4 Pro only)
  async enterRFSweep() {
    await this._cmd(Buffer.from([0x19, 0x00, 0x00, 0x00]));
  }

  async checkRFFrequency() {
    const dec = await this._cmd(Buffer.from([0x1a, 0x00, 0x00, 0x00]));
    if (!dec || dec[0] !== 1) return null;
    return dec.slice(0x01, 0x05);
  }

  async enterRFLearn(freqBuf) {
    const cmd = Buffer.concat([Buffer.from([0x1b]), freqBuf, Buffer.alloc(3)]);
    await this._cmd(cmd);
  }

  async checkRFData() {
    const dec = await this._cmd(Buffer.from([0x1c, 0x00, 0x00, 0x00]));
    if (!dec || dec.length < 5 || dec[0] !== 0) return null;
    return dec.slice(0x04).toString('hex');
  }
}

// ── Code store ───────────────────────────────────────────────────────────────

function loadCodes() {
  try { return JSON.parse(fs.readFileSync(CODES_FILE, 'utf8')); } catch { return {}; }
}

function persistCodes(codes) {
  fs.mkdirSync(path.dirname(CODES_FILE), { recursive: true });
  fs.writeFileSync(CODES_FILE, JSON.stringify(codes, null, 2));
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── BroadlinkClient ──────────────────────────────────────────────────────────

class BroadlinkClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._registry = sensorRegistry;
    this._devMap   = new Map();
    this._codes    = loadCodes();
  }

  async start() {
    const cfgs = this._config.broadlink?.devices || [];
    let anyOk = false;
    for (const cfg of cfgs) {
      if (!cfg.host) continue;
      const dev = new BroadlinkDevice(cfg.host, cfg.mac || '');
      this._devMap.set(cfg.host, dev);
      try {
        await dev.auth();
        console.log(`[Broadlink] ${cfg.name || cfg.host} — OK`);
        anyOk = true;
      } catch (err) {
        console.error(`[Broadlink] ${cfg.host} — auth failed: ${err.message}`);
      }
      this._registerDevice(cfg);
    }
    platformStatus.set('broadlink', anyOk);
  }

  _buildSensors(host) {
    return Object.entries(this._codes[host] || {}).map(([name, entry]) => ({
      path:         `code__${safePath(name)}`,
      name,
      format:       'on-off',
      controllable: true,
      type:         'trigger',
      capabilityId: name,
      writeOn:      'send',
      writeOff:     null,
    }));
  }

  _registerDevice(cfg) {
    const key = deviceKey(cfg.host);
    if (!this._registry.devices.has(key)) {
      const self = this;
      this._registry.registerDevice({
        key,
        label:  cfg.name || `BroadLink ${cfg.host}`,
        icon:   '📡',
        color:  'purple',
        sensors: this._buildSensors(cfg.host),
        _writeCapability: async (capId, command) => {
          if (command !== 'send') return;
          await self._sendCode(cfg.host, capId);
        },
      });
    } else {
      this._registry.devices.get(key).sensors = this._buildSensors(cfg.host);
    }
  }

  async _sendCode(host, codeName) {
    const entry = this._codes[host]?.[codeName];
    if (!entry) throw new Error(`Code "${codeName}" not found`);
    const dev = this._devMap.get(host);
    if (!dev) throw new Error(`Device ${host} not connected`);
    try {
      await dev.sendCode(entry.data);
    } catch {
      await dev.auth();
      await dev.sendCode(entry.data);
    }
  }

  _refreshSensors(host) {
    const key = deviceKey(host);
    if (this._registry.devices.has(key)) {
      this._registry.devices.get(key).sensors = this._buildSensors(host);
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  getDevice(host)  { return this._devMap.get(host); }
  getCodes(host)   { return this._codes[host] || {}; }
  getAllCodes()    { return this._codes; }

  saveCode(host, name, type, dataHex) {
    if (!this._codes[host]) this._codes[host] = {};
    this._codes[host][name] = { type, data: dataHex, learned: new Date().toISOString() };
    persistCodes(this._codes);
    this._refreshSensors(host);
  }

  deleteCode(host, name) {
    if (this._codes[host]?.[name] !== undefined) {
      delete this._codes[host][name];
      persistCodes(this._codes);
      this._refreshSensors(host);
    }
  }

  async sendCode(host, name) {
    return this._sendCode(host, name);
  }

  async learnIR(host, name, onStatus) {
    const dev = this._devMap.get(host);
    if (!dev) throw new Error(`Device ${host} not found`);
    if (!dev.authed) await dev.auth();

    await dev.enterLearning();
    onStatus('learning');

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await delay(800);
      const secs = Math.ceil((deadline - Date.now()) / 1000);
      onStatus(`waiting:${secs}`);
      try {
        const hex = await dev.checkIRData();
        if (hex) {
          this.saveCode(host, name, 'ir', hex);
          return hex;
        }
      } catch { /* no data yet */ }
    }
    await dev.cancelLearning();
    throw new Error('Timeout: no IR signal received in 20 s');
  }

  async learnRF(host, name, onStatus) {
    const dev = this._devMap.get(host);
    if (!dev) throw new Error(`Device ${host} not found`);
    if (!dev.authed) await dev.auth();

    onStatus('rf_sweep');
    await dev.enterRFSweep();

    let freqBuf = null;
    const sweepEnd = Date.now() + 10000;
    while (Date.now() < sweepEnd) {
      await delay(500);
      try { freqBuf = await dev.checkRFFrequency(); if (freqBuf) break; } catch { /* sweeping */ }
    }
    if (!freqBuf) throw new Error('RF frequency not found — hold the RF button during sweep');

    onStatus('rf_learn');
    await dev.enterRFLearn(freqBuf);

    const learnEnd = Date.now() + 15000;
    while (Date.now() < learnEnd) {
      await delay(800);
      onStatus(`waiting:${Math.ceil((learnEnd - Date.now()) / 1000)}`);
      try {
        const hex = await dev.checkRFData();
        if (hex) {
          this.saveCode(host, name, 'rf', hex);
          return hex;
        }
      } catch { /* still learning */ }
    }
    throw new Error('Timeout: no RF code received');
  }
}

function deviceKey(host) { return `broadlink/${host.replace(/\./g, '_')}`; }
function safePath(str)    { return str.replace(/[^a-zA-Z0-9_-]/g, '_'); }

module.exports = BroadlinkClient;
