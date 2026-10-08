'use strict';

// DSC PowerSeries Neo alarm panels via a TL280 / TL2803G / 3G2080 IP
// communicator, over DSC's ITv2 integration protocol (src/dsc-itv2.js).
//
// LSH is the "integration server": the panel dials IN to us (TCP 3072 by
// default) — nothing to poll, state changes are pushed. Program the panel
// once at the keypad ([*][8] + installer code), group 1 shown:
//   [851][422]  Integration ID (read-only, 12 digits — note it down)
//   [851][425]  Integration options: bits 3, 4, 5 on
//   [851][426]  Notifications: bit 3 only
//   [851][428]  Integration server IP = this LSH host
//   [851][429]  Integration server port, hex: 0C00 = 3072
//   [851][700]  Type 2 access key, 32 hex characters
// (Settings → Security → DSC shows the same steps.)
//
// config.dsc: { port = 3072, bindHost = '0.0.0.0', type2Key, type1Code?,
//   integrationId? (Type 1 only), userCode (arm/disarm), zoneTypes?: { n:
//   'motion'|'contact'|'none' }, allZones? (register every zone, not just
//   named/active ones) }
//
// Protocol port verified byte-for-byte against the reference implementation
// (test/dsc-itv2.test.js). Real-panel behaviour is from that project's
// testing (HS2032 + TL280); see its docs for firmware quirks.

const net = require('net');
const platformStatus = require('./platform-status');
const itv2 = require('./dsc-itv2');

const HEARTBEAT_MS = 60000;
const REQUEST_GAP_MS = 100;
const RESPONSE_WAIT_MS = 4000;
const ARM = { away: 2, stay: 1, night: 4, 'no-entry-delay': 3 };

class DscClient {
  constructor(config, store, sensorRegistry, { random } = {}) {
    this.cfg = config.dsc || {};
    this.random = random; // tests: deterministic session nonce
    this.store = store;
    this.registry = sensorRegistry;
    this.server = null;
    this.conn = null;          // { socket, codec, peer }
    this.panel = { connected: false };
    this.maxZones = 0;
    this.maxPartitions = 0;
    this.zones = new Map();      // n → { label, open, tamper, alarm, lowBattery, bypass, fault }
    this.partitions = new Map(); // n → { label, ...decodePartitionStatus }
    this.registered = new Set();
    this.pending = [];           // resolvers waiting for a CommandResponse
    this.lastSeen = 0;
  }

  async start() {
    if (!this.cfg.type2Key && !this.cfg.type1Code) {
      console.warn('[DSC] No type2Key (or type1Code) configured — not listening');
      return;
    }
    platformStatus.set('dsc', false);
    this._registerPanel();
    const port = this.cfg.port === 0 ? 0 : (Number(this.cfg.port) || 3072);
    const host = this.cfg.bindHost || '0.0.0.0';
    this.server = net.createServer((socket) => this._accept(socket));
    this.server.on('error', (err) => console.error(`[DSC] Listener error: ${err.message}`));
    await new Promise((resolve) => this.server.listen(port, host, resolve));
    this.port = this.server.address().port;
    console.log(`[DSC] Waiting for the panel to dial in on ${host}:${port}`);
  }

  stop() {
    clearInterval(this.heartbeat);
    clearTimeout(this.pullTimer);
    if (this.conn) { try { this.conn.socket.write(this.conn.codec.close()); } catch {} this.conn.socket.destroy(); }
    this.server?.close();
    platformStatus.set('dsc', false);
  }

  getStatus() {
    return {
      listening: !!this.server?.listening, port: Number(this.cfg.port) || 3072,
      panel: { ...this.panel, peer: this.conn?.peer || null, lastSeen: this.lastSeen || null },
      maxZones: this.maxZones, maxPartitions: this.maxPartitions,
      partitions: [...this.partitions.entries()].map(([n, p]) => ({ number: n, ...p })),
      zones: [...this.zones.entries()].map(([n, z]) => ({ number: n, ...z })),
    };
  }

  // ── Connection ────────────────────────────────────────────────────────────

  _accept(socket) {
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;
    if (this.conn) {
      console.log(`[DSC] New connection from ${peer} replaces ${this.conn.peer}`);
      this.conn.socket.destroy();
    } else console.log(`[DSC] Panel connected from ${peer}`);
    const codec = new itv2.SessionCodec({
      integration_id: this.cfg.integrationId || null,
      type1_access_code: this.cfg.type1Code || null,
      type2_access_code_hex: this.cfg.type2Key ? String(this.cfg.type2Key).toLowerCase() : null,
    }, this.random ? { random: this.random } : undefined);
    const conn = { socket, codec, peer };
    this.conn = conn;
    socket.setKeepAlive(true, 30000);
    socket.on('data', (data) => {
      const events = codec.feed(data);
      const out = events.filter((e) => e.type === 'send').map((e) => e.data);
      if (out.length) socket.write(Buffer.concat(out));
      for (const ev of events) this._onEvent(conn, ev);
    });
    const gone = (why) => {
      if (this.conn !== conn) return;
      this.conn = null;
      clearInterval(this.heartbeat);
      this.panel.connected = false;
      platformStatus.set('dsc', false);
      this.store.update('dsc/panel/connected', 0);
      console.warn(`[DSC] Panel session ended (${why})`);
    };
    socket.on('close', () => gone('socket closed'));
    socket.on('error', (err) => gone(err.message));
  }

  _onEvent(conn, ev) {
    if (ev.type === 'connected') {
      Object.assign(this.panel, { connected: true, integrationId: ev.session_id, encryptionType: ev.encryption_type, firmware: `${ev.fw[0]}.${String(ev.fw[1]).padStart(2, '0')}` });
      console.log(`[DSC] Session open — Integration ID ${ev.session_id}, Type ${ev.encryption_type} encryption, TL280 firmware ${this.panel.firmware}`);
      platformStatus.set('dsc', true);
      this.store.update('dsc/panel/connected', 1);
      this.store.update('dsc/panel/firmware', this.panel.firmware);
      this.store.update('dsc/panel/integration_id', ev.session_id);
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => this._send({ _type: 'ConnectionPoll' }), HEARTBEAT_MS);
      this.heartbeat.unref?.();
      clearTimeout(this.pullTimer);
      this.pullTimer = setTimeout(() => this._initialPull(conn).catch((e) => console.error(`[DSC] Initial status pull failed: ${e.message}`)), 2000);
    } else if (ev.type === 'notification') {
      this.lastSeen = Date.now();
      this._handle(ev.decoded);
    } else if (ev.type === 'failed') {
      console.error(`[DSC] Session failed: ${ev.reason}${/check-byte|CRC|decrypt/i.test(ev.reason) ? ' — check the access key / Integration ID' : ''}`);
      this.panel.error = ev.reason;
      conn.socket.destroy();
    } else if (ev.type === 'closed') {
      conn.socket.end();
    }
  }

  _send(msg) {
    if (!this.conn?.codec.isReady) throw new Error('DSC panel is not connected');
    this.conn.socket.write(this.conn.codec.sendMessage(msg));
  }

  async _initialPull(conn) {
    const gap = () => new Promise((r) => setTimeout(r, REQUEST_GAP_MS));
    const req = async (request) => { if (this.conn !== conn) throw new Error('reconnected'); this._send({ _type: 'CommandRequestMessage', request }); await gap(); };
    await req({ _type: 'ConnectionSystemCapabilities' });
    for (let i = 0; i < 20 && !this.maxZones; i++) await new Promise((r) => setTimeout(r, 100));
    const zones = this.maxZones || 128, parts = this.maxPartitions || 8;
    for (let start = 1; start <= zones; start += 8) await req({ _type: 'NotificationLabelText', collection: 0xd1, start, end: Math.min(start + 7, zones), labels: [] });
    await req({ _type: 'NotificationLabelText', collection: 0xd3, start: 1, end: parts, labels: [] });
    await req({ _type: 'ModuleZoneStatus', zone_start: 1, zone_count: zones, status_size_in_bytes: 1, zone_status_bytes: [] });
    for (let p = 1; p <= parts; p++) await req({ _type: 'ModulePartitionStatus', partition: p });
    // Labels have arrived by now — register what's worth showing.
    await new Promise((r) => setTimeout(r, 1500));
    for (const [n] of this.partitions) this._registerPartition(n);
    for (const [n, z] of this.zones) if (this._zoneWorthShowing(n, z)) this._registerZone(n);
    console.log(`[DSC] Status loaded — ${this.partitions.size} partition(s), ${[...this.registered].filter((k) => k.startsWith('z')).length} zone(s) shown`);
  }

  // ── Inbound messages ─────────────────────────────────────────────────────

  _handle(m) {
    switch (m._type) {
      case 'MultipleMessagePacket': for (const sub of m.messages) this._handle(sub); return;
      case 'ConnectionSystemCapabilities':
        this.maxZones = m.max_zones; this.maxPartitions = m.max_partitions;
        console.log(`[DSC] Panel capabilities: ${m.max_zones} zones, ${m.max_partitions} partitions`);
        return;
      case 'NotificationLabelText': {
        const target = m.collection === 0xd1 ? this.zones : m.collection === 0xd3 ? this.partitions : null;
        if (!target) return;
        m.labels.forEach((label, i) => {
          const n = m.start + i;
          const clean = String(label || '').trim();
          target.set(n, { ...(target.get(n) || {}), label: clean });
        });
        return;
      }
      case 'ModuleZoneStatus': {
        const size = Math.max(1, m.status_size_in_bytes);
        for (let i = 0; i < m.zone_count; i++) {
          const b = m.zone_status_bytes[i * size];
          if (b === undefined) break;
          this._zone(m.zone_start + i, itv2.decodeZoneByte(b));
        }
        return;
      }
      case 'NotificationLifestyleZoneStatus':
        if (m.status === 0 || m.status === 1) this._zone(m.zone_number, { open: m.status === 1 });
        return;
      case 'SingleZoneBypassStatus': this._zone(m.zone_number, { bypass: !!m.bypass_status }); return;
      case 'ModulePartitionStatus': this._partition(m.partition, itv2.decodePartitionStatus(m.partition_status)); return;
      case 'NotificationPartitionReadyStatus': this._partition(m.partition_number, { ready: m.status === 1 || m.status === 2 }); return;
      case 'NotificationPartitionTroubleStatus': this._partition(m.partition, { trouble: !!m.value }); return;
      case 'NotificationPartitionBypassStatus': this._partition(m.partition, { bypassed: !!m.value }); return;
      case 'NotificationPartitionAlarmMemory': this._partition(m.partition, { alarmMemory: !!m.value }); return;
      case 'NotificationExitDelay': this._partition(m.partition, { exitDelay: !!(m.delay_flags & 0x80) }); return;
      case 'NotificationEntryDelay': this._partition(m.partition, { entryDelay: !!(m.delay_flags & 0x80) }); return;
      case 'NotificationArmDisarm': {
        const mode = Object.entries(ARM).find(([, v]) => v === m.arm_mode)?.[0] || (m.arm_mode === 0 ? 'disarmed' : 'away');
        this._partition(m.partition, { armed: m.arm_mode !== 0, armMode: m.arm_mode === 0 ? 'disarmed' : mode, lastUser: m.user_id });
        console.log(`[DSC] Partition ${m.partition} ${m.arm_mode === 0 ? 'disarmed' : `armed (${mode})`} by user ${m.user_id}`);
        return;
      }
      case 'NotificationDateTimeBroadcast': {
        const d = m.date_time;
        this.store.update('dsc/panel/time', `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')} ${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`);
        return;
      }
      case 'CommandResponse': {
        const waiter = this.pending.shift();
        if (waiter) waiter(m.response_code);
        return;
      }
      case 'CommandError': {
        const waiter = this.pending.shift();
        if (waiter) waiter(-1, `${itv2.nameOf(m.nack_command)} NACK ${m.nack_code}`);
        return;
      }
      default:
        if (m._type === 'DefaultMessage') console.log(`[DSC] Unhandled message 0x${m.command.toString(16)} (${m.data.length} bytes)`);
    }
  }

  _zone(n, patch) {
    const z = { ...(this.zones.get(n) || {}), ...patch };
    this.zones.set(n, z);
    if (!this.registered.has(`z${n}`) && this._zoneWorthShowing(n, z) && this.panel.connected) this._registerZone(n);
    const k = `dsc/zone/${n}`;
    if ('open' in patch) this.store.update(`${k}/state`, patch.open ? 1 : 0);
    if ('tamper' in patch) this.store.update(`${k}/tamper`, patch.tamper ? 1 : 0);
    if ('alarm' in patch) this.store.update(`${k}/alarm`, patch.alarm ? 1 : 0);
    if ('lowBattery' in patch) this.store.update(`${k}/low_battery`, patch.lowBattery ? 1 : 0);
    if ('bypass' in patch) this.store.update(`${k}/bypass`, patch.bypass ? 1 : 0);
  }

  _partition(n, patch) {
    const p = { ...(this.partitions.get(n) || {}), ...patch };
    this.partitions.set(n, p);
    if (!this.registered.has(`p${n}`) && this.panel.connected && (p.armed !== undefined || p.label)) this._registerPartition(n);
    const k = `dsc/partition/${n}`;
    const flag = (key, path) => { if (key in patch) this.store.update(`${k}/${path}`, patch[key] ? 1 : 0); };
    flag('armed', 'armed'); flag('ready', 'ready'); flag('alarm', 'alarm'); flag('trouble', 'trouble');
    flag('exitDelay', 'exit_delay'); flag('entryDelay', 'entry_delay'); flag('bypassed', 'bypassed'); flag('alarmMemory', 'alarm_memory');
    if ('armMode' in patch) this.store.update(`${k}/mode`, patch.armMode);
  }

  // Unnamed, never-active zones (panel default label "Zone 12") are noise.
  _zoneWorthShowing(n, z) {
    if (this.cfg.allZones) return true;
    if (this.cfg.zoneTypes?.[n] && this.cfg.zoneTypes[n] !== 'none') return true;
    const named = z.label && !/^(zone|strefa|zona)\s*0*\d+$/i.test(z.label);
    return !!(named || z.open || z.alarm || z.tamper || z.bypass);
  }

  _zoneHomekit(n, label) {
    const o = this.cfg.zoneTypes?.[n] || this.cfg.zoneTypes?.[String(n)];
    if (o) return o === 'none' ? null : o;
    const u = String(label || '').toUpperCase();
    if (/PIR|MOTION|RUCH|CZUJ|DETECTOR|SALON|HALL|KORYTARZ/.test(u)) return 'motion';
    if (/DOOR|WINDOW|DRZWI|OKNO|BRAMA|GATE|GARAGE|GARAŻ|CONTACT|KONTAKTRON/.test(u)) return 'contact';
    return null;
  }

  // ── LSH devices ───────────────────────────────────────────────────────────

  _registerPanel() {
    this.registry.registerDevice({
      key: 'dsc/panel', type: 'dsc', label: this.cfg.name || 'DSC alarm', icon: '🛡️', homekit: [],
      sensors: [
        { path: 'connected', label: 'Connected', sensorType: 'connectivity', format: 'on-off', homekit: null },
        { path: 'firmware', label: 'Communicator firmware', type: 'label', homekit: null },
        { path: 'integration_id', label: 'Integration ID', type: 'label', homekit: null },
        { path: 'time', label: 'Panel time', type: 'label', homekit: null },
      ],
    });
  }

  _registerPartition(n) {
    this.registered.add(`p${n}`);
    const label = this.partitions.get(n)?.label || `Partition ${n}`;
    this.registry.registerDevice({
      key: `dsc/partition/${n}`, type: 'dsc', label, icon: '🛡️', homekit: [],
      sensors: [
        { path: 'armed', label: 'Armed', sensorType: 'armed', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'arm', writeOff: 'disarm', capabilityId: 'armed', homekit: null },
        { path: 'mode', label: 'Mode', type: 'label', homekit: null },
        { path: 'ready', label: 'Ready', sensorType: 'ready', format: 'on-off', homekit: null },
        { path: 'alarm', label: 'Alarm', sensorType: 'alarm', format: 'on-off', homekit: null },
        { path: 'trouble', label: 'Trouble', sensorType: 'trouble', format: 'on-off', homekit: null },
        { path: 'exit_delay', label: 'Exit delay', format: 'on-off', homekit: null },
        { path: 'entry_delay', label: 'Entry delay', format: 'on-off', homekit: null },
        { path: 'bypassed', label: 'Zones bypassed', format: 'on-off', homekit: null },
      ],
      _writeCapability: (capId, command) => {
        if (capId !== 'armed') return;
        return command === 'disarm' ? this.disarm(n) : this.arm(n, 'away');
      },
    });
  }

  _registerZone(n) {
    this.registered.add(`z${n}`);
    const label = this.zones.get(n)?.label || `Zone ${n}`;
    const hk = this._zoneHomekit(n, label);
    const partition = 1;
    this.registry.registerDevice({
      key: `dsc/zone/${n}`, type: 'dsc', label, homekit: hk ? [hk] : [],
      sensors: [
        { path: 'state', label: 'Open', sensorType: 'violation', format: 'on-off', homekit: hk },
        { path: 'tamper', label: 'Tamper', sensorType: 'tamper', format: 'on-off', homekit: null },
        { path: 'alarm', label: 'Alarm', sensorType: 'alarm', format: 'on-off', homekit: null },
        { path: 'low_battery', label: 'Low battery', sensorType: 'battery', format: 'on-off', homekit: null },
        { path: 'bypass', label: 'Bypassed', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'bypass', writeOff: 'unbypass', capabilityId: 'bypass', homekit: null },
      ],
      _writeCapability: (capId, command) => {
        if (capId !== 'bypass') return;
        return this.bypass(partition, n, command === 'bypass');
      },
    });
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  // Sends a command and waits for the panel's CommandResponse.
  async _command(msg, what) {
    const result = new Promise((resolve) => {
      const t = setTimeout(() => { this.pending = this.pending.filter((p) => p !== done); resolve({ ok: true, code: null }); }, RESPONSE_WAIT_MS);
      const done = (code, err) => { clearTimeout(t); resolve(code === 0 ? { ok: true, code } : { ok: false, code, error: err || itv2.RESPONSE_CODE[code] || `code ${code}` }); };
      this.pending.push(done);
    });
    this._send(msg);
    const r = await result;
    if (!r.ok) throw new Error(`${what} rejected by the panel: ${r.error}`);
    return r;
  }

  async arm(partition, mode = 'away', code = this.cfg.userCode) {
    if (!(mode in ARM)) throw new Error(`Unknown arm mode "${mode}" (away, stay, night, no-entry-delay)`);
    return this._command({ _type: 'PartitionArm', partition: Number(partition), arm_mode: ARM[mode], access_code: String(code || '') }, `Arm ${mode}`);
  }

  async disarm(partition, code = this.cfg.userCode) {
    if (!code) throw new Error('A user code is needed to disarm (config.dsc.userCode)');
    return this._command({ _type: 'PartitionDisarm', partition: Number(partition), access_code: String(code) }, 'Disarm');
  }

  async bypass(partition, zone, on) {
    return this._command({ _type: 'SingleZoneBypassWrite', partition: Number(partition), zone_number: Number(zone), bypass_state: on ? 1 : 0 }, on ? 'Bypass' : 'Unbypass');
  }

  // Simulation / tests: feed a decoded message as if the panel sent it.
  _inject(msg) { this._handle(msg); }
}

module.exports = DscClient;
