'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const LG = require('../src/lgthinq-client');
const { propertiesOf, sensorFor, valueOf, regionOf } = LG;

// a real refrigerator's ThinQ Connect profile / state (2REB1GLVB1, 2026-10)
const range = (min, max) => ({ type: 'range', mode: ['r', 'w'], value: { r: { max, min, step: 1 }, w: { max, min, step: 1 } } });
const FRIDGE_PROFILE = { property: {
  temperature: [{ locationName: 'FRIDGE', unit: 'C', targetTemperature: range(1, 7) }, { locationName: 'FREEZER', unit: 'C', targetTemperature: range(-23, -15) }],
  temperatureInUnits: [{ targetTemperatureC: range(1, 7), locationName: 'FRIDGE', unit: { type: 'enum', mode: ['r'], value: { r: ['C', 'F'] } } }],
  refrigeration: { expressMode: { type: 'boolean', mode: ['r', 'w'], value: { r: [true, false], w: [true, false] } }, expressModeName: { type: 'enum', mode: ['r'], value: { r: ['FREEZER'] } } },
  ecoFriendly: { ecoFriendlyMode: { type: 'boolean', mode: ['r'], value: { r: [false, true] } } },
  doorStatus: [{ doorState: { type: 'enum', mode: ['r'], value: { r: ['OPEN', 'CLOSE'] } }, locationName: 'MAIN' }],
} };
const FRIDGE_STATE = {
  temperature: [{ targetTemperature: 7, unit: 'C', locationName: 'FRIDGE' }, { targetTemperature: -23, unit: 'C', locationName: 'FREEZER' }],
  refrigeration: { expressMode: false, expressModeName: 'FREEZER' },
  ecoFriendly: { ecoFriendlyMode: false },
  doorStatus: [{ doorState: 'CLOSE', locationName: 'MAIN' }],
};
// shaped like LG's air conditioner profile
const AC_PROFILE = { property: {
  operation: { airConOperationMode: { type: 'enum', mode: ['r', 'w'], value: { r: ['POWER_ON', 'POWER_OFF'], w: ['POWER_ON', 'POWER_OFF'] } } },
  airConJobMode: { currentJobMode: { type: 'enum', mode: ['r', 'w'], value: { r: ['COOL', 'AIR_DRY', 'FAN'], w: ['COOL', 'AIR_DRY', 'FAN'] } } },
  temperature: { currentTemperature: { type: 'number', mode: ['r'] }, targetTemperature: { type: 'range', mode: ['r', 'w'], value: { r: { min: 18, max: 30, step: 0.5 }, w: { min: 18, max: 30, step: 0.5 } } } },
} };

const build = (profile) => propertiesOf(profile).map((p) => ({ p, sensor: sensorFor(p) })).filter((x) => x.sensor);

test('LG ThinQ Connect: sensors and values from a refrigerator profile', () => {
  const props = build(FRIDGE_PROFILE);
  const by = Object.fromEntries(props.map((x) => [x.sensor.path, x]));
  assert.deepEqual(Object.keys(by), ['temperature_FRIDGE_targetTemperature', 'temperature_FREEZER_targetTemperature', 'refrigeration_expressMode', 'refrigeration_expressModeName', 'ecoFriendly_ecoFriendlyMode', 'doorStatus_MAIN_doorState']);
  const fr = by.temperature_FREEZER_targetTemperature.sensor;
  assert.equal(fr.type, 'range'); assert.equal(fr.min, -23); assert.equal(fr.max, -15); assert.equal(fr.label, 'Freezer · Target temperature');
  assert.equal(by.refrigeration_expressMode.sensor.type, 'toggle');
  assert.equal(by.ecoFriendly_ecoFriendlyMode.sensor.type, 'boolean');
  assert.equal(by.doorStatus_MAIN_doorState.sensor.type, 'label');
  const v = (k) => valueOf(FRIDGE_STATE, by[k].p, by[k].sensor);
  assert.equal(v('temperature_FRIDGE_targetTemperature'), 7);
  assert.equal(v('temperature_FREEZER_targetTemperature'), -23);
  assert.equal(v('refrigeration_expressMode'), 0);
  assert.equal(v('doorStatus_MAIN_doorState'), 'CLOSE');
});

test('LG ThinQ Connect: power and mode options of an air conditioner; control bodies', async () => {
  const props = build(AC_PROFILE);
  const by = Object.fromEntries(props.map((x) => [x.sensor.path, x]));
  const power = by.operation_airConOperationMode.sensor;
  assert.deepEqual([power.type, power.writeOn, power.writeOff], ['toggle', 'POWER_ON', 'POWER_OFF']);
  const mode = by.airConJobMode_currentJobMode.sensor;
  assert.equal(mode.type, 'range'); assert.equal(mode.max, 2); assert.match(mode.hint, /1 = AIR_DRY/);
  assert.equal(valueOf({ airConJobMode: { currentJobMode: 'FAN' } }, by.airConJobMode_currentJobMode.p, mode), 2);
  assert.equal(valueOf({ operation: { airConOperationMode: 'POWER_ON' } }, by.operation_airConOperationMode.p, power), 1);

  // writes go to POST /devices/{id}/control with the right body
  const c = Object.create(LG.prototype);
  const sent = [];
  c.call = async (m, p, body) => { sent.push([m, p, body]); return {} };
  c.store = { update() {} };
  c.devices = new Map([['ac1', { key: 'lgthinq/ac1', props }], ['fr1', { key: 'lgthinq/fr1', props: build(FRIDGE_PROFILE), state: FRIDGE_STATE }]]);
  await c.write('ac1', 'operation_airConOperationMode', 'POWER_OFF', []);
  await c.write('ac1', 'airConJobMode_currentJobMode', 'set', [1]);
  await c.write('ac1', 'temperature_targetTemperature', 'set', [22.5]);
  await c.write('fr1', 'temperature_FRIDGE_targetTemperature', 'set', [5]);
  await c.write('fr1', 'refrigeration_expressMode', 'true', []);
  assert.deepEqual(sent.map((x) => x[2]), [
    { operation: { airConOperationMode: 'POWER_OFF' } },
    { airConJobMode: { currentJobMode: 'AIR_DRY' } },
    { temperature: { targetTemperature: 22.5 } },
    { temperature: { locationName: 'FRIDGE', targetTemperature: 5, unit: 'C' } },
    { refrigeration: { expressMode: true } },
  ]);
  assert.equal(sent[0][1], '/devices/ac1/control');
});

test('LG ThinQ Connect: regional server by country', () => {
  assert.equal(regionOf('PL'), 'eic');
  assert.equal(regionOf('US'), 'aic');
  assert.equal(regionOf('KR'), 'kic');
});
