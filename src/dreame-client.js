'use strict';

const dgram          = require('dgram');
const crypto         = require('crypto');
const platformStatus = require('./platform-status');

const MIIO_PORT = 54321;
const POLL_MS   = 15_000;

// Hello discovery packet — all 0xFF after the magic + length
const HELLO = Buffer.from('21310020ffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');

// ── miio packet codec (AES-128-CBC, key=MD5(token), IV=MD5(key+token)) ────

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
  // Checksum = MD5( header[0:16] + raw_token + encrypted_payload )
  crypto.createHash('md5').update(pkt.slice(0, 16)).update(token).update(enc).digest().copy(pkt, 16);
  enc.copy(pkt, 32);
  return pkt;
}

function udpCall(host, pkt, ms = 5000) {
  return new Promise((resolve, reject) => {
    const sock  = dgram.createSocket('udp4');
    const timer = setTimeout(() => { sock.close(); reject(new Error(`UDP timeout ${host}`)); }, ms);
    sock.on('message', msg  => { clearTimeout(timer); sock.close(); resolve(msg); });
    sock.on('error',   err  => { clearTimeout(timer); sock.close(); reject(err); });
    sock.send(pkt, MIIO_PORT, host);
  });
}

// ── MiioDevice: one physical device ───────────────────────────────────────

class MiioDevice {
  constructor(host, tokenHex) {
    this.host      = host;
    this.token     = Buffer.from(tokenHex.replace(/\s/g, ''), 'hex');
    this.keys      = deriveKeys(this.token);
    this.deviceId  = 0;
    this._stamp    = 0;     // device stamp at hello time
    this._t0       = 0;     // local ms at hello time
    this._cmdId    = 1;
  }

  get stamp() { return this._stamp + Math.floor((Date.now() - this._t0) / 1000); }

  async hello() {
    const msg     = await udpCall(this.host, HELLO, 6000);
    this.deviceId = msg.readUInt32BE(8);
    this._stamp   = msg.readUInt32BE(12);
    this._t0      = Date.now();
  }

  async call(method, params) {
    const payload = Buffer.from(JSON.stringify({ id: this._cmdId++, method, params }));
    const pkt     = buildPacket(this.token, this.keys, this.deviceId, this.stamp, payload);
    const msg     = await udpCall(this.host, pkt, 5000);
    // Sync stamp from response
    const rStamp  = msg.readUInt32BE(12);
    if (rStamp > this._stamp) { this._stamp = rStamp; this._t0 = Date.now(); }
    const body    = miioDecrypt(this.keys, msg.slice(32));
    const json    = JSON.parse(body.toString().replace(/\x00+$/, ''));
    if (json.error) throw new Error(json.error.message ?? String(json.error.code));
    return json.result;
  }

  async getProperties(props) {
    const did    = String(this.deviceId);
    return this.call('get_properties', props.map(p => ({ did, ...p })));
  }

  async setProperty(siid, piid, value) {
    const did = String(this.deviceId);
    return this.call('set_properties', [{ did, siid, piid, value }]);
  }

  async action(siid, aiid, params = []) {
    const did = String(this.deviceId);
    return this.call('action', { did, siid, aiid, in: params });
  }
}

// ── Device type definitions ─────────────────────────────────────────────────

// Dreame robot vacuum — MIoT properties common across most models
const VACUUM_PROPS = [
  { siid: 3, piid: 1 },   // battery_level   0-100
  { siid: 2, piid: 2 },   // work_status     see map below
];
const VACUUM_STATUS = {
  0: 'Standby', 1: 'Sleeping', 2: 'Idle', 3: 'Cleaning',
  4: 'Paused',  5: 'Error',    6: 'Error', 17: 'Returning', 18: 'Docked',
};

// Dreame air purifier — MIoT properties
const PURIFIER_PROPS = [
  { siid: 2, piid: 1 },   // power           true/false
  { siid: 2, piid: 4 },   // mode            0=auto,1=sleep,2=favorite
  { siid: 3, piid: 4 },   // pm25            μg/m³
  { siid: 4, piid: 1 },   // filter_life     0-100 %
];

// ── DreameClient ────────────────────────────────────────────────────────────

class DreameClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._devs     = [];   // { miio, deviceKey, type }
    this._timer    = null;
  }

  async start() {
    const devices = this._config.dreame?.devices ?? [];
    if (!devices.length) throw new Error('No Dreame devices configured');

    for (const cfg of devices) {
      try {
        await this._init(cfg);
      } catch (err) {
        console.error(`[Dreame] Init failed for ${cfg.name || cfg.host}: ${err.message}`);
      }
    }
    if (!this._devs.length) throw new Error('No Dreame devices connected');

    platformStatus.set('dreame', true);
    this._timer = setInterval(() => this._pollAll(), POLL_MS);
    console.log(`[Dreame] Started — ${this._devs.length} device(s)`);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    console.log('[Dreame] Stopped');
  }

  // ── Init ────────────────────────────────────────────────────────────────

  async _init(cfg) {
    const { host, token } = cfg;
    if (!host || !token) throw new Error('host and token required');
    const tokenClean = token.replace(/\s/g, '');
    if (tokenClean.length !== 32) throw new Error('token must be 32 hex characters');

    const miio = new MiioDevice(host, tokenClean);
    await miio.hello();

    const type      = (cfg.type ?? 'vacuum').toLowerCase();
    const deviceKey = `dreame/${host.replace(/\./g, '_')}`;
    const label     = cfg.name || host;
    const entry     = { miio, deviceKey, type, name: label };

    const descriptor = type === 'purifier'
      ? this._purifierDescriptor(miio, deviceKey, label)
      : this._vacuumDescriptor(miio, deviceKey, label);

    this._devs.push(entry);
    this._registry.registerDevice(descriptor);
    await this._poll(entry);
    console.log(`[Dreame] Connected ${label} (${type}) at ${host}`);
  }

  _vacuumDescriptor(miio, deviceKey, label) {
    return {
      key:   deviceKey,
      type:  'dreame',
      label,
      icon:  '🤖',
      color: 'blue',
      sensors: [
        { path: 'battery',  name: 'Battery', format: 'percent', unit: '%', homekit: 'battery-level' },
        { path: 'status',   name: 'Status',  format: 'string',  raw: true },
        {
          path: 'cleaning',     name: 'Cleaning', format: 'on-off',
          controllable: true,   type: 'toggle',   homekit: 'switch-rw',
          writeOn: 'start',     writeOff: 'dock',  capabilityId: 'cleaning',
        },
      ],
      homekit: ['battery-level', 'switch-rw'],
      _writeCapability: (_capId, command) => this._cmdVacuum(miio, command),
    };
  }

  _purifierDescriptor(miio, deviceKey, label) {
    return {
      key:   deviceKey,
      type:  'dreame',
      label,
      icon:  '💨',
      color: 'blue',
      sensors: [
        {
          path: 'power',       name: 'Power', format: 'on-off',
          controllable: true,  type: 'toggle', homekit: 'switch-rw',
          writeOn: 'on',       writeOff: 'off', capabilityId: 'power',
        },
        { path: 'pm25',        name: 'PM2.5',       format: 'pm25',    unit: 'μg/m³', homekit: 'air-quality' },
        { path: 'filter_life', name: 'Filter Life',  format: 'percent', unit: '%' },
        { path: 'mode',        name: 'Mode',         format: 'number',  hidden: true },
      ],
      homekit: ['switch-rw', 'air-quality'],
      _writeCapability: (_capId, command) => this._cmdPurifier(miio, command),
    };
  }

  // ── Poll ────────────────────────────────────────────────────────────────

  async _pollAll() {
    await Promise.allSettled(this._devs.map(d => this._poll(d)));
  }

  async _poll({ miio, deviceKey, type, name }) {
    try {
      if (type === 'purifier') {
        const results = await miio.getProperties(PURIFIER_PROPS);
        for (const r of results) {
          if (r.code !== 0 && r.code !== undefined) continue;
          if (r.siid === 2 && r.piid === 1) this._store.update(`${deviceKey}/power`,       r.value ? 1 : 0);
          if (r.siid === 2 && r.piid === 4) this._store.update(`${deviceKey}/mode`,        r.value);
          if (r.siid === 3 && r.piid === 4) this._store.update(`${deviceKey}/pm25`,        r.value);
          if (r.siid === 4 && r.piid === 1) this._store.update(`${deviceKey}/filter_life`, r.value);
        }
      } else {
        const results = await miio.getProperties(VACUUM_PROPS);
        for (const r of results) {
          if (r.code !== 0 && r.code !== undefined) continue;
          if (r.siid === 3 && r.piid === 1) {
            this._store.update(`${deviceKey}/battery`, r.value);
          }
          if (r.siid === 2 && r.piid === 2) {
            this._store.update(`${deviceKey}/status`,  VACUUM_STATUS[r.value] ?? `State ${r.value}`);
            // cleaning = 1 when actively sweeping or returning (not idle/charged/error)
            this._store.update(`${deviceKey}/cleaning`, [3, 17].includes(r.value) ? 1 : 0);
          }
        }
      }
    } catch (err) {
      console.error(`[Dreame] Poll failed for ${name}: ${err.message}`);
    }
  }

  // ── Commands ────────────────────────────────────────────────────────────

  async _cmdVacuum(miio, command) {
    try {
      if (command === 'start') await miio.action(2, 1); // start_sweep
      else if (command === 'dock') await miio.action(2, 5); // return_to_base
      else if (command === 'pause') await miio.action(2, 2); // pause
    } catch (err) {
      console.error(`[Dreame] Vacuum command "${command}" failed: ${err.message}`);
    }
  }

  async _cmdPurifier(miio, command) {
    try {
      await miio.setProperty(2, 1, command === 'on');
    } catch (err) {
      console.error(`[Dreame] Purifier command "${command}" failed: ${err.message}`);
    }
  }
}

module.exports = DreameClient;
