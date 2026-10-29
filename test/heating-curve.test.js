'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { flowTemperature, normalizeCurve } = require('../src/heating-curve-client');

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
