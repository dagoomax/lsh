'use strict';

const fs             = require('fs');
const path           = require('path');
const { HttpClient, IPDiscovery, Characteristic, Service } = require('hap-controller');
const platformStatus = require('./platform-status');

// HomeKit Controller — LSH acts as a HomeKit *controller* (like the Home app)
// and pulls third-party HomeKit accessories in as LSH devices. From there they
// reach Loxone like any other device: /api/loxone/inputs.xml|outputs.xml?type=homekitc
// for virtual inputs/outputs, or loxoneOut mappings for push.
// (homekit-bridge.js is the opposite direction: LSH devices → Apple Home.)
//
// HomeKit over IP (Wi-Fi/Ethernet) only — no BLE, no Thread. An accessory has
// one controller set: to pair it with LSH it must first be removed from the
// Home app (or factory-reset). Pair with `node scripts/homekit-pair.js`, which
// writes persist/homekit-controller.json.
//
// config.homekitController = { enabled: true, pollInterval: 60 }
//
// Every readable characteristic becomes a sensor (store key
// homekitc/<pairing id>-<aid>/<name>); writable ones are controllable.
// Values arrive by HAP event subscription; the poll is a fallback for
// characteristics without events and for missed ones.

const PAIRINGS_FILE = path.join(__dirname, '..', 'persist', 'homekit-controller.json');

// services that describe the accessory rather than do anything
const SKIP_SERVICES = new Set(['3E', 'A2', '55']); // accessory info, protocol info, pairing
const SKIP_CHARS = new Set(['14', '23', 'A5']); // identify, name, service-signature

const NICE_NAMES = {
  25: 'Power', 8: 'Brightness', CE: 'Color Temp', 13: 'Hue', '2F': 'Saturation',
  11: 'Temperature', 35: 'Target Temperature', 10: 'Humidity', 34: 'Target Humidity',
  F: 'Heating/Cooling State', 33: 'Target Heating/Cooling Mode',
  22: 'Motion', '6A': 'Contact', 71: 'Occupancy', '6B': 'Light Level',
  68: 'Battery', 79: 'Low Battery', '8F': 'Charging State',
  '6D': 'Position', '7C': 'Target Position', 72: 'Position State',
  E: 'Door State', 32: 'Target Door State', '1D': 'Lock State', '1E': 'Lock Target',
  B0: 'Active', 29: 'Rotation Speed', 26: 'Outlet In Use',
  76: 'Smoke', 69: 'Carbon Monoxide', 70: 'Leak', 95: 'Air Quality',
  C6: 'PM2.5', C7: 'PM10', C8: 'VOC', 93: 'CO2', 73: 'Button Event',
};
const UNITS = { celsius: '°C', percentage: '%', lux: 'lx', arcdegrees: '°', seconds: 's' };

// short UUID ('25') from either form the accessory may send
const shortType = (t) => {
  const s = String(t || '').toUpperCase();
  const m = /^([0-9A-F]{8})-0000-1000-8000-0026BB765291$/.exec(s);
  return m ? m[1].replace(/^0+/, '') || '0' : s;
};
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'value';
const charName = (c, type) => {
  if (NICE_NAMES[type]) return NICE_NAMES[type];
  if (c.description) return c.description;
  try {
    const n = Characteristic.characteristicFromUuid(type).replace(/^public\.hap\.characteristic\./, '');
    return n.split(/[.-]/).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  } catch { return `Characteristic ${type}`; }
};
const isNumeric = (f) => ['uint8', 'uint16', 'uint32', 'uint64', 'int', 'float'].includes(f);
const toNumber  = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v == null ? null : Number(v));
const miredToK  = (m) => Math.round(1e6 / m);

class HomekitControllerClient {
  constructor(config, store, sensorRegistry) {
    this._cfg       = config.homekitController || {};
    this._store     = store;
    this._registry  = sensorRegistry;
    this._pairings  = {};          // pairing id → { name, address, port, pairingData }
    this._accs      = new Map();   // pairing id → { client, chars: Map('aid.iid' → meta), ok }
    this._discovery = null;
    this._timer     = null;
    this._stopped   = false;
  }

  async start() {
    try { this._pairings = JSON.parse(fs.readFileSync(PAIRINGS_FILE, 'utf8')); }
    catch { this._pairings = {}; }
    const ids = Object.keys(this._pairings);
    platformStatus.set('homekitc', false);
    if (!ids.length) {
      console.warn('[HomeKitC] No paired accessories — run: node scripts/homekit-pair.js');
      return;
    }

    // accessories may change IP/port (DHCP, reboot) — follow them via mDNS
    this._discovery = new IPDiscovery();
    this._discovery.on('serviceUp', (svc) => this._onAdvert(svc));
    this._discovery.on('serviceChanged', (svc) => this._onAdvert(svc));
    this._discovery.start();

    await Promise.all(ids.map((id) => this._connect(id)));
    const ms = Math.max(10, this._cfg.pollInterval || 60) * 1000;
    this._timer = setInterval(() => this._pollAll(), ms);
  }

  stop() {
    this._stopped = true;
    clearInterval(this._timer);
    this._discovery?.stop();
    for (const a of this._accs.values()) a.client?.close().catch(() => {});
    this._accs.clear();
    platformStatus.set('homekitc', false);
  }

  _onAdvert(svc) {
    const p = this._pairings[svc.id];
    if (!p || (p.address === svc.address && p.port === svc.port)) return;
    console.log(`[HomeKitC] ${p.name} moved to ${svc.address}:${svc.port}`);
    p.address = svc.address;
    p.port    = svc.port;
    this._savePairings();
    const a = this._accs.get(svc.id);
    if (!a?.ok) this._connect(svc.id);
  }

  _savePairings() {
    try { fs.writeFileSync(PAIRINGS_FILE, JSON.stringify(this._pairings, null, 2)); }
    catch (err) { console.error(`[HomeKitC] Could not save pairings: ${err.message}`); }
  }

  _updateStatus() {
    platformStatus.set('homekitc', [...this._accs.values()].some((a) => a.ok));
  }

  // ── Connect + describe ───────────────────────────────────────────────────

  async _connect(id) {
    if (this._stopped) return;
    const p = this._pairings[id];
    const old = this._accs.get(id);
    if (old?.client) old.client.close().catch(() => {});
    clearTimeout(old?.retry);

    const client = new HttpClient(id, p.address, p.port, p.pairingData, { usePersistentConnections: true });
    const entry  = { client, chars: new Map(), ok: false, retry: null };
    this._accs.set(id, entry);

    try {
      const { accessories } = await client.getAccessories();
      for (const acc of accessories) this._registerAccessory(id, p, acc, entry);
      entry.ok = true;
      this._updateStatus();

      const evKeys = [...entry.chars].filter(([, m]) => m.perms.includes('ev')).map(([k]) => k);
      client.on('event', (ev) => this._applyValues(id, ev.characteristics));
      client.on('event-disconnect', () => {
        console.warn(`[HomeKitC] ${p.name}: event connection lost — reconnecting`);
        entry.ok = false;
        this._updateStatus();
        this._scheduleRetry(id, 5_000);
      });
      if (evKeys.length) await client.subscribeCharacteristics(evKeys);
      console.log(`[HomeKitC] ${p.name}: ${accessories.length} accessor${accessories.length === 1 ? 'y' : 'ies'}, ${entry.chars.size} characteristic(s), ${evKeys.length} subscribed`);
    } catch (err) {
      console.error(`[HomeKitC] ${p.name} (${p.address}:${p.port}): ${err.message}`);
      entry.ok = false;
      this._updateStatus();
      this._scheduleRetry(id, 30_000);
    }
  }

  _scheduleRetry(id, ms) {
    const entry = this._accs.get(id);
    if (!entry || this._stopped) return;
    clearTimeout(entry.retry);
    entry.retry = setTimeout(() => this._connect(id), ms);
  }

  _registerAccessory(id, pairing, acc, entry) {
    const aid = Number(acc.aid);
    const key = `homekitc/${id.replace(/:/g, '').toLowerCase()}-${aid}`;
    let label = pairing.name;
    const sensors = [];
    const used = new Set();
    let hasLight = false, hasColor = null;

    for (const svc of acc.services) {
      const sType = shortType(svc.type);
      if (sType === '3E') {
        const n = svc.characteristics.find((c) => shortType(c.type) === '23');
        if (n?.value) label = String(n.value);
      }
      if (SKIP_SERVICES.has(sType)) continue;
      if (sType === '43') hasLight = true;

      for (const c of svc.characteristics) {
        const type  = shortType(c.type);
        const perms = c.perms || [];
        if (SKIP_CHARS.has(type) || !(perms.includes('pr') || perms.includes('ev'))) continue;
        if (!isNumeric(c.format) && c.format !== 'bool') continue; // strings, tlv8, data

        const ck = `${aid}.${Number(c.iid)}`;
        // Brightness is `level` — the name sensor-registry.js drives from a
        // Loxone composite colour value, same as the Hue client
        let p = type === '8' ? 'level' : slug(charName(c, type));
        if (used.has(p)) p = `${p}_${Number(c.iid)}`;
        used.add(p);

        const writable = perms.includes('pw');
        const name     = charName(c, type);
        const meta     = { key, path: p, type, format: c.format, perms, min: c.minValue, max: c.maxValue, step: c.minStep };
        entry.chars.set(ck, meta);

        const s = { path: p, name };
        const binary = c.format === 'bool' || (isNumeric(c.format) && c.minValue === 0 && c.maxValue === 1);
        if (type === 'CE') {
          // mireds on the wire, Kelvin in LSH (dashboard colour-temp slider)
          Object.assign(s, { format: 'number', unit: 'K' });
          if (writable) Object.assign(s, {
            controllable: true, type: 'color-temp', capabilityId: ck, writeCmd: 'setColorTemperature',
            min: c.maxValue ? miredToK(c.maxValue) : 2000, max: c.minValue ? miredToK(c.minValue) : 6500, step: 100,
          });
        } else if (binary) {
          Object.assign(s, { format: 'on-off' });
          if (writable) Object.assign(s, { controllable: true, type: 'toggle', capabilityId: ck, writeOn: 'on', writeOff: 'off' });
        } else {
          Object.assign(s, { format: c.unit === 'percentage' ? 'percent' : c.unit === 'celsius' ? 'temperature' : 'number' });
          if (UNITS[c.unit]) s.unit = UNITS[c.unit];
          if (writable) Object.assign(s, {
            controllable: true, type: 'range', capabilityId: ck, writeCmd: 'set',
            min: c.minValue ?? 0, max: c.maxValue ?? 100, step: c.minStep ?? 1,
          });
        }
        if (type === '13' || type === '2F') {
          (hasColor ||= {})[type === '13' ? 'hue' : 'sat'] = ck;
          s.hidden = true;
          delete s.controllable;
          delete s.unit; // hue is rescaled to 0-100
        }
        sensors.push(s);
      }
    }

    // Hue + Saturation → one colour control (the dashboard wheel; Loxone sends RGB)
    if (hasColor?.hue && hasColor?.sat) {
      sensors.push({ path: 'color', name: 'Color', format: 'color',
        controllable: true, type: 'color', capabilityId: 'color' });
    }
    if (!sensors.length) return;

    this._registry.registerDevice({
      key,
      label,
      type:  'homekitc',
      icon:  hasLight ? '💡' : '🏠',
      color: 'blue',
      sensors,
      // no `homekit` tags: never re-expose these through homekit-bridge.js
      _writeCapability: (capId, command, args = []) => this._write(id, capId, command, args, hasColor),
    });

    // initial values from the /accessories dump
    this._applyValues(id, acc.services.flatMap((svc) =>
      svc.characteristics.map((c) => ({ aid, iid: c.iid, value: c.value }))));
  }

  // ── Values in ────────────────────────────────────────────────────────────

  _applyValues(id, list = []) {
    const entry = this._accs.get(id);
    if (!entry) return;
    for (const { aid, iid, value } of list) {
      const meta = entry.chars.get(`${Number(aid)}.${Number(iid)}`);
      if (!meta || value === undefined) continue;
      let v = toNumber(value);
      if (meta.type === 'CE' && v) v = miredToK(v);
      if (meta.type === '13' && v != null) v = Math.round(v / 3.6); // 0-360° → 0-100 like Hue/SmartThings
      this._store.update(`${meta.key}/${meta.path}`, v);
    }
  }

  async _pollAll() {
    for (const [id, entry] of this._accs) {
      if (!entry.ok) continue;
      const keys = [...entry.chars].filter(([, m]) => m.perms.includes('pr')).map(([k]) => k);
      if (!keys.length) continue;
      try {
        const { characteristics } = await entry.client.getCharacteristics(keys);
        this._applyValues(id, characteristics);
      } catch (err) {
        console.error(`[HomeKitC] ${this._pairings[id].name}: poll failed — ${err.message}`);
        entry.ok = false;
        this._updateStatus();
        this._scheduleRetry(id, 5_000);
      }
    }
  }

  // ── Commands out ─────────────────────────────────────────────────────────

  async _write(id, capId, command, args, color) {
    const entry = this._accs.get(id);
    if (!entry) throw new Error('Accessory not connected');
    const out = {};

    if (capId === 'color') {
      const { hue, saturation } = args[0] || {};
      if (hue != null)        out[color.hue] = Math.round(hue * 3.6);
      if (saturation != null) out[color.sat] = Math.round(saturation);
    } else {
      const meta = entry.chars.get(capId);
      if (!meta) throw new Error(`Unknown characteristic ${capId}`);
      let v;
      if (command === 'on' || command === 'off') {
        v = meta.format === 'bool' ? command === 'on' : command === 'on' ? 1 : 0;
      } else {
        v = Number(args[0]);
        if (!Number.isFinite(v)) throw new Error('Invalid value');
        if (meta.type === 'CE') v = Math.round(1e6 / Math.max(1, v)); // Kelvin → mireds
        if (meta.min != null) v = Math.max(meta.min, v);
        if (meta.max != null) v = Math.min(meta.max, v);
        if (meta.format !== 'float') v = Math.round(v);
      }
      out[capId] = v;
    }
    if (!Object.keys(out).length) return;

    await entry.client.setCharacteristics(out);
    // reflect immediately; the event (if any) confirms it
    this._applyValues(id, Object.entries(out).map(([k, value]) => {
      const [aid, iid] = k.split('.');
      return { aid, iid, value };
    }));
  }
}

module.exports = HomekitControllerClient;
