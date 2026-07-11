'use strict';

const dgram          = require('dgram');
const crypto         = require('crypto');
const platformStatus = require('./platform-status');

const MIIO_PORT = 54321;
const POLL_MS   = 15_000;

const HELLO = Buffer.from('21310020ffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');

const STATE = {
  1:  'Starting',     2:  'Idle',          3:  'Idle',
  4:  'Remote ctrl',  5:  'Cleaning',       6:  'Returning',
  7:  'Manual',       8:  'Charging',       9:  'Charge error',
  10: 'Paused',       11: 'Spot cleaning',  12: 'Error',
  13: 'Shutting down',14: 'Updating',       15: 'Docking',
  16: 'Going to target', 17: 'Zone cleaning', 18: 'Room cleaning',
  100: 'Fully charged',
};

const ERROR = {
  0:  'None',         1:  'Laser sensor',   2:  'Collision sensor',
  3:  'Wheel floating', 4: 'Cliff sensor',  5:  'Main brush blocked',
  6:  'Side brush',   7:  'Wheel blocked',  8:  'No dustbox',
  9:  'Dustbox full', 10: 'Filter blocked', 12: 'Low battery',
  13: 'Charging error', 14: 'Battery fault',
};

// ── miio codec (shared with dreame pattern) ────────────────────────────────

function deriveKeys(token) {
  const key = crypto.createHash('md5').update(token).digest();
  const iv  = crypto.createHash('md5').update(key).update(token).digest();
  return { key, iv };
}

function miioEncrypt({ key, iv }, buf) {
  const c = crypto.createCipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([c.update(buf), c.final()]);
}

function miioDecrypt({ key, iv }, buf) {
  const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([d.update(buf), d.final()]);
}

function buildPacket(token, keys, deviceId, stamp, payloadBuf) {
  const enc = miioEncrypt(keys, payloadBuf);
  const pkt = Buffer.alloc(32 + enc.length, 0);
  pkt.writeUInt16BE(0x2131, 0);
  pkt.writeUInt16BE(pkt.length, 2);
  pkt.writeUInt32BE(deviceId, 8);
  pkt.writeUInt32BE(stamp, 12);
  crypto.createHash('md5').update(pkt.slice(0, 16)).update(token).update(enc).digest().copy(pkt, 16);
  enc.copy(pkt, 32);
  return pkt;
}

function udpCall(host, pkt, ms = 5000) {
  return new Promise((resolve, reject) => {
    const sock  = dgram.createSocket('udp4');
    const timer = setTimeout(() => { sock.close(); reject(new Error(`UDP timeout ${host}`)); }, ms);
    sock.on('message', msg => { clearTimeout(timer); sock.close(); resolve(msg); });
    sock.on('error',   err => { clearTimeout(timer); sock.close(); reject(err); });
    sock.send(pkt, MIIO_PORT, host);
  });
}

// ── MiioDevice ─────────────────────────────────────────────────────────────

class MiioDevice {
  constructor(host, tokenHex) {
    this.host     = host;
    this.token    = Buffer.from(tokenHex.replace(/\s/g, ''), 'hex');
    this.keys     = deriveKeys(this.token);
    this.deviceId = 0;
    this._stamp   = 0;
    this._t0      = 0;
    this._cmdId   = 1;
  }

  get stamp() { return this._stamp + Math.floor((Date.now() - this._t0) / 1000); }

  async hello() {
    const msg     = await udpCall(this.host, HELLO, 6000);
    this.deviceId = msg.readUInt32BE(8);
    this._stamp   = msg.readUInt32BE(12);
    this._t0      = Date.now();
  }

  async call(method, params = []) {
    const payload = Buffer.from(JSON.stringify({ id: this._cmdId++, method, params }));
    const pkt     = buildPacket(this.token, this.keys, this.deviceId, this.stamp, payload);
    const msg     = await udpCall(this.host, pkt, 5000);
    const rStamp  = msg.readUInt32BE(12);
    if (rStamp > this._stamp) { this._stamp = rStamp; this._t0 = Date.now(); }
    const body    = miioDecrypt(this.keys, msg.slice(32));
    const json    = JSON.parse(body.toString().replace(/\x00+$/, ''));
    if (json.error) throw new Error(json.error.message ?? String(json.error.code));
    return json.result;
  }
}

// ── RoborockClient ─────────────────────────────────────────────────────────

class RoborockClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._devs     = [];
    this._timer    = null;
  }

  async start() {
    const devices = this._config.roborock?.devices ?? [];
    if (!devices.length) throw new Error('No Roborock devices configured');

    for (const cfg of devices) {
      try {
        await this._init(cfg);
      } catch (err) {
        console.error(`[Roborock] Init failed for ${cfg.name || cfg.host}: ${err.message}`);
      }
    }
    if (!this._devs.length) throw new Error('No Roborock devices connected');

    platformStatus.set('roborock', true);
    this._timer = setInterval(() => this._pollAll(), POLL_MS);
    console.log(`[Roborock] Started — ${this._devs.length} device(s)`);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    console.log('[Roborock] Stopped');
  }

  async _init(cfg) {
    const { host, token } = cfg;
    if (!host || !token) throw new Error('host and token required');
    const tokenClean = token.replace(/\s/g, '');
    if (tokenClean.length !== 32) throw new Error('token must be 32 hex characters');

    const miio      = new MiioDevice(host, tokenClean);
    await miio.hello();

    const deviceKey = `roborock/${host.replace(/\./g, '_')}`;
    const label     = cfg.name || host;
    const entry     = { miio, deviceKey, name: label };

    this._registry.registerDevice({
      key:   deviceKey,
      type:  'roborock',
      label,
      icon:  '🤖',
      color: 'blue',
      sensors: [
        { path: 'battery',    name: 'Battery',    format: 'percent', unit: '%', homekit: 'battery-level' },
        { path: 'state',      name: 'State',      format: 'string',  raw: true },
        { path: 'error',      name: 'Error',      format: 'string',  raw: true },
        { path: 'clean_time', name: 'Clean time', format: 'number',  unit: 'min' },
        { path: 'clean_area', name: 'Clean area', format: 'number',  unit: 'm²' },
        {
          path: 'cleaning',  name: 'Cleaning', format: 'on-off',
          controllable: true, type: 'toggle',  homekit: 'switch-rw',
          writeOn: 'start',   writeOff: 'dock', capabilityId: 'cleaning',
        },
      ],
      homekit: ['battery-level', 'switch-rw'],
      _writeCapability: (_capId, command) => this._command(miio, label, command),
    });

    this._devs.push(entry);
    await this._poll(entry);
    console.log(`[Roborock] Connected: ${label} at ${host}`);
  }

  async _pollAll() {
    await Promise.allSettled(this._devs.map(d => this._poll(d)));
  }

  async _poll({ miio, deviceKey, name }) {
    try {
      const [status] = await miio.call('get_status');
      const stateCode = status.state ?? 0;
      this._store.update(`${deviceKey}/battery`,    status.battery ?? 0);
      this._store.update(`${deviceKey}/state`,      STATE[stateCode] ?? `State ${stateCode}`);
      this._store.update(`${deviceKey}/error`,      ERROR[status.error_code] ?? `Error ${status.error_code}`);
      this._store.update(`${deviceKey}/clean_time`, Math.round((status.clean_time ?? 0) / 60));
      this._store.update(`${deviceKey}/clean_area`, Math.round((status.clean_area ?? 0) / 1000000));
      this._store.update(`${deviceKey}/cleaning`,   [5, 6, 11, 15, 16, 17, 18].includes(stateCode) ? 1 : 0);
    } catch (err) {
      console.error(`[Roborock] Poll failed for ${name}: ${err.message}`);
    }
  }

  async _command(miio, name, command) {
    try {
      if (command === 'start')  await miio.call('app_start');
      else if (command === 'dock')  await miio.call('app_charge');
      else if (command === 'pause') await miio.call('app_pause');
      else if (command === 'stop')  await miio.call('app_stop');
    } catch (err) {
      console.error(`[Roborock] Command "${command}" failed for ${name}: ${err.message}`);
    }
  }
}

module.exports = RoborockClient;
