'use strict';

// CAN bus scanner — Settings → System → CAN bus scan (tool module lsh-can).
// Listens passively for a few seconds and reports what's on the bus: every
// frame ID with its rate, length and which bytes change, a guess at the
// protocol (NMEA 2000 / Victron VE.Can, J1939, CANopen, battery BMS "CAN-bus
// BMS" protocol used by Pylontech & co. towards Victron/SMA inverters) and the
// values it can decode. Never transmits.
//
// Arduino VENTUNO Q: its STM32H5 runs Arduino's CANnectivity firmware, a
// gs_usb (candleLight-compatible) USB device (1209:ca01) towards the Linux
// side — the three CAN-FD ports show up as SocketCAN can0..can2 (kernel
// gs_usb driver). They're labelled "VENTUNO Q CAN-FD n" here.
//
// Sources:
//   SocketCAN (can0, vcan0…) via `candump` from can-utils — no native npm
//     build needed. The interface must already be up; LSH doesn't run sudo
//     (`sudo ip link set can0 up type can bitrate 250000 listen-only on`).
//   SLCAN serial adapters (CANable, USBtin…) via the `serialport` package,
//     opened in listen-only mode ("L").

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const SLCAN_RATE = { 10000: 'S0', 20000: 'S1', 50000: 'S2', 100000: 'S3', 125000: 'S4', 250000: 'S5', 500000: 'S6', 800000: 'S7', 1000000: 'S8' };
const MAX_FRAMES = 200000;

// ── Interfaces ──────────────────────────────────────────────────────────────

function run(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 4000 }, (err, stdout) => resolve(err ? null : String(stdout))));
}

async function hasCandump() {
  return !!(await run('sh', ['-c', 'command -v candump']))?.trim();
}

const VENTUNO_USB = { vendor: '1209', product: 'ca01' } // Arduino CANnectivity (gs_usb)

const readSys = (p) => { try { return fs.readFileSync(p, 'utf8').trim() } catch { return null } }

// USB vendor:product of the device behind a netdev (walks up from the
// interface directory to the USB device directory).
function usbIdOf(netdev) {
  let dir
  try { dir = fs.realpathSync(`/sys/class/net/${netdev}/device`) } catch { return null }
  for (let i = 0; i < 4 && dir && dir !== '/'; i++, dir = path.dirname(dir)) {
    const v = readSys(path.join(dir, 'idVendor'))
    if (v) return { vendor: v, product: readSys(path.join(dir, 'idProduct')), product_name: readSys(path.join(dir, 'product')) }
  }
  return null
}

function ventunoUsbPresent() {
  try {
    return fs.readdirSync('/sys/bus/usb/devices').some((d) =>
      readSys(`/sys/bus/usb/devices/${d}/idVendor`) === VENTUNO_USB.vendor && readSys(`/sys/bus/usb/devices/${d}/idProduct`) === VENTUNO_USB.product)
  } catch { return false }
}

// SocketCAN interfaces (ARPHRD_CAN = 280) + serial ports that could be SLCAN
// adapters.
async function interfaces() {
  const out = { socketcan: [], serial: [], candump: false, platform: process.platform, ventuno: null }
  if (process.platform !== 'linux') return out
  out.candump = await hasCandump()
  let names = []
  try { names = fs.readdirSync('/sys/class/net') } catch {}
  for (const name of names) {
    let type = ''
    try { type = fs.readFileSync(`/sys/class/net/${name}/type`, 'utf8').trim() } catch {}
    if (type !== '280') continue
    const info = { name, up: false, state: null, bitrate: null, listenOnly: false, virtual: false, fd: false, rx: null, errors: null, driver: null, label: null }
    try { info.driver = path.basename(fs.realpathSync(`/sys/class/net/${name}/device/driver`)) } catch {}
    const usb = usbIdOf(name)
    if (usb?.vendor === VENTUNO_USB.vendor && usb?.product === VENTUNO_USB.product) {
      info.ventuno = true
      info.label = `VENTUNO Q CAN-FD ${Number(readSys(`/sys/class/net/${name}/dev_port`) || readSys(`/sys/class/net/${name}/dev_id`) || 0) + 1}`
    } else if (usb) info.label = usb.product_name || `USB ${usb.vendor}:${usb.product}`
    try { info.up = /up|unknown/.test(fs.readFileSync(`/sys/class/net/${name}/operstate`, 'utf8')) } catch {}
    const j = await run('ip', ['-details', '-statistics', '-json', 'link', 'show', name])
    try {
      const l = JSON.parse(j)[0]
      info.up = (l.flags || []).includes('UP')
      const d = l.linkinfo?.info_data || {}
      info.virtual = l.linkinfo?.info_kind === 'vcan'
      info.state = d.state || null
      info.bitrate = d.bittiming?.bitrate || null
      info.fd = !!d.data_bittiming
      info.listenOnly = !!(d.ctrlmode?.['LISTEN-ONLY'] || (Array.isArray(d.ctrlmode) && d.ctrlmode.includes('LISTEN-ONLY')))
      info.rx = l.stats64?.rx?.packets ?? null
      info.errors = d.berr_counter ? { tx: d.berr_counter.tx, rx: d.berr_counter.rx } : null
    } catch {}
    out.socketcan.push(info)
  }
  const ventunoIfaces = out.socketcan.filter((x) => x.ventuno).map((x) => x.name)
  if (ventunoIfaces.length || ventunoUsbPresent()) {
    out.ventuno = { usb: true, interfaces: ventunoIfaces }
  }
  const seen = new Set()
  for (const dir of ['/dev/serial/by-id']) {
    try {
      for (const f of fs.readdirSync(dir)) {
        const real = fs.realpathSync(path.join(dir, f))
        seen.add(real)
        out.serial.push({ path: path.join(dir, f), device: real, label: f.replace(/^usb-/, '').replace(/-if\d+.*$/, '').replace(/_/g, ' '), slcanLikely: /canable|usbtin|slcan|can.?usb|lawicel|candlelight|cantact/i.test(f) })
      }
    } catch {}
  }
  try {
    for (const f of fs.readdirSync('/dev').filter((x) => /^tty(ACM|USB)\d+$/.test(x))) {
      const p = `/dev/${f}`
      if (!seen.has(p)) out.serial.push({ path: p, device: p, label: f, slcanLikely: false })
    }
  } catch {}
  return out
}

// ── Capture ─────────────────────────────────────────────────────────────────

// candump -L line: "(1700000000.123456) can0 18FF50E5#0102030405060708"
// remote "123#R", CAN FD "123##1AABB".
function parseCandumpLine(line) {
  const m = /^\((\d+\.\d+)\)\s+(\S+)\s+([0-9A-Fa-f]+)(##?)([0-9A-Fa-f]*|R\d?)\s*$/.exec(line.trim())
  if (!m) return null
  const idHex = m[3]
  const fd = m[4] === '##'
  let dataHex = m[5]
  const remote = dataHex.startsWith('R')
  if (fd) dataHex = dataHex.slice(1) // flags nibble
  return {
    t: Math.round(parseFloat(m[1]) * 1000), id: parseInt(idHex, 16), ext: idHex.length > 3, fd, remote,
    data: remote ? Buffer.alloc(0) : Buffer.from(dataHex, 'hex'),
  }
}

function captureCandump(iface, seconds, onFrame) {
  return new Promise((resolve, reject) => {
    const p = spawn('candump', ['-L', iface], { stdio: ['ignore', 'pipe', 'pipe'] })
    let buf = '', err = ''
    p.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const f = parseCandumpLine(buf.slice(0, i)); buf = buf.slice(i + 1)
        if (f) onFrame(f)
      }
    })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', (e) => reject(e.code === 'ENOENT' ? new Error('candump not found — install can-utils (sudo apt install can-utils)') : e))
    const t = setTimeout(() => p.kill('SIGINT'), seconds * 1000)
    p.on('close', (code) => {
      clearTimeout(t)
      if (err && !/interrupt/i.test(err) && code && code !== 130) return reject(new Error(err.trim().split('\n').pop()))
      resolve()
    })
  })
}

// SLCAN frame: tIIILDD.. (11-bit) / TIIIIIIIILDD.. (29-bit), r/R remote.
function parseSlcan(s, t) {
  const kind = s[0]
  if (!'tTrR'.includes(kind)) return null
  const ext = kind === 'T' || kind === 'R'
  const idLen = ext ? 8 : 3
  const id = parseInt(s.slice(1, 1 + idLen), 16)
  const dlc = parseInt(s[1 + idLen], 16)
  if (Number.isNaN(id) || Number.isNaN(dlc)) return null
  const remote = kind === 'r' || kind === 'R'
  return { t, id, ext, fd: false, remote, data: remote ? Buffer.alloc(0) : Buffer.from(s.slice(2 + idLen, 2 + idLen + dlc * 2), 'hex') }
}

async function captureSlcan(portPath, bitrate, seconds, onFrame) {
  let SerialPortMod
  try { SerialPortMod = require('serialport') } catch { const e = new Error('The serialport package is not installed (CAN bus scan module)'); e.needsModule = true; throw e }
  const SerialPort = SerialPortMod.SerialPort || SerialPortMod
  const code = SLCAN_RATE[bitrate]
  if (!code) throw new Error(`Unsupported SLCAN bitrate ${bitrate}`)
  const port = new SerialPort({ path: portPath, baudRate: 115200, autoOpen: false })
  await new Promise((res, rej) => port.open((e) => (e ? rej(e) : res())))
  let buf = ''
  port.on('data', (d) => {
    buf += d.toString('latin1')
    let i
    while ((i = buf.search(/[\r\x07]/)) >= 0) {
      const f = parseSlcan(buf.slice(0, i), Date.now()); buf = buf.slice(i + 1)
      if (f) onFrame(f)
    }
  })
  const w = (s) => new Promise((res) => port.write(s, () => port.drain(res)))
  try {
    await w('C\r'); await w(`${code}\r`); await w('L\r') // close, bitrate, open LISTEN-ONLY
    await new Promise((r) => setTimeout(r, seconds * 1000))
  } finally {
    await w('C\r').catch(() => {})
    await new Promise((r) => port.close(() => r()))
  }
}

async function scan({ iface, serialPort, bitrate = 250000, seconds = 10 } = {}) {
  if (process.platform !== 'linux') throw new Error('CAN scanning needs a Linux LSH host')
  seconds = Math.min(Math.max(Number(seconds) || 10, 2), 60)
  const frames = []
  const onFrame = (f) => { if (frames.length < MAX_FRAMES) frames.push(f) }
  const t0 = Date.now()
  let source
  if (serialPort) {
    if (!/^\/dev\/[\w./:+-]+$/.test(serialPort)) throw new Error('Invalid serial port')
    bitrate = Number(bitrate)
    await captureSlcan(serialPort, bitrate, seconds, onFrame)
    source = { kind: 'slcan', name: serialPort, bitrate }
  } else {
    if (!/^[a-z][\w-]{0,14}$/i.test(iface || '')) throw new Error('Pick a CAN interface')
    const info = (await interfaces()).socketcan.find((x) => x.name === iface)
    if (!info) throw new Error(`${iface} is not a CAN interface on this host`)
    if (!info.up) { const e = new Error(`${iface} is down`); e.down = true; throw e }
    bitrate = info.bitrate
    await captureCandump(iface, seconds, onFrame)
    source = { kind: 'socketcan', name: iface, bitrate, listenOnly: info.listenOnly, virtual: info.virtual }
  }
  return { source, durationMs: Date.now() - t0, seconds, ...analyze(frames, { seconds, bitrate }) }
}

// ── Analysis ────────────────────────────────────────────────────────────────

const N2K_PGN = {
  59392: 'ISO Acknowledgement', 59904: 'ISO Request', 60160: 'ISO Transport (data)', 60416: 'ISO Transport (control)', 60928: 'ISO Address Claim',
  61184: 'Proprietary single-frame (addressed)', 65280: 'Proprietary single-frame', 126208: 'Group Function', 126464: 'PGN List',
  126720: 'Proprietary fast-packet', 126992: 'System Time', 126993: 'Heartbeat', 126996: 'Product Information', 126998: 'Configuration Information',
  127245: 'Rudder', 127250: 'Vessel Heading', 127251: 'Rate of Turn', 127257: 'Attitude', 127258: 'Magnetic Variation',
  127488: 'Engine Parameters, Rapid', 127489: 'Engine Parameters, Dynamic', 127493: 'Transmission Parameters', 127501: 'Binary Switch Bank Status',
  127505: 'Fluid Level', 127506: 'DC Detailed Status', 127507: 'Charger Status', 127508: 'Battery Status', 127509: 'Inverter Status',
  127510: 'Charger Configuration', 127513: 'Battery Configuration', 127751: 'DC Voltage/Current', 128259: 'Speed, Water Referenced',
  128267: 'Water Depth', 128275: 'Distance Log', 129025: 'Position, Rapid Update', 129026: 'COG & SOG, Rapid Update', 129029: 'GNSS Position Data',
  129033: 'Time & Date', 129038: 'AIS Class A Position', 129039: 'AIS Class B Position', 129283: 'Cross Track Error', 129284: 'Navigation Data',
  129539: 'GNSS DOPs', 129540: 'GNSS Satellites in View', 130306: 'Wind Data', 130310: 'Environmental Parameters', 130311: 'Environmental Parameters',
  130312: 'Temperature', 130313: 'Humidity', 130314: 'Actual Pressure', 130316: 'Temperature, Extended Range',
}
const J1939_PGN = {
  61443: 'EEC2 — Accelerator pedal', 61444: 'EEC1 — Engine speed', 65226: 'DM1 — Active diagnostic codes', 65247: 'EEC3', 65248: 'Vehicle distance',
  65253: 'Engine hours', 65257: 'Fuel consumption', 65262: 'Engine temperature', 65263: 'Engine fluid level/pressure', 65265: 'CCVS — Vehicle speed',
  65266: 'Fuel economy', 65269: 'Ambient conditions', 65270: 'Inlet/exhaust conditions', 65271: 'Vehicle electrical power', 65276: 'Dash display',
}
// NMEA 2000 manufacturer codes (from the address claim NAME)
const N2K_MFR = {
  135: 'Airmar', 137: 'Maretron', 140: 'Lowrance', 144: 'Mercury Marine', 174: 'Volvo Penta', 229: 'Garmin', 275: 'Navico', 358: 'Victron Energy',
  381: 'B&G', 1851: 'Raymarine', 1855: 'Furuno', 1857: 'Simrad',
}

function j1939Parts(id) {
  const prio = (id >> 26) & 7, dp = (id >> 24) & 3, pf = (id >> 16) & 0xff, ps = (id >> 8) & 0xff, sa = id & 0xff
  const pgn = pf >= 240 ? (dp << 16) | (pf << 8) | ps : (dp << 16) | (pf << 8)
  return { prio, pgn, sa, da: pf < 240 ? ps : 255 }
}

const u16 = (b, o) => (b.length >= o + 2 ? b.readUInt16LE(o) : null)
const i16 = (b, o) => (b.length >= o + 2 ? b.readInt16LE(o) : null)
const valid16 = (v) => v != null && v !== 0xffff && v !== 0x7fff
const r = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d

// Single-frame NMEA 2000 / J1939 decoders → [{ label, value, unit }]
function decodePgn(pgn, b) {
  const f = []
  const add = (label, v, unit, d) => { if (v != null && Number.isFinite(v)) f.push({ label, value: r(v, d), unit }) }
  if (pgn === 127508) { // Battery Status
    const v = u16(b, 1), c = i16(b, 3), t = u16(b, 5)
    add('Battery instance', b[0], '', 0)
    if (valid16(v)) add('Voltage', v * 0.01, 'V')
    if (c != null && c !== 0x7fff) add('Current', c * 0.1, 'A', 1)
    if (valid16(t)) add('Temperature', t * 0.01 - 273.15, '°C', 1)
  } else if (pgn === 127506 && b.length >= 8) { // DC Detailed Status (first frame of fast packet — skipped)
  } else if (pgn === 129025) {
    if (b.length >= 8) { add('Latitude', b.readInt32LE(0) * 1e-7, '°', 6); add('Longitude', b.readInt32LE(4) * 1e-7, '°', 6) }
  } else if (pgn === 129026) {
    const cog = u16(b, 2), sog = u16(b, 4)
    if (valid16(cog)) add('COG', (cog * 0.0001 * 180) / Math.PI, '°', 1)
    if (valid16(sog)) add('SOG', sog * 0.01 * 1.94384, 'kn', 1)
  } else if (pgn === 127250) {
    const h = u16(b, 1)
    if (valid16(h)) add('Heading', (h * 0.0001 * 180) / Math.PI, '°', 1)
  } else if (pgn === 128259) {
    const s = u16(b, 1)
    if (valid16(s)) add('Speed through water', s * 0.01 * 1.94384, 'kn', 1)
  } else if (pgn === 130312) {
    const t = u16(b, 3)
    add('Instance', b[1], '', 0)
    if (valid16(t)) add('Temperature', t * 0.01 - 273.15, '°C', 1)
  } else if (pgn === 127488) {
    const rpm = u16(b, 1)
    add('Engine instance', b[0], '', 0)
    if (valid16(rpm)) add('Engine speed', rpm * 0.25, 'rpm', 0)
  } else if (pgn === 61444) { // J1939 EEC1
    const rpm = u16(b, 3)
    if (rpm != null && rpm < 0xfaff) add('Engine speed', rpm * 0.125, 'rpm', 0)
  } else if (pgn === 65262) {
    if (b[0] != null && b[0] < 0xfb) add('Coolant temperature', b[0] - 40, '°C', 0)
  } else if (pgn === 65265) {
    const s = u16(b, 1)
    if (s != null && s < 0xfaff) add('Vehicle speed', s / 256, 'km/h', 1)
  } else if (pgn === 65271) {
    const v = u16(b, 6)
    if (v != null && v < 0xfaff) add('Battery potential', v * 0.05, 'V', 2)
  }
  return f
}

// Address claim NAME (8 bytes LE) → manufacturer, function, class
function decodeName(b) {
  if (b.length < 8) return null
  const lo = b.readUInt32LE(0), hi = b.readUInt32LE(4)
  const mfr = lo >>> 21
  return { manufacturerCode: mfr, manufacturer: N2K_MFR[mfr] || null, uniqueNumber: lo & 0x1fffff, deviceFunction: hi >>> 8 & 0xff, deviceClass: (hi >>> 17) & 0x7f, industryGroup: (hi >>> 28) & 0x7 }
}

// "CAN-bus BMS" protocol (Pylontech, BYD, … towards Victron/SMA), 500 kbit/s
const BMS = {
  0x351: (b) => [['Charge voltage limit', u16(b, 0) * 0.1, 'V'], ['Charge current limit', i16(b, 2) * 0.1, 'A'], ['Discharge current limit', i16(b, 4) * 0.1, 'A'], ['Discharge voltage limit', u16(b, 6) * 0.1, 'V']],
  0x355: (b) => [['State of charge', u16(b, 0), '%'], ['State of health', u16(b, 2), '%']],
  0x356: (b) => [['Battery voltage', i16(b, 0) * 0.01, 'V'], ['Battery current', i16(b, 2) * 0.1, 'A'], ['Battery temperature', i16(b, 4) * 0.1, '°C']],
  0x35e: (b) => [['Manufacturer', b.toString('latin1').replace(/\0+$/, '').trim(), '']],
  0x35a: (b) => [['Alarm/warning bits', b.toString('hex'), '']],
  0x359: (b) => [['Protection/alarm bits', b.toString('hex'), '']],
  0x35c: (b) => [['Request flags', `0x${(b[0] ?? 0).toString(16)}`, '']],
}

const CANOPEN_STATE = { 0: 'Boot-up', 4: 'Stopped', 5: 'Operational', 127: 'Pre-operational' }

function canopenRole(id) {
  const fc = id >> 7, node = id & 0x7f
  if (id === 0) return 'NMT command'
  if (id === 0x80) return 'SYNC'
  if (id === 0x100) return 'TIME'
  if (fc === 1) return `EMCY · node ${node}`
  if (fc >= 3 && fc <= 10) return `${fc % 2 ? 'TPDO' : 'RPDO'}${Math.floor((fc - 1) / 2)} · node ${node}`
  if (fc === 11) return `SDO response · node ${node}`
  if (fc === 12) return `SDO request · node ${node}`
  if (fc === 14) return `Heartbeat · node ${node}`
  return null
}

function bitsPerFrame(ext, dlc) { return Math.round(((ext ? 67 : 47) + dlc * 8) * 1.1) } // ~10% stuffing

function analyze(frames, { seconds, bitrate } = {}) {
  const span = frames.length > 1 ? Math.max(0.001, (frames[frames.length - 1].t - frames[0].t) / 1000) : (seconds || 1)
  const window = Math.max(span, seconds || 0) || 1
  const byId = new Map()
  for (const f of frames) {
    const k = `${f.ext ? 'x' : 's'}${f.id}`
    let e = byId.get(k)
    if (!e) { e = { id: f.id, ext: f.ext, fd: f.fd, count: 0, dlcs: new Set(), first: f.data, last: f.data, changed: 0, samples: [], remote: 0, t0: f.t, t1: f.t }; byId.set(k, e) }
    e.count++; e.t1 = f.t
    if (f.remote) { e.remote++; continue }
    e.dlcs.add(f.data.length)
    for (let i = 0; i < Math.max(f.data.length, e.last.length); i++) if (f.data[i] !== e.last[i]) e.changed |= 1 << i
    e.last = f.data
    const hex = f.data.toString('hex')
    if (!e.samples.includes(hex)) { e.samples.push(hex); if (e.samples.length > 8) e.samples.shift() }
  }

  const ids = [...byId.values()]
  const ext = ids.filter((e) => e.ext)
  const std = ids.filter((e) => !e.ext)
  const stdSet = new Set(std.map((e) => e.id))

  // Protocol guess
  let protocol = 'unknown'
  const pgns = ext.map((e) => j1939Parts(e.id).pgn)
  const n2kHits = pgns.filter((p) => N2K_PGN[p]).length
  const j1939Hits = pgns.filter((p) => J1939_PGN[p]).length
  const bmsHits = [0x351, 0x355, 0x356, 0x35e, 0x359, 0x35a, 0x35c].filter((x) => stdSet.has(x)).length
  const heartbeats = std.filter((e) => e.id > 0x700 && e.id < 0x780 && [...e.dlcs].every((d) => d === 1) && CANOPEN_STATE[e.last[0] & 0x7f] != null)
  if (bmsHits >= 2) protocol = 'bms'
  else if (ext.length && n2kHits >= j1939Hits && n2kHits > 0) protocol = 'nmea2000'
  else if (ext.length && j1939Hits > 0) protocol = 'j1939'
  else if (heartbeats.length) protocol = 'canopen'
  else if (ext.length > std.length) protocol = 'j1939-like'

  const nodes = new Map()
  const rows = ids.sort((a, b) => a.ext - b.ext || a.id - b.id).map((e) => {
    const rate = e.count / window
    const row = {
      id: e.id, idHex: e.ext ? e.id.toString(16).toUpperCase().padStart(8, '0') : e.id.toString(16).toUpperCase().padStart(3, '0'),
      ext: e.ext, fd: e.fd, count: e.count, rate: r(rate, rate < 1 ? 2 : 1), periodMs: e.count > 1 ? Math.round((e.t1 - e.t0) / (e.count - 1)) : null,
      dlc: [...e.dlcs].sort((a, b) => a - b), data: e.last.toString('hex'), changedMask: e.changed, samples: e.samples, remote: e.remote,
      name: null, source: null, decoded: [],
    }
    if (e.ext) {
      const p = j1939Parts(e.id)
      row.pgn = p.pgn; row.source = p.sa; row.priority = p.prio; row.dest = p.da
      row.name = (protocol === 'j1939' ? J1939_PGN[p.pgn] || N2K_PGN[p.pgn] : N2K_PGN[p.pgn] || J1939_PGN[p.pgn]) || (p.pgn >= 65280 ? 'Proprietary' : null)
      row.decoded = decodePgn(p.pgn, e.last)
      const n = nodes.get(p.sa) || { address: p.sa, pgns: new Set(), frames: 0 }
      n.pgns.add(p.pgn); n.frames += e.count
      if (p.pgn === 60928) n.name = decodeName(e.last)
      nodes.set(p.sa, n)
    } else {
      if (protocol === 'bms' && BMS[e.id]) {
        row.name = { 0x351: 'BMS limits', 0x355: 'BMS state of charge', 0x356: 'BMS measurements', 0x35e: 'BMS manufacturer', 0x359: 'BMS protection', 0x35a: 'BMS alarms', 0x35c: 'BMS requests' }[e.id]
        row.decoded = BMS[e.id](e.last).filter(([, v]) => v != null && v !== '' && !(typeof v === 'number' && !Number.isFinite(v)))
          .map(([label, value, unit]) => ({ label, value: typeof value === 'number' ? r(value, 2) : value, unit }))
      } else if (protocol === 'canopen' || heartbeats.length) {
        row.name = canopenRole(e.id)
        if (e.id > 0x700 && e.id < 0x780 && e.last.length === 1) row.decoded = [{ label: 'NMT state', value: CANOPEN_STATE[e.last[0] & 0x7f] || `0x${e.last[0].toString(16)}`, unit: '' }]
        const node = e.id & 0x7f
        if (row.name && node) {
          const n = nodes.get(node) || { address: node, pgns: new Set(), frames: 0 }
          n.frames += e.count; nodes.set(node, n)
        }
      }
    }
    return row
  })

  // Bus load estimate
  const bits = ids.reduce((a, e) => a + e.count * bitsPerFrame(e.ext, Math.max(...e.dlcs, 0)), 0)
  const load = bitrate ? Math.min(100, r((bits / window / bitrate) * 100, 1)) : null

  const highlights = rows.flatMap((x) => x.decoded.filter((d) => !/instance/i.test(d.label)).map((d) => ({ ...d, from: x.name || x.idHex })))
  return {
    protocol,
    protocolLabel: {
      bms: 'Battery BMS (CAN-bus BMS protocol — Pylontech / BYD style)', nmea2000: 'NMEA 2000 (Victron VE.Can compatible)', j1939: 'SAE J1939 (vehicles, engines, generators)',
      canopen: 'CANopen', 'j1939-like': '29-bit IDs, unknown PGNs (J1939-style)', unknown: frames.length ? 'Unknown / proprietary' : 'No traffic',
    }[protocol],
    frames: frames.length, idCount: rows.length, fps: r(frames.length / window, 1), busLoad: load, truncated: frames.length >= MAX_FRAMES,
    nodes: [...nodes.values()].map((n) => ({ address: n.address, frames: n.frames, pgnCount: n.pgns.size, name: n.name || null })).sort((a, b) => a.address - b.address),
    ids: rows,
    highlights: highlights.slice(0, 24),
  }
}

module.exports = { interfaces, scan, analyze, parseCandumpLine, parseSlcan, j1939Parts, decodeName, SLCAN_RATE }
