'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { flowTemperature, normalizeCurve, roomReadings } = require('../src/heating-curve-client');

const curve = (over = {}) => normalizeCurve({ id: 'x', ...over });

test('flow equals room + shift when outdoor equals room', () => {
  assert.strictEqual(flowTemperature(20, curve()), 20);
  assert.strictEqual(flowTemperature(20, curve({ shift: 5, minFlow: 0 })), 25);
});

test('matches Viessmann reference points (slope 1.4, room 20)', () => {
  // DAR = −20 → 20 − 1.4·(−20)·(1.4347 − 0.42 + 0.0992) ≈ 51.2
  assert.ok(Math.abs(flowTemperature(0, curve()) - 51.19) < 0.05);
  assert.ok(flowTemperature(-10, curve()) > flowTemperature(0, curve()));
});

test('clamps to min/max flow', () => {
  assert.strictEqual(flowTemperature(-30, curve({ slope: 3.5, maxFlow: 60 })), 60);
  assert.strictEqual(flowTemperature(25, curve()), 20);
});

test('normalizeCurve fills defaults and coerces numbers from form strings', () => {
  const c = normalizeCurve({ id: 1, name: 'Floor', slope: '0.6', shift: '', room: '21' });
  assert.deepStrictEqual(
    { id: c.id, slope: c.slope, shift: c.shift, room: c.room, outdoorKey: c.outdoorKey },
    { id: '1', slope: 0.6, shift: 0, room: 21, outdoorKey: 'openweather/weather/temperature' });
});

test('room compensation raises flow when rooms are cold, lowers when warm', () => {
  const c = curve({ roomFactor: 3 });
  const base = flowTemperature(0, c);
  assert.ok(Math.abs(flowTemperature(0, c, 19) - (base + 3)) < 1e-9);
  assert.ok(Math.abs(flowTemperature(0, c, 22) - (base - 6)) < 1e-9);
  assert.strictEqual(flowTemperature(0, c, NaN), base); // no room reading → plain curve
  assert.strictEqual(flowTemperature(0, curve({ roomFactor: 0 }), 15), base);
});

test('roomReadings names each source and marks setpoints', () => {
  const values = { 'homey/a/temperature': 22.5, 'tado/1/heatingSetpoint': '21' };
  const store = { get: (k) => (k in values ? values[k] : null) };
  const registry = { getDevices: () => [{ key: 'homey/a', label: 'Hue Garderoba' }, { key: 'tado/1', label: 'Salon' }] };
  const r = roomReadings(['homey/a/temperature', 'tado/1/heatingSetpoint', 'gone/x/temperature'], store, registry);
  assert.deepStrictEqual(r[0], { k: 'homey/a/temperature', n: 'Hue Garderoba', v: 22.5 });
  assert.deepStrictEqual(r[1], { k: 'tado/1/heatingSetpoint', n: 'Salon', v: 21, s: 1 });
  assert.strictEqual(r[2].n, 'gone/x');
  assert.ok(Number.isNaN(r[2].v)); // no reading yet is not 0 °C
});
