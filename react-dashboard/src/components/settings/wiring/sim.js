// Circuit simulation for the wiring emulator — pure functions, no React.
// Model: every port is a node; wires, closed switch contacts, internal device
// bridges and closed relay/dimmer outputs are zero-ohm links merged into
// nets (union-find). Loads (lamps, motor windings) sit between nets. Mains L
// and N (and PE) are the sources. Tested in test/wiring-sim.test.js.

import { portsOf, connectorFor, CONNECTORS } from './devices.js'
import { t } from './i18n.js'

class UF {
  constructor() { this.p = new Map() }
  find(x) {
    if (!this.p.has(x)) this.p.set(x, x)
    let r = x
    while (this.p.get(r) !== r) r = this.p.get(r)
    while (this.p.get(x) !== r) { const n = this.p.get(x); this.p.set(x, r); x = n }
    return r
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb) }
}

// Every port of a scenario (for checking and for the UI)
// extras: parts added by the user or the wall-box plan (connectors)
export function allPorts(device, scenario, extras = []) {
  const ports = ['L', 'N']
  if (usesPE(scenario)) ports.push('PE')
  for (const t of device.terminals) ports.push(`dev:${t.id}`)
  for (const p of [...scenario.parts, ...extras]) for (const q of portsOf(p)) ports.push(`${p.id}:${q}`)
  return ports
}

const joinConnectors = (uf, extras) => {
  for (const p of extras) if (p.kind === 'wago') for (let i = 2; i <= p.poles; i++) uf.union(`${p.id}:p1`, `${p.id}:p${i}`)
}

export const usesPE = (scenario) => scenario.parts.some((p) => p.kind === 'motor' || p.kind === 'motorDriver')

// Initial device state for a scenario
export function initialState(device) {
  return {
    channels: Object.fromEntries((device.channels || []).map((c) => [c.id, false])),
    level: 100,
    shutter: device.shutter ? { dir: null } : null,
    prevInputs: {},
  }
}

function buildNets(device, scenario, wires, switches, state, powered, extras = []) {
  const uf = new UF()
  for (const port of allPorts(device, scenario, extras)) uf.find(port)
  for (const [a, b] of wires) uf.union(a, b)
  joinConnectors(uf, extras)
  for (const [a, b] of device.bridges || []) uf.union(`dev:${a}`, `dev:${b}`)
  for (const p of scenario.parts) {
    const s = switches[p.id] || []
    if (p.kind === 'switch' && s[0]) uf.union(`${p.id}:com`, `${p.id}:o1`)
    if (p.kind === 'switch2') {
      if (s[0]) uf.union(`${p.id}:com`, `${p.id}:o1`)
      if (s[1]) uf.union(`${p.id}:com`, `${p.id}:o2`)
    }
  }
  // Closed outputs connect to the device's live terminal
  if (powered) {
    const live = `dev:${device.power.L}`
    for (const c of device.channels || []) if (state.channels[c.id]) uf.union(`dev:${c.out}`, live)
    if (device.shutter && state.shutter?.dir) uf.union(`dev:${state.shutter.dir === 'up' ? device.shutter.up : device.shutter.down}`, live)
  }
  return uf
}

// Lamps/windings between two nets: is there a load from netA to netB?
function loadsBetween(scenario, uf, a, b) {
  for (const p of scenario.parts) {
    if (p.kind !== 'lamp') continue
    const x = uf.find(`${p.id}:a`), y = uf.find(`${p.id}:b`)
    if ((x === a && y === b) || (x === b && y === a)) return true
  }
  return false
}

function evaluate(device, scenario, wires, switches, state, extras) {
  // Pass 1 — is the module powered? (outputs open)
  let uf = buildNets(device, scenario, wires, switches, state, false, extras)
  const L = () => uf.find('L'), N = () => uf.find('N')
  const pe = usesPE(scenario)
  const findings = []
  let short = null
  const shortCheck = () => {
    if (uf.find('L') === uf.find('N')) short = t('Short circuit: live is connected straight to neutral — the breaker trips.')
    else if (pe && uf.find('L') === uf.find('PE')) short = t('Earth fault: live is connected to protective earth — the RCD trips.')
  }
  shortCheck()
  if (short) return { short, powered: false, findings }

  const devL = uf.find(`dev:${device.power.L}`), devN = uf.find(`dev:${device.power.N}`)
  const liveOk = devL === L()
  let neutralOk = devN === N()
  let twoWire = false
  if (liveOk && !neutralOk && device.power.twoWire) {
    // 2-wire dimmer: supplied through the load from its output
    if (loadsBetween(scenario, uf, uf.find(`dev:${device.power.twoWire.out}`), N())) { neutralOk = true; twoWire = true }
  }
  if (devN === L()) findings.push({ level: 'danger', text: t('Live is on the module’s {t} terminal — it would be damaged.', { t: labelOf(device, device.power.N) }) })
  if (!liveOk) findings.push({ level: 'info', text: t('No live on terminal {t} — the module is off.', { t: labelOf(device, device.power.L) }) })
  else if (!neutralOk) findings.push({ level: 'info', text: device.power.twoWire ? t('No neutral on N and no load on the output — the module can’t power up.') : t('No neutral on N — the module is off (it needs a neutral).') })
  const powered = liveOk && neutralOk

  // Switch-supply terminal (Sx) checks
  const sxTerm = device.terminals.find((x) => x.role === 'sx')
  if (sxTerm) {
    const sx = uf.find(`dev:${sxTerm.id}`)
    if (sx === L()) findings.push({ level: 'danger', text: t('Sx is connected to live — Sx is the switch supply output, not an input.') })
    if (sx === N() && !twoWire) findings.push({ level: 'danger', text: t('Sx is connected to neutral — the switch supply would be shorted.') })
  }
  for (const c of device.channels || []) {
    if (uf.find(`dev:${c.out}`) === L()) findings.push({ level: 'warn', text: t('{t} is fed from live directly — the load would bypass the module.', { t: labelOf(device, c.out) }) })
    if (uf.find(`dev:${c.out}`) === N()) findings.push({ level: 'danger', text: t('{t} is connected to neutral — switching it on shorts live to neutral.', { t: labelOf(device, c.out) }) })
  }
  if (device.shutter) {
    for (const o of [device.shutter.up, device.shutter.down]) if (uf.find(`dev:${o}`) === N()) findings.push({ level: 'danger', text: t('{t} is connected to neutral — driving the motor shorts live to neutral.', { t: o }) })
  }

  // Inputs
  const inputs = {}
  for (const [term, ref] of Object.entries(device.inputs || {})) {
    const net = uf.find(`dev:${term}`)
    if (ref === 'Sx') inputs[term] = powered && sxTerm && net === uf.find(`dev:${sxTerm.id}`) && net !== N()
    else inputs[term] = powered && net === L()
    if (net === N() && ref === 'L') findings.push({ level: 'warn', text: t('Input {t} is on neutral — the switch must switch live.', { t: labelOf(device, term) }) })
  }
  return { short: null, powered, twoWire, inputs, findings, uf }
}

// Device logic: inputs (edges) → new state
export function stepDevice(device, scenario, state, inputs) {
  const prev = state.prevInputs || {}
  const next = { ...state, channels: { ...state.channels }, shutter: state.shutter ? { ...state.shutter } : null, prevInputs: { ...inputs } }
  const mode = scenario.inputMode || 'momentary'
  for (const c of device.channels || []) {
    const now = !!inputs[c.in], was = !!prev[c.in]
    if (mode === 'momentary' ? now && !was : now !== was) next.channels[c.id] = !next.channels[c.id]
  }
  if (device.shutter) {
    const { inUp, inDown } = device.shutter
    const up = !!inputs[inUp], down = !!inputs[inDown]
    if (mode === 'momentary') {
      if (up && !prev[inUp]) next.shutter.dir = next.shutter.dir ? null : 'up'
      else if (down && !prev[inDown]) next.shutter.dir = next.shutter.dir ? null : 'down'
    } else {
      next.shutter.dir = up && !down ? 'up' : down && !up ? 'down' : null
    }
  }
  return next
}

// Full simulation for one moment: returns what lights, moves, trips.
export function simulate(device, scenario, wires, switches, state, extras = [], opts = {}) {
  const e1 = evaluate(device, scenario, wires, switches, state, extras)
  e1.findings.push(...conductorFindings(device, scenario, wires, extras, opts))
  if (e1.short) return { short: e1.short, powered: false, state, lamps: {}, motors: {}, findings: e1.findings, nets: null }
  const st = e1.powered ? stepDevice(device, scenario, state, e1.inputs) : { ...state, prevInputs: {} }
  const uf = buildNets(device, scenario, wires, switches, st, e1.powered, extras)
  const L = uf.find('L'), N = uf.find('N')
  if (L === N) {
    return { short: t('Short circuit when the output switched on — check what the output is connected to.'), powered: false, state: { ...st, channels: Object.fromEntries(Object.keys(st.channels).map((k) => [k, false])), shutter: st.shutter ? { dir: null } : null }, lamps: {}, motors: {}, findings: e1.findings, nets: null }
  }
  const lamps = {}
  const dimmed = (device.channels || []).filter((c) => c.dimmer && st.channels[c.id]).map((c) => uf.find(`dev:${c.out}`))
  for (const p of scenario.parts.filter((x) => x.kind === 'lamp')) {
    const a = uf.find(`${p.id}:a`), b = uf.find(`${p.id}:b`)
    const lit = (a === L && b === N) || (a === N && b === L)
    lamps[p.id] = lit ? (dimmed.includes(a) || dimmed.includes(b) ? st.level / 100 : 1) : 0
  }
  const motors = {}
  for (const p of scenario.parts.filter((x) => x.kind === 'motor' || x.kind === 'motorDriver')) {
    const net = (q) => uf.find(`${p.id}:${q}`)
    let up, down
    if (p.kind === 'motor') { up = net('up') === L && net('n') === N; down = net('down') === L && net('n') === N }
    else { const ok = net('l') === L && net('n') === N; up = ok && net('up') === L; down = ok && net('down') === L }
    motors[p.id] = up && down ? 'both' : up ? 'up' : down ? 'down' : null
    if (up && down) e1.findings.push({ level: 'danger', text: t('{p}: both directions energised at once — this damages the motor.', { p: t(p.label) }) })
    if (net('pe') !== uf.find('PE')) e1.findings.push({ level: 'warn', text: t('{p}: protective earth (PE) not connected.', { p: t(p.label) }) })
  }
  const out = { short: null, powered: e1.powered, twoWire: e1.twoWire, inputs: e1.inputs, state: st, lamps, motors, findings: e1.findings, nets: uf, L, N, PE: usesPE(scenario) ? uf.find('PE') : null }
  // Wire colours vs what the wire carries
  for (const [a, b, meta] of wires) {
    if (!meta?.color || meta.color === 'auto') continue
    const k = netKind(out, device, a) !== 'idle' ? netKind(out, device, a) : netKind(out, device, b)
    const what = `${portName(device, scenario, a, extras)} – ${portName(device, scenario, b, extras)}`
    if (meta.color === 'gnye' && k !== 'pe') out.findings.push({ level: 'danger', text: t('Green-yellow is reserved for protective earth — {w} isn’t earth.', { w: what }) })
    else if (k === 'pe' && meta.color !== 'gnye') out.findings.push({ level: 'warn', text: t('Earth should be green-yellow ({w}).', { w: what }) })
    else if (k === 'neutral' && meta.color !== 'blue') out.findings.push({ level: 'warn', text: t('Neutral should be blue ({w}).', { w: what }) })
    else if (meta.color === 'blue' && k !== 'neutral') out.findings.push({ level: 'warn', text: k === 'live' ? t('Blue is for neutral, but {w} carries live.', { w: what }) : t('Blue is for neutral, but {w} carries a switched or control signal.', { w: what }) })
  }
  return out
}

// Conductors per terminal: a module screw terminal takes at most two, a
// connector port exactly one; in a real wall box the incoming cable has one
// L, one N and one PE conductor.
export function conductorFindings(device, scenario, wires, extras = [], { realBox } = {}) {
  const count = new Map()
  for (const [a, b] of wires) for (const p of [a, b]) count.set(p, (count.get(p) || 0) + 1)
  const f = []
  for (const [p, n] of count) {
    if (p.startsWith('dev:') && n > 2) f.push({ level: 'warn', text: t('{p} has {n} conductors — join them in a connector and run one wire to the terminal.', { p: portName(device, scenario, p, extras), n }) })
    const owner = extras.find((x) => p.startsWith(`${x.id}:`))
    if (owner?.kind === 'wago' && n > 1) f.push({ level: 'danger', text: t('{p}: one conductor per connector port.', { p: portName(device, scenario, p, extras) }) })
    if (realBox && ['L', 'N', 'PE'].includes(p) && n > 1) f.push({ level: 'warn', text: t('Wall box: the incoming {r} is one conductor but {n} wires use it — join them in a {m} ({k}-way).', { r: p, n, m: connectorFor(n + 1).model, k: n + 1 }) })
  }
  return f
}

// The reference wiring as it's done in a real wall box: wherever a mains
// conductor (or a module terminal) feeds more than it can take, put a
// connector there. Returns { parts, wires } to use instead of the
// scenario's wires.
export function wallBoxPlan(device, scenario) {
  const deg = new Map()
  for (const [a, b] of scenario.wires) for (const p of [a, b]) deg.set(p, (deg.get(p) || 0) + 1)
  const parts = [], wires = []
  const hub = new Map() // port → connector id
  const NAMES = { L: 'Live (L)', N: 'Neutral (N)', PE: 'Earth (PE)' }
  for (const [p, n] of deg) {
    if (!((['L', 'N', 'PE'].includes(p) && n > 1) || (p.startsWith('dev:') && n > 2))) continue
    const c = connectorFor(n + 1)
    const id = `wg${parts.length + 1}`
    parts.push({ id, kind: 'wago', poles: c.poles, model: c.model, label: NAMES[p] || portName(device, scenario, p) })
    hub.set(p, { id, next: 2 })
    wires.push([p, `${id}:p1`])
  }
  for (const [a, b] of scenario.wires) {
    const ends = [a, b].map((p) => { const h = hub.get(p); return h ? `${h.id}:p${h.next++}` : p })
    wires.push(ends)
  }
  return { parts, wires }
}

// What kind of net a port is on, for wire colours: live / neutral / pe / sx / idle
export function netKind(sim, device, port) {
  if (!sim?.nets) return 'idle'
  const n = sim.nets.find(port)
  if (n === sim.L) return 'live'
  if (n === sim.N) return 'neutral'
  if (sim.PE && n === sim.PE) return 'pe'
  const sx = device.terminals.find((x) => x.role === 'sx')
  if (sx && sim.powered && n === sim.nets.find(`dev:${sx.id}`)) return 'sx'
  return 'idle'
}

// ── Checker: compare a wiring against the reference scenario ──────────────
// Connectivity is compared with switches open and the module off, so it's
// about the wires, not the state.
export function check(device, scenario, wires, extras = []) {
  const ports = allPorts(device, scenario) // compared on the diagram's own ports
  const ref = new UF(), got = new UF()
  for (const p of ports) ref.find(p)
  for (const p of allPorts(device, scenario, extras)) got.find(p)
  for (const [a, b] of scenario.wires) ref.union(a, b)
  for (const [a, b] of wires) got.union(a, b)
  joinConnectors(got, extras)
  for (const [a, b] of device.bridges || []) { ref.union(`dev:${a}`, `dev:${b}`); got.union(`dev:${a}`, `dev:${b}`) }
  const missing = [], extra = []
  const groups = (uf) => {
    const g = new Map()
    for (const p of ports) { const r = uf.find(p); if (!g.has(r)) g.set(r, []); g.get(r).push(p) }
    return [...g.values()]
  }
  // Missing: ports that belong together in the reference but aren't joined
  for (const grp of groups(ref)) {
    if (grp.length < 2) continue
    const parts = new Map()
    for (const p of grp) { const r = got.find(p); if (!parts.has(r)) parts.set(r, []); parts.get(r).push(p) }
    const comps = [...parts.values()]
    for (let i = 1; i < comps.length; i++) missing.push([comps[0][0], comps[i][0]])
  }
  // Extra: ports joined in the user's wiring that the reference keeps apart
  for (const grp of groups(got)) {
    if (grp.length < 2) continue
    const parts = new Map()
    for (const p of grp) { const r = ref.find(p); if (!parts.has(r)) parts.set(r, []); parts.get(r).push(p) }
    const comps = [...parts.values()]
    for (let i = 1; i < comps.length; i++) extra.push([comps[0][0], comps[i][0]])
  }
  return { ok: !missing.length && !extra.length, missing, extra }
}

export function labelOf(device, terminalId) {
  return device.terminals.find((x) => x.id === terminalId)?.label || terminalId
}

// Human name for a port
export function portName(device, scenario, port, extras = []) {
  if (port === 'L') return t('mains live (L)')
  if (port === 'N') return t('mains neutral (N)')
  if (port === 'PE') return t('protective earth (PE)')
  const [owner, q] = port.split(':')
  if (owner === 'dev') return t('terminal {t}', { t: labelOf(device, q) })
  const part = [...scenario.parts, ...extras].find((p) => p.id === owner)
  if (part?.kind === 'wago') return part.label ? t('{label} connector ({model}) port {n}', { label: t(part.label), model: part.model || `${part.poles}`, n: q.slice(1) }) : t('connector ({model}) port {n}', { model: part.model || `${part.poles}`, n: q.slice(1) })
  const names = { com: t('common'), o1: part?.keys?.[0] ? t('{k} contact', { k: part.keys[0] }) : t('contact 1'), o2: part?.keys?.[1] ? t('{k} contact', { k: part.keys[1] }) : t('contact 2'), a: t('terminal 1'), b: t('terminal 2'), up: t('up wire'), down: t('down wire'), n: t('neutral'), pe: t('earth'), l: t('live') }
  return t('{part}: {port}', { part: t(part?.label) || owner, port: part?.kind === 'switch' && q === 'o1' ? t('contact') : names[q] || q })
}

// Step-by-step instructions from a scenario
export function steps(device, scenario, plan) {
  const wires = plan ? plan.wires : scenario.wires
  const extras = plan ? plan.parts : []
  return wires.map(([a, b]) => {
    const term = [a, b].find((p) => p.startsWith('dev:'))
    const role = term ? device.terminals.find((x) => `dev:${x.id}` === term)?.desc : null
    const conn = extras.find((x) => [a, b].some((p) => p.startsWith(`${x.id}:`)))
    return { wire: [a, b], text: t('Connect {a} to {b}', { a: portName(device, scenario, a, extras), b: portName(device, scenario, b, extras) }), hint: role ? t(role) : conn ? t(CONNECTORS.find((c) => c.model === conn.model)?.spec) : null }
  })
}
