'use strict';

// Ajax Systems alarm (Hub, Hub Plus, Hub 2 / 2 Plus / Hybrid) — LSH acts as
// the monitoring station the Hub reports to over SIA DC-09 (src/sia-dc09.js),
// on the LAN, no Ajax cloud or partner API. In the Ajax app: Hub → Settings →
// Monitoring Station → protocol SIA DC-09 (SIA-DCS, or Contact ID), the LSH
// IP and port, an object/account number, optionally an encryption key
// (16, 24 or 32 characters) and a ping (link test) interval.
//
// It reports — it can't be controlled: arming from LSH would need Ajax's
// Enterprise API (partners only).
//
// Each account becomes a device ajax/<account>: mode (Disarmed / Armed /
// Night / Partial), armed, alarm (burglary, cleared by disarm or restore),
// fire, water, gas, panic, tamper, power trouble, battery low, online (a
// message or link test within 3 ping intervals), last event. Every event is
// also published as ajax/<account>/event = { code, text, zone, zoneName,
// area, at } for flows. Encrypted messages outside the -40 s…+20 s
// timestamp window are refused (replay protection, as pysiaalarm does).
//
// config.ajax = { port: 12128, accounts: [{ account: 'A1B2', name, key,
//                 pingMinutes: 1, zones: { '5': 'Kuchnia – czujka' },
//                 areas: { '1': 'Dom', '2': 'Garaż' } }] }
//
// The same receiver serves Jablotron (src/jablotron-client.js) — any panel
// that reports SIA DC-09 works; only names, port and device keys differ.
// With areas named, each gets its own mode sensor (area<n>), since arming
// is per area (Ajax groups, Jablotron sections).

const net = require('net');
const dgram = require('dgram');
const platformStatus = require('./platform-status');
const sia = require('./sia-dc09');

const PROVIDERS = {
  ajax: { configKey: 'ajax', prefix: 'ajax', statusKey: 'ajax', logTag: 'Ajax', label: 'Ajax', icon: '🛡️', port: 12128 },
  jablotron: { configKey: 'jablotron', prefix: 'jablotron', statusKey: 'jablotron', logTag: 'Jablotron', label: 'Jablotron', icon: '🛡️', port: 12129 },
};
const WINDOW_BEFORE = 40_000;
const WINDOW_AFTER = 20_000;

// SIA event code → what it does to the panel state
const ARM = { CL: 'Armed', CA: 'Armed', CE: 'Armed', CF: 'Armed', CQ: 'Armed', CR: 'Armed', CS: 'Armed', CJ: 'Armed', NL: 'Night', CG: 'Partial', CP: 'Armed' };
const DISARM = new Set(['OP', 'OA', 'OG', 'OQ', 'OR', 'OS', 'OK', 'OJ']);
const FLAGS = {
  BA: ['alarm', true], BR: ['alarm', false], BV: ['alarm', true], BH: ['alarm', false],
  FA: ['fire', true], FR: ['fire', false], FH: ['fire', false],
  WA: ['water', true], WR: ['water', false], WH: ['water', false],
  GA: ['gas', true], GR: ['gas', false], GH: ['gas', false],
  PA: ['panic', true], PR: ['panic', false], PH: ['panic', false], HA: ['panic', true], HR: ['panic', false],
  TA: ['tamper', true], TR: ['tamper', false], ES: ['tamper', true], EJ: ['tamper', false],
  AT: ['powerTrouble', true], AR: ['powerTrouble', false],
  YT: ['batteryLow', true], YR: ['batteryLow', false], XT: ['batteryLow', true], XR: ['batteryLow', false],
};
const TEXT = {
  CL: 'Armed', CA: 'Armed automatically', CQ: 'Armed remotely', CG: 'Group armed', NL: 'Night mode on', OP: 'Disarmed',
  OA: 'Disarmed automatically', OQ: 'Disarmed remotely', OG: 'Group disarmed', BA: 'Intrusion alarm', BR: 'Intrusion alarm restored',
  BV: 'Intrusion alarm confirmed', FA: 'Fire alarm', FR: 'Fire alarm restored', WA: 'Water leak', WR: 'Water leak restored',
  GA: 'Gas alarm', GR: 'Gas alarm restored', PA: 'Panic button', PR: 'Panic restored', HA: 'Hold-up alarm', TA: 'Tamper',
  TR: 'Tamper restored', AT: 'Mains power lost', AR: 'Mains power restored', YT: 'Hub battery low', YR: 'Hub battery restored',
  XT: 'Device battery low', XR: 'Device battery restored', RP: 'Periodic test', YC: 'Communication fault', YK: 'Communication restored',
  KA: 'Heat alarm', KR: 'Heat alarm restored', CI: 'Arming failed', LB: 'Programming started', LS: 'Programming ended',
};
const FLAG_KEYS = ['alarm', 'fire', 'water', 'gas', 'panic', 'tamper', 'powerTrouble', 'batteryLow'];

class AjaxClient {
  constructor(config, store, sensorRegistry, provider = PROVIDERS.ajax) {
    this._p = provider;
    this._config = config;
    this._store = store;
    this._registry = sensorRegistry;
    this._accounts = new Map(); // ACCOUNT → cfg
    this._lastSeen = new Map();
    this._tcp = null;
    this._udp = null;
    this._timer = null;
  }

  async start() {
    const cfg = this._config[this._p.configKey] || {};
    const tag = `[${this._p.logTag}]`;
    for (const a of cfg.accounts || []) {
      const account = String(a.account || '').trim().toUpperCase();
      if (!/^[0-9A-F]{3,16}$/.test(account)) { console.warn(`${tag} Skipping account "${a.account}" — 3-16 hex characters expected`); continue; }
      const key = a.key ? String(a.key) : undefined;
      if (key && ![16, 24, 32].includes(Buffer.byteLength(key))) { console.warn(`${tag} ${account}: the key must be 16, 24 or 32 characters — ignoring it`); }
      this._accounts.set(account, { ...a, account, key: key && [16, 24, 32].includes(Buffer.byteLength(key)) ? key : undefined });
      this._register(this._accounts.get(account));
    }
    if (!this._accounts.size) return;
    const port = Number(cfg.port) || this._p.port;

    this._tcp = net.createServer((sock) => this._onSocket(sock));
    this._tcp.on('error', (err) => console.error(`${tag} TCP ${port}: ${err.message}`));
    await new Promise((resolve) => this._tcp.listen(port, '0.0.0.0', resolve));
    this.port = this._tcp.address().port;

    this._udp = dgram.createSocket('udp4');
    this._udp.on('error', (err) => console.error(`${tag} UDP ${port}: ${err.message}`));
    this._udp.on('message', (buf, rinfo) => {
      for (const reply of this._onData(buf.toString('latin1'), `${rinfo.address}`)) this._udp.send(reply, rinfo.port, rinfo.address);
    });
    this._udp.bind(this.port, '0.0.0.0');

    this._timer = setInterval(() => this._checkOnline(), 15_000);
    this._timer.unref?.();
    this._checkOnline();
    console.log(`${tag} SIA DC-09 receiver on TCP/UDP ${this.port} — account(s) ${[...this._accounts.keys()].join(', ')}`);
  }

  stop() {
    clearInterval(this._timer);
    this._tcp?.close();
    try { this._udp?.close(); } catch { /* not bound */ }
  }

  _key(acct) { return `${this._p.prefix}/${acct.account || acct}`; }
  _tag() { return `[${this._p.logTag}]`; }

  _register(a) {
    const key = this._key(a);
    if (this._registry.devices.has(key)) return;
    const areas = Object.entries(a.areas || {}).filter(([n, name]) => /^\d+$/.test(n) && name);
    this._registry.registerDevice({
      key, type: this._p.prefix, label: a.name || `${this._p.label} ${a.account}`, icon: this._p.icon,
      sensors: [
        { path: 'mode', name: 'Mode', type: 'label' },
        ...areas.map(([n, name]) => ({ path: `area${n}`, name, type: 'label' })),
        { path: 'armed', name: 'Armed', type: 'boolean' },
        { path: 'alarm', name: 'Intrusion alarm', type: 'boolean' },
        { path: 'fire', name: 'Fire', type: 'boolean' },
        { path: 'water', name: 'Water leak', type: 'boolean' },
        { path: 'gas', name: 'Gas', type: 'boolean' },
        { path: 'panic', name: 'Panic', type: 'boolean' },
        { path: 'tamper', name: 'Tamper', type: 'boolean' },
        { path: 'powerTrouble', name: 'Mains power lost', type: 'boolean' },
        { path: 'batteryLow', name: 'Battery low', type: 'boolean' },
        { path: 'online', name: 'Online', type: 'boolean' },
        { path: 'lastEvent', name: 'Last event', type: 'label' },
      ],
    });
  }

  _onSocket(sock) {
    let buf = '';
    sock.setEncoding('latin1');
    sock.setTimeout(5 * 60_000, () => sock.destroy());
    sock.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 64 * 1024) { sock.destroy(); return; }
      let i;
      while ((i = buf.indexOf('\r')) >= 0) {
        const line = buf.slice(0, i + 1);
        buf = buf.slice(i + 1);
        for (const reply of this._onData(line, sock.remoteAddress)) sock.write(reply, 'latin1');
      }
    });
    sock.on('error', () => {});
  }

  // one or more \n…\r frames → replies to send back
  _onData(text, from) {
    const replies = [];
    for (const part of text.split('\r')) {
      const line = part.replace(/^[\s\n]+/, '');
      if (!line) continue;
      const msg = sia.parse(line, (acc) => this._accounts.get(acc)?.key);
      const acct = this._accounts.get(msg.account);
      if (msg.error) {
        console.warn(`${this._tag()} ${from}: ${msg.error}${msg.account ? ` (account ${msg.account})` : ''}`);
        if (msg.error !== 'CRC mismatch' && msg.seq) replies.push(sia.nak(msg));
        continue;
      }
      if (!acct) {
        console.warn(`${this._tag()} ${from}: message for unknown account ${msg.account} — add it in Settings → ${this._p.label}`);
        replies.push(sia.nak(msg));
        continue;
      }
      if (acct.key && !msg.encrypted && msg.id !== 'NULL') {
        console.warn(`${this._tag()} ${msg.account}: unencrypted message, but a key is set — refused`);
        replies.push(sia.nak(msg));
        continue;
      }
      if (msg.encrypted && msg.timestamp) {
        const d = Date.now() - msg.timestamp.getTime();
        if (d > WINDOW_BEFORE || d < -WINDOW_AFTER) {
          console.warn(`${this._tag()} ${msg.account}: timestamp ${msg.timestamp.toISOString()} outside the allowed window — refused (check the Hub's clock)`);
          replies.push(sia.nak(msg));
          continue;
        }
      }
      replies.push(sia.ack(msg, acct.key));
      this._seen(acct);
      if (msg.id !== 'NULL') for (const ev of sia.events(msg)) this._apply(acct, ev);
    }
    return replies;
  }

  _seen(acct) {
    this._lastSeen.set(acct.account, Date.now());
    this._setOnline(acct, true);
  }

  _setOnline(acct, online) {
    const key = `${this._key(acct)}/online`;
    if (this._store.get(key) !== online) this._store.set(key, online);
    platformStatus.set(this._p.statusKey, [...this._accounts.keys()].some((a) => this._store.get(`${this._key(a)}/online`) === true));
  }

  _checkOnline() {
    for (const acct of this._accounts.values()) {
      const last = this._lastSeen.get(acct.account);
      const limit = 3 * Math.max(1, Number(acct.pingMinutes) || 1) * 60_000;
      if (!last) { if (this._store.get(`${this._key(acct)}/online`) === null) this._store.set(`${this._key(acct)}/online`, false); continue; }
      if (Date.now() - last > limit) this._setOnline(acct, false);
    }
  }

  _apply(acct, ev) {
    const key = this._key(acct);
    const zoneName = ev.zone != null ? acct.zones?.[String(ev.zone)] : undefined;
    const text = TEXT[ev.code] || `Event ${ev.code}`;
    const areaKey = ev.area != null && acct.areas?.[String(ev.area)] ? `${key}/area${ev.area}` : null;
    if (ARM[ev.code]) {
      if (areaKey) this._store.set(areaKey, ARM[ev.code]);
      this._store.set(`${key}/mode`, areaKey ? this._overall(acct) : ARM[ev.code]);
      this._store.set(`${key}/armed`, true);
    } else if (DISARM.has(ev.code)) {
      if (areaKey) this._store.set(areaKey, 'Disarmed');
      const overall = areaKey ? this._overall(acct) : 'Disarmed';
      this._store.set(`${key}/mode`, overall);
      this._store.set(`${key}/armed`, overall !== 'Disarmed');
      // disarming silences an alarm in progress
      for (const f of ['alarm', 'panic']) if (this._store.get(`${key}/${f}`)) this._store.set(`${key}/${f}`, false);
    }
    const flag = FLAGS[ev.code];
    if (flag) this._store.set(`${key}/${flag[0]}`, flag[1]);
    for (const f of FLAG_KEYS) if (this._store.get(`${key}/${f}`) === null) this._store.set(`${key}/${f}`, false);

    const where = zoneName || (ev.zone != null && ev.zone !== 0 ? `#${ev.zone}` : '');
    const label = where ? `${text} · ${where}` : text;
    this._store.set(`${key}/lastEvent`, label);
    this._store.set(`${key}/event`, { code: ev.code, text, zone: ev.zone, zoneName: zoneName || null, area: ev.area, at: new Date().toISOString() });
    if (ev.code !== 'RP') console.log(`${this._tag()} ${acct.name || acct.account}: ${label} (${ev.code}${ev.area != null ? `, area ${ev.area}` : ''})`);
  }

  // With named areas: Disarmed only when every area is, Armed when all are, else Partial
  _overall(acct) {
    const modes = Object.keys(acct.areas || {}).map((n) => this._store.get(`${this._key(acct)}/area${n}`) || 'Disarmed');
    if (modes.every((m) => m === 'Disarmed')) return 'Disarmed';
    if (modes.every((m) => m === 'Armed')) return 'Armed';
    return 'Partial';
  }
}

module.exports = AjaxClient;
module.exports.PROVIDERS = PROVIDERS;
