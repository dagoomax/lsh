'use strict';

// Saved LAN devices (persist/lan-devices.json) — every device a LAN scan has
// seen, keyed by MAC (so it survives IP changes; `ip:<addr>` when the MAC is
// unknown), with the user's label / tags / notes and the monitor flag.
//
// System tags, set automatically:
//   new         first seen after the baseline scan — until marked known
//   ip-changed  same MAC turned up at a different IP — until marked known
//   offline     monitored and currently not responding (computed)
//   permanent   user-set: always monitored, can't be forgotten, offline is a
//               critical alert, always on the dashboard (lan/<id>)
// Any other tag is the user's own (trusted, guest, iot, kids, …).

const fs = require('fs');
const path = require('path');

const FILE = process.env.LSH_LAN_DEVICES_FILE || path.join(__dirname, '..', 'persist', 'lan-devices.json');
const SYSTEM_TAGS = ['new', 'ip-changed', 'offline'];
const SUGGESTED_TAGS = ['permanent', 'trusted', 'guest', 'iot', 'kids', 'infra', 'work', 'unknown', 'block'];

let db = null;

function load() {
  if (db) return db;
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { db = null; }
  if (!db || typeof db !== 'object' || !db.devices) db = { baselineAt: null, devices: {} };
  return db;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

const keyOf = (h) => (h.mac && h.mac !== '00:00:00:00:00:00' ? h.mac.toUpperCase() : `ip:${h.ip}`);

const cleanTags = (tags) => [...new Set((Array.isArray(tags) ? tags : String(tags || '').split(','))
  .map((t) => String(t).trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '').slice(0, 24))
  .filter(Boolean))].slice(0, 16);

// Merge one scan's hosts. Returns { newDevices: [...] } and annotates each
// host with { key, saved: {label, tags, monitored, …} }.
function mergeScan(scan) {
  const d = load();
  const now = new Date().toISOString();
  const baseline = !d.baselineAt;
  const newDevices = [];
  for (const h of scan.hosts) {
    if (h.self) continue;
    const key = keyOf(h);
    let dev = d.devices[key];
    if (!dev) {
      dev = d.devices[key] = {
        key, mac: h.mac || null, ip: h.ip, ipHistory: [h.ip], firstSeen: now, lastSeen: now,
        label: '', notes: '', tags: baseline ? [] : ['new'], monitored: false,
      };
      if (!baseline) newDevices.push(dev);
    } else {
      if (dev.ip !== h.ip) {
        dev.ipHistory = [h.ip, ...(dev.ipHistory || []).filter((x) => x !== h.ip)].slice(0, 5);
        dev.ip = h.ip;
        if (!dev.tags.includes('ip-changed')) dev.tags.push('ip-changed');
      }
      dev.lastSeen = now;
    }
    // Latest detected facts (kept so the Devices list shows offline ones too)
    Object.assign(dev, {
      name: h.name || dev.name || null, vendor: h.vendor || dev.vendor || null, hostname: h.hostname || dev.hostname || null,
      kind: h.id?.kind || dev.kind || null, kindLabel: h.id?.label || dev.kindLabel || null,
      integration: h.id?.integration || dev.integration || null, ports: h.ports?.length ? h.ports : (dev.ports || []),
      gateway: !!h.gateway,
    });
    h.key = key;
    h.saved = view(dev);
  }
  if (baseline) d.baselineAt = now;
  d.lastScanAt = now;
  save();
  return { newDevices: newDevices.map(view), baseline };
}

// Public shape; `status` is filled in by the monitor (online/offline/unknown).
function view(dev, status) {
  const tags = [...dev.tags];
  if (status?.online === false && dev.monitored && !tags.includes('offline')) tags.push('offline');
  return { ...dev, tags, status: status || null };
}

function list(statusOf = () => null) {
  const d = load();
  return Object.values(d.devices).map((dev) => view(dev, statusOf(dev.key)))
    .sort((a, b) => ipNum(a.ip) - ipNum(b.ip));
}

const ipNum = (ip) => (ip || '').split('.').reduce((a, b) => a * 256 + Number(b || 0), 0);

function get(key) { return load().devices[key] || null; }

function update(key, patch) {
  const dev = load().devices[key];
  if (!dev) throw new Error('Unknown device');
  if (patch.label !== undefined) dev.label = String(patch.label).trim().slice(0, 60);
  if (patch.notes !== undefined) dev.notes = String(patch.notes).slice(0, 500);
  if (patch.tags !== undefined) {
    // Keep system tags only if the caller kept them (removing "new" = mark known)
    dev.tags = cleanTags(patch.tags).filter((t) => t !== 'offline');
  }
  if (patch.monitored !== undefined) dev.monitored = !!patch.monitored;
  if (patch.permanent !== undefined) {
    dev.permanent = !!patch.permanent;
  } else if (patch.tags !== undefined) {
    dev.permanent = dev.tags.includes('permanent');
  }
  // "permanent" is both a flag and a tag; it always implies monitoring.
  dev.tags = dev.tags.filter((t) => t !== 'permanent');
  if (dev.permanent) { dev.tags.unshift('permanent'); dev.monitored = true; }
  save();
  return dev;
}

// Monitor saw this MAC at another IP.
function setIp(key, ip) {
  const dev = load().devices[key];
  if (!dev || dev.ip === ip) return;
  dev.ipHistory = [ip, ...(dev.ipHistory || []).filter((x) => x !== ip)].slice(0, 5);
  dev.ip = ip;
  if (!dev.tags.includes('ip-changed')) dev.tags.push('ip-changed');
  save();
}

// icon: { file, source: 'vendor'|'favicon'|'url', ref } or null
function setIcon(key, icon) {
  const dev = load().devices[key];
  if (!dev) throw new Error('Unknown device');
  dev.icon = icon || null;
  save();
  return dev;
}

function remove(key) {
  const d = load();
  if (d.devices[key]?.permanent) throw new Error('This device is permanent — remove the permanent tag first');
  delete d.devices[key];
  save();
}

// "Mark known": drop new / ip-changed from the given keys (or all).
function acknowledge(keys) {
  const d = load();
  for (const dev of Object.values(d.devices)) {
    if (keys && !keys.includes(dev.key)) continue;
    dev.tags = dev.tags.filter((t) => t !== 'new' && t !== 'ip-changed');
  }
  save();
}

function monitored() { return Object.values(load().devices).filter((d) => d.monitored); }

function allTags() {
  const set = new Set(SUGGESTED_TAGS);
  for (const d of Object.values(load().devices)) for (const t of d.tags) if (!SYSTEM_TAGS.includes(t)) set.add(t);
  return [...set].sort();
}

function _reset() { db = null; } // tests

module.exports = { mergeScan, list, get, update, setIp, setIcon, remove, acknowledge, monitored, allTags, keyOf, cleanTags, SYSTEM_TAGS, SUGGESTED_TAGS, FILE, _reset };
