#!/usr/bin/env node
'use strict';

// One-off Fibaro Home Center -> Z-Way migration helper. Z-Wave devices are
// cryptographically paired to whichever controller included them, so this
// does NOT move the Z-Wave network itself — that still means excluding each
// device from Fibaro and re-including it into Z-Way by hand. What this
// script does is pull device names/rooms/node IDs and scene logic out of
// Fibaro via its local REST API (config.json -> fibaro: host/port/username/
// password) so that re-pairing and rebuilding scenes in Z-Way's own
// automation engine goes faster than starting from a blank slate.
// Usage: node scripts/fibaro-migration-export.js
// Output: persist/fibaro-migration/export.json (full structured data)
//         persist/fibaro-migration/report.md   (human-readable summary)

const http = require('http');
const fs   = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const OUT_DIR      = path.join(__dirname, '..', 'persist', 'fibaro-migration');

const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).fibaro || {};
if (!cfg.host) {
  console.error('config.json -> fibaro.host is required (host/port/username/password of the Fibaro Home Center)');
  process.exit(1);
}
const auth = Buffer.from(`${cfg.username || 'admin'}:${cfg.password || ''}`).toString('base64');

function get(reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: cfg.host, port: cfg.port || 80, path: reqPath, method: 'GET', timeout: 15000,
      headers: { Authorization: `Basic ${auth}` },
    }, (res) => {
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${reqPath}`));
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Non-JSON response for ${reqPath}: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout on ${reqPath}`)); });
    req.end();
  });
}

// Fibaro's own account/system devices (voip user, primary Z-Wave controller
// node, etc.) aren't migratable end-devices and can carry account PII
// (e.g. HC_user has an email address) — keep the export to physical Z-Wave
// hardware only.
function isMigratableDevice(d) {
  return Array.isArray(d.interfaces) && d.interfaces.includes('zwave')
    && d.type !== 'com.fibaro.zwavePrimaryController';
}

async function main() {
  console.log(`Connecting to Fibaro Home Center at ${cfg.host}:${cfg.port || 80}...`);
  const [devicesRaw, rooms, scenes] = await Promise.all([get('/api/devices'), get('/api/rooms'), get('/api/scenes')]);

  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const devices = devicesRaw.filter(isMigratableDevice).map((d) => ({
    id: d.id,
    name: d.name,
    parentId: d.parentId || null,
    room: roomName.get(d.roomID) || null,
    type: d.type,
    baseType: d.baseType || null,
    manufacturer: d.properties?.manufacturer || d.properties?.zwaveCompany || null,
    model: d.properties?.model || null,
    nodeId: d.properties?.nodeId ?? d.properties?.nodeID ?? null,
  }));

  const sceneList = scenes.map((s) => ({
    id: s.id,
    name: s.name,
    room: roomName.get(s.roomId) || null,
    enabled: !!s.enabled,
    type: s.type,       // "json" (block scene) or "lua"
    content: s.content, // raw scene logic, kept as-is for manual reimplementation
  }));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'export.json'), JSON.stringify({ devices, scenes: sceneList }, null, 2));

  const byRoom = new Map();
  for (const d of devices) {
    const key = d.room || '(no room)';
    if (!byRoom.has(key)) byRoom.set(key, []);
    byRoom.get(key).push(d);
  }

  const lines = [];
  lines.push('# Fibaro -> Z-Way migration report');
  lines.push('');
  lines.push(`Source: ${cfg.host} — ${devices.length} Z-Wave device(s), ${sceneList.length} scene(s).`);
  lines.push('');
  lines.push('Z-Wave devices are paired to the controller that included them — nothing here');
  lines.push('re-pairs hardware automatically. Exclude each device from Fibaro and include it');
  lines.push('into Z-Way, then use the room/name below to put it back where it belongs.');
  lines.push('');
  lines.push('## Devices by room');
  lines.push('');
  for (const [room, list] of [...byRoom.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`### ${room} (${list.length})`);
    lines.push('');
    lines.push('| Name | Type | Manufacturer / Model | Fibaro node ID |');
    lines.push('|---|---|---|---|');
    for (const d of list.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`| ${d.name} | ${d.baseType || d.type} | ${[d.manufacturer, d.model].filter(Boolean).join(' / ') || '—'} | ${d.nodeId ?? '—'} |`);
    }
    lines.push('');
  }

  lines.push('## Scenes (need manual reimplementation in Z-Way automation)');
  lines.push('');
  lines.push('| Name | Room | Type | Enabled |');
  lines.push('|---|---|---|---|');
  for (const s of sceneList) {
    lines.push(`| ${s.name} | ${s.room || '—'} | ${s.type} | ${s.enabled ? 'yes' : 'no'} |`);
  }
  lines.push('');
  lines.push('Full scene logic (block-scene JSON or Lua source) is preserved as-is in export.json');
  lines.push('for reference — Z-Way\'s automation engine is unrelated to Fibaro\'s, so each scene');
  lines.push('needs to be rebuilt by hand there.');

  fs.writeFileSync(path.join(OUT_DIR, 'report.md'), lines.join('\n') + '\n');

  console.log(`\n${devices.length} devices, ${sceneList.length} scenes exported.`);
  console.log(`Wrote ${path.join(OUT_DIR, 'export.json')}`);
  console.log(`Wrote ${path.join(OUT_DIR, 'report.md')}`);
}

main().catch((err) => { console.error('Export failed:', err.message); process.exit(1); });
