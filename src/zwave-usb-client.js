'use strict';

// Z-Wave USB stick (Aeotec Z-Stick 10 Pro, Z-Wave.Me Z-Station, any 500/700/
// 800-series Serial API controller) driven by LSH itself — no Z-Wave JS UI
// needed. This module runs the zwave-js driver on the stick's serial port and
// the Z-Wave JS Server (WebSocket) on 127.0.0.1; the regular Z-Wave JS client
// (src/zwave-js-client.js, in the server process) connects to that, so the
// devices, values, commands and Settings → inclusion are exactly the same as
// with an external Z-Wave JS UI.
//
//   "zwaveUsb": { "port": "/dev/serial/by-id/usb-Silicon_Labs_CP2105_…-if01-port0",
//                 "region": "Europe", "serverPort": 3010 }
//
// port can also be tcp://host:port (ser2net, a networked stick). The network
// security keys (S0, S2, Long Range) are generated on first start and kept in
// persist/zwave/keys.json — back that file up together with the stick, a new
// one can't talk to securely included devices. The driver cache (node
// interviews) is persist/zwave/cache.
//
// Dual sticks expose two serial ports — the other one is Zigbee
// (src/zigbee-client.js). Settings → Z-Wave / Zigbee USB tells them apart by
// probing (src/usb-radio-scan.js).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Driver, RFRegion } = require('zwave-js');
const { ZwavejsServer } = require('@zwave-js/server');
const platformStatus = require('./platform-status');

const DIR = path.join(__dirname, '..', 'persist', 'zwave');
const KEYS_FILE = path.join(DIR, 'keys.json');
const RETRY_MS = 30_000;
const DEFAULT_SERVER_PORT = 3010;
const KEY_NAMES = ['S2_Unauthenticated', 'S2_Authenticated', 'S2_AccessControl', 'S0_Legacy'];
const LR_KEY_NAMES = ['S2_Authenticated', 'S2_AccessControl'];

const serverPort = (config) => Number(config.zwaveUsb?.serverPort) || DEFAULT_SERVER_PORT;

// { securityKeys, securityKeysLongRange } as Buffers — created once, then reused
function loadKeys(file = KEYS_FILE) {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first start */ }
  const hex = (v) => (typeof v === 'string' && /^[0-9a-f]{32}$/i.test(v) ? v.toLowerCase() : null);
  let changed = false;
  const fill = (names, obj = {}) => Object.fromEntries(names.map((n) => {
    let v = hex(obj[n]);
    if (!v) { v = crypto.randomBytes(16).toString('hex'); changed = true; }
    return [n, v];
  }));
  const keys = { classic: fill(KEY_NAMES, saved.classic), longRange: fill(LR_KEY_NAMES, saved.longRange) };
  if (changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
    console.log('[Z-Wave USB] Generated network security keys (persist/zwave/keys.json — keep a backup)');
  }
  const buf = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Buffer.from(v, 'hex')]));
  return { securityKeys: buf(keys.classic), securityKeysLongRange: buf(keys.longRange) };
}

class ZwaveUsbClient {
  constructor(config, store, sensorRegistry, deps = {}) {
    this._config = config;
    this._dir = deps.dir || DIR;
    this._driverOptions = deps.driverOptions || {}; // tests: zwave-js testingHooks for its mock controller
    this._store = store;
    this._registry = sensorRegistry;
    this._driver = null;
    this._server = null;
    this._timer = null;
    this._stopped = false;
  }

  async start() {
    const cfg = this._config.zwaveUsb || {};
    if (!cfg.port) return;
    platformStatus.set('zwaveUsb', false);
    await this._open();
  }

  async _open() {
    const cfg = this._config.zwaveUsb;
    const region = cfg.region != null && cfg.region !== '' ? (typeof cfg.region === 'number' ? cfg.region : RFRegion[cfg.region]) : undefined;
    const driver = new Driver(cfg.port, {
      ...loadKeys(path.join(this._dir, 'keys.json')),
      storage: { cacheDir: path.join(this._dir, 'cache') },
      logConfig: { enabled: true, level: cfg.logLevel || 'warn', logToFile: false, forceConsole: true },
      emitValueUpdateAfterSetValue: true,
      ...(region != null ? { rf: { region } } : {}),
      ...this._driverOptions,
    });
    this._driver = driver;

    driver.on('error', (err) => {
      console.error(`[Z-Wave USB] ${err.message}`);
      platformStatus.set('zwaveUsb', false);
    });
    driver.once('driver ready', async () => {
      const c = driver.controller;
      console.log(`[Z-Wave USB] Stick ready — home ${c.homeId?.toString(16).padStart(8, '0')}, SDK ${c.sdkVersion || '?'}, ${c.nodes.size} node(s)`);
      try {
        const server = new ZwavejsServer(driver, { port: serverPort(this._config), host: '127.0.0.1', logger: serverLogger(), enableDNSServiceDiscovery: false });
        await server.start(true);
        this._server = server;
        console.log(`[Z-Wave USB] Z-Wave JS Server on 127.0.0.1:${serverPort(this._config)}`);
        platformStatus.set('zwaveUsb', true);
      } catch (err) {
        console.error(`[Z-Wave USB] Server start failed: ${err.message}`);
      }
    });

    try {
      await driver.start();
    } catch (err) {
      console.error(`[Z-Wave USB] Can't open ${cfg.port}: ${err.message} — retrying in ${RETRY_MS / 1000} s`);
      platformStatus.set('zwaveUsb', false);
      await driver.destroy().catch(() => {});
      this._driver = null;
      if (!this._stopped) this._timer = setTimeout(() => this._open().catch(() => {}), RETRY_MS);
    }
  }

  async stop() {
    this._stopped = true;
    clearTimeout(this._timer);
    await this._server?.destroy().catch(() => {});
    await this._driver?.destroy().catch(() => {});
    this._server = null;
    this._driver = null;
  }
}

function serverLogger() {
  const p = (m) => `[Z-Wave USB] ${m instanceof Error ? m.message : m}`;
  return { error: (m) => console.error(p(m)), warn: (m) => console.warn(p(m)), info: () => {}, debug: () => {} };
}

module.exports = ZwaveUsbClient;
module.exports.loadKeys = loadKeys;
module.exports.serverPort = serverPort;
