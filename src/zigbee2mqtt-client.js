'use strict';

// Zigbee2MQTT bridge — the devices of an existing Zigbee2MQTT install,
// over MQTT. For a Zigbee stick LSH drives itself, see zigbee-client.js.
//
//   "zigbee2mqtt": { "baseTopic": "zigbee2mqtt",
//                    "host": "", "port": 1883, "username": "", "password": "",
//                    "names": { "0x00158d0001a2b3c4": "Czujnik salon" } }
//
// Blank host → LSH's built-in broker when it's enabled, else the main MQTT
// broker (src/mqtt-target.js). Point Zigbee2MQTT at the same broker.
//
// Zigbee2MQTT publishes its device list (retained) on <base>/bridge/devices,
// each with its definition's exposes, the same format zigbee-herdsman-
// converters gives zigbee-client.js, so src/zigbee-map.js turns them into
// LSH sensors here too. State comes on <base>/<friendly_name> (JSON),
// availability on <base>/<friendly_name>/availability (when availability is
// on in Zigbee2MQTT), and commands go to <base>/<friendly_name>/set.
//
// Devices: zigbee2mqtt/<ieee> (stable across renames; a friendly name change
// only relabels). zigbee2mqtt/bridge carries the bridge state, version,
// channel and permitJoin, plus "remove" (IEEE address or friendly name).
// Groups aren't mapped.
//
// Tested against scripts/zigbee2mqtt-simulator.js over the built-in broker
// (test/zigbee2mqtt.test.js); the topic and payload shapes follow the
// Zigbee2MQTT 1.x / 2.x MQTT API docs. Not run against a real Zigbee2MQTT here.

const mqtt = require('mqtt');
const platformStatus = require('./platform-status');
const { sharedBroker, authOpts } = require('./mqtt-target');
const { buildModel, ICONS } = require('./zigbee-map');

const BRIDGE = 'zigbee2mqtt/bridge';
const START_TIMEOUT_MS = 10_000;
const PERMIT_JOIN_S = 254;

const parse = (buf) => {
  const s = buf.toString();
  try { return JSON.parse(s); } catch { return s; }
};
// availability / bridge state: "online" (1.x) or { state: 'online' } (2.x)
const isOnline = (v) => (typeof v === 'object' && v ? v.state : v) === 'online';

class Zigbee2MqttClient {
  constructor(config, store, sensorRegistry) {
    this._config = config;
    this._store = store;
    this._registry = sensorRegistry;
    this._client = null;
    this._devices = new Map();   // ieee → { ieee, name, key, model, sig }
    this._byName = new Map();    // friendly_name → ieee
    this._pending = new Map();   // friendly_name → last state seen before bridge/devices
    this._bridgeOnline = null; // null until bridge/state says
    this._sawDevices = false;
    this._version = '';
    this._ready = null;
  }

  get cfg() { return this._config.zigbee2mqtt || {}; }
  get base() { return String(this.cfg.baseTopic || 'zigbee2mqtt').replace(/\/+$/, ''); }

  target() {
    const cfg = this.cfg;
    if (cfg.host) {
      return { host: cfg.host, port: Number(cfg.port) || 1883,
        username: cfg.username || undefined, password: cfg.username ? (cfg.password || '') : undefined };
    }
    return sharedBroker(this._config);
  }

  start() {
    const t = this.target();
    if (!t) return Promise.reject(new Error('No MQTT broker: set a host, or enable the built-in broker'));
    const url = `mqtt://${t.host}:${t.port}`;
    platformStatus.set('zigbee2mqtt', false);
    this._registerBridge();
    console.log(`[Zigbee2MQTT] Connecting to ${url} (base topic ${this.base})`);

    let resolveReady;
    this._ready = new Promise((r) => { resolveReady = r; });
    this._resolveReady = resolveReady;

    const client = mqtt.connect(url, {
      clientId: `lsh-z2m-${process.pid}-${Math.random().toString(16).slice(2, 6)}`,
      connectTimeout: 10_000,
      reconnectPeriod: 5_000,
      ...authOpts(t),
    });
    this._client = client;
    client.on('connect', () => {
      client.subscribe(`${this.base}/#`, (err) => {
        if (err) console.error(`[Zigbee2MQTT] Subscribe failed: ${err.message}`);
      });
    });
    client.on('message', (topic, payload) => {
      try { this._onMessage(topic, payload); }
      catch (err) { console.error(`[Zigbee2MQTT] ${topic}: ${err.message}`); }
    });
    client.on('error', (err) => console.error(`[Zigbee2MQTT] ${err.message}`));
    client.on('close', () => this._setStatus());

    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        `No Zigbee2MQTT on ${url} under "${this.base}" (no ${this.base}/bridge/devices within ${START_TIMEOUT_MS / 1000} s) — still trying`)),
      START_TIMEOUT_MS);
    });
    return Promise.race([this._ready, timeout]).finally(() => clearTimeout(timer));
  }

  stop() {
    const c = this._client;
    this._client = null;
    try { c?.end(true); } catch { /* closing anyway */ }
    platformStatus.set('zigbee2mqtt', false);
  }

  _setStatus() {
    // no bridge/state (yet) but a device list: count it as up
    const up = this._bridgeOnline ?? this._sawDevices;
    platformStatus.set('zigbee2mqtt', !!this._client?.connected && up);
  }

  // ── Incoming ──

  _onMessage(topic, buf) {
    const prefix = `${this.base}/`;
    if (!topic.startsWith(prefix)) return;
    const rest = topic.slice(prefix.length);

    if (rest.startsWith('bridge/')) return this._onBridge(rest.slice(7), buf);

    if (rest.endsWith('/availability')) {
      const ieee = this._byName.get(rest.slice(0, -13));
      if (ieee) this._store.update(`${this._devices.get(ieee).key}/online`, isOnline(parse(buf)) ? 1 : 0);
      return;
    }
    // commands (ours or anyone's): <name>/set, <name>/get, <name>/l2/set…
    if (/\/(set|get)(\/[^/]+)?$/.test(rest)) return;
    const ieee = this._byName.get(rest);
    const value = parse(buf);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (!ieee) { this._pending.set(rest, value); return; }
    this._apply(this._devices.get(ieee), value);
  }

  _onBridge(sub, buf) {
    const value = parse(buf);
    if (sub === 'state') {
      this._bridgeOnline = isOnline(value);
      this._store.update(`${BRIDGE}/state`, this._bridgeOnline ? 'online' : 'offline');
      this._setStatus();
    } else if (sub === 'info' && value && typeof value === 'object') {
      this._onInfo(value);
    } else if (sub === 'devices' && Array.isArray(value)) {
      this._onDevices(value);
      this._sawDevices = true;
      this._setStatus();
      this._resolveReady?.();
    } else if (sub === 'event' && value?.type === 'device_joined') {
      this._store.update(`${BRIDGE}/lastJoined`, value.data?.friendly_name || value.data?.ieee_address || '');
    } else if (sub.startsWith('response/') && value?.status === 'error') {
      console.warn(`[Zigbee2MQTT] ${sub.slice(9)}: ${value.error}`);
    }
  }

  _onInfo(info) {
    this._version = String(info.version || '');
    const net = info.network || {};
    const coord = info.coordinator || {};
    this._store.update(`${BRIDGE}/version`, this._version);
    if (net.channel != null) this._store.update(`${BRIDGE}/channel`, Number(net.channel));
    if (net.pan_id != null) this._store.update(`${BRIDGE}/panId`, `0x${Number(net.pan_id).toString(16).padStart(4, '0')}`);
    const fw = [coord.type, coord.meta?.revision || coord.meta?.version].filter(Boolean).join(' ');
    this._store.update(`${BRIDGE}/coordinator`, fw);
    const on = !!info.permit_join;
    this._store.update(`${BRIDGE}/permitJoin`, on ? 1 : 0);
    // 2.x: permit_join_end (epoch ms); 1.x: permit_join_timeout (s)
    const left = info.permit_join_end ? Math.max(0, Math.round((info.permit_join_end - Date.now()) / 1000))
      : Number(info.permit_join_timeout) || 0;
    this._store.update(`${BRIDGE}/permitJoinLeft`, on ? left : 0);
  }

  _onDevices(list) {
    const seen = new Set();
    for (const d of list) {
      if (!d || d.type === 'Coordinator' || !d.ieee_address || !d.friendly_name) continue;
      if (d.disabled || !d.definition || d.interview_completed === false) continue;
      seen.add(d.ieee_address);
      this._upsert(d);
    }
    for (const [ieee, e] of this._devices) {
      if (seen.has(ieee)) continue;
      console.log(`[Zigbee2MQTT] ${e.name} is gone from Zigbee2MQTT`);
      this._devices.delete(ieee);
      this._byName.delete(e.name);
      if (this._registry.devices?.delete?.(e.key)) this._registry.emit?.('devices-changed');
    }
    this._store.update(`${BRIDGE}/devices`, this._devices.size);
  }

  _label(d) {
    const names = this.cfg.names || {};
    return names[d.ieee_address] || names[d.friendly_name] || d.friendly_name;
  }

  _upsert(d) {
    const ieee = d.ieee_address;
    const def = d.definition;
    const prev = this._devices.get(ieee);
    const label = this._label(d);
    const sig = JSON.stringify([label, def.vendor, def.model, def.exposes]);
    if (prev && prev.name !== d.friendly_name) this._byName.delete(prev.name);
    this._byName.set(d.friendly_name, ieee);
    if (prev?.sig === sig) { prev.name = d.friendly_name; return; }

    const model = buildModel(def.exposes || []);
    const entry = { ieee, name: d.friendly_name, key: `zigbee2mqtt/${ieee.replace(/^0x/, '')}`, model, sig };
    this._devices.set(ieee, entry);
    const sensors = [...model.sensors, { path: 'online', name: 'Online', format: 'on-off' }];
    const existing = this._registry.devices?.get?.(entry.key);
    if (existing) {
      // renamed or re-interviewed: the registry keeps the first registration
      Object.assign(existing, { label, model: `${def.vendor} ${def.model}`, sensors, homekit: model.homekit, icon: ICONS[model.kind] || '📡' });
      this._registry.emit?.('devices-changed');
    } else {
      this._registry.registerDevice({
        key: entry.key,
        label,
        type: 'zigbee2mqtt',
        icon: ICONS[model.kind] || '📡',
        model: `${def.vendor} ${def.model}`,
        ieee,
        sensors,
        homekit: model.homekit,
        _writeCapability: (capId, command, args = []) => this._write(ieee, capId, command, args),
      });
    }
    if (!prev) console.log(`[Zigbee2MQTT] ${label} (${def.vendor} ${def.model})`);

    const pending = this._pending.get(d.friendly_name);
    if (pending) { this._pending.delete(d.friendly_name); this._apply(entry, pending); }
    else if (!prev) this._requestState(entry, def.exposes || []);
  }

  // state isn't retained by default: ask for the switchable parts once
  _requestState(entry, exposes) {
    const props = {};
    for (const e of exposes) {
      if (!['light', 'switch', 'cover', 'lock'].includes(e.type)) continue;
      for (const f of e.features || []) {
        if ((f.name === 'state' || f.name === 'position' || f.name === 'brightness') && (f.access & 4)) props[f.property] = '';
      }
    }
    if (Object.keys(props).length) this._publish(`${this.base}/${entry.name}/get`, props);
  }

  _apply(entry, payload) {
    for (const [p, v] of entry.model.read(payload)) this._store.update(`${entry.key}/${p}`, v);
  }

  // ── Outgoing ──

  _publish(topic, payload) {
    const c = this._client;
    if (!c?.connected) throw new Error('Zigbee2MQTT: not connected to the MQTT broker');
    c.publish(topic, JSON.stringify(payload));
  }

  async _write(ieee, capId, command, args) {
    const entry = this._devices.get(ieee);
    if (!entry) throw new Error('Zigbee2MQTT device not available');
    const message = entry.model.write(capId, command, args);
    this._publish(`${this.base}/${entry.name}/set`, message);
    return message;
  }

  _registerBridge() {
    this._registry.registerDevice({
      key: BRIDGE,
      label: 'Zigbee2MQTT',
      type: 'zigbee2mqtt',
      icon: '📡',
      model: 'Zigbee2MQTT bridge',
      sensors: [
        { path: 'state', name: 'Bridge', type: 'label' },
        { path: 'permitJoin', name: 'Pairing', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'permitJoin' },
        { path: 'permitJoinLeft', name: 'Pairing time left', unit: 's', format: 'number', precision: 0 },
        { path: 'devices', name: 'Devices', format: 'number', precision: 0 },
        { path: 'version', name: 'Version', type: 'label' },
        { path: 'coordinator', name: 'Coordinator', type: 'label' },
        { path: 'channel', name: 'Channel', format: 'number', precision: 0 },
        { path: 'panId', name: 'PAN ID', type: 'label' },
        { path: 'lastJoined', name: 'Last joined', type: 'label' },
        { path: 'remove', name: 'Remove device', type: 'text', controllable: true, hidden: true, capabilityId: 'remove', writeCmd: 'remove' },
      ],
      _writeCapability: (capId, command, args = []) => this._bridgeCommand(capId, command, args),
    });
  }

  async _bridgeCommand(capId, command, args) {
    if (capId === 'permitJoin') {
      const time = command === 'on' ? PERMIT_JOIN_S : 0;
      // 2.x takes { time }; 1.x wants { value, time }
      const v1 = /^1\./.test(this._version);
      this._publish(`${this.base}/bridge/request/permit_join`, v1 ? { value: time > 0, time } : { time });
      this._store.update(`${BRIDGE}/permitJoin`, time > 0 ? 1 : 0);
      return { permitJoin: time > 0, seconds: time };
    }
    if (capId === 'remove') {
      const id = String(args[0] || '').trim();
      if (!id) throw new Error('Give the IEEE address or friendly name to remove');
      const entry = this._devices.get(id) || this._devices.get(this._byName.get(id));
      this._publish(`${this.base}/bridge/request/device/remove`, { id: entry?.name || id, force: command === 'forceRemove' });
      return { removing: entry?.name || id };
    }
    throw new Error(`Zigbee2MQTT: unknown command ${capId}`);
  }
}

module.exports = Zigbee2MqttClient;
