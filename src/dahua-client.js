'use strict';

// Dahua NVRs and IP cameras (also sold as Imou / Amcrest / Lorex / many OEM
// labels) over the local HTTP CGI API, HTTP Digest auth.
//
//   device info   GET /cgi-bin/magicBox.cgi?action=getDeviceType | getSerialNo
//   channel names GET /cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle
//   channel state GET /cgi-bin/LogicDeviceManager.cgi?action=getCameraState&uniqueChannels[0]=-1  (NVRs)
//   snapshot      GET /cgi-bin/snapshot.cgi?channel=<1-based>
//   events        GET /cgi-bin/eventManager.cgi?action=attach&codes=[All]&heartbeat=5
//                 — a never-ending multipart stream, one part per event:
//                   Code=VideoMotion;action=Start;index=0
//                   Code=CrossLineDetection;action=Pulse;index=2;data={ … "ObjectType" : "Human" … }
//   RTSP          rtsp://user:pass@host:554/cam/realmonitor?channel=<1-based>&subtype=0|1
//
// Each channel becomes a camera tile (snapshot proxied through LSH so the
// password stays server-side) and a device dahua/<nvr>/<ch> with `online` and
// `motion`. Person / vehicle / line-crossing / intrusion detections become
// their own devices (dahua/<nvr>/<ch>/<kind>, one HomeKit motion sensor each)
// the first time the NVR reports one — same as Reolink's AI categories.
//
// config.dahua = { devices: [{ name, host, port?, https?, username, password,
//                  rtspPort?: 554, stream?: 'main'|'sub', channels?: [1,2,…],
//                  events?: true }], holdSeconds: 10, pollSeconds: 60 }

const digest         = require('./http-digest');
const platformStatus = require('./platform-status');

const EVENT_RETRY_MS = [5000, 15000, 60000];
const EVENT_IDLE_MS  = 30000; // heartbeat is every 5 s — silence this long means a dead socket

// Event code → detection kind. Smart-motion codes carry Start/Stop; IVS codes
// are usually a single Pulse and are cleared after holdSeconds.
const KIND = {
  SmartMotionHuman:     'person',
  SmartMotionVehicle:   'vehicle',
  CrossLineDetection:   'tripwire',
  CrossRegionDetection: 'intrusion',
};
const KIND_LABEL = { person: 'Person', vehicle: 'Vehicle', tripwire: 'Line crossing', intrusion: 'Intrusion' };
const KIND_ICON  = { person: '🚶', vehicle: '🚗', tripwire: '〰️', intrusion: '🚧' };
const OBJECT_KIND = { Human: 'person', Vehicle: 'vehicle', MotorVehicle: 'vehicle', NonMotor: 'vehicle' };

// "key=value" lines (Dahua's plain-text CGI replies) → { key: value }
function parseKv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

// One multipart body → { code, action, index, data } or null (heartbeat etc.)
function parseEvent(text) {
  const m = /Code=([^;\r\n]+);action=([^;\r\n]+);index=(\d+)(?:;data=([\s\S]*))?/.exec(text);
  if (!m) return null;
  let data = null;
  if (m[4]) { try { data = JSON.parse(m[4].trim()) } catch { data = null } }
  return { code: m[1], action: m[2], index: Number(m[3]), data };
}

// Takes complete parts off a growing multipart buffer. Dahua starts every part
// with the boundary and gives a Content-Length, so a part is complete as soon
// as its body is in — no need to wait for the next boundary.
// Returns { parts: [string], rest: Buffer }.
function splitParts(buf, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  const parts = [];
  let pos = 0;
  for (;;) {
    const start = buf.indexOf(sep, pos);
    if (start < 0) break;
    const hdrEnd = buf.indexOf('\r\n\r\n', start);
    if (hdrEnd < 0) break;
    const headers = buf.subarray(start + sep.length, hdrEnd).toString('latin1');
    const len = /content-length:\s*(\d+)/i.exec(headers);
    const bodyStart = hdrEnd + 4;
    let bodyEnd;
    if (len) {
      bodyEnd = bodyStart + Number(len[1]);
      if (bodyEnd > buf.length) break;
    } else {
      bodyEnd = buf.indexOf(sep, bodyStart);
      if (bodyEnd < 0) break;
    }
    parts.push(buf.subarray(bodyStart, bodyEnd).toString('utf8'));
    pos = bodyEnd;
  }
  return { parts, rest: buf.subarray(pos) };
}

function buildRtspUrl(dev, ch) {
  const auth = (dev.username || dev.password)
    ? `${encodeURIComponent(dev.username || '')}:${encodeURIComponent(dev.password || '')}@`
    : '';
  const subtype = dev.stream === 'sub' ? 1 : 0;
  return `rtsp://${auth}${dev.host}:${Number(dev.rtspPort) || 554}/cam/realmonitor?channel=${ch}&subtype=${subtype}`;
}

// Model, serial and channels (1-based, with names and connection state).
async function probe(dev) {
  const info = parseKv((await digest.request(dev, '/cgi-bin/magicBox.cgi?action=getDeviceType')).buffer.toString('utf8'));
  let serial = '';
  try { serial = parseKv((await digest.request(dev, '/cgi-bin/magicBox.cgi?action=getSerialNo')).buffer.toString('utf8')).sn || '' } catch { /* optional */ }

  const titles = parseKv((await digest.request(dev, '/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle')).buffer.toString('utf8'));
  const channels = [];
  for (const [k, v] of Object.entries(titles)) {
    const m = /^table\.ChannelTitle\[(\d+)\]\.Name$/.exec(k);
    if (m) channels.push({ ch: Number(m[1]) + 1, name: v, connected: null });
  }
  channels.sort((a, b) => a.ch - b.ch);
  const state = await cameraState(dev);
  for (const c of channels) if (state.has(c.ch)) c.connected = state.get(c.ch);
  return { model: info.type || '', serial, channels };
}

// NVR only: ch → connected. IP cameras don't have LogicDeviceManager → empty map.
async function cameraState(dev) {
  const out = new Map();
  try {
    const kv = parseKv((await digest.request(dev, '/cgi-bin/LogicDeviceManager.cgi?action=getCameraState&uniqueChannels[0]=-1')).buffer.toString('utf8'));
    for (const [k, v] of Object.entries(kv)) {
      const m = /^states\[(\d+)\]\.channel$/.exec(k);
      if (m) out.set(Number(v) + 1, kv[`states[${m[1]}].connectionState`] === 'Connected');
    }
  } catch { /* not an NVR */ }
  return out;
}

async function fetchSnapshot(dev, ch) {
  const r = await digest.request(dev, `/cgi-bin/snapshot.cgi?channel=${Number(ch) || 1}`, { timeout: 10000 });
  return { buffer: r.buffer, contentType: r.headers['content-type'] || 'image/jpeg' };
}

class DahuaClient {
  constructor(config, store, sensorRegistry) {
    const cfg = config.dahua || {};
    this._store    = store;
    this._registry = sensorRegistry;
    this.devices   = (cfg.devices || []).filter((d) => d && d.host).map((d) => ({ ...d, host: String(d.host).trim() }));
    this.hold      = Math.max(2, Number(cfg.holdSeconds) || 10) * 1000;
    this.pollMs    = Math.max(15, Number(cfg.pollSeconds) || 60) * 1000;
    this.nvrs      = this.devices.map(() => ({ ok: false, model: '', channels: [], kinds: new Set() }));
    this._timers   = new Map(); // deviceKey → clear timer for pulse detections
    this._streams  = [];
    this._poll     = null;
    this._stopped  = false;
  }

  async start() {
    if (!this.devices.length) throw new Error('No Dahua devices configured');
    await Promise.all(this.devices.map((d, i) => this._init(i)));
    this._poll = setInterval(() => this._pollAll().catch(() => {}), this.pollMs);
    this._poll.unref?.();
  }

  stop() {
    this._stopped = true;
    clearInterval(this._poll);
    for (const t of this._timers.values()) clearTimeout(t);
    for (const s of this._streams) s?.destroy?.();
  }

  _key(i, ch, kind) { return `dahua/${i}/${ch}${kind ? '/' + kind : ''}` }

  async _init(i) {
    const dev = this.devices[i];
    const nvr = this.nvrs[i];
    const label = dev.name || dev.host;
    try {
      const p = await probe(dev);
      nvr.model = p.model;
      nvr.serial = p.serial;
      const only = Array.isArray(dev.channels) && dev.channels.length ? new Set(dev.channels.map(Number)) : null;
      // Unused NVR inputs: skip channels the NVR reports as disconnected
      nvr.channels = p.channels.filter((c) => (only ? only.has(c.ch) : c.connected !== false));
      if (!nvr.channels.length && !only && p.channels.length) nvr.channels = p.channels; // no state info → keep all
      nvr.ok = true;
      for (const c of nvr.channels) this._registerChannel(i, c);
      console.log(`[Dahua] ${label}: ${p.model || 'device'} — ${nvr.channels.length} channel(s)`);
      platformStatus.set('dahua', true);
      if (dev.events !== false) this._attach(i, 0);
    } catch (err) {
      nvr.ok = false;
      console.error(`[Dahua] ${label}: ${err.message} — retrying in 60s`);
      if (!this._stopped) setTimeout(() => this._init(i), 60000).unref?.();
    }
  }

  _registerChannel(i, c) {
    const dev = this.devices[i];
    const key = this._key(i, c.ch);
    this._registry.registerDevice({
      key, type: 'dahua', instance: `${i}/${c.ch}`,
      label: c.name || `${dev.name || dev.host} ${c.ch}`,
      model: this.nvrs[i].model ? `Dahua ${this.nvrs[i].model}` : 'Dahua',
      icon: 'camera', color: 'blue',
      sensors: [
        { path: 'motion', name: 'Motion', format: 'on-off', homekit: 'motion' },
        { path: 'online', name: 'Online', format: 'on-off', sensorType: 'connectivity' },
      ],
      homekit: ['motion'],
    });
    this._store.update(`${key}/online`, c.connected === false ? 0 : 1);
    this._store.update(`${key}/motion`, 0);
  }

  _registerKind(i, ch, kind) {
    const nvr = this.nvrs[i];
    const id = `${ch}/${kind}`;
    if (nvr.kinds.has(id)) return;
    nvr.kinds.add(id);
    const c = nvr.channels.find((x) => x.ch === ch);
    const camName = c?.name || `${this.devices[i].name || this.devices[i].host} ${ch}`;
    this._registry.registerDevice({
      key: this._key(i, ch, kind), type: 'dahua', instance: `${i}/${id}`,
      label: `${camName} — ${KIND_LABEL[kind]}`,
      icon: KIND_ICON[kind] || '🎯', color: 'blue',
      sensors: [{ path: 'detected', name: 'Detected', format: 'on-off', homekit: 'motion' }],
      homekit: ['motion'],
    });
  }

  // ── Event stream ────────────────────────────────────────────────────────

  async _attach(i, attempt) {
    if (this._stopped) return;
    const dev = this.devices[i];
    const label = dev.name || dev.host;
    let res;
    try {
      res = await digest.stream(dev, '/cgi-bin/eventManager.cgi?action=attach&codes=[All]&heartbeat=5', { timeout: EVENT_IDLE_MS });
    } catch (err) {
      return this._reattach(i, attempt, `event stream: ${err.message}`);
    }
    this._streams[i] = res;
    const boundary = (/boundary=("?)([^";]+)\1/i.exec(res.headers['content-type'] || '') || [])[2] || 'myboundary';
    if (attempt) console.log(`[Dahua] ${label}: event stream reconnected`);
    let buf = Buffer.alloc(0);
    res.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { parts, rest } = splitParts(buf, boundary);
      buf = rest.length > 1e6 ? Buffer.alloc(0) : rest;
      for (const p of parts) {
        const ev = parseEvent(p);
        if (ev) this._onEvent(i, ev);
      }
    });
    // The request's socket timeout (EVENT_IDLE_MS) fires when heartbeats stop
    let why = 'event stream closed';
    res.on('error', (err) => { why = `event stream: ${err.message}` });
    const opened = Date.now();
    res.on('close', () => {
      if (this._streams[i] !== res) return;
      this._streams[i] = null;
      // a stream that dies right away counts as a failed attempt (backoff, no log spam)
      this._reattach(i, Date.now() - opened < 60000 ? attempt : 0, why);
    });
  }

  _reattach(i, attempt, why) {
    if (this._stopped) return;
    const wait = EVENT_RETRY_MS[Math.min(attempt, EVENT_RETRY_MS.length - 1)];
    if (attempt === 0) console.error(`[Dahua] ${this.devices[i].name || this.devices[i].host}: ${why} — reconnecting`);
    setTimeout(() => this._attach(i, attempt + 1), wait).unref?.();
  }

  _onEvent(i, ev) {
    const ch = ev.index + 1;
    const nvr = this.nvrs[i];
    if (!nvr.channels.some((c) => c.ch === ch)) return;
    const on = ev.action === 'Start' || ev.action === 'Pulse';
    const off = ev.action === 'Stop';
    if (!on && !off) return;

    if (ev.code === 'VideoMotion') return this._set(this._key(i, ch), 'motion', on, false);
    if (ev.code === 'VideoLoss') return this._store.update(`${this._key(i, ch)}/online`, on ? 0 : 1);

    let kind = KIND[ev.code];
    if (!kind) return;
    // IVS rules report what crossed — split people from vehicles
    if (kind === 'tripwire' || kind === 'intrusion') {
      const obj = ev.data?.Object?.ObjectType || ev.data?.Objects?.[0]?.ObjectType;
      if (on && OBJECT_KIND[obj]) {
        this._registerKind(i, ch, OBJECT_KIND[obj]);
        this._set(this._key(i, ch, OBJECT_KIND[obj]), 'detected', true, true);
      }
    }
    this._registerKind(i, ch, kind);
    this._set(this._key(i, ch, kind), 'detected', on, ev.action === 'Pulse');
  }

  // Start/Stop events clear on Stop; pulses clear after holdSeconds. Either
  // way a detection never stays on longer than 10× hold if a Stop is lost.
  _set(key, path, on, pulse) {
    const id = `${key}/${path}`;
    clearTimeout(this._timers.get(id));
    this._store.update(id, on ? 1 : 0);
    if (on) {
      const t = setTimeout(() => { this._store.update(id, 0); this._timers.delete(id) }, pulse ? this.hold : this.hold * 10);
      t.unref?.();
      this._timers.set(id, t);
    }
  }

  // ── Health ──────────────────────────────────────────────────────────────

  async _pollAll() {
    await Promise.all(this.devices.map(async (dev, i) => {
      const nvr = this.nvrs[i];
      if (!nvr.channels.length) return;
      try {
        const state = await cameraState(dev);
        if (!state.size) await digest.request(dev, '/cgi-bin/magicBox.cgi?action=getDeviceType');
        nvr.ok = true;
        for (const c of nvr.channels) {
          if (state.has(c.ch)) c.connected = state.get(c.ch);
          this._store.update(`${this._key(i, c.ch)}/online`, c.connected === false ? 0 : 1);
        }
      } catch {
        nvr.ok = false;
        for (const c of nvr.channels) this._store.update(`${this._key(i, c.ch)}/online`, 0);
      }
    }));
    platformStatus.set('dahua', this.nvrs.some((n) => n.ok));
  }

  // ── Cameras (consumed by /api/cameras) ──────────────────────────────────

  getCameras() {
    const out = [];
    this.devices.forEach((dev, i) => {
      for (const c of this.nvrs[i].channels) {
        out.push({
          name:        c.name || `${dev.name || dev.host} ${c.ch}`,
          url:         buildRtspUrl(dev, c.ch),
          snapshotUrl: `/api/dahua/snapshot/${i}/${c.ch}`,
          mjpegUrl:    '',
          webrtcUrl:   dev.webrtcUrls?.[c.ch] || '',
          _dahua:      true,
        });
      }
    });
    return out;
  }

  proxySnapshot(i, ch, res) {
    const dev = this.devices[Number(i)];
    if (!dev || !this.nvrs[Number(i)].channels.some((c) => c.ch === Number(ch))) return res.status(404).end();
    fetchSnapshot(dev, ch)
      .then(({ buffer, contentType }) => {
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'no-cache');
        res.end(buffer);
      })
      .catch(() => res.status(502).end());
  }

  status() {
    return this.devices.map((dev, i) => ({
      name: dev.name || dev.host, host: dev.host, ok: this.nvrs[i].ok, model: this.nvrs[i].model,
      events: !!this._streams[i], channels: this.nvrs[i].channels,
    }));
  }
}

DahuaClient.probe = probe;
DahuaClient.fetchSnapshot = fetchSnapshot;
DahuaClient._test = { parseKv, parseEvent, splitParts, buildRtspUrl };
module.exports = DahuaClient;
