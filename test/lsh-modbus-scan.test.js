'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const mb = require('../src/lsh-modbus-scan');
const { createServer } = require('../scripts/modbus-simulator');

// Runs the scanner against scripts/modbus-simulator.js over real TCP.
test('Modbus scan: units found and identified on a simulated server', async () => {
  const srv = createServer()
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port
  try {
    const r = await mb.scan({ mode: 'tcp', hosts: ['127.0.0.1'], port, units: '1-3,100,7', timeout: 300 })
    const by = Object.fromEntries(r.devices.map((d) => [d.unit, d]))
    assert.deepEqual(Object.keys(by).map(Number).sort((a, b) => a - b), [1, 2, 3, 100])
    assert.equal(by[1].kind, 'sunspec')
    assert.equal(by[1].details.sunspec.manufacturer, 'Fronius')
    assert.equal(by[1].details.sunspec.serial, '31234567')
    assert.deepEqual(by[1].details.sunspec.models, [1, 103])
    assert.equal(by[1].details.deviceId.vendor, 'Fronius')
    assert.equal(by[2].kind, 'energy-meter')
    assert.equal(by[2].values.find((v) => v.label === 'Voltage L1').value, 231.4)
    assert.equal(by[2].values.find((v) => v.label === 'Total energy').value, 15234.7)
    assert.equal(by[3].kind, 'unknown')
    assert.equal(by[3].probe.exception, 2)
    assert.equal(by[100].kind, 'victron-gx')
    const v = Object.fromEntries(by[100].values.map((x) => [x.label, x.value]))
    assert.equal(v['Battery voltage'], 53.2); assert.equal(v['Battery current'], -12.3); assert.equal(v['State of charge'], 87)

    const rr = await mb.readRange({ mode: 'tcp', host: '127.0.0.1', port, unit: 2, fc: 4, address: 0, count: 2 })
    assert.equal(rr.values[0].f32, 231.4)
    await assert.rejects(() => mb.readRange({ mode: 'tcp', host: '127.0.0.1', port, unit: 3, fc: 3, address: 0, count: 1 }), /exception 2/)
  } finally { srv.close() }
})

test('Modbus helpers: CRC, unit ranges, register interpretation', () => {
  // Classic example: 01 03 00 00 00 0A → CRC C5CD (bytes CD C5)
  assert.equal(mb.crc16(Buffer.from('01030000000a', 'hex')), 0xcdc5)
  assert.deepEqual(mb.parseUnits('1-3, 100,7', []), [1, 2, 3, 100, 7])
  assert.deepEqual(mb.parseUnits('', [9]), [9])
  const i = mb.interpret([0x4367, 0x6666, 0xffff])
  assert.equal(i[0].f32, 231.4); assert.equal(i[2].i16, -1); assert.equal(i[0].ascii, 'Cg')
})
