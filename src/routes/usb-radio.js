'use strict';

// Settings → Z-Wave / Zigbee USB — LSH's own Z-Wave and Zigbee networks on a
// USB stick (Aeotec Z-Stick 10 Pro, Z-Wave.Me Z-Station, single-radio sticks).
//
//   GET  /usb-radio/status          both radios, their processes, Zigbee devices
//   GET  /usb-radio/ports           serial ports, known sticks (no probing)
//   POST /usb-radio/probe           ask each free port: Z-Wave or Zigbee?
//   POST /settings/usb-radio        save config.zwaveUsb / config.zigbee and apply live
//   POST /usb-radio/zigbee/permit   { on } — pairing for 4 min
//   POST /usb-radio/zigbee/remove   { ieee }
//
// Z-Wave inclusion goes through /wiring/zwave/* (the Z-Wave JS client is the
// same one, pointed at the local server). The radio modules run in their own
// processes (src/zwave-usb-client.js, src/zigbee-client.js), so Zigbee
// commands are device commands on zigbee/coordinator.
const fs = require('fs');
const path = require('path');
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');
const INTEGRATIONS = require('../integrations');
const platformStatus = require('../platform-status');

const COORD = 'zigbee/coordinator';
const PORT_RE = /^(\/dev\/[\w./:+@-]+|COM\d{1,3}|tcp:\/\/[\w.-]+:\d{1,5})$/;
const ADAPTERS = ['ember', 'zstack', 'deconz', 'zboss', 'zigate', 'ezsp'];
const REGIONS = ['', 'Europe', 'USA', 'Australia/New Zealand', 'Hong Kong', 'India', 'Israel', 'Russia', 'China', 'Japan', 'Korea',
  'USA (Long Range)', 'Europe (Long Range)'];
const COORD_KEYS = ['permitJoin', 'permitJoinLeft', 'devices', 'channel', 'panId', 'firmware', 'lastJoined'];

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, sensorRegistry, store } = ctx;
  const scanMod = (res) => {
    try { return require('../usb-radio-scan') } catch {
      res.status(409).json({ success: false, needsModule: true, error: 'The USB radio scan module is not installed on this LSH host' });
      return null;
    }
  };
  const proc = (file) => clients.moduleHost?.get(file)?.info?.() || null;
  const busyPorts = () => {
    const c = readConfigFile();
    return [c.zwaveUsb?.port, c.zigbee?.port].filter(Boolean);
  };

  router.get('/usb-radio/status', requireAdmin, (req, res) => {
    const c = readConfigFile();
    const ps = platformStatus.getAll?.() || {};
    const z = clients.zwaveJs;
    const members = store.get(`${COORD}/members`);
    const zigbeeDevices = sensorRegistry.getDevices().filter((d) => d.type === 'zigbee' && d.key !== COORD && (!Array.isArray(members) || members.includes(d.key))).map((d) => ({
      key: d.key, label: d.label, model: d.model, ieee: d.ieee || `0x${d.key.split('/')[1]}`, room: d.room || null,
      linkquality: store.get(`${d.key}/linkquality`), battery: store.get(`${d.key}/battery`),
    }));
    const zwaveNodes = sensorRegistry.getDevices().filter((d) => d.type === 'zwaveJs').length;
    res.json({
      success: true,
      data: {
        zwave: c.zwaveUsb?.port ? {
          port: c.zwaveUsb.port, region: c.zwaveUsb.region || '', stick: !!ps.zwaveUsb, connected: !!z?.connected && !!z?.usb,
          homeId: z?.usb && z?.homeId ? Number(z.homeId).toString(16).padStart(8, '0') : null, nodes: zwaveNodes,
          process: proc('zwave-usb-client'), external: !!c.zwaveJs?.host,
        } : null,
        zigbee: c.zigbee?.port ? {
          port: c.zigbee.port, adapter: c.zigbee.adapter || 'ember', channel: c.zigbee.channel || 15, rtscts: !!c.zigbee.rtscts,
          running: !!ps.zigbee, process: proc('zigbee-client'),
          ...Object.fromEntries(COORD_KEYS.map((k) => [k, store.get(`${COORD}/${k}`)]).filter(([, v]) => v != null)),
          devices: zigbeeDevices,
        } : null,
        stick: c.zigbee?.stick || c.zwaveUsb?.stick || '',
        regions: REGIONS, adapters: ADAPTERS,
      },
    });
  });

  router.get('/usb-radio/ports', requireAdmin, async (req, res) => {
    const m = scanMod(res); if (!m) return;
    try {
      const ports = await m.describe(m.listPorts());
      const busy = busyPorts();
      res.json({ success: true, data: { ports: ports.map((p) => ({ ...p, inUse: busy.includes(p.path) || busy.includes(p.device) })), sticks: m.STICKS.map(({ match, ...s }) => s), platform: process.platform } });
    } catch (err) { res.status(400).json({ success: false, error: err.message }) }
  });

  router.post('/usb-radio/probe', requireAdmin, async (req, res) => {
    const m = scanMod(res); if (!m) return;
    const one = String(req.body?.path || '').trim();
    try {
      if (one) {
        if (!PORT_RE.test(one) || one.startsWith('tcp://')) return res.status(400).json({ success: false, error: 'Not a serial port path' });
        if (busyPorts().includes(one)) return res.json({ success: true, data: [{ path: one, radio: null, busy: true, inUse: true }] });
        return res.json({ success: true, data: [await m.probe(one)] });
      }
      res.json({ success: true, data: await m.scan({ skip: busyPorts() }) });
    } catch (err) {
      res.status(err.needsModule ? 409 : 400).json({ success: false, error: err.message, needsModule: !!err.needsModule });
    }
  });

  router.post('/settings/usb-radio', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const prev = readConfigFile();
    const stick = String(b.stick || '').slice(0, 40);
    let zwaveUsb = null;
    let zigbee = null;
    if (b.zwave?.enabled) {
      const port = String(b.zwave.port || '').trim();
      if (!PORT_RE.test(port)) return res.status(400).json({ success: false, error: 'Z-Wave: choose the stick’s serial port (e.g. /dev/serial/by-id/…, /dev/ttyUSB1, COM6 or tcp://host:port)' });
      const region = String(b.zwave.region || '');
      if (!REGIONS.includes(region)) return res.status(400).json({ success: false, error: 'Z-Wave: unknown region' });
      zwaveUsb = { ...(prev.zwaveUsb || {}), port, stick };
      if (region) zwaveUsb.region = region; else delete zwaveUsb.region;
    }
    if (b.zigbee?.enabled) {
      const port = String(b.zigbee.port || '').trim();
      if (!PORT_RE.test(port)) return res.status(400).json({ success: false, error: 'Zigbee: choose the stick’s serial port (e.g. /dev/serial/by-id/…, /dev/ttyUSB0, COM5 or tcp://host:port)' });
      if (zwaveUsb && port === zwaveUsb.port) return res.status(400).json({ success: false, error: 'Z-Wave and Zigbee are two different ports of the stick — they can’t be the same' });
      const adapter = ADAPTERS.includes(b.zigbee.adapter) ? b.zigbee.adapter : 'ember';
      const channel = Number(b.zigbee.channel) || 15;
      if (channel < 11 || channel > 26) return res.status(400).json({ success: false, error: 'Zigbee channel must be 11–26' });
      zigbee = { ...(prev.zigbee || {}), port, adapter, channel, rtscts: !!b.zigbee.rtscts, stick };
      const baud = Number(b.zigbee.baudRate);
      if (baud) zigbee.baudRate = baud; else delete zigbee.baudRate;
    }
    const next = { ...prev };
    if (zwaveUsb) next.zwaveUsb = zwaveUsb; else delete next.zwaveUsb;
    if (zigbee) next.zigbee = zigbee; else delete next.zigbee;
    try { writeConfigFile(next) }
    catch (err) { return res.status(500).json({ success: false, error: err.message }) }

    if (!clients.moduleHost) return res.json({ success: true, message: 'Saved — restart LSH to apply.' });
    try {
      // a fresh install ships core only — fetch the modules (and zwave-js / zigbee-herdsman) first
      const ids = [zwaveUsb && 'zwave-usb', zwaveUsb && 'zwave-js', zigbee && 'zigbee'].filter(Boolean);
      const missing = ids.filter((id) => !installed(id));
      if (missing.length) await require('../module-manager').install(missing, next);

      for (const file of ['zwave-usb-client', 'zigbee-client']) {
        await clients.moduleHost.apply(INTEGRATIONS.find((x) => x.file === file));
      }
      await restartZwaveJs(clients, next, store, sensorRegistry);
      res.json({ success: true, message: zwaveUsb || zigbee ? 'Saved and applied — the stick starts in a few seconds.' : 'Saved — USB radios stopped.' });
    } catch (err) {
      res.json({ success: true, message: `Saved; restart LSH to apply (${err.message}).` });
    }
  });

  const zigbeeCmd = (res, sensor, value) => sensorRegistry.sendCommand(COORD, sensor, value)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(/not running|not found/i.test(err.message) ? 503 : 400).json({ success: false, error: err.message }));

  router.post('/usb-radio/zigbee/permit', requireAdmin, (req, res) => zigbeeCmd(res, 'permitJoin', req.body?.on !== false));
  router.post('/usb-radio/zigbee/remove', requireAdmin, (req, res) => {
    const ieee = String(req.body?.ieee || '').toLowerCase();
    if (!/^0x[0-9a-f]{16}$/.test(ieee)) return res.status(400).json({ success: false, error: 'IEEE address like 0x00158d0001a2b3c4' });
    zigbeeCmd(res, 'remove', ieee);
  });
};

// A module's files and npm deps on disk (same file check as module-manager)
function installed(id) {
  let mod;
  try { mod = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'modules.json'), 'utf8')).modules[id]; } catch { return true; }
  if (!mod) return true;
  const root = path.join(__dirname, '..', '..');
  const dep = (d) => {
    if (fs.existsSync(path.join(root, 'node_modules', d, 'package.json'))) return true;
    try { require.resolve(`${d}/package.json`); return true; } catch { return false; } // NODE_PATH installs
  };
  return mod.files.every((f) => fs.existsSync(path.join(root, f))) && Object.keys(mod.deps || {}).every(dep);
}

// The Z-Wave JS client lives in the server process (Settings → inclusion calls
// it directly) — recreate it for the new target: external server, the USB
// stick's local one, or none.
async function restartZwaveJs(clients, config, store, sensorRegistry) {
  const Client = require('../zwave-js-client');
  const want = Client.target(config);
  const cur = clients.zwaveJs;
  if (cur) {
    const t = Client.target(cur._config);
    if (want && t && t.host === want.host && t.port === want.port) return;
    cur.stop();
    delete clients.zwaveJs;
  }
  if (!want) return;
  const client = new Client(config, store, sensorRegistry);
  clients.zwaveJs = client;
  await client.start();
}
