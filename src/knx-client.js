const EventEmitter = require('events');
const platformStatus = require('./platform-status');
const ets = require('./knx-ets');

// KNX 2-byte float decode (DPT9)
function decodeDPT9(b0, b1) {
  const sign = (b0 & 0x80) >> 7;
  const exp  = (b0 & 0x78) >> 3;
  let mant   = ((b0 & 0x07) << 8) | b1;
  if (sign) mant -= 2048;
  return Math.round(0.01 * mant * Math.pow(2, exp) * 100) / 100;
}

// KNX 2-byte float encode (DPT9)
function encodeDPT9(value) {
  const sign = value < 0 ? 1 : 0;
  let mant   = Math.round(Math.abs(value) / 0.01);
  let exp    = 0;
  while (mant > 2047) { mant >>= 1; exp++; }
  if (sign) mant = 2048 - mant;
  return [(sign << 7) | (exp << 3) | ((mant >> 8) & 0x07), mant & 0xFF];
}

function parseValue(raw, dpt) {
  if (!raw || raw.length === 0) return null;
  const base = (dpt || '').split('.')[0].toUpperCase();
  switch (base) {
    case 'DPT1':  return raw[0] ? true : false;
    case 'DPT5':  return raw[0];                // 0-255; UI can show as % if unit set
    case 'DPT9':  return raw.length >= 2 ? decodeDPT9(raw[0], raw[1]) : null;
    case 'DPT14': return raw.length >= 4 ? Buffer.from(raw).readFloatBE(0) : null;
    default:      return raw[0] ?? null;
  }
}

function encodeValue(value, dpt) {
  const base = (dpt || '').split('.')[0].toUpperCase();
  switch (base) {
    case 'DPT1':  return value ? 1 : 0;
    case 'DPT5':  return Math.max(0, Math.min(255, Math.round(Number(value))));
    case 'DPT9':  return encodeDPT9(Number(value));
    default:      return Number(value);
  }
}

function inferSensorType(ga) {
  const unit  = (ga.unit  || '').toLowerCase();
  const name  = (ga.name  || ga.address || '').toLowerCase();
  const base  = (ga.dpt   || 'DPT1').split('.')[0].toUpperCase();

  if (base === 'DPT5') return 'dimmer';
  if (unit === '°c' || unit === '°f' || unit === 'c' || unit === 'f' || unit === 'k') return 'temperature';
  if (unit === 'lux' || unit === 'lx')    return 'light';
  if (unit === 'w'   || unit === 'kw')    return 'power';
  if (unit === 'kwh' || unit === 'wh')    return 'energy';
  if (unit === '%' || name.includes('hum')) return 'humidity';
  if (name.includes('motion') || name.includes('pir'))          return 'motion';
  if (name.includes('door')   || name.includes('window'))       return 'door';
  if (name.includes('smoke')  || name.includes('flood'))        return 'security';
  if (base === 'DPT1') return 'switch';
  return 'sensor';
}

class KNXClient extends EventEmitter {
  constructor(config, store, sensorRegistry) {
    super();
    this._cfg   = config.knx;
    this._store = store;
    this._reg   = sensorRegistry;
    this._conn  = null;
    this._automation = null;
    this._bridge = null;   // { byCmd: Map<ga, entry>, byStatus: Map<ga, entry>, byKey: Map<storeKey, entry> }
  }

  // server.js hands over the automation engine, so scene triggers can run scenes
  setAutomation(automation) {
    this._automation = automation;
    automation?.onScenesChanged?.(() => this._scheduleBridge());
    this._scheduleBridge();
  }

  async start() {
    const cfg = this._cfg;
    const gas = cfg.groupAddresses || [];
    if (!cfg.host) return;

    let knxLib;
    try {
      knxLib = require('knx');
    } catch {
      console.error('[KNX] Package not installed — run: npm install knx');
      return;
    }

    const deviceKey = `knx/${cfg.host}`;
    platformStatus.set('knx', false);

    this._conn = knxLib.Connection({
      ipAddr:     cfg.host,
      ipPort:     parseInt(cfg.port) || 3671,
      handlers: {
        connected: () => {
          console.log(`[KNX] Connected to ${cfg.host}:${cfg.port || 3671}`);
          platformStatus.set('knx', true);
          this._registerDevice(deviceKey, gas);
          this._startBridge();
          gas.forEach(ga => {
            if (ga.readable !== false) {
              try { this._conn.read(ga.address); } catch {}
            }
          });
        },

        event: (evt, src, dest, rawValue) => {
          if (this._bridge && this._onBridgeEvent(evt, dest, rawValue)) return;
          if (evt !== 'GroupValue_Write' && evt !== 'GroupValue_Response') return;
          const ga = gas.find(g => g.address === dest);
          if (!ga) return;
          const value = parseValue(rawValue, ga.dpt);
          if (value === null) return;
          this._store.update(`${deviceKey}/${ga.address}`, value);
        },

        disconnected: () => {
          console.warn(`[KNX] Disconnected from ${cfg.host}`);
          platformStatus.set('knx', false);
        },

        error: (err) => {
          console.error(`[KNX] ${err}`);
          platformStatus.set('knx', false);
        },
      },
    });
  }

  // ── LSH → KNX bridge (knx.lshBridge) ───────────────────────────────────
  // Serves the group addresses of the ETS export (src/knx-ets.js) on the
  // bus: a write to a command address drives the LSH device or runs the
  // scene, status/value addresses follow the device (sent on change,
  // answered on read). Only addresses already handed out by an export are
  // served — a device added since appears after the next export.

  _startBridge() {
    if (!this._cfg.lshBridge || this._bridgeOn) return;
    this._bridgeOn = true;
    this._reg.on?.('device-discovered', () => this._scheduleBridge());
    this._store.on('change', ({ key, value, changed }) => {
      if (changed === false || !this._bridge || !this._conn) return;
      const e = this._bridge.byKey.get(key);
      if (e?.status) this._send('write', e.status, value, e);
    });
    this._buildBridge();
  }

  _scheduleBridge() {
    if (!this._bridgeOn) return;
    clearTimeout(this._bridgeTimer);
    this._bridgeTimer = setTimeout(() => this._buildBridge(), 2000);
    this._bridgeTimer.unref?.();
  }

  _buildBridge() {
    const { entries } = ets.allocate(this._reg.getDevices(), ets.loadMap(), {
      mainGroup: this._cfg.ets?.mainGroup ?? 20,
      getValue: (k) => this._store.get(k),
      scenes: this._automation?.scenes || [],
      readOnly: true,
    });
    const byCmd = new Map(), byStatus = new Map(), byKey = new Map();
    for (const e of entries) {
      if (e.cmd) byCmd.set(e.cmd, e);
      if (e.status) byStatus.set(e.status, e);
      byKey.set(e.key, e);
    }
    const first = !this._bridge;
    this._bridge = { byCmd, byStatus, byKey };
    if (first) console.log(`[KNX] LSH bridge: ${byCmd.size} command, ${byStatus.size} status address(es)`);
  }

  // true when the telegram was for a bridged address
  _onBridgeEvent(evt, dest, raw) {
    const { byCmd, byStatus } = this._bridge;
    if (evt === 'GroupValue_Read') {
      const e = byStatus.get(dest);
      if (!e) return false;
      const value = this._store.get(e.key);
      if (value != null) this._send('respond', dest, value, e);
      return true;
    }
    if (evt !== 'GroupValue_Write') return false;
    const e = byCmd.get(dest);
    if (!e) return !!byStatus.get(dest);
    let value = parseValue(raw, e.dpt);
    if (e.dpt === 'DPT5.001' && value != null) value = Math.round(value * 100 / 255);
    if (e.kind === 'scene') {
      if (value && this._automation) this._automation.runScene(e.sceneId).catch((err) => console.error(`[KNX] Scene ${e.sceneId}: ${err.message}`));
      return true;
    }
    // DPT 1.017 trigger: either telegram value fires the button
    if (e.dpt === 'DPT1.017') value = true;
    this._reg.sendCommand(e.deviceKey, e.path, value)
      .catch((err) => console.error(`[KNX] ${dest} → ${e.key}: ${err.message}`));
    return true;
  }

  _send(how, addr, value, e) {
    let v = value;
    if (e.dpt.startsWith('DPT1.')) v = value === true || value === 1 || value === 'on' || value === '1' || value === 'true';
    else if (typeof v !== 'number') { v = Number(v); if (!Number.isFinite(v)) return; }
    if (e.dpt === 'DPT5.001') v = Math.max(0, Math.min(100, v));
    try { this._conn[how](addr, v, e.dpt); }
    catch (err) { console.error(`[KNX] ${how} ${addr} failed: ${err.message}`); }
  }

  stop() {
    clearTimeout(this._bridgeTimer);
    try { this._conn?.Disconnect(); } catch {}
    this._conn = null;
    platformStatus.set('knx', false);
  }

  _registerDevice(deviceKey, gas) {
    const sensors = gas.map(ga => {
      const base       = (ga.dpt || 'DPT1').split('.')[0].toUpperCase();
      const isBoolean  = base === 'DPT1';
      const isRange    = base === 'DPT5';
      const sensorType = ga.sensorType || inferSensorType(ga);

      if (ga.writable && isBoolean) {
        return {
          path: ga.address, label: ga.name || ga.address, sensorType,
          format: 'on-off', controllable: true, type: 'toggle',
          writeOn: 'on', writeOff: 'off', capabilityId: ga.address, homekit: null,
        };
      }
      if (ga.writable && isRange) {
        return {
          path: ga.address, label: ga.name || ga.address, sensorType,
          unit: ga.unit || '', controllable: true, type: 'range',
          min: ga.min ?? 0, max: ga.max ?? 255, writeCmd: 'set',
          capabilityId: ga.address, homekit: null,
        };
      }
      return {
        path: ga.address, label: ga.name || ga.address, sensorType,
        unit: ga.unit || '', homekit: null,
      };
    });

    this._reg.registerDevice({
      key:     deviceKey,
      label:   cfg_label(this._cfg),
      type:    'knx',
      homekit: [],
      sensors,
      _writeCapability: (capId, command, args) => {
        const ga = gas.find(g => g.address === capId);
        if (!ga?.writable || !this._conn) return;
        const value = command === 'on' ? 1 : command === 'off' ? 0 : (args?.[0] ?? 0);
        try {
          this._conn.write(ga.address, encodeValue(value, ga.dpt), ga.dpt || 'DPT1');
        } catch (err) {
          console.error(`[KNX] Write ${ga.address} failed: ${err.message}`);
        }
      },
    });
  }
}

function cfg_label(cfg) {
  return cfg.name || `KNX ${cfg.host}`;
}

module.exports = KNXClient;
