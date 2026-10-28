'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tado-'));
const tokenFile = path.join(tmp, 'tado-tokens.json');
process.env.LSH_TADO_TOKENS = tokenFile;
const TadoClient = require('../src/tado-client');
const { startSimulator } = require('../scripts/tado-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

test('tado: device-code sign-in saves a rotating refresh token', async () => {
  const sim = await startSimulator({ port: 0 });
  const authBase = `http://127.0.0.1:${sim.port}/oauth2`;
  try {
    const a = await TadoClient.startDeviceAuth({ authBase });
    assert.equal(a.userCode, 'ABC123');
    assert.match(a.url, /user_code=ABC123/);
    assert.equal(await TadoClient.pollDeviceAuth(a.deviceCode, { authBase }), 'pending');
    const t = await TadoClient.pollDeviceAuth(a.deviceCode, { authBase });
    assert.equal(t.refreshToken, 'ref-1');
    assert.equal(TadoClient.loadTokens().refreshToken, 'ref-1');
    assert.equal((fs.statSync(tokenFile).mode & 0o777).toString(8), '600');
    await assert.rejects(TadoClient.pollDeviceAuth('nope', { authBase }), /expired/);
  } finally { await sim.close() }
});

test('tado: zones as devices, overlays, schedule, presence, API quota', async () => {
  const sim = await startSimulator({ port: 0 });
  // a token from a sign-in on this simulator, expired so the client must refresh it
  const base = `http://127.0.0.1:${sim.port}`;
  const a = await TadoClient.startDeviceAuth({ authBase: `${base}/oauth2` });
  await TadoClient.pollDeviceAuth(a.deviceCode, { authBase: `${base}/oauth2` });
  await TadoClient.pollDeviceAuth(a.deviceCode, { authBase: `${base}/oauth2` });
  TadoClient.saveTokens({ ...TadoClient.loadTokens(), expiresAt: 0 });

  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new TadoClient({ tado: { enabled: true, apiBase: `${base}/api/v2`, authBase: `${base}/oauth2` } }, store, registry);
  const v = (k) => store.values[k];
  try {
    await c.start();
    assert.ok(TadoClient.loadTokens().refreshToken !== 'ref-1', 'rotated refresh token saved');

    // heating zone
    const heat = registry.devices.get('tado/4711-1');
    assert.equal(heat.label, 'Salon');
    assert.deepEqual(heat.homekit, ['thermostat']);
    assert.equal(v('tado/4711-1/temperature'), 19.4);
    assert.equal(v('tado/4711-1/humidity'), 52.3);
    assert.equal(v('tado/4711-1/targetTemp'), 20);
    assert.equal(v('tado/4711-1/heatingPower'), 35);
    assert.equal(v('tado/4711-1/modeText'), 'schedule');
    assert.equal(v('tado/4711-1/thermostatMode'), 'auto');
    assert.equal(v('tado/4711-1/batteryLow'), 1, 'one device in the zone reports LOW');

    await registry.sendCommand('tado/4711-1', 'targetTemp', 22.5);
    assert.deepEqual(sim.overlays[1].setting, { type: 'HEATING', power: 'ON', temperature: { celsius: 22.5 } });
    assert.equal(sim.overlays[1].termination.type, 'NEXT_TIME_BLOCK', 'until the next schedule block by default');
    assert.equal(v('tado/4711-1/modeText'), 'manual');
    assert.equal(v('tado/4711-1/thermostatMode'), 'heat');
    await heat._writeCapability('thermostatMode', 'setThermostatMode', ['off']);
    assert.equal(sim.overlays[1].setting.power, 'OFF');
    assert.equal(v('tado/4711-1/modeText'), 'off');
    await registry.sendCommand('tado/4711-1', 'resumeSchedule', true);
    assert.equal(sim.overlays[1], undefined);
    assert.equal(v('tado/4711-1/modeText'), 'schedule');
    await assert.rejects(registry.sendCommand('tado/4711-1', 'targetTemp', 40), /5–25/);

    // hot water: temperature only because the capabilities allow it
    const hw = registry.devices.get('tado/4711-0');
    assert.ok(hw.sensors.find((s) => s.path === 'targetTemp' && s.min === 30 && s.max === 65));
    await registry.sendCommand('tado/4711-0', 'power', false);
    assert.deepEqual(sim.overlays[0].setting, { type: 'HOT_WATER', power: 'OFF' });

    // AC zone: shared AC model, within the capabilities
    const ac = registry.devices.get('tado/4711-3');
    assert.equal(ac.sensors.find((s) => s.path === 'targetTemp').max, 30);
    await ac._writeCapability('thermostatMode', 'setThermostatMode', ['heat']);
    assert.equal(sim.overlays[3].setting.mode, 'HEAT');
    assert.equal(sim.overlays[3].setting.temperature.celsius, 22);
    await registry.sendCommand('tado/4711-3', 'fan', 5);
    assert.equal(sim.overlays[3].setting.fanLevel, 'LEVEL3', 'no LEVEL5/4 on this unit → nearest');
    await registry.sendCommand('tado/4711-3', 'swing', true);
    assert.equal(sim.overlays[3].setting.verticalSwing, 'ON');
    await registry.sendCommand('tado/4711-3', 'mode', 2);
    assert.equal(sim.overlays[3].setting.mode, 'DRY');
    assert.equal(sim.overlays[3].setting.temperature, undefined, 'dry takes no temperature');
    await assert.rejects(registry.sendCommand('tado/4711-3', 'mode', 0), /no auto mode/);
    await registry.sendCommand('tado/4711-3', 'resumeSchedule', true);
    assert.equal(sim.overlays[3], undefined);

    // home: presence and the away lock
    assert.equal(v('tado/4711/home'), 1);
    await registry.sendCommand('tado/4711', 'away', true);
    assert.equal(sim.presence.presence, 'AWAY');
    assert.equal(v('tado/4711/home'), 0);
    await registry.sendCommand('tado/4711', 'presenceAuto', true);
    assert.equal(sim.presence.presenceLocked, false);

    // quota from the headers sizes the interval: 100 a day → ~22 min
    assert.equal(c.quota.limit, 100);
    assert.equal(v('tado/4711/apiRemaining'), sim.remaining);
    assert.ok(c._intervalMs >= 20 * 60 * 1000 && c._intervalMs <= 25 * 60 * 1000, `interval ${c._intervalMs}`);
  } finally { c.stop(); await sim.close() }
});

test('tado: an expired sign-in says so', async () => {
  const sim = await startSimulator({ port: 0 });
  const base = `http://127.0.0.1:${sim.port}`;
  TadoClient.saveTokens({ accessToken: null, refreshToken: 'revoked', expiresAt: 0 });
  const c = new TadoClient({ tado: { enabled: true, apiBase: `${base}/api/v2`, authBase: `${base}/oauth2` } }, fakeStore(), new SensorRegistry(fakeStore(), 'en'));
  c.tokens = TadoClient.loadTokens();
  try {
    await assert.rejects(c._pollImpl(), /sign-in expired/);
  } finally { c.stop(); await sim.close() }
});

test('tado: nearest fan step the unit has', () => {
  assert.equal(TadoClient.nearestFan(['LEVEL1', 'LEVEL2', 'LEVEL3', 'AUTO'], 5), 'LEVEL3');
  assert.equal(TadoClient.nearestFan(['LEVEL1', 'LEVEL2', 'LEVEL3', 'AUTO'], 0), 'AUTO');
  assert.equal(TadoClient.nearestFan(['LOW', 'MIDDLE', 'HIGH', 'AUTO'], 1), 'LOW');
  assert.equal(TadoClient.nearestFan(['LOW', 'MIDDLE', 'HIGH'], 0), 'LOW', 'no auto → the lowest');
});

test('tado: overlay termination from config', () => {
  assert.deepEqual(TadoClient.termination(), { typeSkillBasedApp: 'NEXT_TIME_BLOCK' });
  assert.deepEqual(TadoClient.termination('manual'), { typeSkillBasedApp: 'MANUAL' });
  assert.deepEqual(TadoClient.termination(90), { typeSkillBasedApp: 'TIMER', durationInSeconds: 5400 });
});
