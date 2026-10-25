'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const dgram = require('dgram');
const DataStore = require('../src/data-store');
const SensorRegistry = require('../src/sensor-registry');
const AjaxClient = require('../src/ajax-client');
const sia = require('../src/sia-dc09');

test('SIA DC-09: CRC (pysiaalarm vectors), parsing, encryption round trip, Contact ID', () => {
  const v1 = '"SIA-DCS"6002L0#AAA[|Nri1/CL501]_14:12:04,09-25-2019';
  assert.equal(sia.crc16(v1), 'E5D5');
  assert.equal(sia.crc16('"SIA-DCS"6002L0#AAA[|Nri1/CL501][M0026B9E4268B]_14:12:04,09-25-2019'), '8757');
  const m = sia.parse(`E5D50078${v1}`);
  assert.equal(m.account, 'AAA');
  assert.deepEqual(sia.events(m), [{ area: 1, code: 'CL', zone: 501 }]);
  assert.equal(m.timestamp.toISOString(), '2019-09-25T14:12:04.000Z');
  assert.equal(sia.parse(`0000${'0078'}${v1}`).error, 'CRC mismatch');

  const key = '0123456789abcdef';
  const enc = sia.parse(sia.build({ account: 'A1B2', data: 'Nri2/BA05', key, seq: 9 }).trim(), () => key);
  assert.equal(enc.encrypted, true);
  assert.deepEqual(sia.events(enc), [{ area: 2, code: 'BA', zone: 5 }]);
  assert.equal(sia.parse(sia.build({ account: 'A1B2', data: 'Nri2/BA05', key }).trim()).error, 'encrypted, but no key set for this account');
  const ack = sia.ack(enc, key).trim();
  assert.match(ack, /^[0-9A-F]{8}"\*ACK"0009R0L0#A1B2\[[0-9A-F]+$/);
  assert.equal(ack.slice(0, 4), sia.crc16(ack.slice(8)));
  assert.match(sia.decrypt(ack.split('[')[1], key), /^0*\]_\d{2}:\d{2}:\d{2},\d{2}-\d{2}-\d{4}$/);
  assert.deepEqual(sia.cidEvents('1401 01 003'), [{ area: 1, code: 'OP', zone: 3, cid: '1401' }]);
  assert.deepEqual(sia.cidEvents('1130 01 012')[0].code, 'BA');
});

function setup(accounts) {
  const store = new DataStore();
  const registry = new SensorRegistry(store, 'en');
  const client = new AjaxClient({ ajax: { port: 0, accounts } }, store, registry);
  return { store, registry, client };
}

const sendTcp = (port, frames) => new Promise((resolve, reject) => {
  const sock = net.connect(port, '127.0.0.1');
  let got = '';
  sock.setEncoding('latin1');
  sock.on('data', (d) => { got += d; if ((got.match(/\r/g) || []).length >= frames.length) { sock.end(); resolve(got); } });
  sock.on('error', reject);
  sock.on('connect', () => { for (const f of frames) sock.write(f, 'latin1'); });
});

test('Ajax: encrypted events over TCP drive the panel; replays and strangers are refused', async () => {
  const key = 'AjaxKey123456789';
  const { store, registry, client } = setup([{ account: 'A1B2', name: 'Dom', key, zones: { 5: 'Kuchnia' } }]);
  await client.start();
  try {
    assert.equal(registry.devices.get('ajax/A1B2').label, 'Dom');
    assert.equal(store.get('ajax/A1B2/online'), false);

    let reply = await sendTcp(client.port, [sia.build({ account: 'A1B2', data: 'Nri1/CL001', key, seq: 1 })]);
    assert.match(reply, /"\*ACK"0001/);
    assert.equal(store.get('ajax/A1B2/mode'), 'Armed');
    assert.equal(store.get('ajax/A1B2/armed'), true);
    assert.equal(store.get('ajax/A1B2/online'), true);

    await sendTcp(client.port, [sia.build({ account: 'A1B2', data: 'Nri1/BA005', key, seq: 2 })]);
    assert.equal(store.get('ajax/A1B2/alarm'), true);
    assert.equal(store.get('ajax/A1B2/lastEvent'), 'Intrusion alarm · Kuchnia');
    assert.equal(store.get('ajax/A1B2/event').code, 'BA');

    await sendTcp(client.port, [sia.build({ account: 'A1B2', data: 'Nri1/OP001', key, seq: 3 })]);
    assert.equal(store.get('ajax/A1B2/mode'), 'Disarmed');
    assert.equal(store.get('ajax/A1B2/alarm'), false); // disarm silences

    // replayed (old timestamp) → NAK, no state change
    reply = await sendTcp(client.port, [sia.build({ account: 'A1B2', data: 'Nri1/CL001', key, seq: 4, time: '_10:00:00,01-01-2020' })]);
    assert.match(reply, /"NAK"/);
    assert.equal(store.get('ajax/A1B2/armed'), false);
    // unencrypted while a key is set → NAK
    reply = await sendTcp(client.port, [sia.build({ account: 'A1B2', data: 'Nri1/CL001', seq: 5 })]);
    assert.match(reply, /"NAK"/);
    // unknown account → NAK
    reply = await sendTcp(client.port, [sia.build({ account: 'FFFF', data: 'Nri1/CL001', seq: 6 })]);
    assert.match(reply, /"NAK"/);
  } finally {
    client.stop();
  }
});

test('Ajax: unencrypted SIA and Contact ID over UDP, link test keeps it online', async () => {
  const { store, client } = setup([{ account: '1234' }]);
  await client.start();
  const udp = dgram.createSocket('udp4');
  const send = (f) => new Promise((resolve) => { udp.once('message', (m) => resolve(m.toString('latin1'))); udp.send(f, client.port, '127.0.0.1'); });
  try {
    assert.match(await send(sia.build({ id: 'NULL', account: '1234', data: '' })), /"ACK"/);
    assert.equal(store.get('ajax/1234/online'), true);
    await send(sia.build({ account: '1234', data: 'Nri1/NL002' }));
    assert.equal(store.get('ajax/1234/mode'), 'Night');
    await send(sia.build({ id: 'ADM-CID', account: '1234', data: '1154 01 007' }));
    assert.equal(store.get('ajax/1234/water'), true);
    await send(sia.build({ id: 'ADM-CID', account: '1234', data: '3154 01 007' }));
    assert.equal(store.get('ajax/1234/water'), false);
  } finally {
    udp.close();
    client.stop();
  }
});
