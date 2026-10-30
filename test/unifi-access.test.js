'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const { execFileSync } = require('child_process');
const SensorRegistry = require('../src/sensor-registry');
const UnifiAccessClient = require('../src/unifi-access-client');

let hasOpenssl = true;
try { execFileSync('openssl', ['version'], { stdio: 'ignore' }) } catch { hasOpenssl = false }
const { startSimulator } = require('../scripts/unifi-access-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {},
  update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) },
  set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null },
  getTimestamp() { return Date.now() },
});
const until = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)) } };

async function setup() {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new UnifiAccessClient({ unifiAccess: { host: `127.0.0.1:${sim.port}`, apiKey: 'simtoken' } }, store, registry);
  await c.start();
  await until(() => sim.connected() === 1);
  return { sim, store, registry, c, v: (k) => store.values[`unifiAccess/${k}`] };
}

test('UniFi Access: doors, unlock, lock now, lock rules, emergency', { skip: !hasOpenssl && 'needs openssl' }, async () => {
  const { sim, registry, c, v } = await setup();
  try {
    assert.equal(v('door-main/contact'), 0);
    assert.equal(v('door-main/lock'), 1);
    assert.equal(v('door-gate/contact'), undefined, 'no door position sensor → no contact value');
    assert.equal(v('system/doors'), 2);
    assert.equal(v('system/readers'), 2);
    assert.equal(v('door-main/lockRule'), 'none');

    await registry.sendCommand('unifiAccess/door-main', 'lock', '0');
    assert.equal(sim.doors[0].door_lock_relay_status, 'unlock');
    const unlock = sim.calls.find((x) => x.path.endsWith('/door-main/unlock'));
    assert.deepEqual(JSON.parse(unlock.body), { actor_id: 'lsh', actor_name: 'LSH' });
    assert.equal(v('door-main/lock'), 0);

    await registry.sendCommand('unifiAccess/door-main', 'lock', '1');
    assert.ok(sim.calls.some((x) => x.method === 'PUT' && x.path.endsWith('/door-main/lock_rule') && JSON.parse(x.body).type === 'lock_now'));
    assert.equal(v('door-main/lock'), 1);

    await registry.sendCommand('unifiAccess/door-main', 'keepUnlocked', '1');
    assert.equal(sim.rules['door-main'].type, 'keep_unlock');
    assert.equal(v('door-main/keepUnlocked'), 1);
    assert.equal(v('door-main/lock'), 0, 'relay read back after the rule');
    assert.equal(v('door-main/lockRuleEnds'), '', 'keep rules have no end');
    await registry.sendCommand('unifiAccess/door-main', 'keepUnlocked', '0');
    assert.equal(v('door-main/lockRule'), 'none');

    await registry.sendCommand('unifiAccess/door-gate', 'unlockFor', 15);
    assert.deepEqual(sim.rules['door-gate'].type, 'custom');
    assert.ok(sim.calls.some((x) => x.method === 'PUT' && x.path.endsWith('/door-gate/lock_rule') && JSON.parse(x.body).interval === 15));
    assert.match(v('door-gate/lockRuleEnds'), /^\d{4}-/);
    await registry.sendCommand('unifiAccess/door-gate', 'setRule', 'keep_lock');
    assert.equal(sim.rules['door-gate'].type, 'keep_lock');
    await assert.rejects(registry.sendCommand('unifiAccess/door-gate', 'setRule', 'open_sesame'), /Unknown lock rule/);
    await assert.rejects(registry.sendCommand('unifiAccess/door-gate', 'unlockFor', 999), /1–480/);

    await registry.sendCommand('unifiAccess/system', 'lockdown', '1');
    assert.deepEqual(sim.emergency, { lockdown: true, evacuation: false });
    await registry.sendCommand('unifiAccess/system', 'evacuation', '1');
    assert.deepEqual(sim.emergency, { lockdown: false, evacuation: true }, 'one emergency mode at a time');
    assert.equal(v('system/lockdown'), 0);
    assert.equal(v('system/evacuation'), 1);
  } finally { c.stop(); await sim.close() }
});

test('UniFi Access: notifications — doorbell, door position, access log', { skip: !hasOpenssl && 'needs openssl' }, async () => {
  const { sim, c, v } = await setup();
  try {
    sim.push({ event: 'access.remote_view', data: { device_id: 'e4388386be1d', door_name: 'Main Door', request_id: 'RQ1' } });
    await until(() => v('door-main/doorbell') === 1);
    sim.push({ event: 'access.remote_view.change', data: { reason_code: 108, remote_call_request_id: 'RQ1' } });
    await until(() => v('door-main/doorbell') === 0);

    sim.push({ event: 'access.data.v2.location.update', data: { id: 'door-main', state: { dps: 'open', lock: 'unlocked' } } });
    await until(() => v('door-main/contact') === 1 && v('door-main/lock') === 0);
    sim.push({ event: 'access.data.v2.device.update', data: { id: '7483c2773855', location_states: [{ location_id: 'door-main', dps: 'close', lock: 'locked' }] } });
    await until(() => v('door-main/contact') === 0 && v('door-main/lock') === 1);

    sim.push({ event: 'access.logs.add', data: { source: { actor: { display_name: 'Anna' }, authentication: { credential_provider: 'NFC' },
      event: { type: 'access.door.unlock', result: 'ACCESS' }, target: [{ type: 'door', id: 'door-gate' }] } } });
    await until(() => v('door-gate/lastAccess') === 'Anna · nfc');

    sim.push({ event: 'access.data.setting.update', data: { lockdown: true, evacuation: false } });
    await until(() => v('system/lockdown') === 1);
  } finally { c.stop(); await sim.close() }
});
