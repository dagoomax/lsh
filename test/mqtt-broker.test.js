'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const mqtt = require('mqtt');
const MqttBroker = require('../src/mqtt-broker');
const { sharedBroker } = require('../src/mqtt-target');

const connect = (port, opts = {}) => new Promise((resolve, reject) => {
  const c = mqtt.connect(`mqtt://127.0.0.1:${port}`, { reconnectPeriod: 0, connectTimeout: 3000, ...opts });
  c.once('connect', () => resolve(c));
  c.once('error', (e) => { c.end(true); reject(e); });
});

test('built-in broker relays messages and keeps retained ones', async () => {
  const broker = new MqttBroker({ mqttBroker: { enabled: true, port: 0, host: '127.0.0.1' } });
  assert.equal(await broker.start(), true);
  try {
    const pub = await connect(broker.port);
    await new Promise((r, j) => pub.publish('buttonplus/salon/button/1/state', 'pressed', { retain: true, qos: 1 }, (e) => (e ? j(e) : r())));
    const sub = await connect(broker.port);
    const got = new Promise((r) => sub.on('message', (t, p) => r([t, p.toString()])));
    await new Promise((r, j) => sub.subscribe('buttonplus/#', (e) => (e ? j(e) : r())));
    assert.deepEqual(await got, ['buttonplus/salon/button/1/state', 'pressed']);
    const st = broker.status();
    assert.equal(st.listening, true);
    assert.equal(st.clients.length, 2);
    assert.ok(st.messages >= 1);
    pub.end(true); sub.end(true);
  } finally { broker.stop(); }
});

test('with a username set, only that login gets in', async () => {
  const broker = new MqttBroker({ mqttBroker: { enabled: true, port: 0, host: '127.0.0.1', username: 'lsh', password: 's3cret' } });
  await broker.start();
  try {
    await assert.rejects(connect(broker.port), /Not authorized|Bad User Name or Password|connack/i);
    await assert.rejects(connect(broker.port, { username: 'lsh', password: 'nope' }), /Not authorized|Bad User Name or Password|connack/i);
    const ok = await connect(broker.port, { username: 'lsh', password: 's3cret' });
    ok.end(true);
  } finally { broker.stop(); }
});

test('a busy port is reported, not thrown', async () => {
  const a = new MqttBroker({ mqttBroker: { enabled: true, port: 0, host: '127.0.0.1' } });
  await a.start();
  const b = new MqttBroker({ mqttBroker: { enabled: true, port: a.port, host: '127.0.0.1' } });
  try {
    assert.equal(await b.start(), false);
    assert.match(b.status().error, /already in use/);
  } finally { a.stop(); b.stop(); }
});

test('clients with a blank host use the built-in broker when it is on', () => {
  assert.deepEqual(sharedBroker({ mqtt: { host: '192.168.1.109', port: 1883 }, mqttBroker: { enabled: true, port: 1884, username: 'u', password: 'p' } }),
    { host: '127.0.0.1', port: 1884, username: 'u', password: 'p', builtIn: true });
  assert.equal(sharedBroker({ mqtt: { host: '192.168.1.109' }, mqttBroker: { enabled: false } }).host, '192.168.1.109');
  assert.equal(sharedBroker({ mqtt: { host: '' } }), null);
});
