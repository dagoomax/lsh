'use strict';

const dgram          = require('dgram');
const crypto         = require('crypto');
const platformStatus = require('./platform-status');

// Aqara / Xiaomi Zigbee devices via the gateway LAN protocol (UDP 9898,
// enabled as "developer mode" / LAN protocol in the Aqara or Mi Home app).
// Child devices are auto-discovered through the hub: get_id_list → read per
// sid, then live `report` / `heartbeat` multicasts (224.0.0.50:9898) keep the
// store fresh, with a periodic re-read as safety net. Writes (plugs, wall
// switches, gateway light) are signed with the rotating gateway token
// AES-128-CBC-encrypted using the per-gateway LAN password from the app.
//
// config.aqara = {
//   pollInterval: 30,
//   gateways: [ { host: '192.168.1.x', port: 9898, password: '16charLANkey....', name: 'Hub' } ],
//   names: { '158d0001a2b3c4': 'Czujnik salon' },   // optional sid → label
// }

const MCAST_ADDR = '224.0.0.50';
const AES_IV     = Buffer.from('17996d093d28ddb3ba695a2e6f58562e', 'hex');

// model → { label, icon, kind }
const MODELS = {
  'gateway':            { label: 'Gateway',      icon: '📡', kind: 'gateway' },
  'gateway.v3':         { label: 'Gateway',      icon: '📡', kind: 'gateway' },
  'acpartner.v3':       { label: 'AC Partner',   icon: '📡', kind: 'gateway' },
  'sensor_ht':          { label: 'Temp/Humidity', icon: '🌡️', kind: 'ht' },
  'weather':            { label: 'Weather',      icon: '🌡️', kind: 'weather' },
  'weather.v1':         { label: 'Weather',      icon: '🌡️', kind: 'weather' },
  'magnet':             { label: 'Door/Window',  icon: '🚪', kind: 'magnet' },
  'sensor_magnet.aq2':  { label: 'Door/Window',  icon: '🚪', kind: 'magnet' },
  'motion':             { label: 'Motion',       icon: '🚶', kind: 'motion' },
  'sensor_motion.aq2':  { label: 'Motion',       icon: '🚶', kind: 'motion' },
  'sensor_wleak.aq1':   { label: 'Water Leak',   icon: '💧', kind: 'leak' },
  'switch':             { label: 'Button',       icon: '🔘', kind: 'button' },
  'sensor_switch.aq2':  { label: 'Button',       icon: '🔘', kind: 'button' },
  'sensor_switch.aq3':  { label: 'Button',       icon: '🔘', kind: 'button' },
  'plug':               { label: 'Plug',         icon: '🔌', kind: 'plug' },
  '86plug':             { label: 'Wall Plug',    icon: '🔌', kind: 'plug' },
  'ctrl_neutral1':      { label: 'Wall Switch',  icon: '💡', kind: 'ctrl1' },
  'ctrl_ln1':           { label: 'Wall Switch',  icon: '💡', kind: 'ctrl1' },
  'ctrl_neutral2':      { label: 'Wall Switch 2ch', icon: '💡', kind: 'ctrl2' },
  'ctrl_ln2':           { label: 'Wall Switch 2ch', icon: '💡', kind: 'ctrl2' },
  'vibration':          { label: 'Vibration',    icon: '📳', kind: 'button' },
  'cube':               { label: 'Cube',         icon: '🎲', kind: 'button' },
  'sensor_cube.aqgl01': { label: 'Cube',         icon: '🎲', kind: 'button' },
};

// 2.5 V empty → 3.0 V full (CR2032/CR2450 sensors, zigbee2mqtt convention)
function batteryPercent(mv) {
  return Math.max(0, Math.min(100, Math.round(((mv - 2500) / 500) * 100)));
}

class AqaraClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._socket   = null;
    this._timer    = null;
    this._gateways = new Map();   // host → { cfg, token, sid }
    this._devices  = new Map();   // sid → { model, kind, gwHost, deviceKey }
  }

  start() {
    const cfg = this._config.aqara || {};
    if (!Array.isArray(cfg.gateways) || !cfg.gateways.length) {
      console.log('[Aqara] No gateways configured');
      return;
    }
    for (const gw of cfg.gateways) {
      if (gw.host) this._gateways.set(gw.host, { cfg: gw, token: null, sid: null });
    }

    const onMessage = (msg, rinfo) => this._onMessage(msg, rinfo);
    this._socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this._socket.on('message', onMessage);
    this._socket.once('error', (err) => {
      // Multicast port taken → fall back to an ephemeral port (polling still works)
      if (err.code !== 'EADDRINUSE') return console.error('[Aqara] Socket error:', err.message);
      console.log('[Aqara] Port 9898 in use — poll-only mode');
      try { this._socket.close(); } catch {}
      this._socket = dgram.createSocket('udp4');
      this._socket.on('message', onMessage);
      this._socket.on('error', (e) => console.error('[Aqara] Socket error:', e.message));
      this._socket.bind(() => this._begin(cfg));
    });

    // Bind the multicast port so live report/heartbeat packets arrive
    this._socket.bind(9898, () => {
      try { this._socket.addMembership(MCAST_ADDR); }
      catch (err) { console.log(`[Aqara] Multicast join failed (${err.message}) — poll-only mode`); }
      this._begin(cfg);
    });
  }

  _begin(cfg) {
    console.log(`[Aqara] Watching ${this._gateways.size} gateway(s)`);
    this._poll();
    const ms = Math.max(10, cfg.pollInterval || 30) * 1000;
    this._timer = setInterval(() => this._poll(), ms);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    if (this._socket) try { this._socket.close(); } catch {}
    platformStatus.set('aqara', false);
  }

  // ── Protocol ─────────────────────────────────────────────────────────────

  _send(gwHost, obj) {
    const gw   = this._gateways.get(gwHost);
    const port = gw?.cfg.port || 9898;
    const buf  = Buffer.from(JSON.stringify(obj));
    this._socket.send(buf, 0, buf.length, port, gwHost);
  }

  _poll() {
    for (const host of this._gateways.keys()) this._send(host, { cmd: 'get_id_list' });
    // periodic re-read of known children (reports are the live path)
    for (const [sid, dev] of this._devices) {
      if (dev.kind !== 'gateway') this._send(dev.gwHost, { cmd: 'read', sid });
    }
  }

  _onMessage(msg, rinfo) {
    let m;
    try { m = JSON.parse(msg.toString()); } catch { return; }
    const gw = this._gateways.get(rinfo.address);
    if (!gw) return;                              // not one of ours

    if (m.token) gw.token = m.token;

    if (m.cmd === 'get_id_list_ack') {
      platformStatus.set('aqara', true);
      gw.sid = m.sid;
      this._handleData(m.sid, gw.cfg.model || 'gateway', {}, rinfo.address);
      let sids = [];
      try { sids = JSON.parse(m.data || '[]'); } catch {}
      for (const sid of sids) {
        if (!this._devices.has(sid)) this._send(rinfo.address, { cmd: 'read', sid });
      }
    } else if (m.cmd === 'read_ack' || m.cmd === 'report' || m.cmd === 'heartbeat') {
      let data = {};
      try { data = typeof m.data === 'string' ? JSON.parse(m.data) : (m.data || {}); } catch {}
      if (m.sid && m.model) this._handleData(m.sid, m.model, data, rinfo.address);
    }
  }

  // ── Devices ──────────────────────────────────────────────────────────────

  _handleData(sid, model, data, gwHost) {
    let dev = this._devices.get(sid);
    if (!dev) {
      const meta = MODELS[model];
      if (!meta) { console.log(`[Aqara] Unsupported model '${model}' (sid ${sid})`); return; }
      dev = { model, kind: meta.kind, gwHost, deviceKey: `aqara/${sid}` };
      this._devices.set(sid, dev);
      this._register(sid, dev, meta);
    }

    const k = dev.deviceKey;
    if (data.temperature  !== undefined) this._store.set(`${k}/temperature`, Number(data.temperature) / 100);
    if (data.humidity     !== undefined) this._store.set(`${k}/humidity`,    Number(data.humidity) / 100);
    if (data.pressure     !== undefined) this._store.set(`${k}/pressure`,    Number(data.pressure) / 100);
    if (data.illumination !== undefined) this._store.set(`${k}/illumination`, Number(data.illumination));
    if (data.lux          !== undefined) this._store.set(`${k}/lux`,          Number(data.lux));
    if (data.voltage      !== undefined) this._store.set(`${k}/battery`,      batteryPercent(Number(data.voltage)));
    if (data.load_power   !== undefined) this._store.set(`${k}/power`,        Number(data.load_power));

    if (dev.kind === 'magnet' && data.status) this._store.set(`${k}/contact`, data.status === 'open');
    if (dev.kind === 'leak' && data.status)   this._store.set(`${k}/leak`,    data.status === 'leak');
    if (dev.kind === 'motion') {
      if (data.status === 'motion') this._store.set(`${k}/motion`, true);
      if (data.no_motion !== undefined) this._store.set(`${k}/motion`, false);
    }
    if (dev.kind === 'button' && data.status) this._store.set(`${k}/action`, data.status);
    if (dev.kind === 'plug' && data.status)   this._store.set(`${k}/switch`, data.status === 'on');
    if (data.channel_0) this._store.set(`${k}/channel_0`, data.channel_0 === 'on');
    if (data.channel_1) this._store.set(`${k}/channel_1`, data.channel_1 === 'on');
    if (dev.kind === 'gateway' && data.rgb !== undefined) this._store.set(`${k}/light`, Number(data.rgb) > 0);
  }

  _register(sid, dev, meta) {
    const names   = this._config.aqara?.names || {};
    const sensors = [];
    const kind    = dev.kind;

    if (kind === 'ht' || kind === 'weather') {
      sensors.push({ path: 'temperature', label: 'Temperature', sensorType: 'temperature', unit: '°C', homekit: 'temperature' });
      sensors.push({ path: 'humidity',    label: 'Humidity',    format: 'percent', unit: '%', homekit: 'humidity' });
      if (kind === 'weather') sensors.push({ path: 'pressure', label: 'Pressure', sensorType: 'sensor', unit: 'hPa' });
    }
    if (kind === 'magnet') sensors.push({ path: 'contact', label: 'Contact', format: 'on-off', homekit: 'contact' });
    if (kind === 'leak')   sensors.push({ path: 'leak',    label: 'Leak',    format: 'on-off', homekit: 'leak' });
    if (kind === 'motion') {
      sensors.push({ path: 'motion', label: 'Motion', format: 'on-off', homekit: 'motion' });
      sensors.push({ path: 'lux',    label: 'Lux',    sensorType: 'sensor', unit: 'lx' });
    }
    if (kind === 'button') sensors.push({ path: 'action', label: 'Action', sensorType: 'sensor' });
    if (kind === 'plug') {
      sensors.push({
        path: 'switch', label: 'Switch', format: 'on-off', sensorType: 'switch',
        controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off',
        capabilityId: 'switch', homekit: 'switch-rw',
      });
      sensors.push({ path: 'power', label: 'Power', sensorType: 'power', unit: 'W' });
    }
    if (kind === 'ctrl1' || kind === 'ctrl2') {
      for (const ch of kind === 'ctrl2' ? ['channel_0', 'channel_1'] : ['channel_0']) {
        sensors.push({
          path: ch, label: ch === 'channel_0' ? 'Switch L' : 'Switch R', format: 'on-off', sensorType: 'switch',
          controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off',
          capabilityId: ch, homekit: 'switch-rw',
        });
      }
    }
    if (kind === 'gateway') {
      sensors.push({ path: 'illumination', label: 'Illumination', sensorType: 'sensor', unit: 'lx' });
      sensors.push({
        path: 'light', label: 'Light', format: 'on-off', sensorType: 'switch',
        controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off',
        capabilityId: 'light', homekit: 'switch-rw',
      });
    }
    if (kind !== 'gateway' && kind !== 'plug' && kind !== 'ctrl1' && kind !== 'ctrl2') {
      sensors.push({ path: 'battery', label: 'Battery', format: 'percent', unit: '%', homekit: 'battery-level' });
    }

    this._registry.registerDevice({
      key:   dev.deviceKey,
      label: names[sid] || `${meta.label} ${sid.slice(-4)}`,
      type:  'aqara',
      icon:  meta.icon,
      sensors,
      homekit: sensors.map((s) => s.homekit).filter(Boolean),
      _writeCapability: (capId, command) => this._write(sid, capId, command),
    });
    console.log(`[Aqara] Registered ${names[sid] || meta.label} (${dev.model}, ${sid})`);
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  // The write key is the current gateway token encrypted AES-128-CBC with the
  // LAN password (fixed IV), hex-encoded — standard lumi LAN protocol signing.
  _writeKey(gw) {
    const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(gw.cfg.password, 'utf8'), AES_IV);
    cipher.setAutoPadding(false);
    return cipher.update(Buffer.from(gw.token, 'utf8')).toString('hex');
  }

  _write(sid, capId, command) {
    const dev = this._devices.get(sid);
    const gw  = dev && this._gateways.get(dev.gwHost);
    if (!gw) return;
    if (!gw.token || !gw.cfg.password) {
      return console.error('[Aqara] Cannot write — missing gateway token or LAN password');
    }

    const value = command === 'on' ? 'on' : 'off';
    let data;
    if (capId === 'light') data = { rgb: command === 'on' ? 0x64ffffff : 0 };
    else if (capId === 'channel_0' || capId === 'channel_1') data = { [capId]: value };
    else data = { status: value };
    data.key = this._writeKey(gw);

    this._send(dev.gwHost, { cmd: 'write', model: dev.model, sid, data: JSON.stringify(data) });
    // gateway confirms with write_ack + report — no optimistic store update
  }
}

module.exports = AqaraClient;
