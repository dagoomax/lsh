'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const scan = require('../src/usb-radio-scan');

// A stick's UART as the serialport package sees it, answering like the radio would
class FakePort extends EventEmitter {
  constructor(radio) { super(); this.radio = radio; this.written = []; }
  static for(radio) { return class extends FakePort { constructor(o) { super(radio); this.opts = o; } }; }
  open(cb) { cb(this.radio === 'busy' ? new Error('Error Resource temporarily unavailable Cannot lock port') : null); }
  close(cb) { cb(); }
  write(b) {
    this.written.push(Buffer.from(b).toString('hex'));
    const hex = Buffer.from(b).toString('hex');
    if (this.radio === 'zwave' && hex === scan.ZW_GET_VERSION.toString('hex')) {
      // ACK, then "Z-Wave 7.23" + library type 7 (bridge controller)
      const data = Buffer.concat([Buffer.from([0x01, 0x15]), Buffer.from('Z-Wave 7.23\0', 'latin1'), Buffer.from([0x07])]);
      const frame = Buffer.concat([Buffer.from([data.length + 1]), data]);
      const cs = [...frame].reduce((c, x) => c ^ x, 0xff);
      setTimeout(() => { this.emit('data', Buffer.from([0x06])); this.emit('data', Buffer.concat([Buffer.from([0x01]), frame, Buffer.from([cs])])); }, 5);
    }
    if (this.radio === 'zigbee' && hex === scan.ASH_RST.toString('hex')) {
      setTimeout(() => this.emit('data', Buffer.from([0xc1, 0x02, 0x0b, 0x0a, 0x52, 0x7e])), 5);
    }
  }
}

test('USB radios: known sticks by name, Z-Wave / Zigbee answers parsed', () => {
  assert.equal(scan.identify('usb-Silicon_Labs_CP2105_Dual_USB_to_UART_Bridge_Controller_00F4C829-if01-port0').id, 'cp2105-dual');
  assert.equal(scan.identify('usb-Aeotec_Z-Stick_10_Pro_123-if00').id, 'aeotec-zstick10pro');
  assert.equal(scan.identify('Z-Wave.Me Z-Station').id, 'zwaveme-zstation');
  assert.equal(scan.identify('usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_V2_abc-if00').id, 'sonoff-e');
  assert.equal(scan.identify('usb-FTDI_something'), null);
  assert.deepEqual(scan.parseAsh(Buffer.from([0x00, 0xc1, 0x02, 0x0b, 0x7d, 0x31, 0x52, 0x7e])), { radio: 'zigbee', protocol: 'EmberZNet (EZSP)', adapter: 'ember', resetReason: 0x0b });
  assert.equal(scan.parseZwave(Buffer.from([0x06, 0x01, 0x03, 0x01, 0x15, 0x00])), null); // bad checksum
});

test('USB radios: probing tells the two ports of a dual stick apart', async () => {
  const zw = await scan.probe('/dev/ttyUSB1', { timeout: 100, SerialPort: FakePort.for('zwave') });
  assert.deepEqual(zw, { path: '/dev/ttyUSB1', radio: 'zwave', version: 'Z-Wave 7.23', library: 'Bridge controller' });
  const zb = await scan.probe('/dev/ttyUSB0', { timeout: 100, SerialPort: FakePort.for('zigbee') });
  assert.equal(zb.radio, 'zigbee');
  assert.equal(zb.adapter, 'ember');
  const busy = await scan.probe('/dev/ttyUSB0', { timeout: 100, SerialPort: FakePort.for('busy') });
  assert.equal(busy.busy, true);
  const none = await scan.probe('/dev/ttyUSB2', { timeout: 100, SerialPort: FakePort.for('nothing') });
  assert.equal(none.radio, null);
  assert.match(none.error, /No answer/);
});

// zwave-js's own mock controller over TCP, the driver in zwave-usb-client, and
// the regular Z-Wave JS client on the local server — only where zwave-js is installed
let zwaveJs = null;
try { zwaveJs = require('zwave-js/Testing'); require('@zwave-js/server'); } catch { /* module not installed here */ }

test('Z-Wave USB: stick → local Z-Wave JS Server → Z-Wave JS client, end to end', { skip: !zwaveJs && 'zwave-js not installed', timeout: 60_000 }, async () => {
  const { CommandClasses } = require('@zwave-js/core');
  const DataStore = require('../src/data-store');
  const SensorRegistry = require('../src/sensor-registry');
  const ZwaveUsbClient = require('../src/zwave-usb-client');
  const ZwaveJsClient = require('../src/zwave-js-client');
  const free = () => new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
  const [mockPort, proxyPort, serverPort] = [await free(), await free(), await free()];
  const mock = new zwaveJs.MockServer({ port: mockPort, config: { nodes: [{ id: 2, capabilities: { commandClasses: [CommandClasses['Binary Switch'], CommandClasses.Version, CommandClasses['Manufacturer Specific']] } }] } });
  await mock.start();
  // the mock takes each TCP chunk as one message — pass ACK bytes and frames separately
  const proxy = net.createServer((c) => {
    const up = net.connect(mockPort, '127.0.0.1');
    const q = []; let busy = false;
    const pump = () => { if (busy || !q.length) return; busy = true; up.write(q.shift(), () => setTimeout(() => { busy = false; pump(); }, 2)); };
    c.on('data', (d) => { for (let i = 0; i < d.length;) { const n = d[i] === 0x01 && i + 1 < d.length ? d[i + 1] + 2 : 1; q.push(d.subarray(i, i + n)); i += n; } pump(); });
    up.on('data', (d) => c.write(d));
    c.on('close', () => up.destroy()); up.on('close', () => c.destroy());
  }).listen(proxyPort);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-zwave-'));
  const config = { zwaveUsb: { port: `tcp://127.0.0.1:${proxyPort}`, serverPort, logLevel: 'error' } };
  const store = new DataStore();
  const registry = new SensorRegistry(store, 'en');
  const usb = new ZwaveUsbClient(config, store, registry, { dir, driverOptions: { testingHooks: { skipFirmwareIdentification: true } } });
  const client = new ZwaveJsClient(config, store, registry);
  try {
    await usb.start();
    await client.start();
    let dev;
    for (let i = 0; i < 100 && !(dev = registry.getDevices().find((d) => d.key === 'zwaveJs/node_2')); i++) await new Promise((r) => setTimeout(r, 300));
    assert.ok(dev, 'node 2 discovered');
    assert.equal(client.usb, true);
    const sw = dev.sensors.find((s) => s.controllable);
    await registry.sendCommand(dev.key, sw.path, true);
    for (let i = 0; i < 20 && store.get(`${dev.key}/${sw.path}`) !== true; i++) await new Promise((r) => setTimeout(r, 200));
    assert.equal(store.get(`${dev.key}/${sw.path}`), true);
    const keys = JSON.parse(fs.readFileSync(path.join(dir, 'keys.json'), 'utf8'));
    assert.equal(Object.keys(keys.classic).length, 4);
    // same keys next start
    assert.deepEqual(ZwaveUsbClient.loadKeys(path.join(dir, 'keys.json')).securityKeys.S0_Legacy.toString('hex'), keys.classic.S0_Legacy);
  } finally {
    client.stop();
    await usb.stop();
    await mock.stop();
    proxy.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Z-Wave JS client: external server wins, else the USB stick’s local one', () => {
  const { target } = require('../src/zwave-js-client');
  assert.deepEqual(target({ zwaveJs: { host: '10.0.0.5' }, zwaveUsb: { port: '/dev/ttyUSB1' } }), { host: '10.0.0.5', port: 3000, usb: false });
  assert.deepEqual(target({ zwaveUsb: { port: '/dev/ttyUSB1' } }), { host: '127.0.0.1', port: 3010, usb: true });
  assert.equal(target({}), null);
});
