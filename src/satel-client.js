'use strict';

const net            = require('net');
const EventEmitter   = require('events');
const platformStatus = require('./platform-status');

const POLL_MS         = 300;     // delay between new_data checks (self-scheduling, no overlap)
const QUERY_TIMEOUT   = 3_000;
const RECONNECT_DELAY = 30_000;

// Satel Integra protocol command codes (used as indices in new_data response)
const CMD_ZONES_VIOLATION  = 0x00;
const CMD_ZONES_TAMPER     = 0x01;
const CMD_ZONES_ALARM      = 0x02;
const CMD_PART_ARMED       = 0x0A; // ArmedPartitionsReally
const CMD_PART_ALARM       = 0x13; // PartitionsAlarm
const CMD_PART_FIRE_ALARM  = 0x14;
const CMD_OUTPUTS_STATE    = 0x17;
const CMD_INPUTS_STATE     = 0x15;
const CMD_NEW_DATA         = 0x7F;
const CMD_READ_NAME        = 0xEE; // read element name; request: EE <type> <number>

// Element types for the 0xEE name query.
const NAME_TYPE_PARTITION  = 0;
const NAME_TYPE_ZONE       = 1;
const NAME_TYPE_OUTPUT     = 4;
const NAME_TYPE_INPUT      = 6;
const NAME_TIMEOUT         = 1_000; // names answer fast; keep well under QUERY_TIMEOUT

// Check if a command's data changed (new_data response uses cmd code as bit index)
function changed(newDataResp, cmdCode) {
  if (!newDataResp) return true;
  return !!(newDataResp[Math.floor(cmdCode / 8)] & (1 << (cmdCode % 8)));
}

// ── Protocol helpers ──────────────────────────────────────────────────────────

function crc16(data) {
  let crc = 0x147A;
  for (const b of data) {
    crc = ((crc << 1) & 0xFFFF) | (crc >> 15);
    crc ^= 0xFFFF;
    crc = (crc + (crc >> 8) + b) & 0xFFFF;
  }
  return crc;
}

function escapeFE(buf) {
  const out = [];
  for (const b of buf) { out.push(b); if (b === 0xFE) out.push(0xFD); }
  return Buffer.from(out);
}

function unescapeFE(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0xFE && i + 1 < buf.length && buf[i + 1] === 0xFD) { out.push(0xFE); i++; }
    else out.push(buf[i]);
  }
  return Buffer.from(out);
}

function buildFrame(payload) {
  const c    = crc16(payload);
  const full = Buffer.concat([payload, Buffer.from([c >> 8, c & 0xFF])]);
  return Buffer.concat([Buffer.from([0xFE, 0xFE]), escapeFE(full), Buffer.from([0xFE, 0x0D])]);
}

function parseFrames(buf) {
  const frames = [];
  let i = 0;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xFE || buf[i + 1] !== 0xFE) { i++; continue; }
    let j = i + 2;
    while (j < buf.length - 1) {
      if (buf[j] === 0xFE && buf[j + 1] === 0x0D) break;
      if (buf[j] === 0xFE && j + 1 < buf.length) j += 2; else j++;
    }
    if (j >= buf.length - 1) break;
    const raw = unescapeFE(buf.slice(i + 2, j));
    if (raw.length >= 3) {
      const payload = raw.slice(0, -2);
      const recv    = (raw[raw.length - 2] << 8) | raw[raw.length - 1];
      if (crc16(payload) === recv) frames.push(payload);
    }
    i = j + 2;
  }
  return { frames, remaining: buf.slice(i) };
}

function encodeBcd(code) {
  const s = String(code).replace(/\D/g, '').padEnd(8, 'F').slice(0, 8);
  return Buffer.from([
    (parseInt(s[0], 16) << 4) | parseInt(s[1], 16),
    (parseInt(s[2], 16) << 4) | parseInt(s[3], 16),
    (parseInt(s[4], 16) << 4) | parseInt(s[5], 16),
    (parseInt(s[6], 16) << 4) | parseInt(s[7], 16),
  ]);
}

// 4-byte mask for partitions (32 partitions)
function partitionMask(num) {
  const buf = Buffer.alloc(4, 0);
  buf[Math.floor((num - 1) / 8)] |= 1 << ((num - 1) % 8);
  return buf;
}

// 16-byte mask for outputs (128 outputs)
function outputMask(num) {
  const buf = Buffer.alloc(16, 0);
  buf[Math.floor((num - 1) / 8)] |= 1 << ((num - 1) % 8);
  return buf;
}

function getBit(data, num) {
  if (!data) return false;
  const b = Math.floor((num - 1) / 8), bit = (num - 1) % 8;
  return data[b] != null && !!(data[b] & (1 << bit));
}

// Decode a 16-byte element name from a 0xEE response. Names are padded with
// spaces; INTEGRA stores text in a Latin-2 / CP1250-style code page, so decode
// high bytes accordingly to keep Polish diacritics (ąćęłńóśźż …) intact.
const CP1250_HIGH = {
  0xA5: 'Ą', 0xB9: 'ą', 0xC6: 'Ć', 0xE6: 'ć', 0xCA: 'Ę', 0xEA: 'ę',
  0xA3: 'Ł', 0xB3: 'ł', 0xD1: 'Ń', 0xF1: 'ń', 0xD3: 'Ó', 0xF3: 'ó',
  0x8C: 'Ś', 0x9C: 'ś', 0x8F: 'Ź', 0x9F: 'ź', 0xAF: 'Ż', 0xBF: 'ż',
};
function decodeSatelName(buf) {
  let s = '';
  for (const b of buf) {
    if (b === 0x00) continue;
    if (b >= 0x20 && b < 0x7F) s += String.fromCharCode(b);
    else if (CP1250_HIGH[b])   s += CP1250_HIGH[b];
    else if (b !== 0x20)       s += '';
  }
  return s.replace(/\s+$/, '').trim();
}

// ── Client ────────────────────────────────────────────────────────────────────

class SatelClient extends EventEmitter {
  constructor(config, store, sensorRegistry) {
    super();
    this.cfg            = config.satel;
    this.store          = store;
    this.sensorRegistry = sensorRegistry;
    this.socket         = null;
    this.rxBuf          = Buffer.alloc(0);
    this.pollTimer      = null;
    this.reconnTimer    = null;
    this._running       = false;
    this.registered     = new Set();
    this.names          = { partition: {}, zone: {}, output: {}, input: {} }; // names read from the panel
    // Name loading briefly stacks one-shot 'frame' listeners; lift the default cap.
    this.setMaxListeners(50);
  }

  async start() {
    await this._connect();
    await this._loadNames();
    await this._pollAll(true);
    // Self-scheduling loop: the next poll is queued only after the current one
    // settles, so a slow/timed-out query can never overlap the next request on
    // the socket. The loop keeps ticking across disconnects (polls fail harmlessly
    // until _connect succeeds again) and stops only via stop().
    this._running = true;
    const loop = async () => {
      if (!this._running) return;
      try { await this._pollAll(); } catch {}
      if (this._running) this.pollTimer = setTimeout(loop, POLL_MS);
    };
    this.pollTimer = setTimeout(loop, POLL_MS);
    console.log(`[Satel] Started — ${this.cfg.host}:${this.cfg.port || 7094}`);
  }

  stop() {
    this._running = false;
    clearTimeout(this.pollTimer);
    clearTimeout(this.reconnTimer);
    this.socket?.destroy();
    this.socket = null;
  }

  // ── Output control ────────────────────────────────────────────────────────

  async setOutput(num, on) {
    const cmd  = on ? 0x88 : 0x89;
    const code = encodeBcd(this.cfg.armCode || '');
    await this._send(Buffer.concat([Buffer.from([cmd]), code, outputMask(num)]));
  }

  // ── Partition control ─────────────────────────────────────────────────────

  async armPartition(num) {
    const code = this.cfg.armCode;
    if (code) {
      await this._send(Buffer.concat([Buffer.from([0x80]), encodeBcd(code), partitionMask(num)]));
    } else {
      await this._send(Buffer.concat([Buffer.from([0x84]), partitionMask(num)]));
    }
  }

  async disarmPartition(num) {
    await this._send(
      Buffer.concat([Buffer.from([0x85]), encodeBcd(this.cfg.armCode || ''), partitionMask(num)])
    );
  }

  // ── Transport ─────────────────────────────────────────────────────────────

  _connect() {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      sock.setTimeout(10_000);
      sock.connect(this.cfg.port || 7094, this.cfg.host, () => {
        platformStatus.set('satel', true);
        this.socket = sock;
        resolve();
      });
      sock.on('data', chunk => {
        this.rxBuf = Buffer.concat([this.rxBuf, chunk]);
        const { frames, remaining } = parseFrames(this.rxBuf);
        this.rxBuf = remaining;
        for (const f of frames) this.emit('frame', f);
      });
      sock.on('error', err => {
        console.error(`[Satel] ${err.message}`);
        if (sock.connecting) reject(err);
      });
      sock.on('close', () => {
        this.socket = null;
        platformStatus.set('satel', false);
        console.warn('[Satel] Disconnected — reconnecting in 30 s');
        this.reconnTimer = setTimeout(() => this._connect().catch(() => {}), RECONNECT_DELAY);
      });
    });
  }

  _send(data) {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'));
      this.socket.write(buildFrame(data), err => err ? reject(err) : resolve());
    });
  }

  _query(cmd) {
    return new Promise(resolve => {
      const onFrame = frame => {
        if (frame[0] === cmd) { this.off('frame', onFrame); resolve(frame.slice(1)); }
      };
      this.on('frame', onFrame);
      this._send(Buffer.from([cmd])).catch(() => {});
      setTimeout(() => { this.off('frame', onFrame); resolve(null); }, QUERY_TIMEOUT);
    });
  }

  // Read a single element name via 0xEE. Response: EE <type> <num> <func> <16 name>.
  _readName(type, num) {
    return new Promise(resolve => {
      const onFrame = frame => {
        if (frame[0] === CMD_READ_NAME && frame[1] === type && frame[2] === num) {
          this.off('frame', onFrame);
          resolve(decodeSatelName(frame.slice(4, 20)));
        }
      };
      this.on('frame', onFrame);
      this._send(Buffer.from([CMD_READ_NAME, type, num])).catch(() => {});
      setTimeout(() => { this.off('frame', onFrame); resolve(null); }, NAME_TIMEOUT);
    });
  }

  // Download zone / output / partition / input names from the panel once, sequentially
  // (one outstanding query at a time keeps the socket and listeners sane).
  async _loadNames() {
    const range  = (n) => Array.from({ length: n }, (_, i) => i + 1);
    const zoneN  = this.cfg.zones      || range(this.cfg.zoneCount   || 0);
    const outN   = this.cfg.outputs    || range(this.cfg.outputCount || 0);
    const partN  = this.cfg.partitions || [1];
    const inpN   = this.cfg.inputs     || [];

    for (const [type, nums, bucket] of [
      [NAME_TYPE_PARTITION, partN, this.names.partition],
      [NAME_TYPE_ZONE,      zoneN, this.names.zone],
      [NAME_TYPE_OUTPUT,    outN,  this.names.output],
      [NAME_TYPE_INPUT,     inpN,  this.names.input],
    ]) {
      // Up to 3 passes: a single dropped/timed-out frame must not permanently
      // lose that element's name (unnamed elements stay silent each pass)
      let pending = [...nums];
      for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
        const missing = [];
        for (const n of pending) {
          if (!this.socket) return; // disconnected mid-load — abort
          const name = await this._readName(type, n);
          if (name) bucket[n] = name; else missing.push(n);
        }
        pending = missing;
      }
    }
    console.log(`[Satel] Names from panel — ${Object.keys(this.names.output).length} output(s), ${Object.keys(this.names.zone).length} zone(s), ${Object.keys(this.names.partition).length} partition(s), ${Object.keys(this.names.input).length} input(s)`);
  }

  // ── Polling ───────────────────────────────────────────────────────────────

  async _pollAll(force = false) {
    // Query new_data to find what changed; on first call (force) skip and fetch all
    const nd = force ? null : await this._query(CMD_NEW_DATA);

    const fetch = (cmd) => (force || changed(nd, cmd)) ? this._query(cmd) : Promise.resolve(null);

    const [violations, tampers, zoneAlarms, partArmed, partAlarm, partFire, outputs, inputs] = await Promise.all([
      fetch(CMD_ZONES_VIOLATION),
      fetch(CMD_ZONES_TAMPER),
      fetch(CMD_ZONES_ALARM),
      fetch(CMD_PART_ARMED),
      fetch(CMD_PART_ALARM),
      fetch(CMD_PART_FIRE_ALARM),
      fetch(CMD_OUTPUTS_STATE),
      fetch(CMD_INPUTS_STATE),
    ]);

    if (violations || tampers || zoneAlarms) this._updateZones(violations, tampers, zoneAlarms);
    if (partArmed  || partAlarm || partFire)  this._updatePartitions(partArmed, partAlarm, partFire);
    if (outputs)                              this._updateOutputs(outputs);
    if (inputs)                               this._updateInputs(inputs);
  }

  // ── Zones ─────────────────────────────────────────────────────────────────

  _updateZones(violations, tampers, alarms) {
    const nums = this.cfg.zones
      ? this.cfg.zones
      : Array.from({ length: this.cfg.zoneCount || 32 }, (_, i) => i + 1);

    for (const num of nums) {
      if (violations) this.store.update(`satel/zone/${num}/state`,   getBit(violations, num) ? 1 : 0);
      if (tampers)    this.store.update(`satel/zone/${num}/tamper`,  getBit(tampers, num)    ? 1 : 0);
      if (alarms)     this.store.update(`satel/zone/${num}/alarm`,   getBit(alarms, num)     ? 1 : 0);
      if (!this.registered.has(`z${num}`)) this._registerZone(num);
    }
  }

  // Classify a zone as a HomeKit 'motion' or 'contact' sensor (or null = not
  // exposed). An explicit cfg.zoneTypes entry wins ('motion'|'contact'|'none');
  // otherwise infer from the zone name (PL/EN): RUCH/PIR/MOTION → motion,
  // OKNO/DRZWI/CONTACT/REED → contact.
  _zoneHomekitType(num, label) {
    const override = this.cfg.zoneTypes?.[num] || this.cfg.zoneTypes?.[String(num)];
    if (override) return override === 'none' ? null : override;
    const u = (label || '').toUpperCase();
    if (/\b(RUCH|PIR|MOTION)\b|^RUCH/.test(u)) return 'motion';
    if (/\b(OKNO|DRZWI|BRAMA|GATE|CONTACT|REED|DOOR|WINDOW)\b|^OKNO|^DRZWI|^BRAMA/.test(u)) return 'contact';
    return null;
  }

  _registerZone(num) {
    this.registered.add(`z${num}`);
    const explicit = this.cfg.zoneNames?.[num] || this.cfg.zoneNames?.[String(num)]
      || this.names.zone[num];
    const label = explicit || `Zone ${num}`;
    const hk = this._zoneHomekitType(num, label);
    this.sensorRegistry.registerDevice({
      key:     `satel/zone/${num}`,
      type:    'satel',
      label,
      named:   !!explicit,
      homekit: hk ? [hk] : [],
      sensors: [
        { path: 'state',  label: 'Violation', sensorType: 'violation', format: 'on-off', homekit: hk },
        { path: 'tamper', label: 'Tamper',    sensorType: 'tamper',    format: 'on-off', homekit: null },
        { path: 'alarm',  label: 'Alarm',     sensorType: 'alarm',     format: 'on-off', homekit: null },
      ],
    });
  }

  // ── Partitions ────────────────────────────────────────────────────────────

  _updatePartitions(armed, alarm, fire) {
    const nums = this.cfg.partitions || [1];
    for (const num of nums) {
      if (armed) this.store.update(`satel/partition/${num}/armed`,      getBit(armed, num) ? 1 : 0);
      if (alarm) this.store.update(`satel/partition/${num}/alarm`,      getBit(alarm, num) ? 1 : 0);
      if (fire)  this.store.update(`satel/partition/${num}/fire_alarm`, getBit(fire,  num) ? 1 : 0);
      if (!this.registered.has(`p${num}`)) this._registerPartition(num);
    }
  }

  _registerPartition(num) {
    this.registered.add(`p${num}`);
    const explicit = this.cfg.partitionNames?.[num] || this.cfg.partitionNames?.[String(num)]
      || this.names.partition[num];
    const label = explicit || `Partition ${num}`;
    this.sensorRegistry.registerDevice({
      key:     `satel/partition/${num}`,
      type:    'satel',
      label,
      named:   !!explicit,
      homekit: [],
      sensors: [
        {
          path:         'armed',
          label:        'Armed',
          sensorType:   'armed',
          format:       'on-off',
          controllable: true,
          type:         'toggle',
          writeOn:      'arm',
          writeOff:     'disarm',
          capabilityId: 'armed',
          homekit:      null,
        },
        { path: 'alarm',      label: 'Alarm',      sensorType: 'alarm',      format: 'on-off', homekit: null },
        { path: 'fire_alarm', label: 'Fire Alarm',  sensorType: 'fire_alarm', format: 'on-off', homekit: null },
      ],
      _writeCapability: (capId, command) => {
        if (capId !== 'armed') return;
        return command === 'arm'
          ? this.armPartition(num)
          : this.disarmPartition(num);
      },
    });
  }
  // ── Outputs ───────────────────────────────────────────────────────────────

  _updateOutputs(data) {
    const nums = this.cfg.outputs
      ? this.cfg.outputs
      : Array.from({ length: this.cfg.outputCount || 0 }, (_, i) => i + 1);

    for (const num of nums) {
      const on = getBit(data, num);
      this.store.update(`satel/output/${num}/state`, on ? 1 : 0);
      if (!this.registered.has(`o${num}`)) this._registerOutput(num);
    }
  }

  _registerOutput(num) {
    this.registered.add(`o${num}`);
    const explicit = this.cfg.outputNames?.[num] || this.cfg.outputNames?.[String(num)]
      || this.names.output[num];
    const label = explicit || `Output ${num}`;
    this.sensorRegistry.registerDevice({
      key:     `satel/output/${num}`,
      type:    'satel',
      label,
      named:   !!explicit,
      homekit: [],
      sensors: [
        {
          path:         'state',
          label:        'State',
          sensorType:   'output',
          format:       'on-off',
          controllable: true,
          type:         'toggle',
          writeOn:      'on',
          writeOff:     'off',
          capabilityId: 'state',
          homekit:      null,
        },
      ],
      _writeCapability: (capId, command) => {
        if (capId !== 'state') return;
        return this.setOutput(num, command === 'on')
          .catch(err => console.error(`[Satel] Output ${num} failed: ${err.message}`));
      },
    });
  }

  // ── Inputs ────────────────────────────────────────────────────────────────

  _updateInputs(data) {
    const nums = this.cfg.inputs || [];

    for (const num of nums) {
      if (data) this.store.update(`satel/input/${num}/state`, getBit(data, num) ? 1 : 0);
      if (!this.registered.has(`i${num}`)) this._registerInput(num);
    }
  }

  _registerInput(num) {
    this.registered.add(`i${num}`);
    const explicit = this.cfg.inputNames?.[num] || this.cfg.inputNames?.[String(num)]
      || this.names.input[num];
    const label = explicit || `Input ${num}`;
    this.sensorRegistry.registerDevice({
      key:     `satel/input/${num}`,
      type:    'satel',
      label,
      named:   !!explicit,
      homekit: [],
      sensors: [
        {
          path:       'state',
          label:      'State',
          sensorType: 'input',
          format:     'on-off',
          homekit:    null,
        },
      ],
    });
  }
}

module.exports = SatelClient;
