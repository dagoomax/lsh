'use strict';

// Zigbee coordinator on a USB stick — LSH's own Zigbee network, no
// Zigbee2MQTT or MQTT broker needed. zigbee-herdsman drives the stick and
// zigbee-herdsman-converters supplies the device definitions (the same
// ~5000-device library Zigbee2MQTT uses); src/zigbee-map.js turns each
// definition's features into LSH sensors.
//
//   "zigbee": { "port": "/dev/serial/by-id/usb-Silicon_Labs_CP2105_…-if00-port0",
//               "adapter": "ember", "baudRate": 115200, "rtscts": false, "channel": 15,
//               "names": { "0x00158d0001a2b3c4": "Czujnik salon" } }
//
// Sticks: Aeotec Z-Stick 10 Pro (Zigbee side: EFR32MG21, EmberZNet ≥ 7.4.3),
// Z-Wave.Me Z-Station (EFR32MG21P, firmware ≥ 2024.04.22) — both "ember";
// other coordinators work with their herdsman adapter (zstack = TI CC2652
// e.g. Sonoff ZBDongle-P, deconz = ConBee, zboss, zigate). port can also be
// tcp://host:port for a network coordinator.
//
// The network (PAN id, extended PAN id, network key) is generated on first
// start and kept in persist/zigbee/network.json, the device database in
// persist/zigbee/database.db, the coordinator backup in coordinator_backup.json.
// Moving from Zigbee2MQTT: put its pan_id / ext_pan_id / network_key in
// network.json (same names) and the channel in config, and the devices stay
// paired — they show up as they next report.
//
// Devices: zigbee/<ieee>. zigbee/coordinator carries the network state and
// permitJoin (pairing, 4 min) — a regular controllable sensor, so pairing
// works through the module host like any other command.
//
// Not run against a real stick here: the definitions/converters are
// Zigbee2MQTT's own, the mapping and the controller wiring are tested with
// stand-ins (test/zigbee.test.js).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Controller, setLogger: setHerdsmanLogger } = require('zigbee-herdsman');
const zhc = require('zigbee-herdsman-converters');
const platformStatus = require('./platform-status');
const { buildModel, ICONS } = require('./zigbee-map');

const DIR = path.join(__dirname, '..', 'persist', 'zigbee');
const RETRY_MS = 30_000;
const PERMIT_JOIN_S = 240;
const COORD = 'zigbee/coordinator';

// Zigbee2MQTT-compatible names, hex strings or arrays
function loadNetwork(file = path.join(DIR, 'network.json')) {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first start */ }
  const bytes = (v, n) => {
    if (Array.isArray(v) && v.length === n && v.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) return v;
    const h = typeof v === 'string' ? v.replace(/^0x/i, '').replace(/[^0-9a-f]/gi, '') : '';
    return h.length === n * 2 ? [...Buffer.from(h, 'hex')] : null;
  };
  let pan = Number(saved.pan_id ?? saved.panID);
  let ext = bytes(saved.ext_pan_id ?? saved.extendedPanID, 8);
  let key = bytes(saved.network_key ?? saved.networkKey, 16);
  let changed = false;
  if (!(pan >= 1 && pan < 0xffff)) { pan = 1 + crypto.randomInt(0xfffd); changed = true; }
  if (!ext) { ext = [...crypto.randomBytes(8)]; changed = true; }
  if (!key) { key = [...crypto.randomBytes(16)]; changed = true; }
  if (changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ pan_id: pan, ext_pan_id: ext, network_key: key }, null, 2), { mode: 0o600 });
    console.log('[Zigbee] Created a new network (persist/zigbee/network.json — keep a backup)');
  }
  return { panID: pan, extendedPanID: ext, networkKey: key };
}

function quietLogger(tag) {
  const text = (m) => (typeof m === 'function' ? m() : m instanceof Error ? m.message : String(m));
  return {
    debug: () => {},
    info: () => {},
    warning: (m, ns) => console.warn(`[${tag}] ${ns ? `${ns}: ` : ''}${text(m)}`),
    error: (m, ns) => console.error(`[${tag}] ${ns ? `${ns}: ` : ''}${text(m)}`),
  };
}

class ZigbeeClient {
  constructor(config, store, sensorRegistry, deps = {}) {
    this._config = config;
    this._store = store;
    this._registry = sensorRegistry;
    this._Controller = deps.Controller || Controller;
    this._zhc = deps.zhc || zhc;
    this._dir = deps.dir || DIR;
    this._real = !deps.Controller;
    this._controller = null;
    this._devices = new Map(); // ieee → { device, definition, model, key, state }
    this._timer = null;
    this._joinTimer = null;
    this._stopped = false;
  }

  get cfg() { return this._config.zigbee || {}; }

  async start() {
    if (!this.cfg.port) return;
    this._stopped = false;
    if (this._real) {
      try { setHerdsmanLogger(quietLogger('Zigbee')); this._zhc.setLogger?.(quietLogger('Zigbee')); } catch { /* older versions */ }
    }
    platformStatus.set('zigbee', false);
    this._registerCoordinator();
    await this._open();
  }

  async _open() {
    const cfg = this.cfg;
    fs.mkdirSync(this._dir, { recursive: true });
    const channel = Math.min(26, Math.max(11, Number(cfg.channel) || 15));
    const controller = new this._Controller({
      network: { ...loadNetwork(path.join(this._dir, 'network.json')), channelList: [channel] },
      transport: {
        path: cfg.port,
        adapter: cfg.adapter || 'ember',
        baudRate: Number(cfg.baudRate) || 115200,
        rtscts: !!cfg.rtscts,
      },
      databasePath: path.join(this._dir, 'database.db'),
      databaseBackupPath: path.join(this._dir, 'database.db.backup'),
      backupPath: path.join(this._dir, 'coordinator_backup.json'),
      adapter: { disableLED: !!cfg.disableLED, ...(cfg.transmitPower != null ? { transmitPower: Number(cfg.transmitPower) } : {}) },
      acceptJoiningDeviceHandler: async () => true,
    });
    this._controller = controller;

    controller.on('message', (m) => this._onMessage(m).catch((err) => console.error(`[Zigbee] Message: ${err.message}`)));
    controller.on('deviceJoined', ({ device }) => {
      console.log(`[Zigbee] ${device.ieeeAddr} joined — interviewing`);
      this._store.update(`${COORD}/lastJoined`, device.ieeeAddr);
    });
    controller.on('deviceInterview', (e) => this._onInterview(e).catch((err) => console.error(`[Zigbee] Interview: ${err.message}`)));
    controller.on('deviceAnnounce', ({ device }) => this._event('deviceAnnounce', device));
    controller.on('deviceLeave', ({ ieeeAddr }) => {
      console.log(`[Zigbee] ${ieeeAddr} left the network`);
      this._devices.delete(ieeeAddr);
      this._updateCount();
    });
    controller.on('permitJoinChanged', ({ permitted, time }) => {
      this._store.update(`${COORD}/permitJoin`, permitted ? 1 : 0);
      this._store.update(`${COORD}/permitJoinLeft`, permitted ? Number(time) || 0 : 0);
    });
    controller.on('adapterDisconnected', () => {
      console.error('[Zigbee] Stick disconnected');
      platformStatus.set('zigbee', false);
      this._retry();
    });

    try {
      const result = await controller.start();
      const net = await controller.getNetworkParameters().catch(() => null);
      const ver = await controller.getCoordinatorVersion().catch(() => null);
      const fw = ver ? [ver.type, ver.meta?.revision || ver.meta?.version].filter(Boolean).join(' ') : '';
      this._store.update(`${COORD}/channel`, net?.channel ?? channel);
      this._store.update(`${COORD}/panId`, net ? `0x${Number(net.panID).toString(16).padStart(4, '0')}` : '');
      this._store.update(`${COORD}/firmware`, fw);
      this._store.update(`${COORD}/permitJoin`, 0);
      console.log(`[Zigbee] Coordinator ready (${result}) — ${fw || cfg.adapter || 'ember'}, channel ${net?.channel ?? channel}`);
      for (const device of controller.getDevicesIterator((d) => d.type !== 'Coordinator')) {
        await this._setup(device, { configure: false }).catch((err) => console.error(`[Zigbee] ${device.ieeeAddr}: ${err.message}`));
      }
      this._updateCount();
      platformStatus.set('zigbee', true);
    } catch (err) {
      console.error(`[Zigbee] Can't start the coordinator on ${cfg.port}: ${err.message}`);
      platformStatus.set('zigbee', false);
      this._retry();
    }
  }

  _retry() {
    if (this._stopped) return;
    const c = this._controller;
    this._controller = null;
    c?.removeAllListeners?.();
    Promise.resolve(c?.stop?.()).catch(() => {});
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._open().catch(() => {}), RETRY_MS);
  }

  async stop() {
    this._stopped = true;
    clearTimeout(this._timer);
    clearTimeout(this._joinTimer);
    for (const e of this._devices.values()) this._event('stop', e.device);
    const c = this._controller;
    this._controller = null;
    await Promise.resolve(c?.stop?.()).catch(() => {});
  }

  // ── Coordinator device ──

  _registerCoordinator() {
    this._registry.registerDevice({
      key: COORD,
      label: 'Zigbee',
      type: 'zigbee',
      icon: '📡',
      model: 'Zigbee coordinator',
      sensors: [
        { path: 'permitJoin', name: 'Pairing', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'permitJoin' },
        { path: 'permitJoinLeft', name: 'Pairing time left', unit: 's', format: 'number', precision: 0 },
        { path: 'devices', name: 'Devices', format: 'number', precision: 0 },
        { path: 'channel', name: 'Channel', format: 'number', precision: 0 },
        { path: 'panId', name: 'PAN ID', type: 'label' },
        { path: 'firmware', name: 'Firmware', type: 'label' },
        { path: 'lastJoined', name: 'Last joined', type: 'label' },
        { path: 'members', name: 'Devices in the network', type: 'object', hidden: true },
        // Settings → remove a device: the IEEE address as the value
        { path: 'remove', name: 'Remove device', type: 'text', controllable: true, hidden: true, capabilityId: 'remove', writeCmd: 'remove' },
      ],
      _writeCapability: (capId, command, args = []) => this._coordinatorCommand(capId, command, args),
    });
  }

  async _coordinatorCommand(capId, command, args) {
    const c = this._controller;
    if (!c) throw new Error('The Zigbee coordinator is not running');
    if (capId === 'permitJoin') {
      const on = command === 'on';
      await c.permitJoin(on ? PERMIT_JOIN_S : 0);
      this._store.update(`${COORD}/permitJoin`, on ? 1 : 0);
      return { permitJoin: on, seconds: on ? PERMIT_JOIN_S : 0 };
    }
    if (capId === 'remove') {
      const ieee = String(args[0] || '').toLowerCase();
      const device = c.getDeviceByIeeeAddr(ieee);
      if (!device) throw new Error(`No Zigbee device ${ieee}`);
      try { await device.removeFromNetwork(); }
      catch (err) {
        // asleep or gone: forget it here anyway (what Zigbee2MQTT's "force remove" does)
        console.warn(`[Zigbee] ${ieee} didn't confirm leaving (${err.message}) — removed from the database`);
        device.removeFromDatabase?.();
      }
      this._devices.delete(ieee);
      this._updateCount();
      return { removed: ieee };
    }
    throw new Error(`Zigbee: unknown command ${capId}`);
  }

  _updateCount() {
    this._store.update(`${COORD}/devices`, this._devices.size);
    // removed devices stay registered until a restart — Settings lists these
    this._store.update(`${COORD}/members`, [...this._devices.values()].map((e) => e.key));
  }

  // ── Devices ──

  async _onInterview({ status, device }) {
    this._event('deviceInterview', device, { status });
    if (status === 'successful') {
      console.log(`[Zigbee] ${device.ieeeAddr} interviewed (${device.manufacturerName || '?'} ${device.modelID || '?'})`);
      await this._setup(device, { configure: true });
      this._updateCount();
    } else if (status === 'failed') {
      console.warn(`[Zigbee] ${device.ieeeAddr} interview failed — bring it closer and pair it again`);
    }
  }

  async _setup(device, { configure }) {
    // herdsman ≥ 9: interviewState; older: interviewCompleted
    const done = device.interviewState ? device.interviewState === 'SUCCESSFUL' : !!device.interviewCompleted;
    if (!done && !device.modelID) return;
    const definition = await this._zhc.findByDevice(device, true);
    if (!definition) return;
    const ieee = device.ieeeAddr;
    const prev = this._devices.get(ieee);
    const entry = { device, definition, state: prev?.state || {}, key: `zigbee/${ieee.replace(/^0x/, '')}` };
    entry.model = buildModel(this._exposes(entry));
    entry.fz = indexConverters(definition.fromZigbee);
    this._devices.set(ieee, entry);

    // reporting/binding — once per device (and again when the definition changes)
    const cfgKey = `${definition.vendor}/${definition.model}`;
    if (definition.configure && (configure || device.meta?.lshConfigured !== cfgKey)) {
      const coord = this._controller.getDevicesByType('Coordinator')[0]?.getEndpoint(1);
      try {
        await definition.configure(device, coord, definition);
        device.meta = { ...(device.meta || {}), lshConfigured: cfgKey };
        device.save?.();
      } catch (err) {
        console.warn(`[Zigbee] ${this._label(entry)}: configure failed (${err.message}) — retried next start`);
      }
    }
    this._event('start', device);
    this._register(entry);
  }

  _exposes(entry) {
    const { definition, device } = entry;
    try {
      return typeof definition.exposes === 'function' ? definition.exposes(device, this._options(device)) : (definition.exposes || []);
    } catch { return []; }
  }

  _options(device) { return this.cfg.deviceOptions?.[device.ieeeAddr] || {}; }

  _label(entry) {
    const { device, definition } = entry;
    return this.cfg.names?.[device.ieeeAddr] || definition?.description || device.modelID || device.ieeeAddr;
  }

  _register(entry) {
    const { definition, model, key, device } = entry;
    this._registry.registerDevice({
      key,
      label: this._label(entry),
      type: 'zigbee',
      icon: ICONS[model.kind] || '📡',
      model: `${definition.vendor} ${definition.model}`,
      ieee: device.ieeeAddr,
      sensors: model.sensors,
      homekit: model.homekit,
      _writeCapability: (capId, command, args = []) => this._write(entry.device.ieeeAddr, capId, command, args),
    });
  }

  _event(type, device, extra = {}) {
    const entry = this._devices.get(device?.ieeeAddr);
    const data = type === 'stop'
      ? { ieeeAddr: device.ieeeAddr }
      : { device, state: entry?.state || {}, options: this._options(device), deviceExposesChanged: () => entry && this._rebuild(entry), ...extra };
    const ev = { type, data };
    Promise.resolve(this._zhc.onEvent?.(ev)).catch(() => {});
    if (entry?.definition?.onEvent) Promise.resolve().then(() => entry.definition.onEvent(ev)).catch(() => {});
  }

  _rebuild(entry) {
    entry.model = buildModel(this._exposes(entry));
    const dev = this._registry.getDevices?.().find?.((d) => d.key === entry.key);
    if (dev) { dev.sensors = entry.model.sensors; dev.homekit = entry.model.homekit; }
  }

  async _onMessage(data) {
    const entry = this._devices.get(data.device?.ieeeAddr);
    if (!entry) return;
    const { definition } = entry;
    const options = this._options(data.device);
    const payload = {};
    const publish = (p) => this._apply(entry, p);
    const meta = { state: entry.state, device: data.device, deviceExposesChanged: () => this._rebuild(entry) };
    // converters indexed by cluster at setup — reports are the hot path
    for (const c of entry.fz.get(data.cluster) || []) {
      if (Array.isArray(c.type) ? !c.type.includes(data.type) : c.type !== data.type) continue;
      try {
        const r = await c.convert(definition, data, publish, options, meta);
        if (r) Object.assign(payload, r);
      } catch (err) {
        console.warn(`[Zigbee] ${this._label(entry)}: ${err.message}`);
      }
    }
    try { this._zhc.postProcessConvertedFromZigbeeMessage?.(definition, payload, options, data.device); } catch { /* best effort */ }
    if (typeof data.linkquality === 'number') payload.linkquality = data.linkquality;
    this._apply(entry, payload);
  }

  _apply(entry, payload) {
    if (!payload || !Object.keys(payload).length) return;
    Object.assign(entry.state, payload);
    for (const [p, v] of entry.model.read(payload)) this._store.update(`${entry.key}/${p}`, v);
  }

  // LSH command → converter payload → toZigbee converters (as Zigbee2MQTT's publish does)
  async _write(ieee, capId, command, args) {
    const entry = this._devices.get(ieee);
    if (!entry || !this._controller) throw new Error('Zigbee device not available');
    const { definition, device } = entry;
    const message = entry.model.write(capId, command, args);
    const epMap = typeof definition.endpoint === 'function' ? (definition.endpoint(device) || {}) : {};
    const defaultEp = () => (epMap.default != null ? device.getEndpoint(epMap.default) : null) || device.endpoints[0];
    const used = new Set();
    const state = {};
    for (const [rawKey, value] of Object.entries(message)) {
      // state_l2 → key state on endpoint "l2"
      let key = rawKey;
      let epName;
      const m = /^(.*)_([^_]+)$/.exec(rawKey);
      if (m && epMap[m[2]] != null) { key = m[1]; epName = m[2]; }
      const conv = (definition.toZigbee || []).find((c) => c.key?.includes(key) && (!c.endpoints || c.endpoints.includes(epName)));
      if (!conv?.convertSet) throw new Error(`${this._label(entry)} has no converter for ${key}`);
      if (used.has(conv) && !epName) continue; // one converter handles brightness + state together
      used.add(conv);
      const endpoint = epName ? device.getEndpoint(epMap[epName]) : defaultEp();
      const meta = {
        message, mapped: definition, options: this._options(device), state: entry.state, endpoint_name: epName,
        device, publish: (p) => this._apply(entry, p), deviceExposesChanged: () => this._rebuild(entry),
      };
      const r = await conv.convertSet(endpoint, key, value, meta);
      for (const [k, v] of Object.entries(r?.state || {})) state[epName && !k.endsWith(`_${epName}`) ? `${k}_${epName}` : k] = v;
    }
    this._apply(entry, state); // optimistic — the device's own report follows
    return state;
  }
}

// fromZigbee converters by cluster
function indexConverters(list = []) {
  const byCluster = new Map();
  for (const c of list) {
    if (!byCluster.has(c.cluster)) byCluster.set(c.cluster, []);
    byCluster.get(c.cluster).push(c);
  }
  return byCluster;
}

module.exports = ZigbeeClient;
module.exports.loadNetwork = loadNetwork;
