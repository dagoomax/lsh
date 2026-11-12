'use strict';

// Zigbee coordinator on a USB stick — LSH's own Zigbee network, no
// Zigbee2MQTT or MQTT broker needed. zigbee-herdsman drives the stick and
// zigbee-herdsman-converters supplies the device definitions (the same
// ~5000-device library Zigbee2MQTT uses); src/zigbee-map.js turns each
// definition's features into LSH sensors.
//
//   "zigbee": { "port": "/dev/serial/by-id/usb-Silicon_Labs_CP2105_…-if00-port0",
//               "adapter": "ember", "baudRate": 115200, "rtscts": false, "channel": 15,
//               "names": { "0x00158d0001a2b3c4": "Czujnik salon" },
//               "sensorLabels": { "0xa4c138f08193ec19": { "switch": "Kinkiety", "switch_l2": "LedySufit" } } }
//
// lights: [ieee, …] — relay / plug channels that drive lamps show in HomeKit
// as lights (Lightbulb) instead of switches; each channel of a multi-gang
// relay becomes its own light.
//
// sensorLabels names single channels (keyed by sensor path) — a 2-gang relay
// otherwise shows "Switch l1" / "Switch 2", which says nothing about what's wired to it.
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
// Mesh map: the meshScan command on zigbee/coordinator asks the coordinator
// and each router for its neighbor table (ZDO Mgmt_Lqi_req, one at a time)
// and stores { at, nodes, links, failed } on zigbee/coordinator/mesh. Battery
// devices sleep and don't answer; they show up through their parent's table.
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
const MESH_TIMEOUT_MS = 15_000; // per device
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
        { path: 'mesh', name: 'Mesh map', type: 'object', hidden: true },
        { path: 'meshScanning', name: 'Mesh scan running', format: 'on-off', hidden: true },
        { path: 'meshScan', name: 'Scan mesh', type: 'text', controllable: true, hidden: true, capabilityId: 'meshScan', writeCmd: 'scan' },
        // Settings → remove a device: the IEEE address as the value
        { path: 'remove', name: 'Remove device', type: 'text', controllable: true, hidden: true, capabilityId: 'remove', writeCmd: 'remove' },
      ],
      _writeCapability: (capId, command, args = []) => this._coordinatorCommand(capId, command, args),
    });
  }

  async _coordinatorCommand(capId, command, args) {
    const c = this._controller;
    if (!c) throw new Error('The Zigbee coordinator is not running');
    if (capId === 'meshScan') {
      if (this._meshRun) return { scanning: true };
      this._meshRun = this._scanMesh()
        .catch((err) => console.error(`[Zigbee] Mesh scan: ${err.message}`))
        .finally(() => { this._meshRun = null; this._store.update(`${COORD}/meshScanning`, 0); });
      return { scanning: true };
    }
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

  // Neighbor tables of the coordinator and every router → nodes + links
  async _scanMesh() {
    const c = this._controller;
    if (!c) throw new Error('The Zigbee coordinator is not running');
    this._store.update(`${COORD}/meshScanning`, 1);
    const coord = c.getDevicesByType('Coordinator')[0];
    const nodes = new Map();
    const node = (d, extra = {}) => {
      const e = this._devices.get(d.ieeeAddr);
      nodes.set(d.ieeeAddr, {
        ieee: d.ieeeAddr, nwk: d.networkAddress, type: d.type,
        key: d.type === 'Coordinator' ? COORD : e?.key || null,
        label: d.type === 'Coordinator' ? 'Coordinator' : e ? this._label(e) : (d.modelID || d.ieeeAddr),
        lastSeen: d.lastSeen || null, ...extra,
      });
    };
    if (coord) node(coord);
    for (const e of this._devices.values()) node(e.device);
    const links = [];
    const failed = [];
    const ask = [coord, ...[...this._devices.values()].map((e) => e.device).filter((d) => d.type === 'Router')].filter(Boolean);
    for (const d of ask) {
      let timer;
      try {
        const table = await Promise.race([d.lqi(),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('no answer')), MESH_TIMEOUT_MS); })]);
        for (const n of table) {
          const ieee = String(n.eui64 || '').toLowerCase();
          if (!ieee || ieee === '0xffffffffffffffff') continue;
          if (!nodes.has(ieee)) {
            nodes.set(ieee, { ieee, nwk: n.nwkAddress, type: ['Coordinator', 'Router', 'EndDevice'][n.deviceType] || 'Unknown', key: null, label: `Unknown ${ieee.slice(-6)}`, unknown: true });
          }
          links.push({ source: d.ieeeAddr, target: ieee, lqi: n.lqi, relationship: n.relationship, depth: n.depth });
        }
      } catch (err) {
        failed.push({ ieee: d.ieeeAddr, error: err.message });
      } finally { clearTimeout(timer); }
    }
    const mesh = { at: Date.now(), nodes: [...nodes.values()], links, failed };
    this._store.update(`${COORD}/mesh`, mesh);
    console.log(`[Zigbee] Mesh scan: ${mesh.nodes.length} nodes, ${links.length} links${failed.length ? `, ${failed.length} didn't answer` : ''}`);
    return mesh;
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
      sensors: this._sensors(entry),
      homekit: this._homekit(entry),
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
    if (dev) { dev.sensors = this._sensors(entry); dev.homekit = this._homekit(entry); }
  }

  _isLight(entry) {
    const l = this.cfg.lights;
    return Array.isArray(l) && l.map((x) => String(x).toLowerCase()).includes(entry.device.ieeeAddr.toLowerCase());
  }

  // the model's sensors with config.zigbee.sensorLabels (and lights) applied
  _sensors(entry) {
    const labels = this.cfg.sensorLabels?.[entry.device.ieeeAddr] || {};
    const light = this._isLight(entry);
    return entry.model.sensors.map((s) => {
      let out = s;
      if (labels[s.path]) out = { ...out, label: String(labels[s.path]) };
      if (light && s.homekit === 'switch-rw') out = { ...out, homekit: 'light-rw' };
      return out;
    });
  }

  _homekit(entry) {
    const hk = entry.model.homekit;
    return this._isLight(entry) ? [...new Set(hk.map((t) => (t === 'switch-rw' ? 'light-rw' : t)))] : hk;
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
