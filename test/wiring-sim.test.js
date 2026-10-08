'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// The wiring emulator's engine is an ES module in the React app.
const load = async () => {
  const sim = await import('../react-dashboard/src/components/settings/wiring/sim.js')
  const { DEVICES } = await import('../react-dashboard/src/components/settings/wiring/devices.js')
  const dev = (id) => DEVICES.find((d) => d.id === id)
  return { sim, DEVICES, dev }
}

test('every manual diagram is a valid, self-consistent wiring', async () => {
  const { sim, DEVICES } = await load()
  for (const d of DEVICES) {
    for (const s of d.scenarios) {
      const ports = new Set(sim.allPorts(d, s))
      for (const [a, b] of s.wires) assert.ok(ports.has(a) && ports.has(b), `${d.id}/${s.id}: unknown port in ${a}–${b}`)
      assert.ok(sim.check(d, s, s.wires).ok, `${d.id}/${s.id}: reference fails its own check`)
      const r = sim.simulate(d, s, s.wires, {}, sim.initialState(d))
      assert.equal(r.short, null, `${d.id}/${s.id}: ${r.short}`)
      assert.equal(r.powered, true, `${d.id}/${s.id}: not powered — ${JSON.stringify(r.findings)}`)
      assert.deepEqual(r.findings.filter((f) => f.level === 'danger'), [], `${d.id}/${s.id}`)
    }
  }
})

test('relay: momentary press toggles the light, toggle switch follows', async () => {
  const { sim, dev } = await load()
  const d = dev('fibaro-fgs213'), s = d.scenarios[0]
  let st = sim.initialState(d)
  const run = (closed) => { const r = sim.simulate(d, s, s.wires, { sw1: [closed] }, st); st = r.state; return r }
  assert.equal(run(false).lamps.lamp1, 0)
  assert.equal(run(true).lamps.lamp1, 1) // press → on
  assert.equal(run(false).lamps.lamp1, 1) // release → stays on
  assert.equal(run(true).lamps.lamp1, 0) // press → off
  const w = dev('shelly-wave-1pm'), ws = w.scenarios.find((x) => x.inputMode === 'toggle')
  st = sim.initialState(w)
  const r1 = sim.simulate(w, ws, ws.wires, { sw1: [true] }, st)
  assert.equal(r1.lamps.lamp1, 1)
  const r2 = sim.simulate(w, ws, ws.wires, { sw1: [false] }, r1.state)
  assert.equal(r2.lamps.lamp1, 0)
})

test('2-gang: each key drives its own channel', async () => {
  const { sim, dev } = await load()
  const d = dev('fibaro-fgs223'), s = d.scenarios.find((x) => x.id === 'double')
  let r = sim.simulate(d, s, s.wires, { sw1: [false, true] }, sim.initialState(d))
  assert.deepEqual([r.lamps.lamp1, r.lamps.lamp2], [0, 1])
})

test('dimmer: 2-wire powers through the load, switch fed from Sx, level applies', async () => {
  const { sim, dev } = await load()
  const d = dev('fibaro-fgd212'), s = d.scenarios.find((x) => x.id === '2wire')
  let r = sim.simulate(d, s, s.wires, { sw1: [true] }, { ...sim.initialState(d), level: 40 })
  assert.equal(r.twoWire, true)
  assert.equal(r.lamps.lamp1, 0.4)
  // Feeding the switch from L instead of Sx is flagged and doesn't work
  const wrong = s.wires.map(([a, b]) => (a === 'dev:Sx' && b === 'sw1:com' ? ['L', 'sw1:com'] : [a, b]))
  r = sim.simulate(d, s, wrong, { sw1: [true] }, sim.initialState(d))
  assert.equal(r.lamps.lamp1, 0)
  assert.ok(!sim.check(d, s, wrong).ok)
})

test('shutter: momentary up/stop/down, motor direction, never both', async () => {
  const { sim, dev } = await load()
  const d = dev('fibaro-fgr223'), s = d.scenarios[0]
  let st = sim.initialState(d)
  const run = (sw) => { const r = sim.simulate(d, s, s.wires, { sw1: sw }, st); st = r.state; return r }
  assert.equal(run([true, false]).motors.m1, 'up')
  run([false, false])
  assert.equal(run([true, false]).motors.m1, null) // second press stops
  run([false, false])
  assert.equal(run([false, true]).motors.m1, 'down')
})

test('dangerous wiring: short circuit, live on N, output to neutral', async () => {
  const { sim, dev } = await load()
  const d = dev('fibaro-fgs213'), s = d.scenarios[0]
  assert.match(sim.simulate(d, s, [['L', 'N']], {}, sim.initialState(d)).short, /Short circuit/)
  // Lamp bypassed: Q straight to N → short only when the relay closes
  const qToN = [['L', 'dev:L2'], ['dev:L1', 'sw1:com'], ['sw1:o1', 'dev:S1'], ['dev:Q', 'N'], ['N', 'dev:N']]
  const r0 = sim.simulate(d, s, qToN, {}, sim.initialState(d))
  assert.ok(r0.findings.some((f) => /connected to neutral/.test(f.text)))
  assert.match(sim.simulate(d, s, qToN, { sw1: [true] }, r0.state).short, /Short circuit/)
  // L and N swapped on the module
  const swapped = s.wires.map(([a, b]) => [a === 'N' ? 'L' : a === 'L' ? 'N' : a, b])
  const r = sim.simulate(d, s, swapped, {}, sim.initialState(d))
  assert.equal(r.powered, false)
  // Checker names the mistakes
  const c = sim.check(d, s, s.wires.filter(([a]) => a !== 'N'))
  assert.equal(c.ok, false)
  assert.ok(c.missing.length >= 1)
})
