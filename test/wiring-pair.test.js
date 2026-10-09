'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const EventEmitter = require('events');

process.env.LSH_WIRING_LINKS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-links-')), 'links.json');
const ZwaveJsClient = require('../src/zwave-js-client');
const links = require('../src/wiring-links');
const { startSimulator } = require('../scripts/zwave-js-simulator');

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)) }
  throw new Error('timed out');
};
const fakeStore = () => Object.assign(new EventEmitter(), { values: {}, update(k, v) { this.values[k] = v }, set(k, v) { this.values[k] = v } });
const fakeRegistry = () => { const devices = new Map(); return { devices, registerDevice: (d) => devices.set(d.key, d), getDevices: () => [...devices.values()] } };

test('Z-Wave JS: S2 inclusion with PIN, node registered, real id; exclusion', async () => {
  const sim = await startSimulator({ port: 0, pressAfterMs: 50 });
  const registry = fakeRegistry();
  const c = new ZwaveJsClient({ zwaveJs: { host: '127.0.0.1', port: sim.port } }, fakeStore(), registry);
  try {
    await c.start();
    await until(() => c.connected);
    assert.equal(c.homeId, sim.homeId);
    assert.ok(sim.calls.some((m) => m.command === 'set_api_schema' && m.schemaVersion === 35));
    assert.ok(registry.devices.has('zwaveJs/node_2'));

    await c.startInclusion({ secure: true });
    assert.deepEqual(sim.calls.find((m) => m.command === 'controller.begin_inclusion').options, { strategy: 0 });
    const dsk = await until(() => c.pairing.phase === 'dsk' && c.pairing);
    assert.match(dsk.dsk, /^-----/);
    assert.deepEqual(sim.calls.find((m) => m.command === 'controller.grant_security_classes').inclusionGrant, { securityClasses: [1, 2], clientSideAuth: false });
    await assert.rejects(c.submitPin('12'), /5 digits/);
    await c.submitPin('12345');
    const done = await until(() => c.pairing.phase === 'done' && c.pairing);
    assert.equal(done.node.nodeId, 3);
    assert.equal(done.node.manufacturerId, '0x010f');
    assert.equal(done.node.label, 'FGS213');
    assert.equal(done.deviceKey, 'zwaveJs/node_3');
    assert.ok(registry.devices.has('zwaveJs/node_3'));
    assert.equal(links.zwaveRealId(c.homeId, 3), 'zwave:e1a2b3c4:3');

    // Wrong PIN → failed
    await c.startInclusion({ secure: true });
    await until(() => c.pairing.phase === 'dsk');
    await c.submitPin('99999');
    await until(() => c.pairing.phase === 'failed');

    // Insecure inclusion skips the PIN
    await c.startInclusion({ secure: false });
    await until(() => c.pairing.phase === 'done');

    await c.startExclusion();
    const ex = await until(() => c.pairing.phase === 'excluded' && c.pairing);
    assert.equal(ex.node.nodeId, 4);
  } finally { c.stop(); await sim.close() }
});

test('Wi-Fi / LAN probe recognises a Shelly; links are saved with the real id', async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/shelly') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ id: 'shellyplus1pm-a8032ab12345', mac: 'A8032AB12345', model: 'SNSW-001P16EU', gen: 2, fw_id: '20240101' })) }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  // probe() talks to port 80; point it at our server through a host:port path
  const orig = http.get;
  http.get = (opts, cb) => orig.call(http, { ...opts, port }, cb);
  try {
    const p = await links.probe('127.0.0.1');
    assert.equal(p.kind, 'shelly');
    assert.equal(p.mac, 'A8:03:2A:B1:23:45');
    assert.equal(p.realId, 'mac:A8:03:2A:B1:23:45');
    assert.equal(p.model, 'SNSW-001P16EU');
  } finally { http.get = orig; srv.close() }
  await assert.rejects(links.probe('bad host!'), /IP address/);

  const a = links.save({ realId: 'zwave:e1a2b3c4:3', deviceKey: 'zwaveJs/node_3', name: 'Hall', emulator: { device: 'fibaro-fgs213' } });
  links.save({ realId: 'mac:A8:03:2A:B1:23:45', name: 'Pump' });
  links.save({ realId: 'zwave:e1a2b3c4:3', deviceKey: 'zwaveJs/node_3', name: 'Hall light' }); // same device → replaced
  assert.deepEqual(links.list().map((l) => l.name).sort(), ['Hall light', 'Pump']);
  assert.equal(links.remove(a.id), false, 'replaced entry is gone already');
  assert.equal(links.remove(links.list()[0].id), true);
  assert.equal(links.list().length, 1);
});
