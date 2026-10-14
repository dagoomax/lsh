'use strict';

// Midea air conditioners — local LAN protocol (as used by msmart-ng and
// midea-local). Covers the Midea-made units sold under Midea, Comfee,
// Carrier, Toshiba (newer), Pioneer, Electrolux, Inventor, Qlima, Trotec,
// Klimaire, Senville… on the Midea Air / NetHome Plus / SmartHome (MSmartHome)
// apps.
//
// TCP port 6444. Three layers:
//   AA frame    the AC command: AA len AC 00 00 00 00 00 00 type | body | msgId crc8 | checksum
//               query 0x41 → state 0xC0, set 0x40 (answered with a 0xC0 state)
//   5A5A packet 40-byte header (device id, timestamp) + AES-128-ECB(frame,
//               key md5(SIGN_KEY)) + md5(packet + SIGN_KEY)
//   8370 (V3)   newer units (most since ~2019): a handshake with the unit's
//               token (64 bytes) and key (32 bytes) gives a session key;
//               5A5A packets then travel AES-256-CBC encrypted + sha256 signed.
//               V2 units take the 5A5A packets as they are.
//
// token / key come from the Midea cloud once — get them with
// `pip install msmart-ng && msmart-ng discover <ip>` (prints id, token, key).
//
//   state  power · mode 1 auto, 2 cool, 3 dry, 4 heat, 5 fan · target °C (0.5)
//          fan 102 auto, 20 silent, 40 low, 60 medium, 80 high, 100 max
//          swing 0 off, 0x0C vertical, 0x03 horizontal, 0x0F both
//          indoor / outdoor temperature
//
// One LSH device per unit, `midea/<id>`, with the shared AC model of
// src/ac-common.js.
//
// config.midea = { devices: [{ host, id, token?, key?, port = 6444, name?, beep = true }], pollInterval = 30 (s) }
// Tested against scripts/midea-simulator.js (test/midea.test.js) — not yet
// against a real unit.

const net = require('net');
const crypto = require('crypto');
const PollingClient = require('./polling-client');
const { registerAc, publishAc } = require('./ac-common');

const TIMEOUT_MS = 6000;
const SIGN_KEY = Buffer.from('xhdiwjnchekd4d512chdjx5d8e4c394D2D7S');
const ENC_KEY = crypto.createHash('md5').update(SIGN_KEY).digest();
const T = { HANDSHAKE_REQUEST: 0x0, HANDSHAKE_RESPONSE: 0x1, ENCRYPTED_RESPONSE: 0x3, ENCRYPTED_REQUEST: 0x6 };
const MODE_FROM = { 1: 'auto', 2: 'cool', 3: 'dry', 4: 'heat', 5: 'fan' };
const MODE_TO = { auto: 1, cool: 2, dry: 3, heat: 4, fan: 5 };
const FAN_STEPS = [102, 20, 40, 60, 80, 100];

// ── AA frame ────────────────────────────────────────────────────────────────
function crc8(buf) {
  let crc = 0;
  for (const b of buf) { crc ^= b; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >> 1) ^ 0x8c : crc >> 1 }
  return crc;
}
const checksum = (buf) => (~buf.reduce((s, b) => s + b, 0) + 1) & 0xff;

function frame(type, body, msgId) {
  const payload = Buffer.concat([body, Buffer.from([msgId & 0xff])]);
  const withCrc = Buffer.concat([payload, Buffer.from([crc8(payload)])]);
  const f = Buffer.concat([Buffer.from([0xaa, withCrc.length + 10, 0xac, 0, 0, 0, 0, 0, 0, type]), withCrc]);
  return Buffer.concat([f, Buffer.from([checksum(f.subarray(1))])]);
}

const QUERY = Buffer.from([0x41, 0x81, 0x00, 0xff, 0x03, 0xff, 0x00, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x03]);

function setBody(s) {
  const t = Math.round(s.targetTemp * 2) / 2, whole = Math.floor(t), half = t - whole ? 0x10 : 0;
  const inRange = whole >= 17 && whole <= 30;
  const b = Buffer.alloc(21);                          // 0x40 + 20 bytes (midea-local MessageGeneralSet)
  b[0] = 0x40;
  b[1] = 0x02 | (s.beep === false ? 0 : 0x40) | (s.power ? 1 : 0); // remote control source, beep, power
  b[2] = ((inRange ? (whole - 16) & 0x0f : 0) | half) | ((MODE_TO[s.mode] & 0x7) << 5);
  b[3] = s.fanRaw ?? 102;
  b[4] = 0x7f; b[5] = 0x7f; b[6] = 0;                  // timers off
  b[7] = 0x30 | ((s.swingRaw ?? 0) & 0x3f);
  b[9] = s.eco ? 0x80 : 0;
  b[18] = inRange ? 0 : (whole - 12) & 0x1f;           // alternate temperature field (< 17 / > 30 °C)
  return b;
}

function parseTemp(v, dec) {
  if (v === 0xff || v === undefined) return undefined;
  let t = (v - 50) / 2;
  if (dec) t = t >= 0 ? Math.trunc(t) + dec * 0.1 : Math.trunc(t) - dec * 0.1;
  return Math.round(t * 10) / 10;
}

// state body (starts with 0xC0) → raw state
function parseState(p) {
  if (p[0] !== 0xc0 || p.length < 14) return null;
  const s = {
    power: !!(p[1] & 1),
    targetTemp: (p[2] & 0x0f) + 16 + (p[2] & 0x10 ? 0.5 : 0),
    modeRaw: (p[2] >> 5) & 0x7,
    fanRaw: p[3] & 0x7f,
    swingRaw: p[7] & 0x0f,
    eco: !!(p[9] & 0x10),
    indoor: parseTemp(p[11], p.length > 15 ? p[15] & 0x0f : 0),
    outdoor: parseTemp(p[12], p.length > 15 ? p[15] >> 4 : 0),
  };
  if (p[13] & 0x1f) s.targetTemp = (p[13] & 0x1f) + 12 + (p[2] & 0x10 ? 0.5 : 0);
  return s;
}

// AA frame → body without the msgId / crc8 / checksum
function unframe(f) {
  if (f[0] !== 0xaa || f.length < 13 || f[1] + 1 > f.length) throw new Error('bad frame');
  if (checksum(f.subarray(1, f[1])) !== f[f[1]]) throw new Error('frame checksum mismatch');
  return f.subarray(10, f[1] - 1);
}

// ── 5A5A packet ─────────────────────────────────────────────────────────────
function packet(deviceId, f) {
  const c = crypto.createCipheriv('aes-128-ecb', ENC_KEY, null);
  const enc = Buffer.concat([c.update(f), c.final()]);
  const h = Buffer.alloc(40);
  h[0] = 0x5a; h[1] = 0x5a; h[2] = 0x01; h[3] = 0x11; h[6] = 0x20;
  const d = new Date();
  Buffer.from([Math.floor(d.getMilliseconds() / 10), d.getSeconds(), d.getMinutes(), d.getHours(), d.getDate(), d.getMonth() + 1, d.getFullYear() % 100, Math.floor(d.getFullYear() / 100)]).copy(h, 12);
  h.writeBigUInt64LE(BigInt(deviceId), 20);
  const p = Buffer.concat([h, enc]);
  p.writeUInt16LE(p.length + 16, 4);
  return Buffer.concat([p, crypto.createHash('md5').update(Buffer.concat([p, SIGN_KEY])).digest()]);
}

function unpacket(p) {
  if (p[0] !== 0x5a || p[1] !== 0x5a || p.length < 56) throw new Error('bad packet');
  const body = p.subarray(0, -16);
  if (!crypto.createHash('md5').update(Buffer.concat([body, SIGN_KEY])).digest().equals(p.subarray(-16))) throw new Error('packet signature mismatch');
  const d = crypto.createDecipheriv('aes-128-ecb', ENC_KEY, null);
  return Buffer.concat([d.update(p.subarray(40, -16)), d.final()]);
}

// ── 8370 (V3) ───────────────────────────────────────────────────────────────
const cbc = (key, data, decrypt) => {
  const c = (decrypt ? crypto.createDecipheriv : crypto.createCipheriv)('aes-256-cbc', key, Buffer.alloc(16));
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data), c.final()]);
};

class V3Session {
  constructor() { this.tcpKey = null; this.count = 0 }

  encode(data, type) {
    let size = data.length, padding = 0;
    const encrypted = type === T.ENCRYPTED_REQUEST || type === T.ENCRYPTED_RESPONSE;
    if (encrypted && (size + 2) % 16 !== 0) {
      padding = 16 - ((size + 2) & 0x0f);
      size += padding + 32;
      data = Buffer.concat([data, crypto.randomBytes(padding)]);
    }
    const header = Buffer.from([0x83, 0x70, size >> 8, size & 0xff, 0x20, (padding << 4) | type]);
    let body = Buffer.concat([Buffer.from([this.count >> 8, this.count & 0xff]), data]);
    this.count = (this.count + 1) & 0xffff;
    if (encrypted) {
      const sign = crypto.createHash('sha256').update(Buffer.concat([header, body])).digest();
      body = Buffer.concat([cbc(this.tcpKey, body), sign]);
    }
    return Buffer.concat([header, body]);
  }

  // → { packets: [{ type, data }], rest }
  decode(buf) {
    const packets = [];
    while (buf.length >= 6) {
      if (buf[0] !== 0x83 || buf[1] !== 0x70) throw new Error('bad 8370 header');
      const size = buf.readUInt16BE(2) + 8;
      if (buf.length < size) break;
      const header = buf.subarray(0, 6), padding = buf[5] >> 4, type = buf[5] & 0x0f;
      let data = buf.subarray(6, size);
      buf = buf.subarray(size);
      if (type === T.ENCRYPTED_RESPONSE || type === T.ENCRYPTED_REQUEST) {
        const sign = data.subarray(-32);
        data = cbc(this.tcpKey, data.subarray(0, -32), true);
        if (!crypto.createHash('sha256').update(Buffer.concat([header, data])).digest().equals(sign)) throw new Error('8370 signature mismatch');
        if (padding) data = data.subarray(0, -padding);
      }
      packets.push({ type, data: data.subarray(2) });
    }
    return { packets, rest: buf };
  }

  // handshake answer (64 bytes after the count) → session key
  setKey(resp, key) {
    if (resp.length !== 64) throw new Error('handshake refused — check token / key');
    const plain = cbc(key, resp.subarray(0, 32), true);
    if (!crypto.createHash('sha256').update(plain).digest().equals(resp.subarray(32))) throw new Error('handshake failed — wrong token / key');
    this.tcpKey = Buffer.from(plain.map((b, i) => b ^ key[i]));
    this.count = 0;
  }
}

// one connection: (handshake), send a frame, return the AA frame answered
async function exchange(u, f) {
  const sock = net.connect({ host: u.host, port: u.port });
  let buf = Buffer.alloc(0), waiter = null, failed = null;
  const fail = (e) => { failed = failed || e; if (waiter) { const w = waiter; waiter = null; w() } };
  sock.on('data', (d) => { buf = Buffer.concat([buf, d]); if (waiter) { const w = waiter; waiter = null; w() } });
  sock.on('error', fail);
  sock.on('close', () => fail(new Error(`${u.host}: connection closed`)));
  const deadline = Date.now() + TIMEOUT_MS;
  const more = () => new Promise((resolve, reject) => {
    if (failed) return reject(failed);
    const t = setTimeout(() => { waiter = null; reject(new Error(`${u.host}: no answer`)) }, Math.max(1, deadline - Date.now()));
    waiter = () => { clearTimeout(t); failed ? reject(failed) : resolve() };
  });
  try {
    await new Promise((resolve, reject) => { sock.once('connect', resolve); sock.once('error', reject); setTimeout(() => reject(new Error(`${u.host}: connect timed out`)), TIMEOUT_MS) });
    const pkt = packet(u.id, f);
    if (u.token) {
      const v3 = new V3Session();
      sock.write(v3.encode(u.token, T.HANDSHAKE_REQUEST));
      for (;;) {
        if (buf.length >= 6 && buf[0] === 0x83 && buf.length >= buf.readUInt16BE(2) + 8) break;
        if (buf.length >= 5 && buf.subarray(0, 5).toString() === 'ERROR') throw new Error(`${u.host}: handshake refused — check token / key`);
        await more();
      }
      const size = buf.readUInt16BE(2) + 8;
      v3.setKey(buf.subarray(8, size), u.key);
      buf = buf.subarray(size);
      sock.write(v3.encode(pkt, T.ENCRYPTED_REQUEST));
      for (;;) {
        const { packets, rest } = v3.decode(buf);
        buf = rest;
        for (const p of packets) {
          if (p.data[0] !== 0x5a) continue;
          const body = unframe(unpacket(p.data));
          if (body[0] === 0xc0) return body;
        }
        await more();
      }
    }
    sock.write(pkt);
    for (;;) {
      while (buf.length >= 6 && buf[0] === 0x5a) {
        const len = buf.readUInt16LE(4);
        if (buf.length < len) break;
        const body = unframe(unpacket(buf.subarray(0, len)));
        buf = buf.subarray(len);
        if (body[0] === 0xc0) return body;
      }
      await more();
    }
  } finally { sock.destroy() }
}

class MideaClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'midea', logTag: 'Midea' });
    this.cfg = config.midea || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.units = [];
    this.msgId = 0;
    this.queue = Promise.resolve();
  }

  async start() {
    const devs = Array.isArray(this.cfg.devices) ? this.cfg.devices.filter((d) => d?.host && d?.id) : [];
    if (!devs.length) throw new Error('config.midea.devices needs at least one { host, id } (plus token and key for V3 units — msmart-ng discover)');
    this.units = devs.map((d) => {
      const [host, port] = String(d.host).split(':');
      const token = d.token ? Buffer.from(String(d.token), 'hex') : null, key = d.key ? Buffer.from(String(d.key), 'hex') : null;
      if (token && (token.length !== 64 || !key || key.length !== 32)) throw new Error(`Midea ${host}: token must be 128 hex characters and key 64`);
      return { conf: d, host, port: Number(d.port || port) || 6444, id: String(d.id), token, key, devKey: `midea/${String(d.id).replace(/\D/g, '')}`, state: null, registered: false };
    });
    await this.startPolling(Math.max(10, Number(this.cfg.pollInterval) || 30) * 1000);
  }

  _send(u, type, body) {
    const run = () => exchange(u, frame(type, body, (this.msgId = (this.msgId + 1) & 0xff)));
    const r = this.queue.then(run, run);
    this.queue = r.catch(() => {});
    return r;
  }

  async _pollImpl() {
    let ok = 0; const errs = [];
    for (const u of this.units) {
      try { this._apply(u, await this._send(u, 0x03, QUERY)); ok++ } catch (err) {
        errs.push(`${u.host}: ${err.message.replace(`${u.host}: `, '')}`);
        if (u.registered) publishAc(this.store, u.devKey, { online: false });
      }
    }
    if (!ok) throw new Error(errs.join('; '));
    if (errs.length) console.warn(`[Midea] ${errs.join('; ')}`);
  }

  _apply(u, body) {
    const s = parseState(body);
    if (!s) throw new Error('no state in the answer');
    u.state = s;
    if (!u.registered) {
      u.registered = true;
      registerAc(this.registry, {
        key: u.devKey, label: u.conf.name || `Midea AC ${u.id.slice(-4)}`, type: 'midea', model: u.token ? 'Midea (V3)' : 'Midea (V2)',
        features: { swing: true, outdoor: true, minTemp: 16, maxTemp: 30 },
        set: (patch) => this.set(u, patch),
      });
      console.log(`[Midea] ${u.host}: unit ${u.id} (${u.token ? 'V3' : 'V2'})`);
    }
    const fan = FAN_STEPS.indexOf(s.fanRaw);
    publishAc(this.store, u.devKey, {
      online: true, power: s.power, mode: MODE_FROM[s.modeRaw], targetTemp: s.targetTemp,
      fan: fan >= 0 ? fan : s.fanRaw > 100 ? 0 : s.fanRaw <= 30 ? 1 : s.fanRaw <= 50 ? 2 : s.fanRaw <= 70 ? 3 : s.fanRaw <= 90 ? 4 : 5,
      swing: (s.swingRaw & 0x0c) !== 0, temperature: s.indoor, outdoorTemp: s.outdoor,
    });
  }

  async set(u, patch) {
    if (!u.state) throw new Error(`Midea ${u.host}: no state read yet`);
    const s = { ...u.state, mode: MODE_FROM[u.state.modeRaw] || 'auto', beep: u.conf.beep !== false };
    if (patch.power !== undefined) s.power = patch.power;
    if (patch.mode) s.mode = patch.mode;
    if (patch.targetTemp !== undefined) s.targetTemp = patch.targetTemp;
    if (patch.fan !== undefined) s.fanRaw = FAN_STEPS[patch.fan];
    if (patch.swing !== undefined) s.swingRaw = patch.swing ? (s.swingRaw | 0x0c) : (s.swingRaw & ~0x0c);
    this._apply(u, await this._send(u, 0x02, setBody(s)));
  }
}

module.exports = MideaClient;
Object.assign(module.exports, { frame, unframe, packet, unpacket, parseState, setBody, crc8, V3Session, T, QUERY });
