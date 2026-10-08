// Node catalogue for the Flows editor (FlowsPage.jsx) — the runtime that
// executes these lives in src/automation-engine.js. Each type declares its
// colour, output count, and fields(cfg, ctx) → field descriptors:
//
//   { kind: 'text'|'number', key, label, ph?, list? }
//   { kind: 'textarea', key, label, ph?, rows? }
//   { kind: 'select', key, label, options: [[value, text]], def, refresh? }
//   { kind: 'bool', key, label, labels: ['on','off'] }   (stored as true/false)
//   { kind: 'row', items: [...] }
//   { kind: 'hint', text }
//
// defaults(cfg, ctx) returns the config with every value the UI shows as
// pre-selected actually filled in — applied on add, on edit and on deploy, so
// what the engine receives is what the node displays.

const OPS = ['>', '<', '>=', '<=', '==', '!=', 'changes']
const opt = (list) => list.map((v) => [v, v])
const firstOf = (pairs) => pairs[0]?.[0]

export const ICONS = {
  trigger: '⚡', time: '⏰', mqttIn: '📥', condition: '⌥', device: '🔌', relay: '⏻', mqttOut: '📤',
  http: '🌐', notify: '🔔', scene: '✨', delay: '⏱', debug: '🐞', virtual: '🧩', extract: '🔎',
  loxoneXml: '🧾', store: '🧵', sceneGen: '🎬', global: '🌍', sync: '🔁', page: '📟',
}

const roomText = (r) => (r.label && r.label !== r.id ? `${r.id} (${r.label})` : r.id)
const roomOptions = (ctx) => ctx.pagingRooms.map((r) => [r.id, `${roomText(r)}${r.online ? '' : ' — offline'}`])

// Virtual node: device picker + a value control shaped by the device's type.
// A deviceKey that no longer exists is kept visible and flagged — never
// silently re-pointed at another device.
function virtualFields(cfg, ctx) {
  if (!ctx.virtualDevices.length) return [{ kind: 'hint', text: 'No virtual devices configured — add one in Settings → Virtual Devices.' }]
  const missing = !ctx.virtualDevices.some((d) => d.key === cfg.deviceKey)
  const options = [
    ...(missing ? [[cfg.deviceKey, `⚠ ${cfg.deviceKey} (not found)`]] : []),
    ...ctx.virtualDevices.map((d) => [d.key, d.label]),
  ]
  // changing device drops the old value — it rarely fits the new device's type
  const dev = { kind: 'select', key: 'deviceKey', label: 'Device', options, refresh: (c) => { const n = { ...c }; delete n.value; return n } }
  if (missing) return [dev, { kind: 'hint', text: '⚠ This device no longer exists — pick a replacement.' }]
  const vt = ctx.virtualDevices.find((d) => d.key === cfg.deviceKey)?.valueType
  const value = {
    boolean: { kind: 'select', key: 'value', label: 'Value', options: opt(['on', 'off']), def: 'on' },
    range:   { kind: 'number', key: 'value', label: 'Value', ph: '0' },
    trigger: { kind: 'hint', text: 'Fires the button — no value needed.' },
  }[vt] || { kind: 'text', key: 'value', label: 'Value', ph: vt === 'text' ? 'text…' : 'value' }
  return [dev, value]
}

export const TYPES = {
  trigger: {
    label: 'Trigger', color: '#ff9838', outs: 1,
    defaults: (c) => ({ op: 'changes', ...c }),
    fields: () => [
      { kind: 'text', key: 'key', label: 'Store key', list: 'fe-store-keys', ph: 'battery/soc' },
      { kind: 'row', items: [
        { kind: 'select', key: 'op', label: 'When', options: opt(OPS) },
        { kind: 'text', key: 'value', label: 'Value', ph: '20' },
      ] },
    ],
  },
  time: {
    label: 'Time', color: '#e879f9', outs: 1,
    fields: () => [
      { kind: 'number', key: 'intervalSeconds', label: 'Every (seconds)', ph: '60' },
      { kind: 'hint', text: 'Fires the flow on a repeating interval.' },
    ],
  },
  mqttIn: {
    label: 'MQTT In', color: '#2dd4bf', outs: 1,
    fields: () => [
      { kind: 'text', key: 'topic', label: 'Topic', ph: 'home/sensor/temp' },
      { kind: 'hint', text: 'Fires when a message arrives on this topic (msg.payload = message).' },
    ],
  },
  condition: {
    label: 'Condition', color: '#ffc53d', outs: 2,
    defaults: (c) => ({ op: '>', ...c }),
    fields: () => [
      { kind: 'row', items: [
        { kind: 'select', key: 'op', label: 'Op', options: opt(OPS.filter((o) => o !== 'changes')) },
        { kind: 'text', key: 'value', label: 'Value', ph: '30' },
      ] },
      { kind: 'hint', text: 'output 1 = matches · output 2 = else' },
    ],
  },
  device: {
    label: 'Device', color: '#4a9dff', outs: 1,
    fields: () => [
      { kind: 'text', key: 'deviceKey', label: 'Device key', list: 'fe-device-keys', ph: 'shelly/…' },
      { kind: 'row', items: [
        { kind: 'text', key: 'sensor', label: 'Sensor', ph: 'switch' },
        { kind: 'text', key: 'value', label: 'Value', ph: 'on' },
      ] },
    ],
  },
  virtual: {
    label: 'Virtual', color: '#d946ef', outs: 1,
    defaults: (c, ctx) => {
      const n = { ...c, sensor: 'value' } // every virtual device exposes one 'value' sensor
      if (!n.deviceKey && ctx.virtualDevices.length) n.deviceKey = ctx.virtualDevices[0].key
      const vt = ctx.virtualDevices.find((d) => d.key === n.deviceKey)?.valueType
      if (vt === 'trigger') n.value = 'on'
      if (vt === 'boolean' && n.value == null) n.value = 'on'
      return n
    },
    fields: virtualFields,
  },
  sync: {
    label: 'Sync', color: '#22c55e', outs: 1,
    fields: () => [
      { kind: 'text', key: 'sensor', label: 'Sensor (same on every target)', ph: 'switch or brightness' },
      { kind: 'textarea', key: 'targets', label: 'Target device keys (one per line)', ph: 'shelly/bulb1\nshelly/bulb2\nsmartthings/…', rows: 4 },
      { kind: 'text', key: 'value', label: 'Value (blank = msg.payload)', ph: '{value} or a literal' },
      { kind: 'hint', text: 'Fans one value out to a whole group of devices — e.g. a no-load physical dimmer (power+neutral only) driving several real bulbs in sync. One bad target is skipped, not fatal.' },
    ],
  },
  relay: {
    label: 'Relay', color: '#2ee66b', outs: 1,
    defaults: (c) => ({ on: true, ...c }),
    fields: () => [{ kind: 'row', items: [
      { kind: 'number', key: 'index', label: 'Index', ph: '0' },
      { kind: 'bool', key: 'on', label: 'State', labels: ['on', 'off'] },
    ] }],
  },
  notify: {
    label: 'Notify', color: '#a875ff', outs: 1,
    defaults: (c) => ({ level: 'info', ...c }),
    fields: () => [
      { kind: 'select', key: 'level', label: 'Level', options: opt(['info', 'warning', 'critical']) },
      { kind: 'text', key: 'message', label: 'Message', ph: 'SOC is {value}%' },
    ],
  },
  scene: {
    label: 'Scene', color: '#ff5db1', outs: 1,
    defaults: (c, ctx) => ({ sceneId: firstOf(ctx.scenes.map((s) => [s.id])), ...c }),
    fields: (c, ctx) => [{ kind: 'select', key: 'sceneId', label: 'Scene', options: ctx.scenes.map((s) => [s.id, s.name]) }],
  },
  page: {
    label: 'Page Room', color: '#38bdf8', outs: 1,
    defaults: (c, ctx) => {
      const first = firstOf(roomOptions(ctx))
      return { from: first, to: first, ...c }
    },
    fields: (c, ctx) => {
      if (!ctx.pagingRooms.length) return [{ kind: 'hint', text: 'No paging rooms configured — add some to config.paging.rooms.' }]
      return [
        { kind: 'row', items: [
          { kind: 'select', key: 'from', label: 'From', options: roomOptions(ctx) },
          { kind: 'select', key: 'to', label: 'To', options: roomOptions(ctx) },
        ] },
        { kind: 'hint', text: 'Opens a live two-way audio channel between two paging rooms — both need an online device (Wall Dashboard tablet or dashboard tab registered to that room).' },
      ]
    },
  },
  sceneGen: {
    label: 'Scene Generator', color: '#fb64b6', outs: 1,
    defaults: (c) => {
      const n = { actionType: 'device', enabled: true, ...c }
      if (n.actionType === 'relay' && n.on == null) n.on = true
      if (n.actionType === 'notify' && !n.level) n.level = 'info'
      return n
    },
    fields: (c) => [
      { kind: 'row', items: [
        { kind: 'text', key: 'name', label: 'Name', ph: 'Evening Mode' },
        { kind: 'text', key: 'icon', label: 'Icon', ph: '🎬' },
      ] },
      { kind: 'select', key: 'actionType', label: 'Action type', options: [['device', 'Device'], ['relay', 'Relay'], ['notify', 'Notify']] },
      ...(c.actionType === 'device' ? [
        { kind: 'text', key: 'deviceKey', label: 'Device key', list: 'fe-device-keys', ph: 'shelly/… or virtual/…' },
        { kind: 'row', items: [
          { kind: 'text', key: 'sensor', label: 'Sensor', ph: 'switch' },
          { kind: 'text', key: 'value', label: 'Value', ph: 'on (or {value})' },
        ] },
      ] : c.actionType === 'relay' ? [
        { kind: 'row', items: [
          { kind: 'number', key: 'index', label: 'Index', ph: '0' },
          { kind: 'bool', key: 'on', label: 'State', labels: ['on', 'off'] },
        ] },
      ] : [
        { kind: 'select', key: 'level', label: 'Level', options: opt(['info', 'warning', 'critical']) },
        { kind: 'text', key: 'message', label: 'Message', ph: '{value}' },
      ]),
      { kind: 'bool', key: 'enabled', label: 'Enabled (shows in dashboard strip)', labels: ['yes', 'no'] },
      { kind: 'hint', text: 'Creates/updates a Scene (one action) — reruns overwrite the same scene by name, never duplicate it. {value}/{key} resolve against this run’s message.' },
    ],
  },
  mqttOut: {
    label: 'MQTT Out', color: '#34d399', outs: 1,
    fields: () => [
      { kind: 'text', key: 'topic', label: 'Topic', ph: 'home/cmd/light' },
      { kind: 'text', key: 'payload', label: 'Payload', ph: '{value} (blank = msg)' },
    ],
  },
  http: {
    label: 'HTTP', color: '#fb7185', outs: 1,
    defaults: (c) => ({ method: 'GET', ...c }),
    fields: () => [
      { kind: 'row', items: [
        { kind: 'select', key: 'method', label: 'Method', options: opt(['GET', 'POST', 'PUT', 'DELETE']) },
        { kind: 'text', key: 'url', label: 'URL', ph: 'https://…' },
      ] },
      { kind: 'text', key: 'body', label: 'Body', ph: '{"soc":{value}}' },
      { kind: 'text', key: 'saveAs', label: 'Save as image (optional)', ph: 'e.g. front-door' },
      { kind: 'hint', text: 'Response becomes msg.payload for the next node. Fill "Save as image" to fetch binary and serve it at /api/flow-snapshots/<name>.jpg — use like a camera snapshotUrl.' },
    ],
  },
  extract: {
    label: 'Extract', color: '#facc15', outs: 1,
    fields: () => [
      { kind: 'text', key: 'pattern', label: 'Regex pattern', ph: 'data-price="(\\d+)"' },
      { kind: 'row', items: [
        { kind: 'text', key: 'flags', label: 'Flags', ph: 'i (optional)' },
        { kind: 'number', key: 'group', label: 'Group', ph: '1' },
      ] },
      { kind: 'hint', text: 'Matches the regex against msg.payload (e.g. scraped HTML) and passes the capture group on. No match = flow stops here.' },
    ],
  },
  global: {
    label: 'Global', color: '#38bdf8', outs: 1,
    defaults: (c) => ({ mode: 'get', ...c }),
    fields: (c) => [
      { kind: 'row', items: [
        { kind: 'text', key: 'name', label: 'Name', ph: 'lastMode' },
        { kind: 'select', key: 'mode', label: 'Mode', options: opt(['get', 'set']) },
      ] },
      ...(c.mode === 'set' ? [{ kind: 'text', key: 'value', label: 'Value (blank = msg.payload)', ph: '{value} or a literal' }] : []),
      { kind: 'hint', text: 'A named value shared across every flow, memory-only (resets on restart). "get" reads it into msg.payload; "set" writes it (blank Value = pass msg.payload straight through).' },
    ],
  },
  store: {
    label: 'Store', color: '#a3e635', outs: 1,
    defaults: (c) => ({ kind: 'number', ...c }),
    fields: (c) => [
      { kind: 'row', items: [
        { kind: 'text', key: 'name', label: 'Name', ph: 'e.g. Gold Price' },
        { kind: 'select', key: 'kind', label: 'Kind', options: [['number', 'number (gauge)'], ['boolean', 'boolean (on/off)'], ['text', 'text (label)']] },
      ] },
      { kind: 'row', items: [
        { kind: 'text', key: 'icon', label: 'Icon (emoji)', ph: '🧵' },
        { kind: 'text', key: 'color', label: 'Color', ph: 'e.g. teal' },
      ] },
      ...(c.kind === 'number' ? [{ kind: 'row', items: [
        { kind: 'text', key: 'unit', label: 'Unit', ph: 'zł' },
        { kind: 'number', key: 'min', label: 'Min', ph: '-1000000' },
        { kind: 'number', key: 'max', label: 'Max', ph: '1000000' },
      ] }] : []),
      { kind: 'hint', text: 'Writes msg.payload into a custom dashboard widget (flow/<name>) — a number gauge, on/off indicator, or text label depending on Kind. Shows up on the dashboard, Graphs and the Loxone export like any other device. Pass-through: wire more nodes after it.' },
    ],
  },
  loxoneXml: {
    label: 'Loxone XML', color: '#67e8f9', outs: 1,
    fields: () => [
      { kind: 'text', key: 'name', label: 'Name', ph: 'Tavex Gold Price' },
      { kind: 'row', items: [
        { kind: 'text', key: 'unit', label: 'Unit', ph: 'zł' },
        { kind: 'number', key: 'min', label: 'Min', ph: '-1000000' },
        { kind: 'number', key: 'max', label: 'Max', ph: '1000000' },
      ] },
      { kind: 'row', items: [
        { kind: 'text', key: 'host', label: 'LSH host (in XML)', ph: 'localhost:3001' },
        { kind: 'text', key: 'token', label: 'API token (in XML)', ph: 'YOUR_API_TOKEN' },
      ] },
      { kind: 'hint', text: 'Writes msg.payload to a live device (flowloxone/<name>) and (re)builds its Loxone Virtual Input import XML at /api/flow-loxone/<name>.xml — import once into Loxone Config, then it polls /api/devices for live values.' },
    ],
  },
  delay: {
    label: 'Delay', color: '#8ea2ff', outs: 1,
    fields: () => [{ kind: 'number', key: 'seconds', label: 'Seconds', ph: '5' }],
  },
  debug: {
    label: 'Debug', color: '#22d3ee', outs: 0,
    fields: () => [
      { kind: 'text', key: 'name', label: 'Name', ph: 'debug 1' },
      { kind: 'hint', text: 'Wire a node into this to watch its message below.' },
    ],
  },
}

export function withDefaults(node, ctx) {
  const t = TYPES[node.type]
  return t?.defaults ? t.defaults(node.config || {}, ctx) : (node.config || {})
}
