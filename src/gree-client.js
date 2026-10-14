'use strict';

// Gree air conditioners — local UDP protocol of the Gree+ / EWPE Smart apps
// (as used by greeclimate). Also the many Gree-made brands on those apps:
// Sinclair, Cooper&Hunter, Tosot, Bulex, Kinghome, Ekokai, Proklima,
// Daitsu, Heiwa, Innova…
//
// UDP port 7000, JSON. Every request/answer carries an AES-encrypted "pack":
//   firmware < ~1.21  AES-128-ECB (PKCS7), generic key "a3K8Bx%2r8Y7#xDh"
//   newer firmware    AES-128-GCM, generic key "{yxAHAY_Lm6pbC/<", fixed
//                     nonce, aad "qualcomm-test", tag in the message's "tag"
// scan   {"t":"scan"}                        → pack {t:"dev", mac, name, ver}
// bind   pack {mac, t:"bind", uid:0}         → pack {t:"bindok", key}  (generic key)
// status pack {cols:[…], mac, t:"status"}    → pack {t:"dat", cols, dat}  (device key)
// cmd    pack {opt:[…], p:[…], t:"cmd"}      → pack {t:"res", opt, p}
//
//   Pow 0/1 · Mod 0 auto, 1 cool, 2 dry, 3 fan, 4 heat · SetTem °C
//   WdSpd 0 auto, 1 low … 5 high · Quiet · Tur(bo) · SwUpDn 0 off, 1 full swing
//   TemSen room temperature (+40 offset, except v4 firmware)
//
// The unit must already be on the Wi-Fi (set up once with the Gree+ / EWPE
// Smart app). One LSH device per unit, `gree/<mac>`, with the shared AC model
// of src/ac-common.js.
//
// config.gree = { devices: [{ host, mac?, key?, encryption?: 'ecb'|'gcm', name? }], pollInterval = 15 (s) }
//   mac / key are learned (scan + bind) when not given.
// Tested against scripts/gree-simulator.js (test/gree.test.js) — not yet
// against a real unit.

const dgram = require('dgram');
const crypto = require('crypto');
const PollingClient = require('./polling-client');
const { registerAc, publishAc } = require('./ac-common');

const PORT = 7000;
const TIMEOUT_MS = 3000;
const GENERIC = { ecb: 'a3K8Bx%2r8Y7#xDh', gcm: '{yxAHAY_Lm6pbC/<' };
const GCM_IV = Buffer.from('5440784449675a516c5e6313', 'hex');
const GCM_AAD = Buffer.from('qualcomm-test');
const COLS = ['Pow', 'Mod', 'SetTem', 'TemUn', 'WdSpd', 'Tur', 'Quiet', 'SwUpDn', 'TemSen'];
const MODES = ['auto', 'cool', 'dry', 'fan', 'heat'];

function encrypt(obj, key, enc) {
  const data = Buffer.from(JSON.stringify(obj));
  if (enc === 'gcm') {
    const c = crypto.createCipheriv('aes-128-gcm', Buffer.from(key), GCM_IV);
    c.setAAD(GCM_AAD);
    const pack = Buffer.concat([c.update(data), c.final()]).toString('base64');
    return { pack, tag: c.getAuthTag().toString('base64') };
  }
  const c = crypto.createCipheriv('aes-128-ecb', Buffer.from(key), null);
  return { pack: Buffer.concat([c.update(data), c.final()]).toString('base64') };
}

function decrypt(msg, key, enc) {
  const data = Buffer.from(msg.pack, 'base64');
  let out;
  if (enc === 'gcm') {
    const d = crypto.createDecipheriv('aes-128-gcm', Buffer.from(key), GCM_IV);
    d.setAAD(GCM_AAD);
    d.setAuthTag(Buffer.from(msg.tag || '', 'base64'));
    out = Buffer.concat([d.update(data), d.final()]);
  } else {
    const d = crypto.createDecipheriv('aes-128-ecb', Buffer.from(key), null);
    out = Buffer.concat([d.update(data), d.final()]);
  }
  return JSON.parse(out.toString('utf8').replace(/[\0-\x1f]+$/, ''));
}

// one UDP request / answer
function udp(host, port, msg) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    const t = setTimeout(() => { s.close(); reject(new Error(`${host}: no answer`)) }, TIMEOUT_MS);
    s.on('message', (raw) => {
      clearTimeout(t); s.close();
      try { resolve(JSON.parse(raw.toString())) } catch (e) { reject(new Error(`${host}: bad answer`)) }
    });
    s.on('error', (e) => { clearTimeout(t); try { s.close() } catch {} reject(e) });
    s.send(Buffer.from(JSON.stringify(msg)), port, host);
  });
}

class GreeClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'gree', logTag: 'Gree' });
    this.cfg = config.gree || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.units = [];
  }

  async start() {
    const devs = Array.isArray(this.cfg.devices) ? this.cfg.devices.filter((d) => d?.host) : [];
    if (!devs.length) throw new Error('config.gree.devices needs at least one { host }');
    this.units = devs.map((d) => {
      const [host, port] = String(d.host).split(':');
      return { conf: d, host, port: Number(port) || PORT, mac: d.mac ? String(d.mac).toLowerCase().replace(/[^0-9a-f]/g, '') : null,
        devKey: d.key || null, enc: d.encryption === 'gcm' || d.encryption === 'ecb' ? d.encryption : null, ver: null, key: null, last: {} };
    });
    await this.startPolling(Math.max(5, Number(this.cfg.pollInterval) || 15) * 1000);
  }

  async _scan(u) {
    const r = await udp(u.host, u.port, { t: 'scan' });
    if (!r.pack) throw new Error(`${u.host}: not a Gree unit`);
    const enc = u.enc || (r.tag ? 'gcm' : 'ecb');
    const dev = decrypt(r, GENERIC[enc], enc);
    u.enc = enc;
    u.mac = u.mac || String(dev.mac || dev.cid || '').toLowerCase();
    u.ver = dev.ver || dev.hid || null;
    u.name = dev.name;
    if (!u.mac) throw new Error(`${u.host}: no MAC in the scan answer`);
  }

  async _bind(u) {
    const tryBind = async (enc) => {
      const inner = enc === 'gcm' ? { cid: u.mac, mac: u.mac, t: 'bind', uid: 0 } : { mac: u.mac, t: 'bind', uid: 0 };
      const r = await udp(u.host, u.port, { cid: 'app', i: 1, t: 'pack', uid: 0, tcid: u.mac, ...encrypt(inner, GENERIC[enc], enc) });
      const p = decrypt(r, GENERIC[enc], enc);
      if (p.t !== 'bindok' || !p.key) throw new Error(`${u.host}: bind refused`);
      return p.key;
    };
    try { u.devKey = await tryBind(u.enc || 'ecb'); u.enc = u.enc || 'ecb' } catch (err) {
      if (u.conf.encryption) throw err;
      u.devKey = await tryBind(u.enc === 'gcm' ? 'ecb' : 'gcm'); // the scan's guess was wrong
      u.enc = u.enc === 'gcm' ? 'ecb' : 'gcm';
    }
  }

  async _pack(u, inner) {
    const r = await udp(u.host, u.port, { cid: 'app', i: 0, t: 'pack', uid: 0, tcid: u.mac, ...encrypt(inner, u.devKey, u.enc) });
    if (!r.pack) throw new Error(`${u.host}: bad answer`);
    return decrypt(r, u.devKey, u.enc);
  }

  async _pollImpl() {
    let ok = 0; const errs = [];
    for (const u of this.units) {
      try { await this._pollUnit(u); ok++ } catch (err) {
        errs.push(err.message);
        if (u.key) publishAc(this.store, u.key, { online: false });
        if (!u.conf.key) u.devKey = null; // re-bind next time (unit reset / re-paired)
      }
    }
    if (!ok) throw new Error(errs.join('; '));
    if (errs.length) console.warn(`[Gree] ${errs.join('; ')}`);
  }

  async _pollUnit(u) {
    if (!u.mac || (!u.enc && !u.devKey)) await this._scan(u);
    if (!u.enc) u.enc = 'ecb';
    if (!u.devKey) await this._bind(u);
    if (!u.key) {
      u.key = `gree/${u.mac}`;
      registerAc(this.registry, {
        key: u.key, label: u.conf.name || u.name || `Gree ${u.mac.slice(-4)}`, type: 'gree', model: 'Gree Wi-Fi',
        features: { swing: true, minTemp: 16, maxTemp: 30, step: 1 },
        set: (patch) => this.set(u, patch),
      });
      console.log(`[Gree] ${u.host}: ${u.mac} (${u.enc.toUpperCase()}${u.ver ? `, ${u.ver}` : ''})`);
    }
    const p = await this._pack(u, { cols: COLS, mac: u.mac, t: 'status' });
    if (p.t !== 'dat' || !Array.isArray(p.cols)) throw new Error(`${u.host}: no status`);
    const v = Object.fromEntries(p.cols.map((c, i) => [c, p.dat[i]]));
    u.last = v;
    publishAc(this.store, u.key, { online: true, ...this._state(u, v) });
  }

  _state(u, v) {
    const s = {};
    if (v.Pow !== undefined) s.power = v.Pow === 1;
    if (v.Mod !== undefined) s.mode = MODES[v.Mod];
    if (v.SetTem !== undefined) s.targetTemp = v.SetTem;
    if (v.WdSpd !== undefined) s.fan = v.Tur ? 5 : v.Quiet ? 1 : [0, 2, 2, 3, 4, 4][v.WdSpd] ?? 0;
    if (v.SwUpDn !== undefined) s.swing = v.SwUpDn === 1;
    if (v.TemSen) {
      const major = Number(String(u.ver || '').replace(/^\D+/, '').split('.')[0]);
      s.temperature = major === 4 ? v.TemSen : v.TemSen - 40;
    }
    return s;
  }

  async set(u, patch) {
    if (!u.devKey) throw new Error(`Gree ${u.host}: not bound yet`);
    const o = {};
    if (patch.power !== undefined) o.Pow = patch.power ? 1 : 0;
    if (patch.mode) o.Mod = MODES.indexOf(patch.mode);
    if (patch.targetTemp !== undefined) { o.SetTem = Math.round(patch.targetTemp); o.TemUn = 0 }
    if (patch.fan !== undefined) Object.assign(o, [
      { WdSpd: 0, Quiet: 0, Tur: 0 }, { WdSpd: 1, Quiet: 1, Tur: 0 }, { WdSpd: 1, Quiet: 0, Tur: 0 },
      { WdSpd: 3, Quiet: 0, Tur: 0 }, { WdSpd: 5, Quiet: 0, Tur: 0 }, { WdSpd: 5, Quiet: 0, Tur: 1 },
    ][patch.fan]);
    if (patch.swing !== undefined) o.SwUpDn = patch.swing ? 1 : 0;
    const r = await this._pack(u, { opt: Object.keys(o), p: Object.values(o), t: 'cmd' });
    if (r.t !== 'res') throw new Error(`Gree ${u.host}: command not acknowledged`);
    Object.assign(u.last, o);
    publishAc(this.store, u.key, this._state(u, u.last));
  }
}

module.exports = GreeClient;
module.exports.encrypt = encrypt;
module.exports.decrypt = decrypt;
