'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const can = require('../src/lsh-can-scan');

// Frames built by hand from the protocol specs (no captured bus traffic).
const f = (t, id, ext, hex) => ({ t, id, ext, fd: false, remote: false, data: Buffer.from(hex, 'hex') })
const j1939Id = (prio, pgn, sa) => ((prio << 26) | (pgn << 8) | sa) >>> 0

test('candump -L and SLCAN lines parse', () => {
  const a = can.parseCandumpLine('(1700000000.123456) can0 18FF50E5#0102030405060708')
  assert.equal(a.id, 0x18ff50e5); assert.equal(a.ext, true); assert.equal(a.data.toString('hex'), '0102030405060708'); assert.equal(a.t, 1700000000123)
  const b = can.parseCandumpLine('(1700000000.200000) can1 356#2C0B0A00DC00')
  assert.equal(b.id, 0x356); assert.equal(b.ext, false); assert.equal(b.data.length, 6)
  const fd = can.parseCandumpLine('(1.000000) can2 123##1AABBCCDD')
  assert.equal(fd.fd, true); assert.equal(fd.data.toString('hex'), 'aabbccdd')
  assert.equal(can.parseCandumpLine('(1.0) can0 7FF#R').remote, true)
  assert.equal(can.parseCandumpLine('garbage'), null)
  const s = can.parseSlcan('T18FF50E53010203', 5)
  assert.equal(s.id, 0x18ff50e5); assert.equal(s.data.toString('hex'), '010203')
  assert.equal(can.parseSlcan('t1232AABB', 5).id, 0x123)
})

test('J1939 id → PGN / source address', () => {
  assert.deepEqual(can.j1939Parts(j1939Id(6, 127508, 0x23)), { prio: 6, pgn: 127508, sa: 0x23, da: 255 })
  const pdu1 = can.j1939Parts(((6 << 26) | (0xea << 16) | (0x17 << 8) | 0x05) >>> 0) // ISO request to 0x17
  assert.equal(pdu1.pgn, 59904); assert.equal(pdu1.da, 0x17); assert.equal(pdu1.sa, 5)
})

test('Battery BMS protocol (Pylontech style) is recognised and decoded', () => {
  const frames = []
  for (let i = 0; i < 10; i++) {
    frames.push(f(i * 1000, 0x351, false, '8002e803e8031c02')) // 64.0 V, 100.0 A, 100.0 A, 54.0 V
    frames.push(f(i * 1000 + 1, 0x355, false, '55006300')) // 85 %, 99 %
    frames.push(f(i * 1000 + 2, 0x356, false, '2c15f6ff fa00'.replace(' ', ''))) // 54.20 V, -1.0 A, 25.0 °C
    frames.push(f(i * 1000 + 3, 0x35e, false, Buffer.from('PYLON   ').toString('hex')))
  }
  const r = can.analyze(frames, { seconds: 10, bitrate: 500000 })
  assert.equal(r.protocol, 'bms')
  const get = (label) => r.highlights.find((h) => h.label === label)?.value
  assert.equal(get('State of charge'), 85)
  assert.equal(get('Battery voltage'), 54.2)
  assert.equal(get('Battery current'), -1)
  assert.equal(get('Battery temperature'), 25)
  assert.equal(get('Charge voltage limit'), 64)
  assert.equal(get('Manufacturer'), 'PYLON')
  assert.equal(r.idCount, 4)
  assert.ok(r.busLoad > 0 && r.busLoad < 5)
})

test('NMEA 2000: battery status decoded, Victron found from its address claim', () => {
  const sa = 0x23
  // Address claim NAME: manufacturer 358 (Victron) in bits 21..31 of the low word
  const lo = (358 << 21) | 12345, hi = (35 << 8) | (2 << 28)
  const name = Buffer.alloc(8); name.writeUInt32LE(lo >>> 0, 0); name.writeUInt32LE(hi >>> 0, 4)
  // 127508: instance 0, 13.25 V, -2.5 A, 298.15 K
  const bat = Buffer.alloc(8, 0xff); bat[0] = 0; bat.writeUInt16LE(1325, 1); bat.writeInt16LE(-25, 3); bat.writeUInt16LE(29815, 5)
  const frames = []
  for (let i = 0; i < 20; i++) frames.push(f(i * 500, j1939Id(6, 127508, sa), true, bat.toString('hex')))
  frames.push(f(100, j1939Id(6, 60928, sa) & ~0xff00 | 0xff00, true, name.toString('hex')))
  const r = can.analyze(frames, { seconds: 10, bitrate: 250000 })
  assert.equal(r.protocol, 'nmea2000')
  const row = r.ids.find((x) => x.pgn === 127508)
  assert.equal(row.name, 'Battery Status')
  assert.equal(row.rate, 2)
  const v = Object.fromEntries(row.decoded.map((d) => [d.label, d.value]))
  assert.equal(v.Voltage, 13.25); assert.equal(v.Current, -2.5); assert.equal(v.Temperature, 25)
  const node = r.nodes.find((n) => n.address === sa)
  assert.equal(node.name.manufacturer, 'Victron Energy')
})

test('CANopen heartbeats, changing bytes and an empty bus', () => {
  const frames = []
  for (let i = 0; i < 5; i++) {
    frames.push(f(i * 1000, 0x705, false, '05'))
    frames.push(f(i * 1000 + 5, 0x185, false, `00${i.toString(16).padStart(2, '0')}0000`))
  }
  const r = can.analyze(frames, { seconds: 5, bitrate: 125000 })
  assert.equal(r.protocol, 'canopen')
  assert.equal(r.ids.find((x) => x.id === 0x705).decoded[0].value, 'Operational')
  assert.equal(r.ids.find((x) => x.id === 0x185).name, 'TPDO1 · node 5')
  assert.equal(r.ids.find((x) => x.id === 0x185).changedMask, 0b10)
  const empty = can.analyze([], { seconds: 5, bitrate: 250000 })
  assert.equal(empty.frames, 0); assert.equal(empty.protocolLabel, 'No traffic')
})
