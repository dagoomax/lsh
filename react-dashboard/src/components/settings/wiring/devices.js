import { t } from './i18n.js'

// Wiring data for the wiring emulator, converted from the manufacturers'
// installation manuals (kept in the private dagoomax/lsh-manuals repo — see
// `manual`, opened through /api/manuals/<id>/pdf). Diagrams are re-drawn as
// data — terminals, parts, wires — and the rules are paraphrased; nothing is
// copied from the manuals' text. AC (230 V) diagrams only.
//
// Ports: mains 'L' | 'N' | 'PE' · device terminals 'dev:<id>' ·
// parts '<part>:<port>' — switch: com, o1 · switch2: com, o1, o2 ·
// lamp: a, b · motor: up, down, n, pe · motorDriver: l, n, up, down, pe

export const DEVICES = [
  {
    id: 'fibaro-fgs213', manual: 'fibaro-switch-2', manufacturer: 'FIBARO', model: 'FGS-213', name: 'Single Switch 2', kind: 'relay', color: '#0a84ff',
    terminals: [
      { id: 'S1', label: 'S1', role: 'in', desc: 'Switch input 1 — main switch, also starts add/remove' },
      { id: 'S2', label: 'S2', role: 'in', desc: 'Switch input 2 — optional, sends scenes only' },
      { id: 'L1', label: 'L', role: 'L', desc: 'Live (bridged with the other L) — handy to feed the switch' },
      { id: 'L2', label: 'L', role: 'L', desc: 'Live supply' },
      { id: 'Q', label: 'Q', role: 'out', desc: 'Switched output to the load' },
      { id: 'N', label: 'N', role: 'N', desc: 'Neutral — required' },
    ],
    bridges: [['L1', 'L2']],
    power: { L: 'L2', N: 'N' },
    inputs: { S1: 'L', S2: 'L' },
    channels: [{ id: 'ch1', out: 'Q', in: 'S1', label: 'Output Q' }],
    specs: [['Rated load', '8 A resistive (IEC)'], ['Fuse', '≤ 10 A'], ['Neutral', 'Required'], ['Wall box', '≥ 60 mm deep'], ['Switch cable', '≤ 10 m'], ['Loads', 'Incandescent, halogen, resistive appliances']],
    rules: [
      'Isolate the circuit at the breaker before touching the terminals — they can be live even when the module is off.',
      'Resistive loads only (bulbs, heaters); don’t exceed the rated current.',
      'The switch on S1 is the main one; the second key on S2 doesn’t switch the output (it can trigger scenes).',
      'Keep the antenna away from metal and don’t shorten it.',
    ],
    scenarios: [
      { id: 'single', title: 'One switch, one light', inputMode: 'momentary',
        parts: [{ id: 'sw1', kind: 'switch', label: 'Wall switch' }, { id: 'lamp1', kind: 'lamp', label: 'Light' }],
        wires: [['L', 'dev:L2'], ['dev:L1', 'sw1:com'], ['sw1:o1', 'dev:S1'], ['dev:Q', 'lamp1:a'], ['lamp1:b', 'N'], ['N', 'dev:N']] },
      { id: 'double', title: 'Two-key switch (key 2 → scenes)', inputMode: 'momentary',
        parts: [{ id: 'sw1', kind: 'switch2', label: 'Two-key switch' }, { id: 'lamp1', kind: 'lamp', label: 'Light' }],
        wires: [['L', 'dev:L2'], ['dev:L1', 'sw1:com'], ['sw1:o1', 'dev:S1'], ['sw1:o2', 'dev:S2'], ['dev:Q', 'lamp1:a'], ['lamp1:b', 'N'], ['N', 'dev:N']] },
    ],
  },
  {
    id: 'fibaro-fgs223', manual: 'fibaro-switch-2', manufacturer: 'FIBARO', model: 'FGS-223', name: 'Double Switch 2', kind: 'relay', color: '#0a84ff',
    terminals: [
      { id: 'S1', label: 'S1', role: 'in', desc: 'Switch input 1 — controls Q1, also starts add/remove' },
      { id: 'S2', label: 'S2', role: 'in', desc: 'Switch input 2 — controls Q2' },
      { id: 'Q2', label: 'Q2', role: 'out', desc: 'Output channel 2' },
      { id: 'L', label: 'L', role: 'L', desc: 'Live supply' },
      { id: 'Q1', label: 'Q1', role: 'out', desc: 'Output channel 1' },
      { id: 'N', label: 'N', role: 'N', desc: 'Neutral — required' },
    ],
    power: { L: 'L', N: 'N' },
    inputs: { S1: 'L', S2: 'L' },
    channels: [{ id: 'ch1', out: 'Q1', in: 'S1', label: 'Output Q1' }, { id: 'ch2', out: 'Q2', in: 'S2', label: 'Output Q2' }],
    specs: [['Rated load', '6.5 A per channel, 10 A total (IEC)'], ['Fuse', '≤ 10 A'], ['Neutral', 'Required'], ['Wall box', '≥ 60 mm deep'], ['Switch cable', '≤ 10 m'], ['Loads', 'Incandescent, halogen, resistive appliances']],
    rules: [
      'Isolate the circuit at the breaker first.',
      'Resistive loads only; mind the per-channel and total current.',
      'S1 switches Q1 and S2 switches Q2. The switch is fed straight from the live line.',
    ],
    scenarios: [
      { id: 'single', title: 'One switch, one light', inputMode: 'momentary',
        parts: [{ id: 'sw1', kind: 'switch', label: 'Wall switch' }, { id: 'lamp1', kind: 'lamp', label: 'Light (Q1)' }],
        wires: [['L', 'dev:L'], ['L', 'sw1:com'], ['sw1:o1', 'dev:S1'], ['dev:Q1', 'lamp1:a'], ['lamp1:b', 'N'], ['N', 'dev:N']] },
      { id: 'double', title: 'Two-key switch, two lights', inputMode: 'momentary',
        parts: [{ id: 'sw1', kind: 'switch2', label: 'Two-key switch' }, { id: 'lamp2', kind: 'lamp', label: 'Light 2 (Q2)' }, { id: 'lamp1', kind: 'lamp', label: 'Light 1 (Q1)' }],
        wires: [['L', 'dev:L'], ['L', 'sw1:com'], ['sw1:o1', 'dev:S1'], ['sw1:o2', 'dev:S2'], ['dev:Q1', 'lamp1:a'], ['dev:Q2', 'lamp2:a'], ['lamp1:b', 'N'], ['lamp2:b', 'N'], ['N', 'dev:N']] },
    ],
  },
  {
    id: 'fibaro-fgd212', manual: 'fibaro-dimmer-2', manufacturer: 'FIBARO', model: 'FGD-212', name: 'Dimmer 2', kind: 'dimmer', color: '#0a84ff',
    terminals: [
      { id: 'L', label: 'L', role: 'L', desc: 'Live supply' },
      { id: 'S1', label: 'S1', role: 'in', desc: 'Switch input 1 — on/off and dimming, also starts add/remove' },
      { id: 'S2', label: 'S2', role: 'in', desc: 'Switch input 2 — optional' },
      { id: 'Sx', label: 'Sx', role: 'sx', desc: 'Supply for the wall switch — the switch is fed from here, not from L' },
      { id: 'N', label: 'N', role: 'N', desc: 'Neutral (3-wire) — in 2-wire mode bridged to Sx instead' },
      { id: 'OUT', label: '⏦', role: 'out', desc: 'Dimmed output to the light' },
    ],
    power: { L: 'L', N: 'N', twoWire: { out: 'OUT' } },
    inputs: { S1: 'Sx', S2: 'Sx' },
    channels: [{ id: 'ch1', out: 'OUT', in: 'S1', label: 'Dimmed output', dimmer: true }],
    specs: [['Resistive', '50–250 W'], ['LED / CFL / electronic transformer', '50–200 VA'], ['Ferromagnetic transformer', '50–220 VA'], ['Neutral', 'Optional (2-wire mode)'], ['Wall box', '≥ 60 mm deep'], ['Switch cable', '≤ 20 m']],
    rules: [
      'Isolate the circuit first. Never power the dimmer without a load connected.',
      'The wall switch is supplied from Sx — not from the live line.',
      '2-wire (no neutral): bridge Sx to the N terminal. Below the minimum load, add a FIBARO Bypass 2 (FGB-002) across the light.',
      'Don’t mix light source types on one dimmer, and connect at most one transformer.',
      'After power-up the dimmer calibrates for about 30 s; the light may blink.',
    ],
    scenarios: [
      { id: '3wire', title: '3-wire (with neutral), one switch', inputMode: 'momentary',
        parts: [{ id: 'sw1', kind: 'switch', label: 'Wall switch' }, { id: 'lamp1', kind: 'lamp', label: 'Light' }],
        wires: [['L', 'dev:L'], ['dev:Sx', 'sw1:com'], ['sw1:o1', 'dev:S1'], ['N', 'dev:N'], ['dev:OUT', 'lamp1:a'], ['lamp1:b', 'N']] },
      { id: '3wire-double', title: '3-wire, two-key switch', inputMode: 'momentary',
        parts: [{ id: 'sw1', kind: 'switch2', label: 'Two-key switch' }, { id: 'lamp1', kind: 'lamp', label: 'Light' }],
        wires: [['L', 'dev:L'], ['dev:Sx', 'sw1:com'], ['sw1:o1', 'dev:S1'], ['sw1:o2', 'dev:S2'], ['N', 'dev:N'], ['dev:OUT', 'lamp1:a'], ['lamp1:b', 'N']] },
      { id: '2wire', title: '2-wire (no neutral), one switch', inputMode: 'momentary', twoWire: true,
        parts: [{ id: 'sw1', kind: 'switch', label: 'Wall switch' }, { id: 'lamp1', kind: 'lamp', label: 'Light' }],
        wires: [['L', 'dev:L'], ['dev:Sx', 'sw1:com'], ['sw1:o1', 'dev:S1'], ['dev:Sx', 'dev:N'], ['dev:OUT', 'lamp1:a'], ['lamp1:b', 'N']] },
      { id: '2wire-double', title: '2-wire, two-key switch', inputMode: 'momentary', twoWire: true,
        parts: [{ id: 'sw1', kind: 'switch2', label: 'Two-key switch' }, { id: 'lamp1', kind: 'lamp', label: 'Light' }],
        wires: [['L', 'dev:L'], ['dev:Sx', 'sw1:com'], ['sw1:o1', 'dev:S1'], ['sw1:o2', 'dev:S2'], ['dev:Sx', 'dev:N'], ['dev:OUT', 'lamp1:a'], ['lamp1:b', 'N']] },
    ],
  },
  {
    id: 'fibaro-fgr223', manual: 'fibaro-roller-shutter-3', manufacturer: 'FIBARO', model: 'FGR-223', name: 'Roller Shutter 3', kind: 'shutter', color: '#0a84ff',
    terminals: [
      { id: 'S1', label: 'S1', role: 'in', desc: 'Switch input 1 (up) — also starts add/remove' },
      { id: 'S2', label: 'S2', role: 'in', desc: 'Switch input 2 (down)' },
      { id: 'Q2', label: 'Q2', role: 'out', desc: 'Motor output 2 (down)' },
      { id: 'L', label: 'L', role: 'L', desc: 'Live supply' },
      { id: 'Q1', label: 'Q1', role: 'out', desc: 'Motor output 1 (up)' },
      { id: 'N', label: 'N', role: 'N', desc: 'Neutral — required' },
    ],
    power: { L: 'L', N: 'N' },
    inputs: { S1: 'L', S2: 'L' },
    shutter: { up: 'Q1', down: 'Q2', inUp: 'S1', inDown: 'S2' },
    specs: [['Motors', '1.7 A (inductive, single-phase AC)'], ['Lamps / resistive', '4.2 A'], ['Limit switches', 'Required (electronic or mechanical)'], ['Neutral', 'Required'], ['Wall box', '≥ 60 mm deep'], ['Switch cable', '≤ 20 m']],
    rules: [
      'Isolate the circuit first.',
      'AC motors with limit switches only — never DC motors.',
      'Q1 drives one direction and Q2 the other; the module never energises both. If up/down are swapped after wiring, swap Q1 and Q2 (or calibrate).',
      'Connect the motor’s protective earth (PE).',
    ],
    scenarios: [
      { id: 'standard', title: 'Standard blind motor', inputMode: 'momentary',
        parts: [{ id: 'sw1', kind: 'switch2', label: 'Up / down switch', keys: ['▲', '▼'] }, { id: 'm1', kind: 'motor', label: 'Blind motor' }],
        wires: [['L', 'dev:L'], ['L', 'sw1:com'], ['sw1:o1', 'dev:S1'], ['sw1:o2', 'dev:S2'], ['N', 'dev:N'], ['dev:Q1', 'm1:up'], ['dev:Q2', 'm1:down'], ['m1:n', 'N'], ['m1:pe', 'PE']] },
      { id: 'driver', title: 'Blind with built-in driver', inputMode: 'momentary',
        parts: [{ id: 'sw1', kind: 'switch2', label: 'Up / down switch', keys: ['▲', '▼'] }, { id: 'm1', kind: 'motorDriver', label: 'Blind (built-in driver)' }],
        wires: [['L', 'dev:L'], ['L', 'sw1:com'], ['sw1:o1', 'dev:S1'], ['sw1:o2', 'dev:S2'], ['N', 'dev:N'], ['dev:Q1', 'm1:up'], ['dev:Q2', 'm1:down'], ['L', 'm1:l'], ['N', 'm1:n'], ['PE', 'm1:pe']] },
    ],
  },
  {
    id: 'shelly-wave-1pm', manual: 'shelly-wave-1pm', manufacturer: 'Shelly', model: 'Wave 1PM', name: 'Qubino Wave 1PM', kind: 'relay', color: '#ff375f',
    terminals: [
      { id: 'O', label: 'O', role: 'out', desc: 'Switched output to the load' },
      { id: 'SW', label: 'SW', role: 'in', desc: 'Switch / push-button input for O' },
      { id: 'L', label: 'L', role: 'L', desc: 'Live supply (AC 110–240 V)' },
      { id: 'N', label: 'N', role: 'N', desc: 'Neutral — required' },
    ],
    power: { L: 'L', N: 'N' },
    inputs: { SW: 'L' },
    channels: [{ id: 'ch1', out: 'O', in: 'SW', label: 'Output O' }],
    specs: [['Max switching', 'AC 16 A / 240 V'], ['Supply', '110–240 V AC or 24–30 V DC'], ['Neutral', 'Required (AC)'], ['Metering', 'Power and energy']],
    rules: [
      'Isolate the circuit first.',
      'Don’t exceed the maximum load.',
      'Switch input type (toggle switch or push-button) is set in the device settings — match it to the switch you install.',
      'Don’t shorten the antenna.',
    ],
    scenarios: [
      { id: 'switch', title: 'Toggle switch, one light', inputMode: 'toggle',
        parts: [{ id: 'sw1', kind: 'switch', label: 'Toggle switch' }, { id: 'lamp1', kind: 'lamp', label: 'Light' }],
        wires: [['L', 'dev:L'], ['L', 'sw1:com'], ['sw1:o1', 'dev:SW'], ['dev:O', 'lamp1:a'], ['lamp1:b', 'N'], ['N', 'dev:N']] },
      { id: 'button', title: 'Push-button, one light', inputMode: 'momentary',
        parts: [{ id: 'sw1', kind: 'switch', label: 'Push-button' }, { id: 'lamp1', kind: 'lamp', label: 'Light' }],
        wires: [['L', 'dev:L'], ['L', 'sw1:com'], ['sw1:o1', 'dev:SW'], ['dev:O', 'lamp1:a'], ['lamp1:b', 'N'], ['N', 'dev:N']] },
    ],
  },
  {
    id: 'shelly-wave-2pm', manual: 'shelly-wave-2pm', manufacturer: 'Shelly', model: 'Wave 2PM', name: 'Qubino Wave 2PM', kind: 'relay', color: '#ff375f',
    terminals: [
      { id: 'N', label: 'N', role: 'N', desc: 'Neutral — required' },
      { id: 'O1', label: 'O1', role: 'out', desc: 'Output 1' },
      { id: 'L', label: 'L', role: 'L', desc: 'Live supply (AC 110–240 V)' },
      { id: 'O2', label: 'O2', role: 'out', desc: 'Output 2' },
      { id: 'SW1', label: 'SW1', role: 'in', desc: 'Switch input for O1' },
      { id: 'SW2', label: 'SW2', role: 'in', desc: 'Switch input for O2' },
    ],
    power: { L: 'L', N: 'N' },
    inputs: { SW1: 'L', SW2: 'L' },
    channels: [{ id: 'ch1', out: 'O1', in: 'SW1', label: 'Output O1' }, { id: 'ch2', out: 'O2', in: 'SW2', label: 'Output O2' }],
    specs: [['Max switching', 'AC 10 A per channel, 16 A total'], ['Supply', '110–240 V AC or 24 V DC'], ['Neutral', 'Required (AC)'], ['Metering', 'Power and energy per channel']],
    rules: [
      'Isolate the circuit first.',
      'Mind the per-channel and total current.',
      'Set the input type (toggle switch or push-button) in the device settings to match the switches.',
    ],
    scenarios: [
      { id: 'switches', title: 'Two toggle switches, two lights', inputMode: 'toggle',
        parts: [{ id: 'sw1', kind: 'switch', label: 'Switch 1' }, { id: 'sw2', kind: 'switch', label: 'Switch 2' }, { id: 'lamp1', kind: 'lamp', label: 'Light 1 (O1)' }, { id: 'lamp2', kind: 'lamp', label: 'Light 2 (O2)' }],
        wires: [['L', 'dev:L'], ['L', 'sw1:com'], ['L', 'sw2:com'], ['sw1:o1', 'dev:SW1'], ['sw2:o1', 'dev:SW2'], ['dev:O1', 'lamp1:a'], ['dev:O2', 'lamp2:a'], ['lamp1:b', 'N'], ['lamp2:b', 'N'], ['N', 'dev:N']] },
      { id: 'buttons', title: 'Two push-buttons, two lights', inputMode: 'momentary',
        parts: [{ id: 'sw1', kind: 'switch', label: 'Button 1' }, { id: 'sw2', kind: 'switch', label: 'Button 2' }, { id: 'lamp1', kind: 'lamp', label: 'Light 1 (O1)' }, { id: 'lamp2', kind: 'lamp', label: 'Light 2 (O2)' }],
        wires: [['L', 'dev:L'], ['L', 'sw1:com'], ['L', 'sw2:com'], ['sw1:o1', 'dev:SW1'], ['sw2:o1', 'dev:SW2'], ['dev:O1', 'lamp1:a'], ['dev:O2', 'lamp2:a'], ['lamp1:b', 'N'], ['lamp2:b', 'N'], ['N', 'dev:N']] },
    ],
  },
]

export const PART_PORTS = {
  switch: ['com', 'o1'],
  switch2: ['com', 'o1', 'o2'],
  lamp: ['a', 'b'],
  motor: ['up', 'down', 'n', 'pe'],
  motorDriver: ['l', 'n', 'up', 'down', 'pe'],
}

// Ports of any part, including connectors (p1…pN, all joined inside)
export const portsOf = (part) => (part.kind === 'wago' ? [...Array(part.poles)].map((_, i) => `p${i + 1}`) : PART_PORTS[part.kind] || [])

// Lever / push-in connectors. Every port takes one conductor; all ports of a
// connector are joined. "or equivalent" — any certified lever connector of the
// same size works.
export const CONNECTORS = [
  { poles: 2, model: 'WAGO 221-2411', name: '1:1 inline splice', spec: '0.2–4 mm² · lever', note: 'Joins one conductor to one other in line (extends a wire).' },
  { poles: 2, model: 'WAGO 221-412', name: '2-way', spec: '0.2–4 mm² · lever' },
  { poles: 3, model: 'WAGO 221-413', name: '3-way', spec: '0.2–4 mm² · lever' },
  { poles: 4, model: 'WAGO 2273-204', name: '4-way', spec: 'solid 0.5–2.5 mm² · push-in', note: 'Push-in: solid conductors only.' },
  { poles: 5, model: 'WAGO 221-415', name: '5-way', spec: '0.2–4 mm² · lever' },
]
export const connectorFor = (n) => CONNECTORS.find((c) => c.poles >= n && c.model !== 'WAGO 221-2411') || CONNECTORS[CONNECTORS.length - 1]

// Wire colours (EU, IEC 60446): brown/black/grey = line, blue = neutral, green-yellow = earth
export const WIRE_COLORS = [
  { id: 'auto', label: 'Auto', css: null },
  { id: 'brown', label: 'Brown (L)', css: '#8b4513' },
  { id: 'black', label: 'Black (L / switched)', css: '#1c1c1e' },
  { id: 'grey', label: 'Grey (L / switched)', css: '#8e8e93' },
  { id: 'blue', label: 'Blue (N)', css: '#2f80ed' },
  { id: 'gnye', label: 'Green-yellow (PE)', css: 'repeating-linear-gradient' },
]

// Tools and materials for mounting an in-wall module
export function toolsFor(device, scenario, plan) {
  const tools = [
    { id: 'tester', text: t('Two-pole voltage tester (and a non-contact tester) — prove the circuit is dead before touching it') },
    { id: 'lockout', text: t('Breaker lock-out or tape + a “do not switch on” tag') },
    { id: 'screwdriver', text: t('Insulated (VDE 1000 V) flat screwdrivers, 2.5 mm and 3.5 mm, for the module’s terminal screws') },
    { id: 'stripper', text: t('Wire stripper and side cutters (strip only as much as the terminal or connector strip gauge shows)') },
    { id: 'pliers', text: t('Insulated pliers') },
    { id: 'multimeter', text: t('Multimeter — continuity and checking the load before connecting') },
    { id: 'ferrules', text: t('Wire-end ferrules + crimper, if any conductor is stranded') },
    { id: 'box', text: t('Deep wall box (≥ 60 mm) or a box extension, so the module and connectors fit behind the switch') },
  ]
  if (device.kind === 'shutter') tools.push({ id: 'pe', text: t('Earth (PE) connection for the motor — a connector or terminal for green-yellow') })
  const wagos = new Map()
  for (const p of plan?.parts || []) if (p.kind === 'wago') wagos.set(p.model, (wagos.get(p.model) || 0) + 1)
  const materials = [
    { id: 'module', text: `${device.manufacturer} ${device.name} (${device.model})` },
    ...[...wagos.entries()].map(([model, n]) => ({ id: model, text: t('{n}× {model} connector (or equivalent)', { n, model }) })),
    { id: 'wire', text: t('Short pieces of 1.5 mm² wire in the right colours (brown/black/grey for line and switched line, blue for neutral) — as the circuit’s cable, per local rules') },
  ]
  return { tools, materials }
}
