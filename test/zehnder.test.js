'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

process.env.LSH_ZEHNDER_STATE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-zehnder-')), 'zehnder.json');

const SensorRegistry = require('../src/sensor-registry');
const ZehnderClient = require('../src/zehnder-client');
const LanC = require('../src/zehnder/lanc');
const { startLanC, startPro, startCA350 } = require('../scripts/zehnder-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)) } return false };

const clients = [];
after(() => { for (const c of clients) c.stop() });

function client(units, extra = {}) {
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new ZehnderClient({ zehnder: { units, ...extra } }, store, registry);
  clients.push(c);
  return { c, store, registry };
}

test('LAN C: discovery, PIN registration, readings, control, alarms, takeover', async () => {
  const sim = await startLanC({ port: 0, pin: 4321 });
  try {
    // wrong PIN → clear error, no retry storm
    const bad = client([{ type: 'lanc', host: '127.0.0.1', port: sim.port, pin: 1, sensorDelay: 0, id: 'bad' }]);
    await bad.c.start();
    assert.match(bad.c.status()[0].error, /refused the PIN/);
    bad.c.stop();

    const { c, store, registry } = client([{ type: 'lanc', host: '127.0.0.1', port: sim.port, pin: 4321, name: 'Rekuperator', sensorDelay: 0, reconnect: 50, takeoverBackoff: 100 }], { boostMinutes: 30 });
    await c.start();
    const st = c.status()[0];
    assert.equal(st.connected, true, st.error);
    assert.equal(st.info.gateway.uuid, sim.uuid, 'gateway uuid found by UDP discovery');
    assert.equal(st.info.version.serial, 'DEM0116372001');
    const key = st.deviceKey, v = (p) => store.values[`${key}/${p}`];
    assert.equal(registry.devices.get(key).label, 'Rekuperator');
    assert.ok(await until(() => v('extractHumidity') === 48), 'PDO readings arrive');
    assert.equal(v('outdoorTemp'), 3.2);
    assert.equal(v('supplyTemp'), 19.6);
    assert.equal(v('speed'), 2);
    assert.equal(v('auto'), 1, 'mode 255 = auto');
    assert.equal(v('power'), 24);
    assert.equal(v('filterDays'), 87);
    assert.equal(v('level'), 67, 'HomeKit rotation speed');
    assert.equal(v('switch'), 1);
    assert.deepEqual(registry.devices.get(key).homekit, ['fan-rw', 'temperature', 'humidity']);

    await registry.sendCommand(key, 'speed', 3);
    assert.equal(sim.rmi.at(-1), '84150101000000000100000003');
    assert.ok(await until(() => v('speed') === 3 && v('auto') === 0));

    await registry.sendCommand(key, 'boost', true);
    assert.equal(sim.rmi.at(-1), '8415010600000000' + '08070000' + '03', 'boost for 30 min = 1800 s');
    assert.equal(v('boost'), 1);

    await registry.sendCommand(key, 'switch', false); // HomeKit off → away (until cancelled)
    assert.equal(sim.rmi.at(-1), '8415010b00000000ffffffff00');
    assert.ok(await until(() => v('switch') === 0));

    await registry.sendCommand(key, 'level', 34); // HomeKit speed → leaves away, level 1
    assert.ok(sim.rmi.includes('8515010b'), 'away cancelled');
    assert.equal(sim.rmi.at(-1), '84150101000000000100000001');

    await registry.sendCommand(key, 'bypassMode', 1);
    assert.equal(sim.rmi.at(-1), '8415020100000000ffffffff01');
    await registry.sendCommand(key, 'profile', 2);
    assert.ok(await until(() => v('profile') === 2));
    await registry.sendCommand(key, 'auto', true);
    assert.deepEqual(sim.rmi.slice(-2), ['85150801', '85150101']);
    await assert.rejects(registry.sendCommand(key, 'speed', 7), /0 \(away\) – 3/);

    sim.alarm([34, 77]);
    assert.ok(await until(() => v('errors') === 'Front door open; Replace the filters now'));
    assert.equal(v('error'), 1);
    assert.equal(v('filterAlarm'), 1);

    // Zehnder app takes the session over → LSH comes back after the backoff
    const sessions = sim.sessions;
    sim.takeover();
    assert.ok(await until(() => sim.sessions > sessions && c.status()[0].connected, 4000), 'reconnected');
  } finally { for (const c of clients.splice(0)) c.stop(); await sim.close() }
});

test('LAN C: discovery by broadcast-style query returns the gateway', async () => {
  const sim = await startLanC({ port: 0 });
  try {
    const found = await LanC.discover({ host: `127.0.0.1:${sim.port}`, timeout: 1000 });
    assert.deepEqual(found.map((g) => [g.uuid, g.type]), [[sim.uuid, 'lanc']]);
  } finally { for (const c of clients.splice(0)) c.stop(); await sim.close() }
});

test('ComfoConnect Pro (Modbus TCP): registers, coils, presets', async () => {
  const sim = await startPro({ port: 0 });
  try {
    const { c, store, registry } = client([{ type: 'pro', host: '127.0.0.1', port: sim.port, name: 'CAQ' }]);
    await c.start();
    const key = c.status()[0].deviceKey, v = (p) => store.values[`${key}/${p}`];
    assert.equal(c.status()[0].connected, true, c.status()[0].error);
    assert.equal(v('speed'), 2);
    assert.equal(v('auto'), 1);
    assert.equal(v('airflow'), 155);
    assert.equal(v('outdoorTemp'), -2, 'signed °C×10');
    assert.equal(v('extractHumidity'), 47);
    assert.equal(v('filterDays'), 63);
    assert.equal(v('co2Zone1'), 612);
    assert.ok(registry.devices.get(key).sensors.some((s) => s.path === 'co2Zone1'), 'CO₂ zone added when reported');
    assert.ok(!registry.devices.get(key).sensors.some((s) => s.path === 'co2Zone2'));
    assert.equal(v('connection'), 'OK');

    await registry.sendCommand(key, 'speed', 3);
    assert.deepEqual(sim.writes.at(-1), 'hr0=3');
    assert.equal(v('speed'), 3);
    await registry.sendCommand(key, 'boost', true);
    assert.deepEqual(sim.writes.slice(-2), ['hr4=3600', 'coil6=1']);
    await registry.sendCommand(key, 'away', true);
    assert.equal(v('away'), 1);
    assert.equal(v('switch'), 0);
    await registry.sendCommand(key, 'profile', 1);
    assert.equal(sim.writes.at(-1), 'hr1=1');
    sim.di[3] = true;
    sim.ir[1] = 77;
    await c.units.get(c.status()[0].id).backend.poll();
    assert.equal(v('filterAlarm'), 1);
    assert.equal(v('errors'), 'Error 77');
    await registry.sendCommand(key, 'resetErrors', true);
    assert.equal(sim.writes.at(-1), 'coil0=1');
  } finally { for (const c of clients.splice(0)) c.stop(); await sim.close() }
});

test('ComfoAir 350 (RS232 via TCP bridge): readings, level, comfort temperature, resets', async () => {
  const sim = await startCA350({ port: 0 });
  try {
    sim.filter = 1;
    const { c, store, registry } = client([{ type: 'ca350', host: '127.0.0.1', port: sim.port }]);
    await c.start();
    const key = c.status()[0].deviceKey, v = (p) => store.values[`${key}/${p}`];
    assert.equal(c.status()[0].connected, true, c.status()[0].error);
    assert.equal(v('speed'), 2, 'level byte 3 (medium) → 2');
    assert.equal(v('away'), 0);
    assert.equal(v('targetTemp'), 21.5);
    assert.equal(v('outdoorTemp'), 3.5);
    assert.equal(v('extractTemp'), 22.5);
    assert.equal(v('supplyFanRpm'), 1500);
    assert.equal(v('supplyFanDuty'), 47);
    assert.equal(v('filterAlarm'), 1);
    assert.equal(v('errors'), 'Filter full');
    assert.equal(registry.devices.get(key).sensors.find((s) => s.path === 'targetTemp').controllable, true);

    await registry.sendCommand(key, 'speed', 3);
    assert.equal(sim.sets.at(-1), 'level=4');
    assert.equal(v('speed'), 3);
    await registry.sendCommand(key, 'away', true);
    assert.equal(sim.sets.at(-1), 'level=1');
    assert.equal(v('switch'), 0);
    await registry.sendCommand(key, 'away', false);
    assert.equal(sim.sets.at(-1), 'level=4', 'back to the level before away');
    await registry.sendCommand(key, 'targetTemp', 22);
    assert.equal(sim.sets.at(-1), 'comfort=84');
    assert.equal(v('targetTemp'), 22);
    await registry.sendCommand(key, 'resetFilter', true);
    assert.equal(sim.sets.at(-1), 'reset=0001');
    assert.equal(v('filterAlarm'), 0);
    await assert.rejects(registry.sendCommand(key, 'targetTemp', 40), /12–28/);

    sim.silent = true; // unit stops answering
    await assert.rejects(c.units.get(c.status()[0].id).backend.poll(), /No answer/);
    assert.equal(store.values[`${key}/online`], 0);
  } finally { for (const c of clients.splice(0)) c.stop(); await sim.close() }
});
