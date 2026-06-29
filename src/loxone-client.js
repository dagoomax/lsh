'use strict';

const WebSocket      = require('ws');
const crypto         = require('crypto');
const http           = require('http');
const EventEmitter   = require('events');
const platformStatus = require('./platform-status');

// ── Control type definitions ───────────────────────────────────────────────
//
// bindings:     numeric state UUID → store path(s)
// textBindings: text state UUID → store path(s)
// sensors:      descriptor array passed to sensor-registry
//
// _writeCapability(capId, command, args) semantics:
//   toggle  → command is 'On'/'Off'/'Pulse'/etc.  (writeOn/writeOff)
//   range   → command is writeCmd, args[0] is value
//   → _sendCmd translates to the Loxone HTTP command

const T = {
  Switch: {
    sensors: [
      { path: 'active', label: 'Switch', sensorType: 'switch', format: 'on-off',
        controllable: true, type: 'toggle', writeOn: 'On', writeOff: 'Off',
        capabilityId: 'io', homekit: 'switch-rw' },
    ],
    bindings: [{ state: 'active', path: 'active', bool: true }],
  },

  TimedSwitch: {
    sensors: [
      { path: 'active', label: 'Switch', sensorType: 'switch', format: 'on-off',
        controllable: true, type: 'toggle', writeOn: 'Pulse', writeOff: 'Pulse',
        capabilityId: 'io', homekit: 'switch-rw' },
    ],
    bindings: [{ state: 'active', path: 'active', bool: true }],
  },

  Pushbutton: {
    sensors: [
      { path: 'active', label: 'Button', sensorType: 'switch', format: 'on-off',
        controllable: true, type: 'toggle', writeOn: 'Pulse', writeOff: 'Pulse',
        capabilityId: 'io', homekit: 'switch-rw' },
    ],
    bindings: [{ state: 'active', path: 'active', bool: true }],
  },

  Gate: {
    sensors: [
      { path: 'active', label: 'Gate', sensorType: 'gate', format: 'on-off',
        controllable: true, type: 'toggle', writeOn: 'On', writeOff: 'Off',
        capabilityId: 'io', homekit: 'switch-rw' },
    ],
    bindings: [{ state: 'position', path: 'active', transform: v => v > 0 }],
  },

  Dimmer: {
    sensors: [
      { path: 'on', label: 'Light', sensorType: 'dimmer', format: 'on-off',
        controllable: true, type: 'toggle', writeOn: 'On', writeOff: 'Off',
        capabilityId: 'io', homekit: 'switch-rw' },
      { path: 'level', label: 'Level', sensorType: 'dimmer', format: 'percent',
        controllable: true, type: 'range', writeCmd: 'setLevel',
        capabilityId: 'io', min: 0, max: 100, rangeFormat: 'percent' },
    ],
    bindings: [
      { state: 'value', path: 'on',    transform: v => v > 0 },
      { state: 'value', path: 'level' },
    ],
  },

  Jalousie: {
    sensors: [
      { path: 'up',   label: 'Up',   sensorType: 'shutter', format: 'on-off',
        controllable: true, type: 'toggle', writeOn: 'Up',   writeOff: 'Stop',
        capabilityId: 'io', homekit: null },
      { path: 'down', label: 'Down', sensorType: 'shutter', format: 'on-off',
        controllable: true, type: 'toggle', writeOn: 'Down', writeOff: 'Stop',
        capabilityId: 'io', homekit: null },
      { path: 'position', label: 'Position', sensorType: 'shutter', unit: '%' },
    ],
    bindings: [
      { state: 'up',       path: 'up',       transform: v => v > 0 },
      { state: 'down',     path: 'down',     transform: v => v > 0 },
      { state: 'position', path: 'position', transform: v => Math.round(v * 100) },
    ],
  },

  IRoomController: {
    sensors: [
      { path: 'temperature', label: 'Temperature', sensorType: 'temperature', unit: '°C', homekit: 'temperature' },
      { path: 'target',      label: 'Target Temp', sensorType: 'temperature', unit: '°C',
        controllable: true, type: 'range', writeCmd: 'setTarget',
        capabilityId: 'io', min: 5, max: 35, rangeFormat: 'temperature' },
    ],
    bindings: [
      { state: 'tempActual', path: 'temperature' },
      { state: 'tempTarget', path: 'target' },
    ],
  },

  Alarm: {
    sensors: [
      { path: 'armed', label: 'Armed', sensorType: 'security', format: 'on-off',
        controllable: true, type: 'toggle', writeOn: 'delayedOn/30', writeOff: 'Off',
        capabilityId: 'io', homekit: 'switch-rw' },
      { path: 'level', label: 'Level', sensorType: 'security' },
    ],
    bindings: [
      { state: 'armed', path: 'armed', transform: v => v > 0 },
      { state: 'level', path: 'level' },
    ],
  },

  InfoOnlyDigital: {
    sensors: [{ path: 'value', label: 'State', sensorType: 'sensor', format: 'on-off', homekit: null }],
    bindings: [{ state: 'active', path: 'value', bool: true }],
  },

  InfoOnlyAnalog: {
    sensors: [{ path: 'value', label: 'Value', sensorType: 'sensor', homekit: null }],
    bindings: [{ state: 'value', path: 'value' }],
  },

  TextInput: {
    sensors: [{ path: 'value', label: 'Text', sensorType: 'sensor', homekit: null }],
    bindings: [],
    textBindings: [{ state: 'value', path: 'value' }],
  },
};

T.VideoIntercom = {
  sensors: [
    { path: 'bell',      label: 'Doorbell',  sensorType: 'door',   format: 'on-off', homekit: null },
    { path: 'answering', label: 'Answering', sensorType: 'switch', format: 'on-off', homekit: null },
  ],
  bindings: [
    { state: 'bell',      path: 'bell',      bool: true },
    { state: 'answering', path: 'answering', bool: true },
  ],
  isCamera: true,
};

// Aliases
T.EIBDimmer         = T.Dimmer;
T.ColorPickerV2     = T.Switch;   // on/off only for now
T.LightControllerV2 = T.Switch;
T.LightController   = T.Switch;
T.Intercom          = T.Switch;

// ── Client ─────────────────────────────────────────────────────────────────

class LoxoneClient extends EventEmitter {
  constructor(config, store, sensorRegistry) {
    super();
    this._cfg      = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._ws       = null;
    this._hdr      = null;           // pending 8-byte header
    this._replies  = new Map();      // command → {resolve, reject, timer}
    this._valMap   = {};             // stateUuid → [{deviceKey, path, transform}]
    this._txtMap   = {};             // stateUuid → [{deviceKey, path, transform}]
    this._reconTimer = null;
    this._cameras  = [];
  }

  async start() {
    await this._connect();
  }

  // ── Connection ────────────────────────────────────────────────────────

  async _connect() {
    const { host, port = 80 } = this._cfg.loxone;
    console.log(`[Loxone] Connecting to ${host}:${port}`);

    this._ws  = new WebSocket(`ws://${host}:${port}/ws/rfc6455`);
    this._hdr = null;

    this._ws.on('open', async () => {
      platformStatus.set('loxone', true);
      try {
        await this._auth();
        const structure = await this._fetchStructure();
        this._buildMaps(structure);
        this._ws.send('jdev/sps/enablebinstatusupdate');
        const n = Object.keys(this._valMap).length + Object.keys(this._txtMap).length;
        console.log(`[Loxone] Ready — tracking ${n} state UUIDs`);
      } catch (err) {
        console.error(`[Loxone] Init error: ${err.message}`);
        this._ws.close();
      }
    });

    this._ws.on('message', data => this._onMessage(Buffer.isBuffer(data) ? data : Buffer.from(data)));

    this._ws.on('close', () => {
      platformStatus.set('loxone', false);
      console.log('[Loxone] Disconnected — reconnecting in 30 s');
      this._scheduleReconnect();
    });

    this._ws.on('error', err => console.error(`[Loxone] WS error: ${err.message}`));
  }

  _scheduleReconnect() {
    if (this._reconTimer) return;
    this._reconTimer = setTimeout(() => {
      this._reconTimer = null;
      this._connect().catch(err => console.error(`[Loxone] Reconnect failed: ${err.message}`));
    }, 30000);
  }

  // ── Auth (token-based) ────────────────────────────────────────────────

  async _auth() {
    const { username, password } = this._cfg.loxone;

    // 1 – get key + salt
    const keyData  = await this._wsSend(`jdev/sys/getkey2/${username}`);
    const { key, salt, hashAlg = 'SHA1' } = keyData;
    const alg      = hashAlg.toLowerCase().replace('-', ''); // 'sha256' or 'sha1'

    // 2 – hash password
    const pwHash   = crypto.createHash(alg)
      .update(`${password}:${salt}`)
      .digest('hex').toUpperCase();

    // 3 – HMAC(username:pwHash, key)
    const userHash = crypto.createHmac(alg, Buffer.from(key, 'hex'))
      .update(`${username}:${pwHash}`)
      .digest('hex');

    // 4 – get token
    const clientId = crypto.randomUUID().replace(/-/g, '');
    const tokData  = await this._wsSend(
      `jdev/sys/gettoken/${userHash}/${username}/4/${clientId}/LoxoneSwaggerHelper`
    );
    if (!tokData.token) throw new Error('No token in response');

    console.log(`[Loxone] Authenticated as ${username}`);
  }

  // ── Structure ──────────────────────────────────────────────────────────

  _fetchStructure() {
    const { host, port = 80, username, password } = this._cfg.loxone;
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    return new Promise((resolve, reject) => {
      const req = http.get(
        { hostname: host, port, path: '/data/LoxAPP3.json', timeout: 15000,
          headers: { Authorization: `Basic ${auth}` } },
        res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch { reject(new Error('Invalid structure JSON')); }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Structure download timed out')); });
    });
  }

  _buildMaps(structure) {
    this._valMap  = {};
    this._txtMap  = {};
    this._cameras = [];

    const rooms    = structure.rooms    || {};
    const controls = structure.controls || {};

    for (const [uuid, ctrl] of Object.entries(controls)) {
      const def = T[ctrl.type];
      if (!def) continue;

      const deviceKey = `loxone/${uuid}`;
      const roomName  = rooms[ctrl.room]?.name || '';
      const label     = roomName ? `${ctrl.name} (${roomName})` : ctrl.name;
      const homekit   = [...new Set(def.sensors.map(s => s.homekit).filter(Boolean))];
      const states    = ctrl.states || {};

      // Numeric state bindings
      for (const b of (def.bindings || [])) {
        const stUuid = states[b.state];
        if (!stUuid) continue;
        if (!this._valMap[stUuid]) this._valMap[stUuid] = [];
        this._valMap[stUuid].push({ deviceKey, path: b.path, transform: b.bool ? (v => v > 0) : b.transform });
      }

      // Text state bindings
      for (const b of (def.textBindings || [])) {
        const stUuid = states[b.state];
        if (!stUuid) continue;
        if (!this._txtMap[stUuid]) this._txtMap[stUuid] = [];
        this._txtMap[stUuid].push({ deviceKey, path: b.path, transform: b.transform });
      }

      const ctrlUuid = uuid;
      const device = {
        key: deviceKey, label, type: 'loxone',
        sensors: def.sensors.map(s => ({ ...s })),
        homekit,
        _writeCapability: (capId, command, args = []) =>
          this._sendCmd(ctrlUuid, command, args[0]),
      };

      this._registry.registerDevice(device);

      // VideoIntercom controls become HomeKit cameras
      if (def.isCamera) {
        this._cameras.push({
          name:          label,
          url:           ctrl.details?.rtspUrl || null,
          snapshotUrl:   null,
          fetchSnapshot: () => this._fetchCameraSnapshot(uuid),
        });
      }
    }

    if (this._cameras.length > 0) {
      this.emit('cameras-discovered', this._cameras);
    }
  }

  _fetchCameraSnapshot(controlUuid) {
    const { host, port = 80, username, password } = this._cfg.loxone;
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    return new Promise((resolve, reject) => {
      const req = http.get({
        hostname: host,
        port,
        path:    `/dev/sps/swimage/${controlUuid}`,
        headers: { Authorization: `Basic ${auth}` },
        timeout: 5000,
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Snapshot timeout')); });
    });
  }

  // ── Message handling ──────────────────────────────────────────────────

  _onMessage(buf) {
    if (!this._hdr) {
      // Expect 8-byte binary header
      if (buf.length === 8 && buf[0] === 0x03) {
        this._hdr = { type: buf[1], size: buf.readUInt32LE(4) };
      }
      return;
    }

    const { type } = this._hdr;
    this._hdr = null;

    switch (type) {
      case 0: this._onText(buf.toString('utf8')); break;
      case 2: this._onValueStates(buf);           break;
      case 3: this._onTextStates(buf);            break;
      case 6: this._ws.send('keepalive');         break; // keepalive ping
    }
  }

  _onText(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    const ll      = msg.LL || msg;
    const control = (ll.control || '').toLowerCase();

    for (const [cmd, p] of this._replies) {
      if (control === cmd.toLowerCase() || control.endsWith(cmd.toLowerCase().split('/').pop())) {
        clearTimeout(p.timer);
        this._replies.delete(cmd);
        if (String(ll.Code) === '200' || ll.Code == null) p.resolve(ll.value ?? ll);
        else p.reject(new Error(`Loxone ${ll.Code}: ${control}`));
        return;
      }
    }
  }

  _onValueStates(buf) {
    const count = Math.floor(buf.length / 24);
    for (let i = 0; i < count; i++) {
      const off   = i * 24;
      const uuid  = this._uuidAt(buf, off);
      const value = buf.readDoubleLE(off + 16);
      for (const { deviceKey, path, transform } of (this._valMap[uuid] || [])) {
        this._store.set(`${deviceKey}/${path}`, transform ? transform(value) : value);
      }
    }
  }

  _onTextStates(buf) {
    let off = 0;
    while (off + 36 <= buf.length) {
      const uuid    = this._uuidAt(buf, off);
      // icon UUID at off+16, skip
      const txtLen  = buf.readUInt32LE(off + 32);
      if (off + 36 + txtLen > buf.length) break;
      const text    = buf.slice(off + 36, off + 36 + txtLen).toString('utf8');
      // align to 4-byte boundary
      off += 36 + txtLen + (txtLen % 4 ? 4 - (txtLen % 4) : 0);

      for (const { deviceKey, path, transform } of (this._txtMap[uuid] || [])) {
        this._store.set(`${deviceKey}/${path}`, transform ? transform(text) : text);
      }
    }
  }

  // Loxone UUID binary layout: uint32LE + uint16LE + uint16LE + 8 bytes raw
  _uuidAt(buf, off) {
    const p1 = buf.readUInt32LE(off).toString(16).padStart(8, '0');
    const p2 = buf.readUInt16LE(off + 4).toString(16).padStart(4, '0');
    const p3 = buf.readUInt16LE(off + 6).toString(16).padStart(4, '0');
    const p4 = buf.slice(off + 8, off + 16).toString('hex');
    return `${p1}-${p2}-${p3}-${p4}`;
  }

  // ── Commands (HTTP GET) ───────────────────────────────────────────────

  async _sendCmd(ctrlUuid, command, value) {
    // Translate internal writeCmd names to Loxone commands
    let loxCmd;
    if (command === 'setLevel')  loxCmd = String(Math.round(value ?? 0));
    else if (command === 'setTarget') loxCmd = `setTemperature/${value ?? 20}`;
    else loxCmd = command; // 'On', 'Off', 'Pulse', 'Up', 'Down', 'Stop', etc.

    const { host, port = 80, username, password } = this._cfg.loxone;
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    const path = `/jdev/sps/io/${ctrlUuid}/${encodeURIComponent(loxCmd)}`;

    return new Promise((resolve, reject) => {
      http.get({ hostname: host, port, path, timeout: 5000,
        headers: { Authorization: `Basic ${auth}` } }, res => {
        res.resume();
        res.on('end', resolve);
      }).on('error', reject)
        .on('timeout', (r) => { r?.destroy(); reject(new Error('Command timeout')); });
    });
  }

  // ── WebSocket RPC helper ──────────────────────────────────────────────

  _wsSend(command) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._replies.delete(command);
        reject(new Error(`Timeout waiting for: ${command}`));
      }, 8000);
      this._replies.set(command, { resolve, reject, timer });
      this._ws.send(command);
    });
  }
}

module.exports = LoxoneClient;
