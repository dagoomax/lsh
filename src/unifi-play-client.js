'use strict';

const https          = require('https');
const fs             = require('fs');
const crypto         = require('crypto');
const PollingClient  = require('./polling-client');

// UniFi Play — Ubiquiti's audio line: PowerAmp (UPL-AMP), PoE Audio Port
// (UPL-PORT) and the speakers/in-walls managed by the UniFi Play app. Two
// ways in, neither of them a documented public API:
//
//  1. The console's Play app ("Apollo"): GET /proxy/apollo/api/v1/devices
//     with the console API key (X-API-KEY — UniFi OS → Control Plane →
//     Integrations / API Keys). Read-only: name, model, firmware, volume,
//     source, streaming service, now playing. Polled; can lag the device.
//
//  2. Each speaker's own MQTT broker (TLS, port 8883), the channel the UniFi
//     Play app uses. Live state and control: volume, source, play / pause /
//     next / previous, locate. The broker only accepts a client certificate
//     signed by Ubiquiti's CA — LSH doesn't ship one; `mqtt.certFile` /
//     `mqtt.keyFile` point at the certificate and key you provide. Without
//     them the devices are read-only (route 1).
//
//     Messages ("binme" framing) are a JSON header + JSON body, each part:
//       type(1: 1 header, 2 body) format(1: 1 JSON) zlib(1) 0(1) length(4 BE) data
//     requests  → UPL-MOB/<client id>/action   header { id, type: 'request', timestamp, action }
//     events    ← UPL-<platform>/<MAC>/status  header { name: 'info' | 'metadata' | … }
//     Protocol as documented by the ha-unifiplay project (MIT); untested
//     against real hardware here.
//
// Playing sound *on* a UniFi Play device (announcements, doorbell chimes)
// works through AirPlay — add it in Settings → AirPlay.
//
// config.unifiPlay = {
//   host: '192.168.1.1', apiKey: '…',             // console (optional with devices[])
//   devices: [{ host: '192.168.1.60', name: 'Kitchen' }],  // direct speakers (MQTT)
//   mqtt: { certFile: '/path/client.crt', keyFile: '/path/client.key' },
//   pollSeconds: 30,
// }
const APOLLO = '/proxy/apollo/api/v1';
const MQTT_PORT = 8883;
const PLATFORMS = { 'UPL-AMP': 'PowerAmp', 'UPL-PORT': 'PoE Audio Port', 'UPL-DEVICE': 'PoE Audio Port' };
const SOURCES = {
  'UPL-AMP': ['streaming', 'speakers', 'lineIn'],
  'UPL-PORT': ['streaming', 'speakers', 'lineIn', 'spdif', 'usb'],
};
const PLAYER = ['play', 'pause', 'next', 'prev'];

// ── binme framing ───────────────────────────────────────────

function encodeBinme(header, body = {}) {
  const part = (type, obj) => {
    const data = Buffer.from(JSON.stringify(obj));
    const h = Buffer.alloc(8);
    h[0] = type; h[1] = 0x01; h[2] = 0x00; h[3] = 0x00;
    h.writeUInt32BE(data.length, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([part(0x01, header), part(0x02, body)]);
}

function decodeBinme(buf) {
  const out = {};
  let o = 0;
  const zlib = require('zlib');
  while (o + 8 <= buf.length) {
    const type = buf[o], format = buf[o + 1], compressed = buf[o + 2];
    const len = buf.readUInt32BE(o + 4);
    let data = buf.subarray(o + 8, o + 8 + len);
    o += 8 + len;
    if (compressed === 0x01) data = zlib.inflateSync(data);
    let val = data;
    if (format === 0x01) { try { val = JSON.parse(data.toString('utf8')); } catch { val = null; } }
    else if (format === 0x02) val = data.toString('utf8');
    if (type === 0x01) out.header = val; else if (type === 0x02) out.body = val;
  }
  return out.header ? out : null;
}

const normMac = (m) => String(m || '').replace(/[^0-9a-f]/gi, '').toUpperCase();

class UnifiPlayClient extends PollingClient {
  constructor(config, store, sensorRegistry, deps = {}) {
    super({ statusKey: 'unifiPlay', logTag: 'UniFi Play' });
    this.cfg            = config.unifiPlay || {};
    this.store          = store;
    this.sensorRegistry = sensorRegistry;
    this._mqttLib       = deps.mqtt || null;
    this._devices       = new Map(); // MAC → { mac, name, platform, ip, client, volume }
    this._clientId      = crypto.randomUUID();
    this._stopped       = false;
  }

  get controllable() { return !!(this.cfg.mqtt?.certFile && this.cfg.mqtt?.keyFile); }

  async start() {
    if (!this.cfg.host && !this.cfg.devices?.length) throw new Error('unifiPlay.host (console) or unifiPlay.devices is required');
    if (this.cfg.host && !this.cfg.apiKey) throw new Error('unifiPlay.apiKey (console API key) is required with unifiPlay.host');
    if (this.controllable) {
      try { this._tls = { cert: fs.readFileSync(this.cfg.mqtt.certFile), key: fs.readFileSync(this.cfg.mqtt.keyFile) }; }
      catch (err) { console.error(`[UniFi Play] Client certificate: ${err.message} — read-only`); this._tls = null; }
    }
    // direct speakers: register up front, the MAC comes from their status topic
    for (const d of this.cfg.devices || []) if (d?.host) this._direct(d);
    await this.startPolling(Math.max(10, Number(this.cfg.pollSeconds) || 30) * 1000);
    console.log(`[UniFi Play] Started — ${this._devices.size} device(s)${this._tls ? ', MQTT control' : ', read-only'}`);
  }

  stop() {
    this._stopped = true;
    this.stopPolling?.();
    for (const d of this._devices.values()) { try { d.client?.end(true); } catch { /* closed */ } }
  }

  // ── Console (Apollo REST) ─────────────────────────────────

  async _pollImpl() {
    if (!this.cfg.host) {
      // direct only: healthy while at least one speaker's broker is connected
      if (![...this._devices.values()].some((d) => d.client?.connected)) throw new Error('No speaker connected');
      return;
    }
    const list = await this._apollo('/devices');
    for (const raw of list) {
      const mac = normMac(raw.mac);
      if (!mac) continue;
      let d = this._devices.get(mac);
      if (!d) d = this._register({ mac, name: raw.name, platform: raw.platform, ip: raw.ip, firmware: raw.firmware });
      if (raw.ip && !d.ip) d.ip = raw.ip;
      this._applyInfo(d, raw.info || {});
      if (raw.now_playing) this._applyMetadata(d, raw.now_playing);
      if (!d.client) this.store.update(`${d.key}/online`, raw.state !== 'OFFLINE' && raw.state !== 'DISCONNECTED' ? 1 : 0);
      this._connect(d);
    }
  }

  _apollo(path) {
    const host = String(this.cfg.host).replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const [hostname, port] = host.split(':');
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname, port: port || 443, path: APOLLO + path, method: 'GET',
        headers: { 'X-API-KEY': this.cfg.apiKey, Accept: 'application/json' },
        rejectUnauthorized: this.cfg.verifySsl === true, timeout: 10_000,
      }, (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          if (res.statusCode === 401) return reject(new Error('Console API key rejected (401)'));
          if (/text\/html/.test(res.headers['content-type'] || '')) return reject(new Error('UniFi Play is not installed on this console'));
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${path}`));
          let j;
          try { j = JSON.parse(raw); } catch { return reject(new Error(`Not JSON from ${path}`)); }
          if (j?.err) return reject(new Error(String(j.err.message || j.err)));
          resolve(Array.isArray(j?.data) ? j.data : []);
        });
      });
      req.on('timeout', () => req.destroy(new Error('Timed out')));
      req.on('error', reject);
      req.end();
    });
  }

  // ── Devices ───────────────────────────────────────────────

  _direct(cfg) {
    const mac = normMac(cfg.mac) || `IP-${cfg.host}`; // replaced by the real MAC on first status
    this._register({ mac, name: cfg.name, platform: cfg.platform, ip: cfg.host, pending: !normMac(cfg.mac) });
  }

  _register({ mac, name, platform, ip, firmware, pending }) {
    const id = pending ? `ip_${String(ip).replace(/[^0-9a-z]/gi, '_')}` : mac.toLowerCase();
    const key = `unifiPlay/${id}`;
    const ctl = !!this._tls;
    const model = PLATFORMS[platform] || platform || 'UniFi Play';
    const d = { mac, key, name: name || model, platform: platform || '', ip, firmware, client: null, volume: null, pending };
    const sensors = [
      { path: 'online', name: 'Online', format: 'on-off' },
      { path: 'playing', name: 'Playing', format: 'on-off' },
      ctl ? { path: 'volume', name: 'Volume', format: 'percent', controllable: true, type: 'range', min: 0, max: 100, writeCmd: 'set_volume', capabilityId: 'volume' }
          : { path: 'volume', name: 'Volume', format: 'percent' },
      { path: 'muted', name: 'Muted', format: 'on-off', ...(ctl ? { controllable: true, type: 'toggle', writeOn: 'mute', writeOff: 'unmute', capabilityId: 'mute' } : {}) },
      ctl ? { path: 'source', name: 'Source', format: 'text', controllable: true, type: 'text', writeCmd: 'set_audio_src', capabilityId: 'source' }
          : { path: 'source', name: 'Source', format: 'text' },
      { path: 'service', name: 'Service', format: 'text' },
      { path: 'title', name: 'Title', format: 'text' },
      { path: 'artist', name: 'Artist', format: 'text' },
      { path: 'album', name: 'Album', format: 'text' },
    ];
    if (ctl) {
      sensors.push(
        { path: 'player', name: 'Player', format: 'text', controllable: true, type: 'text', writeCmd: 'set_player', capabilityId: 'player', hidden: true },
        { path: 'locate', name: 'Locate', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'locate' },
      );
    }
    this.sensorRegistry.registerDevice({
      key, type: 'unifiPlay', instance: id, label: d.name, model, icon: '🔊', color: 'blue',
      firmware: firmware || undefined, sensors, homekit: [],
      _writeCapability: (capId, command, args) => this._write(d, capId, command, args),
    });
    this._devices.set(mac, d);
    if (pending) this._connect(d);
    return d;
  }

  _applyInfo(d, info) {
    const k = d.key;
    if (typeof info.volume === 'number') { this.store.update(`${k}/volume`, info.volume); if (info.volume > 0) d.volume = info.volume; }
    if (info.muted !== undefined) this.store.update(`${k}/muted`, info.muted ? 1 : 0);
    else if (typeof info.volume === 'number') this.store.update(`${k}/muted`, info.volume === 0 ? 1 : 0);
    if (info.source !== undefined) this.store.update(`${k}/source`, info.source === 'hdmi' ? 'speakers' : String(info.source || ''));
    if (info.stream_playing !== undefined) this.store.update(`${k}/playing`, info.stream_playing ? 1 : 0);
    if (info.service !== undefined) this.store.update(`${k}/service`, String(info.service || ''));
    if (info.locating !== undefined && d.client) this.store.update(`${k}/locate`, info.locating ? 1 : 0);
  }

  _applyMetadata(d, m) {
    const k = d.key;
    const title = m.title ?? m.song;
    if (title !== undefined) this.store.update(`${k}/title`, String(title || ''));
    if (m.artist !== undefined) this.store.update(`${k}/artist`, String(m.artist || ''));
    if (m.album !== undefined) this.store.update(`${k}/album`, String(m.album || ''));
  }

  // ── MQTT (control) ────────────────────────────────────────

  _connect(d) {
    if (!this._tls || d.client || !d.ip || this._stopped) return;
    const mqtt = this._mqttLib || require('mqtt');
    const client = mqtt.connect(`mqtts://${d.ip}:${this.cfg.mqtt?.port || MQTT_PORT}`, {
      ...this._tls, rejectUnauthorized: false, // the speaker's own certificate isn't verifiable
      clientId: `lsh-${crypto.randomBytes(6).toString('hex')}`, keepalive: 60, reconnectPeriod: 10_000, connectTimeout: 8_000,
    });
    d.client = client;
    client.on('connect', () => {
      this.store.update(`${d.key}/online`, 1);
      client.subscribe('+/+/status');
      this._send(d, 'info');
      this._send(d, 'metadata');
    });
    client.on('close', () => { if (!this._stopped) this.store.update(`${d.key}/online`, 0); });
    client.on('error', (err) => { if (!d._errLogged) { d._errLogged = true; console.error(`[UniFi Play] ${d.name} (${d.ip}): ${err.message}`); } });
    client.on('message', (topic, payload) => {
      const [, mac, last] = topic.split('/');
      if (last !== 'status') return;
      const msg = decodeBinme(payload);
      if (!msg?.header) return;
      const name = msg.header.name || msg.header.action;
      // a broker can carry another speaker's retained status — only take ours
      if (d.pending) {
        if (name !== 'info' || msg.header.type === 'request') return;
        this._devices.delete(d.mac);
        d.mac = normMac(mac); d.pending = false;
        this._devices.set(d.mac, d);
      } else if (normMac(mac) !== d.mac) return;
      d.platform = d.platform || topic.split('/')[0];
      if (name === 'info') this._applyInfo(d, msg.body || {});
      else if (name === 'metadata') this._applyMetadata(d, msg.body || {});
    });
  }

  _send(d, action, body = {}) {
    if (!d.client?.connected) throw new Error(`${d.name} is not connected`);
    const header = { id: crypto.randomUUID(), type: 'request', timestamp: Date.now(), action };
    d.client.publish(`UPL-MOB/${this._clientId}/action`, encodeBinme(header, body), { qos: 0 });
  }

  async _write(d, capId, command, args) {
    if (!d.client) throw new Error('UniFi Play control needs the MQTT client certificate (Settings → UniFi Play)');
    const v = args?.[0];
    switch (capId) {
      case 'volume': {
        const volume = Math.round(Number(v));
        if (!(volume >= 0 && volume <= 100)) throw new Error('Volume: 0–100');
        this._send(d, 'set_volume', { volume, info_sync: true });
        this.store.update(`${d.key}/volume`, volume);
        if (volume > 0) d.volume = volume;
        break;
      }
      case 'mute': {
        // no mute command on the device — mute is volume 0, unmute restores the last level
        const volume = command === 'mute' ? 0 : (d.volume || 20);
        this._send(d, 'set_volume', { volume, info_sync: true });
        this.store.update(`${d.key}/muted`, volume === 0 ? 1 : 0);
        this.store.update(`${d.key}/volume`, volume);
        break;
      }
      case 'source': {
        const source = String(v || '').trim();
        const allowed = SOURCES[d.platform] || SOURCES['UPL-PORT'];
        if (!allowed.includes(source)) throw new Error(`Source: ${allowed.join(', ')}`);
        this._send(d, 'set_audio_src', { source });
        break;
      }
      case 'player': {
        const action = String(v || '').trim().toLowerCase().replace(/^previous$/, 'prev');
        if (!PLAYER.includes(action)) throw new Error(`Player: ${PLAYER.join(', ')}`);
        this._send(d, 'set_player', { action });
        break;
      }
      case 'locate':
        this._send(d, 'locate', { enable: command === 'on' });
        this.store.update(`${d.key}/locate`, command === 'on' ? 1 : 0);
        break;
      default:
        throw new Error(`Unknown capability '${capId}'`);
    }
  }

  status() {
    return [...this._devices.values()].map((d) => ({
      key: d.key, name: d.name, model: PLATFORMS[d.platform] || d.platform || null, ip: d.ip || null,
      mac: d.pending ? null : d.mac, mqtt: !!d.client?.connected,
    }));
  }
}

UnifiPlayClient.encodeBinme = encodeBinme;
UnifiPlayClient.decodeBinme = decodeBinme;
UnifiPlayClient.PLATFORMS = PLATFORMS;
module.exports = UnifiPlayClient;
