'use strict';

// Settings → Z-Wave / Zigbee USB: find the stick's serial ports and tell which
// one is the Z-Wave and which the Zigbee radio. Dual sticks (Aeotec Z-Stick
// 10 Pro, Z-Wave.Me Z-Station) are one Silicon Labs CP2105 bridge with two
// UARTs — same USB ids, and the order (if00/if01, ttyUSB0/1) differs between
// units — so each port is asked directly:
//
//   Z-Wave  Serial API: FUNC_ID_ZW_GET_VERSION (0x15) → "Z-Wave 7.xx" + library type
//   Zigbee  EmberZNet NCP (EZSP over ASH): RST → RSTACK
//
// Both at 115200 8N1, about a second each; a port that's open elsewhere
// (the running Z-Wave / Zigbee module, Zigbee2MQTT…) reports "busy" and is
// left alone. Read-only: nothing is written to the radios' settings.

const fs = require('fs');
const path = require('path');

const BAUD = 115200;
const TIMEOUT = 1200;

// Known sticks — matched on the by-id name / USB description
const STICKS = [
  { id: 'aeotec-zstick10pro', label: 'Aeotec Z-Stick 10 Pro', radios: ['zwave', 'zigbee'], adapter: 'ember', rtscts: false,
    match: /Z-?Stick[ _-]?10/i, note: 'Zigbee needs firmware 7.4.3 or newer (EmberZNet); Z-Wave 7.23.2 recommended.' },
  { id: 'zwaveme-zstation', label: 'Z-Wave.Me Z-Station', radios: ['zwave', 'zigbee'], adapter: 'ember', rtscts: false,
    match: /Z-?Station|Z-Wave\.Me|ZME/i, note: 'Zigbee needs the Zigbee NCP firmware, 2024.04.22 or newer.' },
  // Both dual sticks report a plain CP2105 — "one of the two" until probed
  { id: 'cp2105-dual', label: 'Dual Z-Wave + Zigbee stick (CP2105)', radios: ['zwave', 'zigbee'], adapter: 'ember', rtscts: false,
    match: /CP2105|10c4:ea70/i },
  { id: 'aeotec-zstick7', label: 'Aeotec Z-Stick 7', radios: ['zwave'], match: /Z-?Stick[ _-]?7|0658:0200/i },
  { id: 'zooz-zst', label: 'Zooz ZST10/ZST39', radios: ['zwave'], match: /Zooz|ZST(10|39)/i },
  { id: 'nabu-zwa2', label: 'Home Assistant Connect ZWA-2', radios: ['zwave'], match: /ZWA-?2/i },
  { id: 'nabu-zbt', label: 'Home Assistant Connect ZBT-1/2 / SkyConnect', radios: ['zigbee'], adapter: 'ember', match: /SkyConnect|ZBT-?[12]/i },
  { id: 'sonoff-p', label: 'Sonoff ZBDongle-P', radios: ['zigbee'], adapter: 'zstack', match: /ZBDongle-?P|Sonoff_Zigbee_3\.0_USB_Dongle_Plus.*CP210/i },
  { id: 'sonoff-e', label: 'Sonoff ZBDongle-E', radios: ['zigbee'], adapter: 'ember', match: /ZBDongle-?E|Dongle_Plus_V2|1a86:55d4/i },
  { id: 'conbee', label: 'ConBee', radios: ['zigbee'], adapter: 'deconz', match: /ConBee|RaspBee|dresden/i },
];

function identify(text) {
  return STICKS.find((s) => s.match.test(text)) || null;
}

// Serial ports without the serialport package: stable by-id names on Linux,
// the usual USB-serial device nodes elsewhere
function listPorts() {
  const out = [];
  const seen = new Set();
  const byId = '/dev/serial/by-id';
  try {
    for (const name of fs.readdirSync(byId).sort()) {
      const p = path.join(byId, name);
      let real = p;
      try { real = fs.realpathSync(p); } catch { /* dangling */ }
      seen.add(real);
      const iface = /-if(\d+)/.exec(name)?.[1];
      out.push({ path: p, device: real, name, interface: iface != null ? Number(iface) : null });
    }
  } catch { /* not Linux / no USB serial */ }
  let dev = [];
  try { dev = fs.readdirSync('/dev'); } catch { /* Windows */ }
  for (const n of dev.sort()) {
    if (!/^(ttyUSB\d+|ttyACM\d+|cu\.(usbserial|usbmodem|SLAB_USBtoUART|wchusbserial)[\w.-]*)$/.test(n)) continue;
    const p = `/dev/${n}`;
    if (seen.has(p)) continue;
    out.push({ path: p, device: p, name: n, interface: null });
  }
  return out.map((p) => ({ ...p, stick: identify(p.name)?.label || null }));
}

// USB ids / descriptions from the serialport package, when it's there
async function describe(ports) {
  let SerialPort;
  try { ({ SerialPort } = require('serialport')); } catch { return ports; }
  let list = [];
  try { list = await SerialPort.list(); } catch { return ports; }
  return ports.map((p) => {
    const l = list.find((x) => x.path === p.device || x.path === p.path);
    if (!l) return p;
    const usb = l.vendorId ? `${l.vendorId}:${l.productId}`.toLowerCase() : null;
    const text = [p.name, l.manufacturer, l.friendlyName, l.pnpId, usb].filter(Boolean).join(' ');
    return { ...p, usb, manufacturer: l.manufacturer || null, serialNumber: l.serialNumber || null, stick: identify(text)?.label || p.stick };
  });
}

// ── Probes ──

const zwChecksum = (bytes) => bytes.reduce((c, b) => c ^ b, 0xff);
const ZW_GET_VERSION = Buffer.from([0x01, 0x03, 0x00, 0x15, zwChecksum([0x03, 0x00, 0x15])]);
// ASH: cancel + RST frame (CRC-CCITT of 0xC0 = 0x38BC)
const ASH_RST = Buffer.from([0x1a, 0xc0, 0x38, 0xbc, 0x7e]);

// Z-Wave response: [ACK] SOF len 0x01 0x15 "Z-Wave x.yy\0" libType checksum
function parseZwave(buf) {
  const i = buf.indexOf(0x01);
  for (let s = i; s >= 0 && s < buf.length; s = buf.indexOf(0x01, s + 1)) {
    const len = buf[s + 1];
    if (len == null || s + len + 2 > buf.length) continue;
    if (buf[s + 2] !== 0x01 || buf[s + 3] !== 0x15) continue;
    const frame = buf.subarray(s + 1, s + len + 1);
    if (zwChecksum([...frame]) !== buf[s + len + 1]) continue;
    const data = buf.subarray(s + 4, s + len + 1);
    const nul = data.indexOf(0);
    const version = data.subarray(0, nul >= 0 ? nul : data.length - 1).toString('latin1').trim();
    const LIB = { 1: 'Static controller', 2: 'Controller', 7: 'Bridge controller' };
    return { radio: 'zwave', version, library: LIB[data[nul + 1]] || null };
  }
  return null;
}

// RSTACK: 0xC1 0x02 <reset reason> CRC CRC 0x7E — a CRC byte may be escaped
// (0x7D xx), so the flag can come a byte or two later
function parseAsh(buf) {
  for (let s = buf.indexOf(0xc1); s >= 0; s = buf.indexOf(0xc1, s + 1)) {
    const flag = buf.indexOf(0x7e, s + 5);
    if (buf[s + 1] === 0x02 && flag >= 0 && flag <= s + 7) return { radio: 'zigbee', protocol: 'EmberZNet (EZSP)', adapter: 'ember', resetReason: buf[s + 2] };
  }
  return null;
}

function exchange(port, bytes, parse, ms = TIMEOUT) {
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0);
    const done = (r) => { clearTimeout(t); port.off('data', onData); resolve(r); };
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      const r = parse(buf);
      if (r) { if (r.radio === 'zwave') port.write(Buffer.from([0x06])); done(r); }
    };
    const t = setTimeout(() => done(null), ms);
    port.on('data', onData);
    port.write(bytes);
  });
}

async function probe(portPath, { baudRate = BAUD, rtscts = false, timeout = TIMEOUT, SerialPort } = {}) {
  if (!SerialPort) {
    try { ({ SerialPort } = require('serialport')); }
    catch { const e = new Error('The serialport package is not installed (USB radio scan module)'); e.needsModule = true; throw e; }
  }
  const port = new SerialPort({ path: portPath, baudRate, rtscts, autoOpen: false });
  try {
    await new Promise((res, rej) => port.open((err) => (err ? rej(err) : res())));
  } catch (err) {
    const busy = /busy|lock|access denied|EBUSY|EACCES|Cannot lock/i.test(err.message);
    return { path: portPath, radio: null, busy, error: busy ? 'In use by another program (or an LSH module)' : err.message };
  }
  try {
    // NAK flushes a half-received Z-Wave frame; then ask each protocol in turn
    port.write(Buffer.from([0x15]));
    const zw = await exchange(port, ZW_GET_VERSION, parseZwave, timeout);
    if (zw) return { path: portPath, ...zw };
    const zb = await exchange(port, ASH_RST, parseAsh, timeout + 800);
    if (zb) return { path: portPath, ...zb };
    return { path: portPath, radio: null, error: 'No answer as Z-Wave or EmberZNet Zigbee (other firmware, or not a radio)' };
  } finally {
    await new Promise((res) => port.close(() => res()));
  }
}

async function scan({ skip = [] } = {}) {
  const ports = await describe(listPorts());
  const out = [];
  for (const p of ports) {
    if (skip.includes(p.path) || skip.includes(p.device)) { out.push({ ...p, radio: null, busy: true, inUse: true }); continue; }
    try { out.push({ ...p, ...(await probe(p.path)), path: p.path }); }
    catch (err) { if (err.needsModule) throw err; out.push({ ...p, radio: null, error: err.message }); }
  }
  return out;
}

module.exports = { STICKS, identify, listPorts, describe, probe, scan, parseZwave, parseAsh, ZW_GET_VERSION, ASH_RST };
