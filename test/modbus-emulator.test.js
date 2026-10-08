'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ModbusEmulator = require('../src/modbus-emulator');
const scan = require('../src/lsh-modbus-scan');

// The emulator is queried with LSH's own Modbus scanner client over real TCP.
function fakeStore(init = {}) {
  const data = {}
  for (const [k, v] of Object.entries(init)) data[k] = { value: v, ts: 1 }
  return {
    data,
    get: (k) => data[k]?.value ?? null,
    getTimestamp: (k) => data[k]?.ts ?? null,
    update(k, v) { data[k] = { value: v, ts: Date.now() } },
  }
}

test('Modbus emulator serves store values, templates and guarded writes over TCP', async () => {
  const store = fakeStore({ 'shelly/em/power': 1834.5, 'shelly/em/voltage': 231.4, 'victron/battery/soc': 87.4, 'victron/battery/current': -12.3 })
  const commands = []
  const registry = { sendCommand: async (d, s, v) => { commands.push([d, s, v]) } }
  const tpl = ModbusEmulator.TEMPLATES.sdm630.registers.map((r) => ({ ...r }))
  tpl.find((r) => r.address === 0).source = 'shelly/em/voltage'
  tpl.find((r) => r.address === 52).source = 'shelly/em/power'
  const config = { modbusEmu: { enabled: true, devices: [
    { id: 'meter', name: 'Grid meter', transport: 'tcp', port: 0, bindHost: '127.0.0.1', unitId: 1, registers: tpl },
    { id: 'plc', name: 'LSH to PLC', transport: 'tcp', port: 0, bindHost: '127.0.0.1', unitId: 7, strict: true, registers: [
      { table: 'holding', address: 100, type: 'u16', source: 'victron/battery/soc', scale: 1 },
      { table: 'holding', address: 101, type: 'i16', source: 'victron/battery/current', scale: 10 },
      { table: 'holding', address: 102, type: 'u32', value: 70000, wordOrder: 'le' },
      { table: 'holding', address: 110, type: 'string', length: 4, value: 'LSH!' },
      { table: 'holding', address: 200, type: 'u16', value: 0, scale: 10, writable: true, command: 'shelly/relay/target' },
      { table: 'coil', address: 0, type: 'bool', value: true },
      { table: 'coil', address: 1, type: 'bool', value: false, writable: true },
    ] },
  ] } }
  const emu = new ModbusEmulator(config, store, registry)
  await emu.start()
  const [meter, plc] = emu.running.map((r) => r.transport.port)
  const m = scan.tcpClient('127.0.0.1', meter, { timeout: 800 })
  const p = scan.tcpClient('127.0.0.1', plc, { timeout: 800 })
  try {
    // LSH's scanner recognises its own emulated SDM630
    const id = await scan.identify(m, 1)
    assert.equal(id.kind, 'device-id') // FC 0x2B answered…
    const meterVals = await scan.read(m, 1, 4, 52, 2)
    assert.equal(scan.interpret(meterVals)[0].f32, 1834.5)
    const em = await scan.identify(m, 1).catch(() => null)
    assert.ok(em)
    assert.equal((await scan.read(m, 1, 4, 0, 2)).length, 2)
    assert.equal(scan.interpret(await scan.read(m, 1, 4, 0, 2))[0].f32, 231.4)

    // Typed registers, scale, word order, strings, coils
    const regs = await scan.read(p, 7, 3, 100, 4)
    assert.equal(regs[0], 87) // rounded
    assert.equal(regs[1], (-123) & 0xffff) // -12.3 × 10
    assert.equal(regs[3] * 65536 + regs[2], 70000) // little-endian word order
    assert.equal(Buffer.from((await scan.read(p, 7, 3, 110, 2)).flatMap((w) => [w >> 8, w & 0xff])).toString(), 'LSH!')
    assert.deepEqual(await scan.read(p, 7, 1, 0, 2), [1, 0])
    // strict: unmapped register → exception 2; wrong unit → no reply
    await assert.rejects(() => scan.read(p, 7, 3, 150, 1), /exception 2/)
    await assert.rejects(() => scan.read(p, 9, 3, 100, 1), /timeout/)

    // Writes: read-only register refused, writable one stored + forwarded
    const fc6 = (addr, v) => { const b = Buffer.alloc(5); b[0] = 6; b.writeUInt16BE(addr, 1); b.writeUInt16BE(v, 3); return b }
    assert.equal((await p.request(7, fc6(100, 5)))[0], 0x86)
    assert.equal((await p.request(7, fc6(200, 215)))[0], 6)
    assert.equal(store.get('modbus-emu/plc/holding/200'), 21.5)
    assert.deepEqual(commands, [['shelly/relay', 'target', 21.5]])
    assert.equal((await scan.read(p, 7, 3, 200, 1))[0], 215)
    assert.equal((await p.request(7, Buffer.from([5, 0, 1, 0xff, 0])))[0], 5) // write coil 1 on
    assert.deepEqual(await scan.read(p, 7, 1, 0, 2), [1, 1])

    const st = emu.getStatus()
    assert.equal(st.length, 2)
    assert.ok(st[1].stats.requests >= 8)
    assert.equal(st[1].stats.writes, 2)
  } finally {
    m.close(); p.close()
    await emu.stop()
  }
})

test('Modbus emulator encode/decode round-trips', () => {
  for (const [r, v] of [[{ type: 'f32' }, 50.01], [{ type: 'i32', scale: 100 }, -1234.56], [{ type: 'u32', wordOrder: 'le' }, 123456], [{ type: 'i16', scale: 10 }, -3.2]]) {
    const back = ModbusEmulator.decode(r, ModbusEmulator.encode(r, v))
    assert.ok(Math.abs(back - v) < 1e-3, `${r.type}: ${back} vs ${v}`)
  }
  assert.deepEqual(ModbusEmulator.encode({ type: 'u16' }, 99999), [65535])
})
