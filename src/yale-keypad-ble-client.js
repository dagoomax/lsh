'use strict';

const platformStatus = require('./platform-status');

// Yale Access / August keypad (ASSA ABLOY AK-R4 and kin) over LOCAL Bluetooth,
// read directly by the LSH host via BlueZ/D-Bus (dbus-next — nothing to
// compile). This is KEYPAD-ONLY and does NOT touch the lock.
//
// What it can and cannot do, and why — the keypad advertises a plain Device
// Information service (readable) plus two vendor services whose characteristics
// are the encrypted August session channel:
//   52e4c6be-0f96-425c-89X0-ddcef680f636  (…8910 write, …8920 notify/indicate)
//   a86abc2d-… / 1bd19c14-… / 279f9dab-…   (write/notify)
// Reading key presses / battery requires establishing an encrypted August
// session with the device's OFFLINE KEY (minted by the Yale/August cloud) and
// the keypad session protocol — yalexs-ble implements that for LOCKS, not
// keypads. So without the cloud key this module exposes only what BlueZ gives
// us for free, with no pairing and no session:
//   - online        presence: an advertisement/RSSI seen within presenceTtl
//   - rssi          signal strength, dBm
//   - model/serial/firmware/manufacturer  static Device Information, either
//                   from config or, if readDeviceInfo:true, read once over a
//                   brief GATT connect (opt-in — a connect holds a BLE link to
//                   a lock-paired device, so it is off by default)
//
// config.json:
//   "yaleKeypadBle": {
//     "adapter": "hci0",
//     "readDeviceInfo": false,
//     "devices": [
//       { "name": "Keypad Wejście", "mac": "98:1B:B5:66:07:9F",
//         "model": "AK-R4", "serial": "K4IKC000CA", "firmware": "1.2.3" }
//     ]
//   }
//
// Requirements on the host: bluetoothd running and the LSH user allowed to talk
// to org.bluez on the system bus (Debian: the `bluetooth` group). The D-Bus
// side needs real hardware to verify; the connect/read-device-info path in
// particular is UNTESTED against a real keypad.

const WATCHDOG_MS = 30 * 1000;
const DEFAULT_PRESENCE_TTL_MS = 3 * 60 * 1000; // no sighting this long → offline
const INFO_CONNECT_TIMEOUT_MS = 20 * 1000;

// Device Information characteristic UUIDs (128-bit form of the 16-bit shorts).
const DIS = {
  manufacturer: '00002a29-0000-1000-8000-00805f9b34fb',
  model:        '00002a24-0000-1000-8000-00805f9b34fb',
  serial:       '00002a25-0000-1000-8000-00805f9b34fb',
  hardware:     '00002a27-0000-1000-8000-00805f9b34fb',
  firmware:     '00002a26-0000-1000-8000-00805f9b34fb',
};

const normalizeMac = (s) => {
  const hex = String(s || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  return hex.length === 12 ? hex.match(/.{2}/g).join(':') : '';
};
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'keypad';

class YaleKeypadBleClient {
  constructor(config, store, sensorRegistry) {
    this._cfg = config.yaleKeypadBle || {};
    this._store = store;
    this._registry = sensorRegistry;
    this._adapterPath = `/org/bluez/${this._cfg.adapter || 'hci0'}`;
    this._presenceTtl = Number(this._cfg.presenceTtl) > 0 ? Number(this._cfg.presenceTtl) * 1000 : DEFAULT_PRESENCE_TTL_MS;
    this._byMac = new Map();
    const seen = new Set();
    for (const d of this._cfg.devices || []) {
      const mac = normalizeMac(d.mac);
      if (!mac) continue;
      let id = slug(d.name || mac);
      while (seen.has(id)) id += '_2';
      seen.add(id);
      this._byMac.set(mac, {
        id, mac, name: String(d.name || mac).trim(),
        info: { manufacturer: d.manufacturer || '', model: d.model || '', serial: d.serial || '', hardware: d.hardware || '', firmware: d.firmware || '' },
        registered: false, lastAt: 0, online: null, infoRead: false,
      });
    }
    this._watched = new Set();
    this._stopped = false;
  }

  async start() {
    if (!this._byMac.size) return;
    if (process.platform !== 'linux') {
      console.warn('[Yale Keypad BLE] Needs Linux + BlueZ — not starting on this host');
      return;
    }
    platformStatus.set('yale-keypad-ble', false);
    try { this._dbus = require('dbus-next'); }
    catch { console.error('[Yale Keypad BLE] dbus-next not installed — run: npm install dbus-next'); return; }
    // Register devices up front so they show even before the first sighting.
    for (const dev of this._byMac.values()) this._register(dev);
    this._watchdog = setInterval(() => this._checkStale(), WATCHDOG_MS);
    this._watchdog.unref?.();
    await this._connectBus().catch((err) => console.error(`[Yale Keypad BLE] ${err.message}`));
  }

  stop() {
    this._stopped = true;
    clearInterval(this._watchdog);
    try { this._adapter?.StopDiscovery().catch(() => {}); } catch {}
    try { this._bus?.disconnect(); } catch {}
    platformStatus.set('yale-keypad-ble', false);
  }

  getStatus() {
    return {
      adapter: this._adapterPath,
      devices: [...this._byMac.values()].map((d) => ({
        name: d.name, mac: d.mac, online: d.online === 1, rssi: d.rssi ?? null, lastSeen: d.lastAt || null, ...d.info,
      })),
    };
  }

  // ── BlueZ ─────────────────────────────────────────────────────────────────

  async _connectBus() {
    const { Variant } = this._dbus;
    this._bus = this._dbus.systemBus();
    this._bus.on('error', (err) => console.error(`[Yale Keypad BLE] D-Bus: ${err.message}`));

    const root = await this._bus.getProxyObject('org.bluez', '/');
    const om = root.getInterface('org.freedesktop.DBus.ObjectManager');
    om.on('InterfacesAdded', (path, ifaces) => this._onObject(path, ifaces['org.bluez.Device1']));
    om.on('InterfacesRemoved', (path) => this._watched.delete(path));

    const adapterObj = await this._bus.getProxyObject('org.bluez', this._adapterPath);
    this._adapter = adapterObj.getInterface('org.bluez.Adapter1');
    const adapterProps = adapterObj.getInterface('org.freedesktop.DBus.Properties');
    const powered = (await adapterProps.Get('org.bluez.Adapter1', 'Powered')).value;
    if (!powered) await adapterProps.Set('org.bluez.Adapter1', 'Powered', new Variant('b', true));
    await this._adapter.SetDiscoveryFilter({ Transport: new Variant('s', 'le'), DuplicateData: new Variant('b', true) });
    await this._startDiscovery();
    adapterProps.on('PropertiesChanged', (iface, changed) => {
      if (iface === 'org.bluez.Adapter1' && changed.Discovering && changed.Discovering.value === false && !this._stopped) {
        setTimeout(() => this._startDiscovery().catch(() => {}), 2000);
      }
    });

    const objects = await om.GetManagedObjects();
    this._objects = objects;
    for (const [path, ifaces] of Object.entries(objects)) this._onObject(path, ifaces['org.bluez.Device1']);
    console.log(`[Yale Keypad BLE] Scanning on ${this._adapterPath} for ${this._byMac.size} keypad(s)`);
  }

  async _startDiscovery() {
    try { await this._adapter.StartDiscovery(); }
    catch (err) { if (!/InProgress/i.test(err.type || err.message || '')) throw err; }
  }

  async _onObject(path, device1) {
    if (!device1 || !path.startsWith(this._adapterPath + '/')) return;
    const mac = normalizeMac(device1.Address?.value);
    const dev = this._byMac.get(mac);
    if (!dev) return;
    dev._path = path;
    this._sighting(dev, device1.RSSI?.value);
    if (this._watched.has(path)) return;
    this._watched.add(path);
    try {
      const obj = await this._bus.getProxyObject('org.bluez', path);
      obj.getInterface('org.freedesktop.DBus.Properties').on('PropertiesChanged', (iface, changed) => {
        if (iface !== 'org.bluez.Device1') return;
        if (changed.RSSI) this._sighting(dev, changed.RSSI.value);
      });
    } catch (err) {
      this._watched.delete(path);
      console.error(`[Yale Keypad BLE] Watching ${mac} failed: ${err.message}`);
    }
  }

  _sighting(dev, rssi) {
    dev.lastAt = Date.now();
    if (typeof rssi === 'number') {
      dev.rssi = rssi;
      this._store.update(`yale-keypad-ble/${dev.id}/rssi`, rssi);
    }
    if (dev.online !== 1) {
      dev.online = 1;
      this._store.update(`yale-keypad-ble/${dev.id}/online`, 1);
      console.log(`[Yale Keypad BLE] ${dev.name} present (${dev.rssi ?? '?'} dBm)`);
    }
    platformStatus.set('yale-keypad-ble', true);
    if (this._cfg.readDeviceInfo && !dev.infoRead && dev._path) {
      dev.infoRead = true; // single-shot regardless of outcome
      this._readDeviceInfo(dev).catch((err) => console.error(`[Yale Keypad BLE] ${dev.name} device-info read failed: ${err.message}`));
    }
  }

  _checkStale() {
    const now = Date.now();
    let anyOnline = false;
    for (const dev of this._byMac.values()) {
      if (dev.lastAt && now - dev.lastAt < this._presenceTtl) { anyOnline = true; continue; }
      if (dev.online !== 0) {
        dev.online = 0;
        this._store.update(`yale-keypad-ble/${dev.id}/online`, 0);
        console.log(`[Yale Keypad BLE] ${dev.name} offline (no advert for ${Math.round(this._presenceTtl / 1000)}s)`);
      }
    }
    platformStatus.set('yale-keypad-ble', anyOnline);
    if (!anyOnline && this._adapter && !this._stopped) this._startDiscovery().catch(() => {});
  }

  _register(dev) {
    if (dev.registered) return;
    dev.registered = true;
    const key = `yale-keypad-ble/${dev.id}`;
    this._registry.registerDevice({
      key, type: 'yale-keypad-ble', label: dev.name, icon: '🔢', color: 'gray', category: 'security',
      model: dev.info.model || 'Yale/August keypad',
      homekit: [],
      sensors: [
        { path: 'online',       name: 'Present',      format: 'on-off' },
        { path: 'rssi',         name: 'Signal',       format: 'number', unit: 'dBm', sensorType: 'signal' },
        { path: 'model',        name: 'Model',        format: 'string', hidden: true },
        { path: 'serial',       name: 'Serial',       format: 'string', hidden: true },
        { path: 'firmware',     name: 'Firmware',     format: 'string', hidden: true },
        { path: 'manufacturer', name: 'Manufacturer', format: 'string', hidden: true },
      ],
    });
    // Seed any static info known from config.
    for (const k of ['model', 'serial', 'firmware', 'manufacturer']) {
      if (dev.info[k]) this._store.update(`${key}/${k}`, dev.info[k]);
    }
    this._store.update(`${key}/online`, 0);
  }

  // Opt-in, single-shot: connect, read Device Information, disconnect. Holds a
  // BLE link briefly — off by default so we don't disturb a lock-paired keypad.
  async _readDeviceInfo(dev) {
    const obj = await this._bus.getProxyObject('org.bluez', dev._path);
    const device = obj.getInterface('org.bluez.Device1');
    const props = obj.getInterface('org.freedesktop.DBus.Properties');
    const resolved = new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('timeout waiting for ServicesResolved')), INFO_CONNECT_TIMEOUT_MS);
      props.on('PropertiesChanged', (iface, changed) => {
        if (iface === 'org.bluez.Device1' && changed.ServicesResolved?.value === true) { clearTimeout(to); res(); }
      });
    });
    try {
      if (!(await props.Get('org.bluez.Device1', 'Connected')).value) await device.Connect();
      if (!(await props.Get('org.bluez.Device1', 'ServicesResolved')).value) await resolved;
      const root = await this._bus.getProxyObject('org.bluez', '/');
      const om = root.getInterface('org.freedesktop.DBus.ObjectManager');
      const objects = await om.GetManagedObjects();
      const wanted = new Map(Object.entries(DIS).map(([k, uuid]) => [uuid, k]));
      const key = `yale-keypad-ble/${dev.id}`;
      for (const [path, ifaces] of Object.entries(objects)) {
        const ch = ifaces['org.bluez.GattCharacteristic1'];
        if (!ch || !path.startsWith(dev._path + '/')) continue;
        const field = wanted.get(String(ch.UUID?.value || '').toLowerCase());
        if (!field) continue;
        try {
          const chObj = await this._bus.getProxyObject('org.bluez', path);
          const bytes = await chObj.getInterface('org.bluez.GattCharacteristic1').ReadValue({});
          const text = Buffer.from(bytes).toString('utf8').replace(/\0+$/, '').trim();
          if (text) { dev.info[field] = text; this._store.update(`${key}/${field}`, text); }
        } catch { /* skip an unreadable characteristic */ }
      }
      console.log(`[Yale Keypad BLE] ${dev.name}: ${dev.info.model || '?'} sn ${dev.info.serial || '?'} fw ${dev.info.firmware || '?'}`);
    } finally {
      try { await device.Disconnect(); } catch { /* already gone */ }
    }
  }
}

module.exports = YaleKeypadBleClient;
module.exports.normalizeMac = normalizeMac;
