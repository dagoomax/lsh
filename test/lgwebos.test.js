'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.LSH_LGWEBOS_KEYS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-lgwebos-')), 'keys.json');
const LgWebosClient = require('../src/lgwebos-client');
const SensorRegistry = require('../src/sensor-registry');
const DataStore = require('../src/data-store');
const { startSimulator } = require('../scripts/lgwebos-simulator');

const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 25)) } throw new Error('timed out') };

test('LG webOS: pair on the TV prompt, key reused, volume / apps / inputs / buttons / message, off and back', async () => {
  const sim = await startSimulator({ port: 0 });
  const store = new DataStore();
  const registry = new SensorRegistry(store);
  const cfg = { lgwebos: { tvs: [{ host: '127.0.0.1', port: sim.port, secure: false, name: 'Salon TV' }] } };
  const c = new LgWebosClient(cfg, store, registry);
  try {
    await c.start();
    const key = 'lgwebos/127_0_0_1';
    const get = (p) => store.get(`${key}/${p}`);
    const set = (p, v) => registry.sendCommand(key, p, v);

    // first connection: the TV asks, accepts → key saved, state read
    await until(() => get('status') === 'connected' && get('appName') === 'Live TV');
    assert.equal(get('power'), 1);
    assert.equal(get('volume'), 12);
    assert.equal(get('channel'), '1 TVP1');
    const saved = JSON.parse(fs.readFileSync(process.env.LSH_LGWEBOS_KEYS, 'utf8'))['127.0.0.1'];
    assert.ok(saved.clientKey);
    assert.equal(saved.mac, 'a8:23:fe:00:11:22', 'MAC learnt for Wake-on-LAN');
    assert.equal(sim.calls.find((x) => x.type === 'register').signed, true);

    // the app / input lists name their numbers
    const dev = registry.getDevices().find((d) => d.key === key);
    assert.match(dev.sensors.find((s) => s.path === 'app').hint, /1 = Netflix, 2 = YouTube/);
    assert.match(dev.sensors.find((s) => s.path === 'input').hint, /2 = PlayStation/);

    await set('volume', 30);
    await until(() => get('volume') === 30);
    await set('volumeUp', 1);
    await until(() => get('volume') === 31);
    await set('mute', 1);
    await until(() => get('mute') === 1);
    await set('app', 2);
    await until(() => get('appName') === 'YouTube');
    assert.equal(get('app'), 2);
    await set('input', 2);
    await until(() => get('appName') === 'PlayStation');
    assert.equal(get('input'), 2);
    await set('ok', 1);
    await set('back', 1);
    await until(() => sim.buttons.length === 2);
    assert.deepEqual(sim.buttons, ['ENTER', 'BACK']);
    await set('notify', 'Pralka skończyła');
    assert.deepEqual(sim.toasts, ['Pralka skończyła']);
    await assert.rejects(set('app', 9), /App number is 1–3/);

    // off → disconnected; it reconnects with the saved key, no new prompt
    await set('power', 0);
    await until(() => get('power') === 0 && get('status') === 'off');
    const registers = sim.calls.filter((x) => x.type === 'register').length;
    c.tvs[0].failures = 0; clearTimeout(c.tvs[0].timer); c.tvs[0].connect();
    await until(() => get('status') === 'connected');
    const again = sim.calls.filter((x) => x.type === 'register').slice(registers);
    assert.equal(again[0].key, saved.clientKey, 'reconnects with the saved key');
  } finally { c.stop(); await sim.close() }
});

test('Wake-on-LAN needs the MAC', async () => {
  await assert.rejects(LgWebosClient.wake(''), /MAC address is needed/);
});
