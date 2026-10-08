'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// The wiring emulator's engine is an ES module in the React app. Its texts
// follow the dashboard language (localStorage 'lsh-lang'); tests pin it.
let LANG = 'en'
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => LANG, setItem: () => {} } })
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
      for (const [a, b] of s.wires) for (const p of [a, b]) if (p.startsWith('dev:') && s.terminals) assert.ok(s.terminals.includes(p.slice(4)), `${d.id}/${s.id}: ${p} not shown in this diagram`)
      assert.ok(sim.check(d, s, s.wires).ok, `${d.id}/${s.id}: reference fails its own check`)
      const r = sim.simulate(d, s, s.wires, {}, sim.initialState(d, s))
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

test('wall-box plan: connectors where one mains conductor feeds several wires', async () => {
  const { sim, DEVICES, dev } = await load()
  for (const d of DEVICES.filter((x) => x.enclosure !== 'din')) {
    for (const s of d.scenarios) {
      const plan = sim.wallBoxPlan(d, s)
      // electrically identical to the manual's diagram…
      assert.ok(sim.check(d, s, plan.wires, plan.parts).ok, `${d.id}/${s.id}`)
      const r = sim.simulate(d, s, plan.wires, {}, sim.initialState(d), plan.parts, { realBox: true })
      assert.equal(r.powered, true, `${d.id}/${s.id}`)
      // …and nothing left that a real box can't do
      assert.deepEqual(r.findings.filter((f) => f.level !== 'info' && !/earth \(PE\) not connected/.test(f.text)), [], `${d.id}/${s.id}: ${JSON.stringify(r.findings)}`)
    }
  }
  const p = sim.wallBoxPlan(dev('fibaro-fgs223'), dev('fibaro-fgs223').scenarios.find((x) => x.id === 'double'))
  const live = p.parts.find((x) => x.label === 'Live (L)'), neu = p.parts.find((x) => x.label === 'Neutral (N)')
  assert.equal(live.model, 'WAGO 221-413') // incoming L + module L + switch
  assert.equal(neu.model, 'WAGO 2273-204') // incoming N + module N + 2 lamps
})

test('connectors: user-placed WAGO joins wires; one conductor per port; colours checked', async () => {
  const { sim, dev } = await load()
  const d = dev('shelly-wave-1pm'), s = d.scenarios[0]
  const wg = [{ id: 'u1', kind: 'wago', poles: 3, model: 'WAGO 221-413', label: 'L' }]
  const wires = [['L', 'u1:p1', { color: 'brown' }], ['u1:p2', 'dev:L', { color: 'brown' }], ['u1:p3', 'sw1:com', { color: 'brown' }],
    ['sw1:o1', 'dev:SW', { color: 'black' }], ['dev:O', 'lamp1:a', { color: 'black' }], ['lamp1:b', 'N', { color: 'brown' }], ['N', 'dev:N', { color: 'blue' }]]
  assert.ok(sim.check(d, s, wires, wg).ok)
  const r = sim.simulate(d, s, wires, { sw1: [true] }, sim.initialState(d), wg)
  assert.equal(r.lamps.lamp1, 1)
  assert.ok(r.findings.some((f) => /Neutral should be blue/.test(f.text)))
  const doubled = [...wires, ['u1:p3', 'dev:L']]
  assert.ok(sim.conductorFindings(d, s, doubled, wg).some((f) => /one conductor per connector port/.test(f.text)))
})

test('translations: every phrase the emulator shows has all languages and matching placeholders', async () => {
  const { DEVICES } = await load()
  const { PHRASES } = await import('../react-dashboard/src/components/settings/wiring/i18n-dict.js')
  const { CONNECTORS, WIRE_COLORS } = await import('../react-dashboard/src/components/settings/wiring/devices.js')
  const fs = require('fs')
  const dir = require('path').join(__dirname, '../react-dashboard/src/components/settings/')
  const used = new Set()
  for (const f of ['wiring/sim.js', 'wiring/devices.js', 'wiring/WiringCanvas.jsx', 'wiring/WiringInfo.jsx', 'sections/WiringSection.jsx']) {
    const src = fs.readFileSync(dir + f, 'utf8')
    for (const m of src.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) used.add(m[1])
    if (f.endsWith('WiringInfo.jsx')) for (const m of src.matchAll(/text: '((?:[^'\\]|\\.)*)'/g)) used.add(m[1])
  }
  for (const d of DEVICES) {
    for (const s of d.scenarios) { used.add(s.title); s.parts.forEach((p) => used.add(p.label)) }
    d.terminals.forEach((x) => used.add(x.desc)); d.rules.forEach((r) => used.add(r)); (d.channels || []).forEach((c) => used.add(c.label)); (d.tools || []).forEach((x) => used.add(x.text))
    for (const [k, v] of d.specs) { used.add(k); if (/[a-z]{2}/i.test(v)) used.add(v) }
  }
  CONNECTORS.forEach((c) => { used.add(c.spec); if (c.note) used.add(c.note) })
  WIRE_COLORS.forEach((c) => used.add(c.label))
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join()
  const missing = [...used].filter((k) => !PHRASES[k])
  assert.deepEqual(missing, [], 'phrases without translations')
  for (const [k, v] of Object.entries(PHRASES)) {
    assert.equal(v.length, 6, `${k}: needs pl, de, fr, es, it, uk`)
    v.forEach((s, i) => assert.equal(ph(s), ph(k), `${k} [${i}]: placeholders differ`))
  }
})

test('translations: findings and steps follow the dashboard language', async () => {
  const { sim, dev } = await load()
  const d = dev('fibaro-fgs213'), s = d.scenarios[0]
  try {
    LANG = 'pl'
    assert.match(sim.simulate(d, s, [['L', 'N']], {}, sim.initialState(d)).short, /^Zwarcie/)
    assert.match(sim.steps(d, s)[0].text, /^Połącz: faza sieci \(L\) ↔ zacisk L$/)
    LANG = 'de'
    assert.match(sim.steps(d, s)[0].text, /^Verbinde Netz-Außenleiter \(L\) mit Klemme L$/)
  } finally { LANG = 'en' }
})

test('SmartBob SM-LITE-1616R: 24 V inputs, potential-free relays, blind pair, contactor', async () => {
  const { sim, dev } = await load()
  const d = dev('smartbob-sm-lite-1616r')
  const sc = (id) => d.scenarios.find((x) => x.id === id)
  const press = (s, sw, held) => { let st = sim.initialState(d, s); st = sim.simulate(d, s, s.wires, {}, st).state; return sim.simulate(d, s, s.wires, { sw1: held }, st) }
  // Option 1: button to 0 V lights the lamp; the same button to +24 V does nothing
  assert.equal(press(sc('light'), 'sw1', [true]).lamps.lamp1, 1)
  const wrongRef = sc('light').wires.map(([a, b]) => (a === 'psu1:minus' && b === 'sw1:com' ? ['psu1:plus', 'sw1:com'] : [a, b]))
  let st = sim.initialState(d, sc('light'))
  st = sim.simulate(d, sc('light'), wrongRef, {}, st).state
  assert.equal(sim.simulate(d, sc('light'), wrongRef, { sw1: [true] }, st).lamps.lamp1, 0)
  // Option 2 diagram: +24 V is the active level
  assert.equal(press(sc('light-opt2'), 'sw1', [true]).lamps.lamp1, 1)
  // Relay contacts are potential-free: without a feed on COM nothing lights
  const noFeed = sc('light').wires.filter(([a, b]) => !(a === 'cb1:out' && b === 'dev:C1'))
  st = sim.initialState(d, sc('light')); st = sim.simulate(d, sc('light'), noFeed, {}, st).state
  assert.equal(sim.simulate(d, sc('light'), noFeed, { sw1: [true] }, st).lamps.lamp1, 0)
  // Blind pair: up, then down, never both
  assert.equal(press(sc('blind'), 'sw1', [true, false]).motors.m1, 'up')
  // Contactor pulls in and switches the heater
  const r = press(sc('contactor'), 'sw1', [true])
  assert.equal(r.contactors.km1, true); assert.equal(r.lamps.load1, 1)
  // Dangers: 230 V on an input, DC short, reversed supply
  const mainsIn = [...sc('light').wires, ['L', 'dev:IN1']]
  assert.ok(sim.simulate(d, sc('light'), mainsIn, {}, sim.initialState(d)).findings.some((f) => /230 V on 24 V input/.test(f.text)))
  assert.match(sim.simulate(d, sc('light'), [...sc('light').wires, ['psu1:plus', 'psu1:minus']], {}, sim.initialState(d)).short, /24 V DC supply shorted/)
  const reversed = sc('light').wires.map(([a, b]) => [a === 'psu1:plus' ? 'psu1:minus' : a === 'psu1:minus' ? 'psu1:plus' : a, b]).filter(([a, b]) => !(b === 'sw1:com'))
  const rr = sim.simulate(d, sc('light'), reversed, {}, sim.initialState(d))
  assert.equal(rr.powered, false); assert.ok(rr.findings.some((f) => /polarity reversed/.test(f.text)))
  // NC contact is closed while relay 2 is off
  const ncWires = [...sc('light').wires, ['cb1:out', 'dev:C2'], ['dev:NC2', 'N']]
  assert.match(sim.simulate(d, sc('light'), ncWires, {}, sim.initialState(d)).short, /Short circuit/)
})

test('SmartBob 1-Wire: DS18B20 sensors on the bus, reversed sensor, high voltage on the interface', async () => {
  const { sim, dev } = await load()
  const d = dev('smartbob-sm-lite-1616r'), s = d.scenarios.find((x) => x.id === 'ds18b20')
  const run = (w) => sim.simulate(d, s, w, {}, sim.initialState(d, s))
  assert.deepEqual(run(s.wires).sensors, { ds1: { online: true }, ds2: { online: true } })
  // one sensor's data wire missing → that sensor offline, the other still reads
  assert.deepEqual(run(s.wires.filter(([a, b]) => b !== 'ds2:dq')).sensors, { ds1: { online: true }, ds2: { online: false } })
  // supply/ground swapped on #2 → danger, offline
  const rev = s.wires.map(([a, b, m]) => [a === 'dev:X1' && b === 'ds2:vdd' ? 'dev:X5' : a === 'dev:X5' && b === 'ds2:gnd' ? 'dev:X1' : a, b, m])
  const r = run(rev)
  assert.equal(r.sensors.ds2.online, false)
  assert.ok(r.findings.some((f) => /wrong way round/.test(f.text)))
  // data shorted to ground → whole bus down
  assert.deepEqual(run([...s.wires, ['dev:X4', 'dev:G']]).sensors, { ds1: { online: false }, ds2: { online: false } })
  // 24 V on the data pin
  assert.ok(run([...s.wires, ['psu1:plus', 'dev:X4']]).findings.some((f) => /24 V on interface pin/.test(f.text)))
  // controller off → no readings
  assert.equal(run(s.wires.filter(([a]) => a !== 'psu1:plus')).sensors.ds1.online, false)
})
