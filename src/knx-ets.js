'use strict';

/**
 * LSH devices as KNX group addresses, for ETS.
 *
 * buildEtsXml() writes ETS's own group-address exchange format
 * (xmlns http://knx.org/xml/ga-export/01) — ETS 5/6: Group Addresses →
 * Import… → XML. Addresses come from a persistent map
 * (persist/knx-ets.json), so a device keeps its address across exports
 * and a new device never shifts the others — what's linked in ETS stays
 * valid. The KNX client's bridge (knx.lshBridge) serves the same map on
 * the bus: command writes drive the device, status follows its value.
 *
 * Layout, from knx.ets.mainGroup M (default 20, M+4 ≤ 31):
 *   M    Switching  M/0-3/x commands, M/4-7/x status (same x) — DPT 1.001
 *   M+1  Dimming    same split — DPT 5.001 (0-100 %), or 5.010 / 14 for other ranges
 *   M+2  Values     M+2/0-7/x read-only measurements (DPT 9 / 14 by unit)
 *   M+3  States     M+3/0-7/x read-only booleans — DPT 1
 *   M+4  Scenes     M+4/0-7/x one trigger per LSH scene — DPT 1.017
 */

const fs = require('fs');
const path = require('path');

const MAP_FILE = process.env.LSH_KNX_ETS_MAP || path.join(__dirname, '..', 'persist', 'knx-ets.json');

const KINDS = ['switch', 'dim', 'value', 'state', 'scene'];
const TITLES = { switch: 'Switching', dim: 'Dimming', value: 'Values', state: 'States', scene: 'Scenes' };
// switch/dim pair a command with a status in the upper half of the range
const PAIRED = new Set(['switch', 'dim']);
const capacity = (kind) => (PAIRED.has(kind) ? 1024 : 2048);

const ga = (main, mid, sub) => `${main}/${mid}/${sub}`;
const gaNumber = (main, mid, sub) => (main << 11) | (mid << 8) | sub;

function xmlEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Measurement DPT by unit; anything numeric we can't place is a 4-byte float.
function valueDpt(sensor) {
  const unit = String(sensor.unit || '').trim().toLowerCase();
  const name = `${sensor.label || ''} ${sensor.path || ''}`.toLowerCase();
  if (unit === '°c' || unit === 'c') return 'DPT9.001';
  if (unit === 'k') return 'DPT9.002';
  if (unit === 'lx' || unit === 'lux') return 'DPT9.004';
  if (unit === 'm/s') return 'DPT9.005';
  if (unit === 'ppm') return 'DPT9.008';
  if (unit === '%') return /hum|wilgot/.test(name) ? 'DPT9.007' : 'DPT5.001';
  if (unit === 'kw') return 'DPT9.024';
  if (unit === 'w') return 'DPT14.056';
  if (unit === 'v') return 'DPT14.027';
  if (unit === 'a') return 'DPT14.019';
  if (unit === 'hz') return 'DPT14.033';
  return 'DPT14';
}

const isMomentary = (s) => s.type === 'trigger' || (s.type === 'toggle' && s.writeOn && s.writeOn === s.writeOff);

/**
 * What a sensor becomes on the bus, or null if it has no KNX form
 * (text, colour, a value not yet seen). `value` is its current store value.
 */
function classify(sensor, value) {
  if (!sensor || sensor.hidden) return null;
  if (sensor.type === 'text' || sensor.type === 'label' || sensor.type === 'color') return null;
  if (sensor.controllable) {
    if (sensor.type === 'range' || sensor.type === 'color-temp') {
      const min = sensor.min ?? 0, max = sensor.max ?? 100;
      const dpt = min === 0 && max === 100 ? 'DPT5.001' : min >= 0 && max <= 255 ? 'DPT5.010' : 'DPT14';
      return { kind: 'dim', dpt };
    }
    // a momentary button (blind up/stop, doorbell open) has nothing to report back
    return { kind: 'switch', dpt: isMomentary(sensor) ? 'DPT1.017' : 'DPT1.001', status: !isMomentary(sensor) };
  }
  if (sensor.type === 'boolean' || sensor.format === 'on-off' || typeof value === 'boolean') return { kind: 'state', dpt: 'DPT1.001' };
  if (typeof value === 'number' || (value == null && sensor.unit)) return { kind: 'value', dpt: valueDpt(sensor) };
  return null;
}

// Slot → { cmd, status } addresses (strings) for a kind.
function addresses(kind, slot, mainGroup) {
  const main = mainGroup + KINDS.indexOf(kind);
  if (PAIRED.has(kind)) {
    return { cmd: ga(main, slot >> 8, slot & 255), status: ga(main, 4 + (slot >> 8), slot & 255) };
  }
  const a = ga(main, slot >> 8, slot & 255);
  return kind === 'scene' ? { cmd: a } : { status: a };
}

function loadMap(file = MAP_FILE) {
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const k of KINDS) m.slots[k] = m.slots[k] || {};
    return m;
  } catch {
    return { version: 1, slots: Object.fromEntries(KINDS.map((k) => [k, {}])) };
  }
}

function saveMap(map, file = MAP_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2));
  fs.renameSync(tmp, file);
}

function nextSlot(used, kind) {
  const taken = new Set(Object.values(used));
  for (let i = 0; i < capacity(kind); i++) if (!taken.has(i)) return i;
  return -1;
}

/**
 * Give every exportable sensor (and scene) a slot, keeping the ones it has.
 * Returns { entries, changed, full } — entries sorted by address, changed
 * when new slots were handed out (save the map), full = kinds that ran out.
 * Devices of type 'knx' are left out: they are already on the bus.
 * readOnly: only what the map already has (the bridge — never hand out
 * an address ETS hasn't been given).
 */
function allocate(devices, map, { mainGroup = 20, getValue = () => null, scenes = [], readOnly = false } = {}) {
  let changed = false;
  const full = new Set();
  const entries = [];
  const take = (kind, key) => {
    const used = map.slots[kind];
    if (used[key] == null) {
      if (readOnly) return -1;
      const slot = nextSlot(used, kind);
      if (slot < 0) { full.add(kind); return -1; }
      used[key] = slot;
      changed = true;
    }
    return used[key];
  };

  for (const device of devices) {
    if (device.type === 'knx') continue;
    for (const sensor of device.sensors || []) {
      const key = `${device.key}/${sensor.path}`;
      const c = classify(sensor, getValue(key));
      if (!c) continue;
      const slot = take(c.kind, key);
      if (slot < 0) continue;
      const a = addresses(c.kind, slot, mainGroup);
      if (c.status === false) delete a.status;
      entries.push({
        kind: c.kind, slot, dpt: c.dpt, key, deviceKey: device.key, path: sensor.path,
        name: `${device.label} ${sensor.label || sensor.name || sensor.path}`.trim(),
        room: device.room || '', ...a,
      });
    }
  }
  for (const scene of scenes) {
    const key = `scene/${scene.id}`;
    const slot = take('scene', key);
    if (slot < 0) continue;
    entries.push({ kind: 'scene', slot, dpt: 'DPT1.017', key, sceneId: scene.id, name: scene.name || String(scene.id), room: '', ...addresses('scene', slot, mainGroup) });
  }
  if (changed) map.mainGroup = mainGroup;
  entries.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.slot - b.slot);
  return { entries, changed, full: [...full] };
}

// "DPT9.001" → ETS's "DPST-9-1"; "DPT14" → "DPT-14"
function etsDpt(dpt) {
  const m = /^DPT(\d+)(?:\.(\d+))?$/i.exec(dpt || '');
  if (!m) return '';
  return m[2] ? `DPST-${Number(m[1])}-${Number(m[2])}` : `DPT-${Number(m[1])}`;
}

/**
 * ETS group-address import XML. Three levels: an LSH main group per kind,
 * middle groups for commands/status, then one address each.
 */
function buildEtsXml(entries, { mainGroup = 20, title = 'LSH' } = {}) {
  const out = ['<?xml version="1.0" encoding="utf-8" standalone="yes"?>', '<GroupAddress-Export xmlns="http://knx.org/xml/ga-export/01">'];
  for (const kind of KINDS) {
    const list = entries.filter((e) => e.kind === kind);
    if (!list.length) continue;
    const main = mainGroup + KINDS.indexOf(kind);
    out.push(`  <GroupRange Name="${xmlEsc(`${title} ${TITLES[kind]}`)}" RangeStart="${gaNumber(main, 0, 0)}" RangeEnd="${gaNumber(main, 7, 255)}">`);
    // one middle group per 256 slots and role
    const mids = new Map();
    for (const e of list) {
      for (const role of ['cmd', 'status']) {
        if (!e[role]) continue;
        const mid = Number(e[role].split('/')[1]);
        if (!mids.has(mid)) mids.set(mid, []);
        mids.get(mid).push({ e, role });
      }
    }
    for (const mid of [...mids.keys()].sort((a, b) => a - b)) {
      const roleName = PAIRED.has(kind) ? (mid >= 4 ? 'Status' : 'Commands') : TITLES[kind];
      const block = PAIRED.has(kind) ? (mid & 3) : mid;
      const label = block ? `${roleName} ${block + 1}` : roleName;
      out.push(`    <GroupRange Name="${xmlEsc(label)}" RangeStart="${gaNumber(main, mid, 0)}" RangeEnd="${gaNumber(main, mid, 255)}">`);
      for (const { e, role } of mids.get(mid)) {
        const suffix = PAIRED.has(kind) ? (role === 'status' ? ' status' : '') : '';
        const dpt = role === 'status' && e.kind === 'dim' && e.dpt === 'DPT5.001' ? 'DPT5.001' : e.dpt;
        const desc = e.sceneId != null ? `LSH scene ${e.sceneId}` : `LSH ${e.key}${e.room ? ` · ${e.room}` : ''}`;
        out.push(`      <GroupAddress Name="${xmlEsc(`${e.name}${suffix}`.slice(0, 255))}" Address="${e[role]}" DPTs="${etsDpt(dpt)}" Description="${xmlEsc(desc)}" />`);
      }
      out.push('    </GroupRange>');
    }
    out.push('  </GroupRange>');
  }
  out.push('</GroupAddress-Export>', '');
  return out.join('\n');
}

module.exports = { MAP_FILE, KINDS, classify, valueDpt, addresses, allocate, loadMap, saveMap, buildEtsXml, etsDpt };
