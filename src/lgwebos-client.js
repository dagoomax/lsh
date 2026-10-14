'use strict';

// LG webOS TVs — local control over LG's "second screen" API (SSAP): a
// WebSocket on the TV, wss://<tv>:3001 on 2018+ firmware (self-signed
// certificate), ws://<tv>:3000 on older sets. No cloud.
//
// Pairing: the first connection asks on the TV screen ("Allow this device?");
// once accepted the TV returns a client key, kept in persist/lgwebos-keys.json
// (with the TV's MAC, learnt for Wake-on-LAN). The pairing request is the
// signed manifest LG's own remote apps use — src/lgwebos-pairing.json, taken
// from the lgtv2 package (MIT, © Sebastian Raff); TVs that reject that
// signature ("blacklisted certificate") get the same manifest unsigned.
//
// One LSH device per TV, lgwebos/<host with _>:
//   power        on = Wake-on-LAN (TV setting "Turn on via Wi-Fi" / "LG Connect
//                Apps"), off = turn off
//   volume, volumeUp / volumeDown, mute
//   app          0…N: open app N (the TV's launcher list; the hint names them)
//   input        0…N: switch to input N (HDMI 1…)
//   channelUp / channelDown, play / pause / stop
//   home, back, up, down, left, right, ok — remote buttons
//   notify       text: shown as a message on the TV
//   appName, channel, status — what's on, and the connection state (text)
//
// config.lgwebos = { tvs: [{ host, name?, mac?, secure? (true = 3001 only,
//   false = 3000 only) }] }  — or { host, name, mac } for one TV.
// Tested against scripts/lgwebos-simulator.js (test/lgwebos.test.js); not yet
// against a real TV.

const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const WebSocket = require('ws');
const platformStatus = require('./platform-status');
const PAIRING = require('./lgwebos-pairing.json');

const KEYS_FILE = process.env.LSH_LGWEBOS_KEYS || path.join(__dirname, '..', 'persist', 'lgwebos-keys.json');
const REQUEST_MS = 8000;
const RECONNECT_MS = [5000, 10000, 20000, 30000];
const BUTTONS = { home: 'HOME', back: 'BACK', up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', ok: 'ENTER' };

function loadKeys() { try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')) } catch { return {} } }
function saveKey(host, patch) {
  const all = loadKeys();
  all[host] = { ...(all[host] || {}), ...patch };
  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
  fs.writeFileSync(`${KEYS_FILE}.tmp`, JSON.stringify(all, null, 2), { mode: 0o600 });
  fs.renameSync(`${KEYS_FILE}.tmp`, KEYS_FILE);
}

function unsignedPairing() {
  const p = JSON.parse(JSON.stringify(PAIRING));
  delete p.manifest.signed;
  delete p.manifest.signatures;
  p.manifest.appVersion = '1.0';
  p.manifest.permissions.push('CONTROL_INPUT_TEXT', 'CONTROL_MOUSE_AND_KEYBOARD');
  return p;
}

// Wake-on-LAN magic packet: 6 × 0xFF, then the MAC 16 times
function wake(mac, { address = '255.255.255.255' } = {}) {
  const hex = String(mac || '').replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 12) return Promise.reject(new Error('The TV’s MAC address is needed to switch it on — add it in Settings → LG webOS TVs'));
  const pkt = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(Buffer.from(hex, 'hex'))]);
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.once('error', (e) => { s.close(); reject(e) });
    s.bind(() => {
      s.setBroadcast(true);
      let left = 2;
      for (const port of [9, 7]) s.send(pkt, port, address, () => { if (--left === 0) { s.close(); resolve() } });
    });
  });
}

class Tv {
  constructor(cfg, store, registry) {
    this.cfg = cfg;
    this.host = cfg.host;
    this.name = cfg.name || `LG TV ${cfg.host}`;
    this.key = `lgwebos/${cfg.host.replace(/[.:]/g, '_')}`;
    this.store = store;
    this.registry = registry;
    this.ws = null;
    this.ready = false;       // registered (paired) on the open connection
    this.waiting = new Map(); // id → { resolve, reject, timer, keep }
    this.seq = 0;
    this.apps = [];           // [{ id, title }]
    this.inputs = [];         // [{ id, label, appId }]
    this.failures = 0;
    this.stopped = false;
    this.status = 'connecting';
    this.button = null;       // pointer-input socket
    this.secureOk = cfg.secure;
  }

  set(path, value) { this.store.update(`${this.key}/${path}`, value) }

  register() {
    const trig = (path, label, cap) => ({ path, label, type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: cap || path });
    const sensors = [
      { path: 'power', label: 'Power', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'power' },
      { path: 'volume', label: 'Volume', unit: '%', controllable: true, type: 'range', min: 0, max: 100, rangeFormat: 'percent', writeCmd: 'setVolume', capabilityId: 'volume' },
      trig('volumeUp', 'Volume +'), trig('volumeDown', 'Volume −'),
      { path: 'mute', label: 'Mute', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'mute' },
      { path: 'app', label: 'App', controllable: true, type: 'range', min: 0, max: 1, step: 1, writeCmd: 'setApp', capabilityId: 'app', hint: '0 = —' },
      { path: 'input', label: 'Input', controllable: true, type: 'range', min: 0, max: 1, step: 1, writeCmd: 'setInput', capabilityId: 'input', hint: '0 = —' },
      trig('channelUp', 'Channel +'), trig('channelDown', 'Channel −'),
      trig('play', 'Play'), trig('pause', 'Pause'), trig('stop', 'Stop'),
      ...Object.keys(BUTTONS).map((b) => trig(b, b === 'ok' ? 'OK' : b[0].toUpperCase() + b.slice(1), `button:${b}`)),
      { path: 'notify', label: 'Message on TV', controllable: true, type: 'text', writeCmd: 'notify', capabilityId: 'notify' },
      { path: 'appName', label: 'Now on', type: 'label' },
      { path: 'channel', label: 'Channel', type: 'label' },
      { path: 'status', label: 'Connection', type: 'label' },
    ];
    // a unique `ref` last: Loxone's feedback inputs match on it (src/loxone-xml.js) —
    // identical TVs read their own values, changing app / input lists don't break them
    for (const s of sensors) s.ref = `${this.key}/${s.path}`;
    this.device = { key: this.key, label: this.name, type: 'lgwebos', icon: '📺', homekit: [], sensors, _writeCapability: (cap, cmd, args) => this.command(cap, cmd, args) };
    this.registry.registerDevice(this.device);
    this.set('power', 0);
    this.set('status', 'connecting');
  }

  // ── connection ──────────────────────────────────────────────────────────
  urls() {
    if (this.cfg.url) return [this.cfg.url];
    if (this.secureOk === true) return [`wss://${this.host}:${this.cfg.port || 3001}`];
    if (this.secureOk === false) return [`ws://${this.host}:${this.cfg.port || 3000}`];
    return [`wss://${this.host}:3001`, `ws://${this.host}:3000`];
  }

  connect() {
    if (this.stopped) return;
    const tryUrl = (list) => {
      const url = list[0];
      const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 5000 });
      let opened = false;
      ws.on('open', () => {
        opened = true;
        this.ws = ws;
        if (this.secureOk === undefined) this.secureOk = url.startsWith('wss:');
        this.failures = 0;
        this.pair().catch((err) => this.setStatus(`error: ${err.message}`));
      });
      ws.on('message', (m) => this.onMessage(m));
      ws.on('error', () => {});
      ws.on('close', () => {
        if (!opened && list.length > 1) return tryUrl(list.slice(1));
        if (this.ws === ws) this.closed();
        else if (!opened) this.retry();
      });
    };
    tryUrl(this.urls());
  }

  closed() {
    this.ws = null;
    this.ready = false;
    for (const w of this.waiting.values()) { clearTimeout(w.timer); w.reject(new Error('The TV disconnected')) }
    this.waiting.clear();
    try { this.button?.close() } catch { /* gone */ }
    this.button = null;
    this.set('power', 0);
    this.set('appName', '');
    this.set('channel', '');
    this.setStatus('off');
    this.retry();
  }

  retry() {
    if (this.stopped) return;
    const ms = RECONNECT_MS[Math.min(this.failures++, RECONNECT_MS.length - 1)];
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), ms);
    this.timer.unref?.();
  }

  setStatus(s) { this.status = s; this.set('status', s) }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    try { this.ws?.close() } catch { /* gone */ }
    try { this.button?.close() } catch { /* gone */ }
  }

  send(type, uri, payload, { keep = false } = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`${this.name} is off or unreachable`));
    const id = `${type}_${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = keep ? null : setTimeout(() => { this.waiting.delete(id); reject(new Error(`${this.name} didn’t answer`)) }, REQUEST_MS);
      timer?.unref?.();
      this.waiting.set(id, { resolve, reject, timer, keep, onEvent: null });
      this.ws.send(JSON.stringify({ id, type, ...(uri ? { uri } : {}), payload: payload || {} }));
    });
  }

  request(uri, payload) { return this.send('request', `ssap://${uri}`, payload) }

  // subscriptions answer once, then keep sending under the same id
  subscribe(uri, onEvent) {
    const id = `subscribe_${++this.seq}`;
    this.waiting.set(id, { resolve() {}, reject() {}, timer: null, keep: true, onEvent });
    this.ws.send(JSON.stringify({ id, type: 'subscribe', uri: `ssap://${uri}`, payload: {} }));
  }

  onMessage(raw) {
    let m;
    try { m = JSON.parse(raw) } catch { return }
    const w = this.waiting.get(m.id);
    if (!w) return;
    if (m.type === 'error') {
      if (!w.keep) { clearTimeout(w.timer); this.waiting.delete(m.id) }
      return w.onPair ? w.onPair(new Error(m.error || 'refused')) : w.reject(new Error(m.error || 'The TV refused'));
    }
    if (w.onPair) return w.onPair(null, m);
    if (w.onEvent) return w.onEvent(m.payload || {});
    clearTimeout(w.timer);
    this.waiting.delete(m.id);
    if (m.payload?.returnValue === false) return w.reject(new Error(m.payload.errorText || 'The TV refused'));
    w.resolve(m.payload || {});
  }

  // register: with the saved key it's immediate; without, the TV asks on screen
  pair(signed = true) {
    return new Promise((resolve, reject) => {
      const pairing = signed ? JSON.parse(JSON.stringify(PAIRING)) : unsignedPairing();
      const saved = loadKeys()[this.host];
      if (saved?.clientKey) pairing['client-key'] = saved.clientKey;
      const id = `register_${++this.seq}`;
      this.waiting.set(id, {
        keep: true, timer: null, resolve() {}, reject() {},
        onPair: (err, m) => {
          if (err) {
            this.waiting.delete(id);
            if (signed && /blacklisted certificate/i.test(err.message)) return this.pair(false).then(resolve, reject);
            this.setStatus(/cancel|reject|denied/i.test(err.message) ? 'pairing refused on the TV' : `error: ${err.message}`);
            return reject(err);
          }
          if (m.type === 'response' && m.payload?.pairingType === 'PROMPT') { this.setStatus('accept on the TV'); return }
          if (m.type === 'registered') {
            this.waiting.delete(id);
            const key = m.payload?.['client-key'];
            if (key && key !== saved?.clientKey) saveKey(this.host, { clientKey: key });
            this.ready = true;
            this.setStatus('connected');
            this.afterPair().catch((e) => console.warn(`[LGwebOS] ${this.name}: ${e.message}`));
            resolve();
          }
        },
      });
      this.ws.send(JSON.stringify({ id, type: 'register', payload: pairing }));
    });
  }

  async afterPair() {
    platformStatus.set('lgwebos', true);
    this.set('power', 1);
    this.subscribe('audio/getVolume', (p) => this.onVolume(p));
    this.subscribe('com.webos.applicationManager/getForegroundAppInfo', (p) => this.onApp(p));
    this.subscribe('com.webos.service.tvpower/power/getPowerState', (p) => this.onPower(p));
    const [apps, inputs] = await Promise.all([
      this.request('com.webos.applicationManager/listLaunchPoints').catch(() => ({})),
      this.request('tv/getExternalInputList').catch(() => ({})),
    ]);
    this.apps = (apps.launchPoints || []).map((a) => ({ id: a.id, title: a.title })).filter((a) => a.id);
    this.inputs = (inputs.devices || []).map((d) => ({ id: d.id, label: d.label || d.id, appId: d.appId }));
    this.updateLists();
    this.onVolume(await this.request('audio/getVolume').catch(() => ({})));
    this.onApp(await this.request('com.webos.applicationManager/getForegroundAppInfo').catch(() => ({})));
    // the MAC, for switching on next time
    if (!this.cfg.mac && !loadKeys()[this.host]?.mac) {
      const info = await this.request('com.webos.service.connectionmanager/getinfo').catch(() => null);
      const mac = info?.wiredInfo?.macAddress || info?.wifiInfo?.macAddress;
      if (mac) saveKey(this.host, { mac });
    }
  }

  updateLists() {
    const app = this.device.sensors.find((s) => s.path === 'app');
    app.max = Math.max(1, this.apps.length);
    app.hint = `0 = —${this.apps.slice(0, 20).map((a, i) => `, ${i + 1} = ${a.title}`).join('')}${this.apps.length > 20 ? ', …' : ''}`;
    const inp = this.device.sensors.find((s) => s.path === 'input');
    inp.max = Math.max(1, this.inputs.length);
    inp.hint = `0 = —${this.inputs.map((d, i) => `, ${i + 1} = ${d.label}`).join('')}`;
  }

  onVolume(p) {
    const st = p.volumeStatus || p;
    if (st.volume != null) this.set('volume', Number(st.volume));
    const muted = st.muteStatus ?? st.muted ?? p.mute;
    if (muted != null) this.set('mute', muted ? 1 : 0);
  }

  onApp(p) {
    const id = p.appId || '';
    const app = this.apps.find((a) => a.id === id);
    const input = this.inputs.find((d) => d.appId && d.appId === id);
    this.set('appName', input?.label || app?.title || (id ? id.replace(/^com\.webos\.app\./, '') : ''));
    this.set('app', app ? this.apps.indexOf(app) + 1 : 0);
    this.set('input', input ? this.inputs.indexOf(input) + 1 : 0);
    if (/livetv/.test(id)) {
      this.request('tv/getCurrentChannel').then((c) => this.set('channel', [c.channelNumber, c.channelName].filter(Boolean).join(' '))).catch(() => {});
    } else this.set('channel', '');
  }

  onPower(p) {
    // "Active" = on; "Active Standby" / "Screen Off" / "Suspend" = off for LSH
    if (p.state) this.set('power', p.state === 'Active' || p.state === 'Screen Saver' ? 1 : 0);
  }

  async pressButton(name) {
    if (!this.button || this.button.readyState !== WebSocket.OPEN) {
      const { socketPath } = await this.request('com.webos.service.networkinput/getPointerInputSocket');
      if (!socketPath) throw new Error('The TV gave no input socket');
      this.button = await new Promise((resolve, reject) => {
        const s = new WebSocket(socketPath, { rejectUnauthorized: false });
        s.once('open', () => resolve(s));
        s.once('error', reject);
      });
    }
    this.button.send(`type:button\nname:${name}\n\n`);
  }

  async command(cap, cmd, args = []) {
    const n = Math.round(Number(args[0]));
    switch (cap) {
      case 'power':
        if (cmd === 'on') {
          if (this.ready) return; // already on
          await wake(this.cfg.mac || loadKeys()[this.host]?.mac, this.cfg.broadcast ? { address: this.cfg.broadcast } : {});
          clearTimeout(this.timer); this.failures = 0;
          this.timer = setTimeout(() => this.connect(), 4000); this.timer.unref?.();
          return;
        }
        return this.request('system/turnOff');
      case 'volume': return this.request('audio/setVolume', { volume: Math.max(0, Math.min(100, n)) });
      case 'volumeUp': return this.request('audio/volumeUp');
      case 'volumeDown': return this.request('audio/volumeDown');
      case 'mute': return this.request('audio/setMute', { mute: cmd === 'on' });
      case 'app': {
        const a = this.apps[n - 1];
        if (!a) throw new Error(this.apps.length ? `App number is 1–${this.apps.length}` : 'The TV hasn’t listed its apps yet');
        return this.request('system.launcher/launch', { id: a.id });
      }
      case 'input': {
        const d = this.inputs[n - 1];
        if (!d) throw new Error(this.inputs.length ? `Input number is 1–${this.inputs.length}` : 'The TV hasn’t listed its inputs yet');
        return this.request('tv/switchInput', { inputId: d.id });
      }
      case 'channelUp': return this.request('tv/channelUp');
      case 'channelDown': return this.request('tv/channelDown');
      case 'play': case 'pause': case 'stop': return this.request(`media.controls/${cap}`);
      case 'notify': {
        const text = String(args[0] ?? '').trim().slice(0, 200);
        if (!text) return;
        return this.request('system.notifications/createToast', { message: text });
      }
      default:
        if (cap.startsWith('button:')) return this.pressButton(BUTTONS[cap.slice(7)]);
        throw new Error(`Unknown TV command ${cap}`);
    }
  }

  info() {
    const k = loadKeys()[this.host] || {};
    return { key: this.key, host: this.host, name: this.name, status: this.status, paired: !!k.clientKey, mac: this.cfg.mac || k.mac || '', secure: this.secureOk, apps: this.apps.length, inputs: this.inputs.map((d) => d.label) };
  }
}

class LgWebosClient {
  constructor(config, store, sensorRegistry) {
    const c = config.lgwebos || {};
    this.list = (Array.isArray(c.tvs) ? c.tvs : c.host ? [c] : []).filter((t) => t?.host);
    this.store = store;
    this.registry = sensorRegistry;
    this.tvs = [];
  }

  async start() {
    platformStatus.set('lgwebos', false);
    for (const cfg of this.list) {
      const tv = new Tv(cfg, this.store, this.registry);
      tv.register();
      tv.connect();
      this.tvs.push(tv);
    }
  }

  stop() { for (const tv of this.tvs) tv.stop() }

  find(host) { return this.tvs.find((t) => t.host === host) }

  // forget the key and connect again: the TV asks to allow LSH
  repair(host) {
    const tv = this.find(host);
    if (!tv) throw new Error('Unknown TV');
    saveKey(host, { clientKey: undefined });
    try { tv.ws?.close() } catch { /* gone */ }
    clearTimeout(tv.timer); tv.failures = 0;
    setTimeout(() => tv.connect(), 500).unref?.();
  }
}

// LG TVs on the network (SSDP) → [{ host, name }]
function discover(timeoutMs = 3500) {
  return new Promise((resolve) => {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = new Map();
    s.on('message', (m, r) => {
      const t = m.toString();
      if (/webos-second-screen|LG Smart TV|webOS/i.test(t)) found.set(r.address, { host: r.address, name: (/^SERVER:\s*(.*)$/im.exec(t)?.[1] || 'LG webOS TV').trim() });
    });
    s.on('error', () => {});
    s.bind(() => {
      const msg = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: urn:lge-com:service:webos-second-screen:1\r\n\r\n');
      s.send(msg, 1900, '239.255.255.250');
    });
    setTimeout(() => { try { s.close() } catch {} resolve([...found.values()]) }, timeoutMs);
  });
}

module.exports = LgWebosClient;
module.exports.discover = discover;
module.exports.wake = wake;
module.exports.KEYS_FILE = KEYS_FILE;
