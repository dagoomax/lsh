'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// The dashboard's previous merge (useLSH.js before mergeDeviceUpdate): every
// sensor of every device checked against the batch
function previousMerge(prev, changes) {
  let touched = false;
  const next = prev.map((d) => {
    let readings = d.readings;
    let devTouched = false;
    const apply = (path, sensor) => {
      const full = `${d.key}/${path}`;
      if (!(full in changes)) return;
      if (!devTouched) { readings = { ...(readings || {}) }; devTouched = true; }
      readings[path] = { ...(readings[path] || sensor || {}), value: changes[full] };
    };
    Object.keys(d.readings || {}).forEach((p) => apply(p));
    (d.sensors || []).forEach((s) => { if (!(d.readings || {})[s.path]) apply(s.path, s); });
    if (!devTouched) return d;
    touched = true;
    return { ...d, readings };
  });
  return touched ? next : prev;
}

const devices = () => [
  { key: 'system/0', sensors: [{ path: 'Dc/Battery/Soc', unit: '%' }, { path: 'Ac/Grid/L1/Power' }], readings: { 'Dc/Battery/Soc': { path: 'Dc/Battery/Soc', unit: '%', value: 80, timestamp: 1 } } },
  { key: 'shelly/kitchen', sensors: [{ path: 'relay0' }, { path: 'power' }], readings: { relay0: { path: 'relay0', value: 1 }, power: { path: 'power', value: 12.5 } } },
  // nested keys: objectdetect/cam and objectdetect/cam/any are different devices
  { key: 'objectdetect/cam', sensors: [{ path: 'any/detected' }], readings: {} },
  { key: 'objectdetect/cam/any', sensors: [{ path: 'detected' }] },
  { key: 'radio/all', sensors: [{ path: 'nowPlaying' }], readings: { nowPlaying: { path: 'nowPlaying', value: '' }, extra: { value: 'kept' } } },
];

test('device updates: same result as the previous merge', async () => {
  const { mergeDeviceUpdate } = await import('../react-dashboard/src/deviceUpdates.js');
  const keys = ['system/0/Dc/Battery/Soc', 'system/0/Ac/Grid/L1/Power', 'system/0/Unknown', 'shelly/kitchen/relay0', 'shelly/kitchen/power',
    'objectdetect/cam/any/detected', 'radio/all/nowPlaying', 'radio/all/extra', 'nope/1/x', 'system', 'radio/all/'];
  const values = [0, 1, 80, 12.5, '', 'Song', null, true, NaN, [1]];
  let seed = 11;
  const rnd = (n) => (seed = (seed * 1103515245 + 12345) >>> 0) % n;
  let a = devices(), b = devices();
  for (let round = 0; round < 500; round++) {
    const changes = {};
    for (let i = rnd(4); i >= 0; i--) changes[keys[rnd(keys.length)]] = values[rnd(values.length)];
    a = mergeDeviceUpdate(a, changes);
    b = previousMerge(b, changes);
    assert.deepEqual(a, b, `round ${round}: ${JSON.stringify(changes)}`);
  }
});

test('device updates: a batch of repeats keeps every object; a change copies only its device', async () => {
  const { mergeDeviceUpdate } = await import('../react-dashboard/src/deviceUpdates.js');
  const list = devices();
  assert.equal(mergeDeviceUpdate(list, { 'system/0/Dc/Battery/Soc': 80, 'shelly/kitchen/relay0': 1, 'nope/x': 3 }), list);

  const next = mergeDeviceUpdate(list, { 'shelly/kitchen/power': 40, 'shelly/kitchen/relay0': 1 });
  assert.notEqual(next, list);
  assert.equal(next[0], list[0]);
  assert.equal(next[2], list[2]);
  assert.equal(next[1].readings.power.value, 40);
  assert.equal(next[1].readings.relay0, list[1].readings.relay0);
  assert.equal(list[1].readings.power.value, 12.5, 'the previous list is left alone');

  // a sensor without a reading yet gets one from its descriptor
  const cam = mergeDeviceUpdate(next, { 'objectdetect/cam/any/detected': 1 });
  assert.deepEqual(cam[2].readings, { 'any/detected': { path: 'any/detected', value: 1 } });
  assert.deepEqual(cam[3].readings, { detected: { path: 'detected', value: 1 } });
});
