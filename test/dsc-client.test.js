'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const DscClient = require('../src/dsc-client');
const fixture = require('./fixtures/dsc-itv2-transcript.json');

// Plays the reference panel transcript at a real DscClient over TCP and
// checks the resulting LSH store values and registered devices.
test('DSC client: panel dials in, handshake completes, state lands in the store', async () => {
  const t = fixture.transcripts[0]
  const values = {}
  const store = { update: (k, v) => { values[k] = v }, set: (k, v) => { values[k] = v } }
  const devices = new Map()
  const registry = { registerDevice: (d) => { if (!devices.has(d.key)) devices.set(d.key, d) } }
  const random = Buffer.from(t.random_calls[1], 'hex')
  const client = new DscClient({ dsc: { port: 0, bindHost: '127.0.0.1', type2Key: t.type2_key, userCode: '1234' } }, store, registry, { random: () => random })
  await client.start()

  const sock = net.connect(client.port, '127.0.0.1')
  const received = []
  sock.on('data', (d) => received.push(d))
  await new Promise((r) => sock.once('connect', r))
  const settle = () => new Promise((r) => setTimeout(r, 30))
  for (const step of t.steps) { sock.write(Buffer.from(step.in, 'hex')); await settle() }

  // The client answered the handshake with exactly the reference bytes
  const expected = t.steps.flatMap((s) => s.out).join('')
  assert.equal(Buffer.concat(received).toString('hex').slice(0, expected.length), expected)

  assert.equal(client.panel.connected, true)
  assert.equal(values['dsc/panel/connected'], 1)
  assert.equal(values['dsc/panel/integration_id'], '123456789012')
  assert.equal(values['dsc/zone/2/state'], 1)        // 0x01 open
  assert.equal(values['dsc/zone/3/bypass'], 1)       // 0x81
  assert.equal(values['dsc/zone/3/state'], 1)        // lifestyle open
  assert.equal(values['dsc/zone/4/alarm'], 1)        // 0x22 → tamper + alarm
  assert.equal(values['dsc/zone/4/tamper'], 1)
  assert.equal(values['dsc/partition/1/armed'], 1)
  assert.equal(values['dsc/partition/1/mode'], 'away')
  assert.equal(values['dsc/partition/1/exit_delay'], 1)
  assert.equal(values['dsc/partition/1/trouble'], 1)
  assert.equal(values['dsc/panel/time'], '2026-10-08 12:34')
  assert.equal(client.maxZones, 32)
  assert.equal(client.zones.get(1).label, 'Front door')
  assert.ok(devices.has('dsc/partition/1'))
  assert.ok(devices.has('dsc/zone/4'))

  // A panel-bound arm command goes out encrypted on the live socket
  const before = Buffer.concat(received).length
  client.arm(1, 'away').catch(() => {})
  await settle()
  assert.ok(Buffer.concat(received).length > before)
  await assert.rejects(() => client.arm(1, 'party'), /Unknown arm mode/)

  sock.destroy()
  await settle()
  assert.equal(values['dsc/panel/connected'], 0)
  client.stop()
})

test('DSC client: zone HomeKit type from config or label', () => {
  const c = new DscClient({ dsc: { zoneTypes: { 7: 'none', 8: 'contact' } } }, {}, {})
  assert.equal(c._zoneHomekit(1, 'Salon PIR'), 'motion')
  assert.equal(c._zoneHomekit(2, 'Front door'), 'contact')
  assert.equal(c._zoneHomekit(7, 'Hall PIR'), null)
  assert.equal(c._zoneHomekit(8, 'Kitchen'), 'contact')
  assert.equal(c._zoneWorthShowing(9, { label: 'Zone 09' }), false)
  assert.equal(c._zoneWorthShowing(9, { label: 'Zone 09', open: true }), true)
})
