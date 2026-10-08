'use strict';

const platformStatus = require('./platform-status');
const { parseAdvertisement, sensorsFor, normalizeMac, KINDS, VICTRON_MANUFACTURER_ID, RECORDS } = require('./lsh-ble');
// Product id (hex, 4 digits) → model name; from the public-domain
// keshavdv/victron-ble MODEL_ID_MAPPING.
const MODELS = require('./lsh-ble-models.json');
const modelName = (pid) => MODELS[pid.toString(16).padStart(4, '0')] || null;

// Victron devices over Bluetooth, read directly by the LSH host — meant for
// the Arduino UNO Q (its Linux side has Bluetooth on board). Listens to BlueZ
// over D-Bus (dbus-next, pure JS — nothing to compile on the board) for the
// "Instant Readout" advertisements each configured device broadcasts, and
// decodes them with lsh-ble.js (ported from esphome-victron_ble).
//
// Each device becomes an LSH device (lshble/<id>/...), registered on its
// first decoded advertisement — the record type says what it is, so config
// only needs name + MAC + bindkey. Readings also fill the Victron system keys
// the energy dashboard reads (system/0/Dc/Battery/Soc, Dc/Pv/Power, …) unless
// a GX source (MQTT/VRM) is already writing them.
//
// Requirements on the host: bluetoothd running, and the LSH user allowed to
// talk to org.bluez on the system bus (on Debian: member of the `bluetooth`
// group). Decoding is covered by test/lsh-ble.test.js against real
// captured advertisements; the D-Bus side needs real hardware to verify.

const STALE_MS = 5 * 60 * 1000;          // no advert from any device this long → disconnected, restart discovery
const WATCHDOG_MS = 60 * 1000;
const FEED_MIN_INTERVAL_MS = 1000;
const FOREIGN_SOURCE_MS = 120000;

const BATTERY_SOURCES = ['battery_monitor', 'lynx_bms', 've_bus', 'smart_lithium'];
const PV_SOURCES = ['solar_charger', 'inverter_rs', 'multi_rs'];
const AC_SOURCES = ['ve_bus', 'multi_rs', 'inverter_rs'];

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'device';

class LshBleClient {
  constructor(config, store, sensorRegistry) {
    this._cfg = config.lshBle || {};
    this._store = store;
    this._registry = sensorRegistry;
    this._adapterPath = `/org/bluez/${this._cfg.adapter || 'hci0'}`;
    this._byMac = new Map(); // MAC → device state
    const seen = new Set();
    for (const d of this._cfg.devices || []) {
      const mac = normalizeMac(d.mac);
      if (!mac || !d.bindkey) continue;
      let id = slug(d.name || mac);
      while (seen.has(id)) id += '_2';
      seen.add(id);
      this._byMac.set(mac, {
        id, mac, name: String(d.name || mac).trim(), bindkey: String(d.bindkey).trim().toLowerCase(),
        kind: null, values: {}, sensorPaths: new Set(), lastCounter: null, lastAt: 0, warned: null,
      });
    }
    this._watched = new Set();    // D-Bus device paths with a PropertiesChanged listener
    this._ourWrites = new Map();
    this._stopped = false;
  }

  async start() {
    if (!this._byMac.size) return;
    if (process.platform !== 'linux') {
      console.warn('[LSH BLE] Needs Linux + BlueZ (e.g. the Arduino UNO Q) — not starting on this host');
      return;
    }
    platformStatus.set('lsh-ble', false);
    let dbus;
    try { dbus = require('dbus-next'); } catch { console.error('[LSH BLE] dbus-next not installed — run: npm install dbus-next'); return; }
    this._dbus = dbus;
    this._watchdog = setInterval(() => this._checkStale(), WATCHDOG_MS);
    this._watchdog.unref?.();
    await this._connectBus().catch((err) => console.error(`[LSH BLE] ${err.message}`));
  }

  stop() {
    this._stopped = true;
    clearInterval(this._watchdog);
    try { this._adapter?.StopDiscovery().catch(() => {}); } catch {}
    try { this._bus?.disconnect(); } catch {}
    platformStatus.set('lsh-ble', false);
  }

  getStatus() {
    return {
      adapter: this._adapterPath,
      devices: [...this._byMac.values()].map((d) => ({
        name: d.name, mac: d.mac, kind: d.kind, model: d.model || null, lastSeen: d.lastAt || null, error: d.warned,
      })),
    };
  }

  // ── BlueZ ─────────────────────────────────────────────────────────────────

  async _connectBus() {
    const { Variant } = this._dbus;
    this._bus = this._dbus.systemBus();
    this._bus.on('error', (err) => console.error(`[LSH BLE] D-Bus: ${err.message}`));

    const root = await this._bus.getProxyObject('org.bluez', '/');
    const om = root.getInterface('org.freedesktop.DBus.ObjectManager');
    om.on('InterfacesAdded', (path, ifaces) => this._onObject(path, ifaces['org.bluez.Device1']));
    om.on('InterfacesRemoved', (path) => this._watched.delete(path));

    const adapterObj = await this._bus.getProxyObject('org.bluez', this._adapterPath);
    this._adapter = adapterObj.getInterface('org.bluez.Adapter1');
    const adapterProps = adapterObj.getInterface('org.freedesktop.DBus.Properties');
    const powered = (await adapterProps.Get('org.bluez.Adapter1', 'Powered')).value;
    if (!powered) await adapterProps.Set('org.bluez.Adapter1', 'Powered', new Variant('b', true));
    // Victron devices only advertise. DuplicateData: report every
    // advertisement, not just the first per device — each carries new readings.
    await this._adapter.SetDiscoveryFilter({ Transport: new Variant('s', 'le'), DuplicateData: new Variant('b', true) });
    await this._startDiscovery();
    // Restart discovery if something (another app, bluetoothd restart) stops it.
    adapterProps.on('PropertiesChanged', (iface, changed) => {
      if (iface === 'org.bluez.Adapter1' && changed.Discovering && changed.Discovering.value === false && !this._stopped) {
        setTimeout(() => this._startDiscovery().catch(() => {}), 2000);
      }
    });

    const objects = await om.GetManagedObjects();
    for (const [path, ifaces] of Object.entries(objects)) this._onObject(path, ifaces['org.bluez.Device1']);
    console.log(`[LSH BLE] Scanning on ${this._adapterPath} for ${this._byMac.size} device(s)`);
  }

  async _startDiscovery() {
    try {
      await this._adapter.StartDiscovery();
    } catch (err) {
      if (!/InProgress/i.test(err.type || err.message || '')) throw err;
    }
  }

  async _onObject(path, device1) {
    if (!device1 || !path.startsWith(this._adapterPath + '/')) return;
    const mac = normalizeMac(device1.Address?.value);
    if (!this._byMac.has(mac)) return;
    this._handleManufacturerData(mac, device1.ManufacturerData?.value);
    if (this._watched.has(path)) return;
    this._watched.add(path);
    try {
      const obj = await this._bus.getProxyObject('org.bluez', path);
      obj.getInterface('org.freedesktop.DBus.Properties').on('PropertiesChanged', (iface, changed) => {
        if (iface === 'org.bluez.Device1' && changed.ManufacturerData) this._handleManufacturerData(mac, changed.ManufacturerData.value);
      });
    } catch (err) {
      this._watched.delete(path);
      console.error(`[LSH BLE] Watching ${mac} failed: ${err.message}`);
    }
  }

  async _checkStale() {
    const last = Math.max(0, ...[...this._byMac.values()].map((d) => d.lastAt));
    if (last && Date.now() - last < STALE_MS) return;
    platformStatus.set('lsh-ble', false);
    if (this._adapter && !this._stopped) await this._startDiscovery().catch(() => {});
  }

  // ── Advertisements ────────────────────────────────────────────────────────

  // `manufacturerData` = BlueZ's ManufacturerData dict {companyId: Variant(ay)}.
  _handleManufacturerData(mac, manufacturerData) {
    if (!manufacturerData) return;
    const entry = manufacturerData[VICTRON_MANUFACTURER_ID] ?? manufacturerData[String(VICTRON_MANUFACTURER_ID)];
    const bytes = entry?.value ?? entry;
    if (!bytes) return;
    this.handleAdvertisement(mac, Buffer.from(bytes));
  }

  // Public for tests/simulation: one raw advertisement (data after the
  // company id) from a device MAC.
  handleAdvertisement(mac, data) {
    const dev = this._byMac.get(normalizeMac(mac));
    if (!dev) return false;
    if (data.length >= 7 && dev.lastCounter === data.readUInt16LE(5)) return false; // same reading re-reported
    const r = parseAdvertisement(data, dev.bindkey);
    if (r.error) {
      if (dev.warned !== r.error) console.warn(`[LSH BLE] ${dev.name} (${dev.mac}): ${r.error}`);
      dev.warned = r.error;
      return false;
    }
    dev.warned = null;
    dev.lastCounter = r.counter;
    dev.lastAt = Date.now();
    platformStatus.set('lsh-ble', true);

    const newPaths = Object.keys(r.values).map((t) => (t === 'ALARM_ACTIVE' ? 'alarm_active' : t.toLowerCase()))
      .filter((p) => !dev.sensorPaths.has(p));
    if (dev.kind !== r.kind || newPaths.length) {
      if (!dev.kind) console.log(`[LSH BLE] ${dev.name}: ${modelName(r.productId) || KINDS[r.kind]?.label || r.kind} (product 0x${r.productId.toString(16)})`);
      dev.model = modelName(r.productId);
      dev.kind = r.kind;
      const key = `lshble/${dev.id}`;
      const sensors = sensorsFor(r.values).filter((s) => !dev.sensorPaths.has(s.path));
      sensors.forEach((s) => dev.sensorPaths.add(s.path));
      // registerDevice() ignores a key it already has — sensors that only
      // show up later (e.g. the shunt's aux input mode was changed) are
      // appended to the registered device instead.
      const existing = this._registry.devices?.get(key);
      if (existing) existing.sensors.push(...sensors);
      else {
        this._registry.registerDevice({
          key, label: dev.name, type: 'lshble', icon: KINDS[r.kind]?.icon || '🔋', homekit: [], sensors,
        });
      }
    }
    for (const [type, value] of Object.entries(r.values)) {
      if (value == null) continue;
      const path = type === 'ALARM_ACTIVE' ? 'alarm_active' : type.toLowerCase();
      this._store.update(`lshble/${dev.id}/${path}`, value);
    }
    dev.values = r.values;
    this._feedDashboard();
    return true;
  }

  // ── Victron system keys for the energy dashboard ─────────────────────────

  _devs(kinds) {
    return [...this._byMac.values()].filter((d) => kinds.includes(d.kind));
  }

  _first(kinds, type) {
    for (const kind of kinds) for (const d of this._devs([kind])) if (d.values[type] != null) return d.values[type];
    return null;
  }

  _sum(kinds, type) {
    let total = null;
    for (const d of this._devs(kinds)) if (d.values[type] != null) total = (total ?? 0) + d.values[type];
    return total;
  }

  _feedDashboard() {
    if (this._cfg.feedDashboard === false) return;
    const battKind = BATTERY_SOURCES.find((k) => this._devs([k]).some((d) => d.values.STATE_OF_CHARGE != null))
      || BATTERY_SOURCES.find((k) => this._devs([k]).length);
    const b = battKind ? [battKind] : [];
    const ttg = this._first(b, 'TIME_TO_GO');
    this._feed('system/0/Dc/Battery/Soc', this._first(b, 'STATE_OF_CHARGE'));
    this._feed('system/0/Dc/Battery/Voltage', this._first(b, 'BATTERY_VOLTAGE'));
    this._feed('system/0/Dc/Battery/Current', this._first(b, 'BATTERY_CURRENT'));
    this._feed('system/0/Dc/Battery/Power', this._first(b, 'BATTERY_POWER'));
    this._feed('system/0/Dc/Battery/TimeToGo', ttg != null ? ttg * 60 : null); // Victron: seconds
    this._feed('battery/0/Temperature', this._first(b, 'TEMPERATURE'));
    this._feed('system/0/Dc/Pv/Power', this._sum(PV_SOURCES, 'PV_POWER'));
    this._feed('system/0/PvChargerAggregated/Yield/User', this._sum(PV_SOURCES, 'YIELD_TODAY'));
    this._feed('system/0/Ac/Consumption/L1/Power', this._sum(AC_SOURCES, 'AC_OUT_POWER'));
    this._feed('system/0/Ac/Grid/L1/Power', this._sum(AC_SOURCES, 'ACTIVE_AC_IN_POWER'));
  }

  _feed(key, value) {
    if (value == null || !Number.isFinite(value)) return;
    const now = Date.now();
    const ours = this._ourWrites.get(key);
    // A GX source (MQTT/VRM) wrote this key after us, recently → it wins.
    const ts = this._store.getTimestamp(key);
    if (ts && ts > (ours?.t ?? 0) + 500 && now - ts < FOREIGN_SOURCE_MS) return;
    if (ours && now - ours.t < FEED_MIN_INTERVAL_MS) return;
    this._store.update(key, Math.round(value * 1000) / 1000);
    this._ourWrites.set(key, { t: this._store.getTimestamp(key) ?? now });
  }
}

// ── One-off scan (Settings → LSH BLE → Scan) ──────────────────────
// Runs BlueZ discovery for `seconds` and lists the LE devices seen, Victron
// ones identified from the unencrypted part of their advertisement (record
// type + product id — no key needed). Independent of a running client: BlueZ
// discovery sessions are per D-Bus connection, so this doesn't disturb it.
async function scan({ adapter = 'hci0', seconds = 10 } = {}) {
  if (process.platform !== 'linux') throw new Error('Bluetooth scanning needs Linux + BlueZ (e.g. the Arduino UNO Q)');
  const dbus = require('dbus-next');
  const { Variant } = dbus;
  const bus = dbus.systemBus();
  const adapterPath = `/org/bluez/${adapter}`;
  try {
    const adapterObj = await bus.getProxyObject('org.bluez', adapterPath);
    const ad = adapterObj.getInterface('org.bluez.Adapter1');
    const props = adapterObj.getInterface('org.freedesktop.DBus.Properties');
    if (!(await props.Get('org.bluez.Adapter1', 'Powered')).value) await props.Set('org.bluez.Adapter1', 'Powered', new Variant('b', true));
    await ad.SetDiscoveryFilter({ Transport: new Variant('s', 'le') });
    try { await ad.StartDiscovery(); } catch (err) { if (!/InProgress/i.test(err.type || err.message || '')) throw err; }
    await new Promise((r) => setTimeout(r, Math.min(Math.max(Number(seconds) || 10, 3), 30) * 1000));
    const om = (await bus.getProxyObject('org.bluez', '/')).getInterface('org.freedesktop.DBus.ObjectManager');
    const objects = await om.GetManagedObjects();
    await ad.StopDiscovery().catch(() => {});
    const out = [];
    for (const [path, ifaces] of Object.entries(objects)) {
      const d = ifaces['org.bluez.Device1'];
      if (!d || !path.startsWith(adapterPath + '/')) continue;
      if (d.RSSI === undefined) continue; // cached from an earlier session, not seen now
      const mfr = d.ManufacturerData?.value || {};
      const vic = mfr[VICTRON_MANUFACTURER_ID] ?? mfr[String(VICTRON_MANUFACTURER_ID)];
      const bytes = vic ? Buffer.from(vic.value ?? vic) : null;
      let victron = null;
      if (bytes && bytes.length >= 8 && bytes[0] === 0x10) {
        const pid = bytes.readUInt16LE(2);
        const kind = RECORDS[bytes[4]]?.[0] || null;
        victron = { productId: `0x${pid.toString(16).padStart(4, '0')}`, model: modelName(pid), kind, kindLabel: KINDS[kind]?.label || null, keyStartsWith: bytes[7].toString(16).padStart(2, '0') };
      } else if (bytes) {
        victron = { productId: null, model: null, kind: null, kindLabel: null, note: 'Victron device without Instant Readout enabled' };
      }
      out.push({
        mac: normalizeMac(d.Address?.value),
        // BlueZ's Alias falls back to the MAC ("AA-BB-…") when a device has
        // no name — that's not a name.
        name: d.Name?.value || (d.Alias?.value && !/^([0-9A-F]{2}-){5}[0-9A-F]{2}$/i.test(d.Alias.value) ? d.Alias.value : null),
        rssi: d.RSSI.value,
        manufacturers: Object.keys(mfr).map((k) => `0x${Number(k).toString(16).padStart(4, '0')}`),
        victron,
      });
    }
    return out.sort((a, b) => (!!b.victron - !!a.victron) || b.rssi - a.rssi);
  } finally {
    bus.disconnect();
  }
}

module.exports = LshBleClient;
module.exports.scan = scan;
// Deep dive on one device (Settings → Bluetooth scan → click a device)
module.exports.inspect = require('./lsh-ble-inspect').inspect;
