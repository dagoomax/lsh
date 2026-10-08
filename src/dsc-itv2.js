// SPDX-License-Identifier: GPL-3.0-or-later
// DSC PowerSeries Neo ITv2 protocol (TL280 / TL2803G / 3G2080 communicators).
// Ported to Node from HA_DSC_Neo_ITv2 by LawPaul (GPL-3.0,
// https://github.com/LawPaul/HA_DSC_Neo_ITv2), itself informed by
// Brian Humlicek's NeoHub / DSC-TLink (GPL-3.0). Distributed under the same
// license. Verified byte-for-byte against the reference implementation:
// test/fixtures/dsc-itv2-transcript.json + test/dsc-itv2.test.js.
//
// Layers (outermost first): TLink byte-stuffed framing → AES-128-ECB (one key
// per direction, Type 1 or Type 2 handshake) → ITv2 length + CRC-16 framing →
// packet header (sequence numbers + command) → message body. I/O-free: the
// SessionCodec takes received bytes and returns bytes to send + events;
// src/dsc-client.js owns the TCP socket.
'use strict';

const crypto = require('crypto');

// ── Commands ────────────────────────────────────────────────────────────────
const CMD = {
  Simple_Ack: 0, Command_Error: 1281, Command_Response: 1282,
  Notification_Text: 513, Notification_Life_Style_Zone_Status: 528, Notification_Time_Date_Broadcast: 544,
  Notification_Chime_Broadcast: 547, Notification_Exit_Delay: 560, Notification_Entry_Delay: 561,
  Notification_Arming_Disarming: 562, Notification_Partition_Ready_Status: 569,
  Notification_Partition_Alarm_Memory: 572, Notification_Partition_Trouble_Status: 575,
  Notification_Partition_Bypass_Status: 576,
  Connection_Poll: 1536, Connection_Open_Session: 1546, Connection_End_Session: 1547,
  Connection_Software_Version: 1549, Connection_Request_Access: 1550, Connection_System_Capabilities: 1555,
  Connection_Encapsulated_Command_for_Multiple_Packets: 1571,
  Configuration_Write_Single_Zone_Bypass_Write: 1866, Configuration_Notification_Configuration: 1905,
  ModuleStatus_Command_Request: 2048, ModuleStatus_Zone_Status: 2065, ModuleStatus_Partition_Status: 2066,
  ModuleStatus_Single_Zone_Bypass_Status: 2080,
  ModuleControl_Partition_Arm_Control: 2304, ModuleControl_Partition_Disarm_Control: 2305,
}
const CMD_NAME = Object.fromEntries(Object.entries(CMD).map(([k, v]) => [v, k]))
const nameOf = (c) => CMD_NAME[c] || `Unknown(0x${c.toString(16).padStart(4, '0')})`

const ARM_MODE = { Disarm: 0, StayArm: 1, AwayArm: 2, ArmWithNoEntryDelay: 3, NightArm: 4, QuickArm: 5 }
const RESPONSE_CODE = {
  0: 'Success', 1: 'CannotExitConfiguration', 2: 'InvalidProgrammingType', 3: 'UnsupportedModule', 4: 'InvalidSignalType',
  16: 'NotInCorrectProgrammingMode', 17: 'InvalidAccessCode', 18: 'AccessCodeRequired', 19: 'SystemPartitionBusy',
  20: 'InvalidPartition', 23: 'FunctionNotAvailable', 24: 'InternalError', 25: 'CommandTimeOut',
}

// ── CRC-16-CCITT (poly 0x1021, init 0xFFFF, MSB-first, no xor-out) ─────────
function crc16(data) {
  let crc = 0xffff
  for (const b of data) {
    crc ^= b << 8
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

// ── TLink framing ───────────────────────────────────────────────────────────
const HDR = 0x7e, END = 0x7f, ESC = 0x7d
function stuff(buf) {
  const out = []
  for (const b of buf) {
    if (b === ESC) out.push(ESC, 0x00)
    else if (b === HDR) out.push(ESC, 0x01)
    else if (b === END) out.push(ESC, 0x02)
    else out.push(b)
  }
  return Buffer.from(out)
}
function unstuff(buf) {
  const out = []
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]
    if (b === HDR || b === END) throw new Error('invalid delimiter inside stuffed region')
    if (b === ESC) {
      const n = buf[++i]
      if (n === 0x00) out.push(ESC); else if (n === 0x01) out.push(HDR); else if (n === 0x02) out.push(END)
      else throw new Error('invalid escape sequence')
    } else out.push(b)
  }
  return Buffer.from(out)
}
const tlinkPack = (header, payload) => Buffer.concat([stuff(header), Buffer.from([HDR]), stuff(payload), Buffer.from([END])])
// → { packet: {header, payload} | null, rest }
function tlinkExtract(buffer) {
  const end = buffer.indexOf(END)
  if (end < 0) return { packet: null, rest: buffer }
  const body = buffer.subarray(0, end)
  const rest = buffer.subarray(end + 1)
  const sep = body.indexOf(HDR)
  if (sep < 0) throw new Error('missing 0x7E header delimiter')
  return { packet: { header: unstuff(body.subarray(0, sep)), payload: unstuff(body.subarray(sep + 1)) }, rest }
}

// ── ITv2 framing (length prefix + CRC) ──────────────────────────────────────
function lenPrefix(n) {
  if (n > 0x7fff) throw new Error('length too large')
  return n > 0x7f ? Buffer.from([(n >> 8) | 0x80, n & 0xff]) : Buffer.from([n])
}
function addFraming(pkt) {
  const head = Buffer.concat([lenPrefix(pkt.length + 2), pkt])
  const c = crc16(head)
  return Buffer.concat([head, Buffer.from([c >> 8, c & 0xff])])
}
function removeFraming(data) {
  if (!data.length) throw new Error('empty ITv2 frame')
  let length, off
  if (data[0] & 0x80) { if (data.length < 2) throw new Error('truncated length'); length = ((data[0] & 0x7f) << 8) | data[1]; off = 2 } else { length = data[0]; off = 1 }
  if (length < 2) throw new Error('ITv2 length too small')
  const end = off + length - 2
  if (data.length < end + 2) throw new Error('ITv2 frame truncated')
  const expected = (data[end] << 8) | data[end + 1]
  if (crc16(data.subarray(0, end)) !== expected) throw new Error('ITv2 CRC mismatch')
  return data.subarray(off, end)
}

// ── Packet header ───────────────────────────────────────────────────────────
function buildPacket(snd, rcv, command, body) {
  if (command === CMD.Simple_Ack && !body.length) return Buffer.from([snd, rcv])
  return Buffer.concat([Buffer.from([snd, rcv, command >> 8, command & 0xff]), body])
}
function parsePacket(data) {
  if (data.length === 2) return { snd: data[0], rcv: data[1], command: CMD.Simple_Ack, body: Buffer.alloc(0) }
  if (data.length < 4) throw new Error(`packet too short (${data.length})`)
  return { snd: data[0], rcv: data[1], command: (data[2] << 8) | data[3], body: data.subarray(4) }
}

// ── Serdes ──────────────────────────────────────────────────────────────────
class Reader {
  constructor(buf) { this.b = buf; this.o = 0 }
  need(n) { if (this.o + n > this.b.length) throw new Error('truncated'); }
  u8() { this.need(1); return this.b[this.o++] }
  u16() { this.need(2); const v = this.b.readUInt16BE(this.o); this.o += 2; return v }
  u32() { this.need(4); const v = this.b.readUInt32BE(this.o); this.o += 4; return v }
  bytes(n) { this.need(n); const v = this.b.subarray(this.o, this.o + n); this.o += n; return Buffer.from(v) }
  rest() { const v = Buffer.from(this.b.subarray(this.o)); this.o = this.b.length; return v }
  compact() { const len = this.u8(); this.need(len); let v = 0; for (let i = 0; i < len; i++) v = v * 256 + this.b[this.o++]; return v }
  lenBytes() { return this.bytes(this.u8()) }
  varLen() { const f = this.u8(); return f & 0x80 ? ((f & 0x7f) << 8) | this.u8() : f }
  fixedUnicodeArray() {
    const w = this.compact()
    const items = []
    if (!w) return items
    while (this.o + w <= this.b.length) items.push(utf16beDecode(this.bytes(w)).replace(/\0+$/, ''))
    return items
  }
  packedDate() {
    const p = this.u32()
    return { year: ((p >>> 9) & 0x3f) + 2000, month: (p >>> 5) & 0x0f, day: p & 0x1f, hour: (p >>> 27) & 0x1f, minute: (p >>> 21) & 0x3f, second: (p >>> 15) & 0x3f }
  }
}
class Writer {
  constructor() { this.parts = [] }
  u8(v) { this.parts.push(Buffer.from([v & 0xff])); return this }
  u16(v) { this.parts.push(Buffer.from([(v >> 8) & 0xff, v & 0xff])); return this }
  bytes(b) { this.parts.push(Buffer.from(b)); return this }
  compact(v) {
    if (v < 0) throw new Error('compact-int cannot encode negatives')
    if (v === 0) return this.bytes([1, 0])
    const out = []
    while (v > 0) { out.unshift(v & 0xff); v = Math.floor(v / 256) }
    return this.bytes([out.length, ...out])
  }
  lenBytes(b) { if (b.length > 0xff) throw new Error('too long'); return this.u8(b.length).bytes(b) }
  bcd(digits) {
    let d = String(digits || '')
    if (d.length % 2) d += '0'
    const out = []
    for (let i = 0; i < d.length; i += 2) out.push((parseInt(d[i], 16) << 4) | parseInt(d[i + 1], 16))
    return this.bytes(out)
  }
  fixedUnicodeArray(items) {
    if (!items.length) return this.compact(0)
    const enc = items.map(utf16beEncode)
    const w = Math.max(...enc.map((e) => e.length))
    this.compact(w)
    for (const e of enc) this.bytes(Buffer.concat([e, Buffer.alloc(w - e.length)]))
    return this
  }
  buf() { return Buffer.concat(this.parts) }
}
const utf16beDecode = (b) => { const s = Buffer.from(b); s.swap16(); return s.toString('utf16le') }
const utf16beEncode = (str) => { const s = Buffer.from(String(str || ''), 'utf16le'); s.swap16(); return s }
const hex = (b) => Buffer.from(b).toString('hex')

// ── Messages ────────────────────────────────────────────────────────────────
// Each decoded message: { _type, ...fields } (field names as in the
// reference implementation). Encoders take the same shape.
const partByte = (type) => ({ dec: (r) => ({ _type: type, partition: r.compact(), value: r.u8() }) })
const M = {
  [CMD.Simple_Ack]: { type: 'SimpleAck', enc: () => Buffer.alloc(0), dec: () => ({ _type: 'SimpleAck' }) },
  [CMD.Connection_Poll]: { type: 'ConnectionPoll', enc: () => Buffer.alloc(0), dec: () => ({ _type: 'ConnectionPoll' }) },
  [CMD.Connection_End_Session]: { type: 'ConnectionEndSession', enc: () => Buffer.alloc(0), dec: () => ({ _type: 'ConnectionEndSession' }) },
  [CMD.Command_Response]: {
    type: 'CommandResponse',
    enc: (m) => Buffer.from([m.command_sequence & 0xff, (m.response_code || 0) & 0xff]),
    dec: (r) => ({ _type: 'CommandResponse', command_sequence: r.u8(), response_code: r.u8() }),
  },
  [CMD.Command_Error]: { type: 'CommandError', dec: (r) => ({ _type: 'CommandError', nack_command: r.u16(), nack_code: r.u8() }) },
  [CMD.Connection_Open_Session]: {
    type: 'OpenSession',
    enc: (m) => new Writer().u8(m.command_sequence).u8(m.device_type).bytes(m.device_id).bytes(m.firmware_version)
      .u16(m.protocol_version).u16(m.tx_buffer_size).u16(m.rx_buffer_size).bytes(m.unknown || Buffer.alloc(2)).u8(m.encryption_type).buf(),
    dec: (r) => {
      if (r.b.length < 15) throw new Error('OpenSession body too short')
      return {
        _type: 'OpenSession', command_sequence: r.u8(), device_type: r.u8(), device_id: r.bytes(2), firmware_version: r.bytes(2),
        protocol_version: r.u16(), tx_buffer_size: r.u16(), rx_buffer_size: r.u16(), unknown: r.bytes(2), encryption_type: r.u8(),
      }
    },
  },
  [CMD.Connection_Request_Access]: {
    type: 'RequestAccess',
    enc: (m) => new Writer().u8(m.command_sequence).lenBytes(m.initializer).buf(),
    dec: (r) => ({ _type: 'RequestAccess', command_sequence: r.u8(), initializer: r.lenBytes() }),
  },
  [CMD.Connection_Software_Version]: {
    type: 'ConnectionSoftwareVersion',
    dec: (r) => {
      const k = ['major_version', 'minor_version', 'build_number', 'release_number', 'protocol_major_version', 'protocol_minor_version', 'product_id_1', 'product_id_2', 'market_id', 'customer_id', 'approval_id']
      return Object.fromEntries([['_type', 'ConnectionSoftwareVersion'], ...k.map((f) => [f, r.u8()])])
    },
  },
  [CMD.Connection_System_Capabilities]: {
    type: 'ConnectionSystemCapabilities',
    enc: (m) => new Writer().compact(m.max_zones || 0).compact(m.max_users || 0).compact(m.max_partitions || 0).compact(m.max_fobs || 0).compact(m.max_prox_tags || 0).compact(m.max_outputs || 0).buf(),
    dec: (r) => ({ _type: 'ConnectionSystemCapabilities', max_zones: r.compact(), max_users: r.compact(), max_partitions: r.compact(), max_fobs: r.compact(), max_prox_tags: r.compact(), max_outputs: r.compact() }),
  },
  [CMD.ModuleStatus_Zone_Status]: {
    type: 'ModuleZoneStatus',
    enc: (m) => new Writer().compact(m.zone_start).compact(m.zone_count).u8(m.status_size_in_bytes ?? 1).bytes(m.zone_status_bytes || []).buf(),
    dec: (r) => ({ _type: 'ModuleZoneStatus', zone_start: r.compact(), zone_count: r.compact(), status_size_in_bytes: r.u8(), zone_status_bytes: r.rest() }),
  },
  [CMD.ModuleStatus_Partition_Status]: {
    type: 'ModulePartitionStatus',
    enc: (m) => new Writer().compact(m.partition).lenBytes(m.partition_status || Buffer.alloc(0)).buf(),
    dec: (r) => ({ _type: 'ModulePartitionStatus', partition: r.compact(), partition_status: r.lenBytes() }),
  },
  [CMD.ModuleStatus_Single_Zone_Bypass_Status]: {
    type: 'SingleZoneBypassStatus', dec: (r) => ({ _type: 'SingleZoneBypassStatus', zone_number: r.compact(), bypass_status: r.u8() }),
  },
  [CMD.ModuleControl_Partition_Arm_Control]: {
    type: 'PartitionArm', enc: (m) => new Writer().u8(m.command_sequence || 0).compact(m.partition).u8(m.arm_mode).bcd(m.access_code).buf(),
  },
  [CMD.ModuleControl_Partition_Disarm_Control]: {
    type: 'PartitionDisarm', enc: (m) => new Writer().u8(m.command_sequence || 0).compact(m.partition).bcd(m.access_code).buf(),
  },
  [CMD.Configuration_Write_Single_Zone_Bypass_Write]: {
    type: 'SingleZoneBypassWrite', enc: (m) => new Writer().u8(m.command_sequence || 0).compact(m.partition).compact(m.zone_number).u8(m.bypass_state).buf(),
  },
  [CMD.ModuleStatus_Command_Request]: {
    type: 'CommandRequestMessage',
    enc: (m) => { const [cmd, body] = encodeMessage(m.request); return new Writer().u8(m.command_sequence || 0).u16(cmd).bytes(body).buf() },
  },
  [CMD.Configuration_Notification_Configuration]: {
    type: 'NotificationLabelText',
    enc: (m) => new Writer().compact(m.collection).compact(m.start).compact(m.end).fixedUnicodeArray(m.labels || []).buf(),
    dec: (r) => ({ _type: 'NotificationLabelText', collection: r.compact(), start: r.compact(), end: r.compact(), labels: r.fixedUnicodeArray() }),
  },
  [CMD.Notification_Life_Style_Zone_Status]: { type: 'NotificationLifestyleZoneStatus', dec: (r) => ({ _type: 'NotificationLifestyleZoneStatus', zone_number: r.compact(), status: r.u8() }) },
  [CMD.Notification_Arming_Disarming]: { type: 'NotificationArmDisarm', dec: (r) => ({ _type: 'NotificationArmDisarm', partition: r.compact(), arm_mode: r.u8(), method: r.u8(), user_id: r.compact() }) },
  [CMD.Notification_Exit_Delay]: { type: 'NotificationExitDelay', dec: (r) => ({ _type: 'NotificationExitDelay', partition: r.compact(), delay_flags: r.u8(), duration_in_seconds: r.compact() }) },
  [CMD.Notification_Entry_Delay]: { type: 'NotificationEntryDelay', dec: (r) => ({ _type: 'NotificationEntryDelay', partition: r.compact(), delay_flags: r.u8(), duration_in_seconds: r.compact() }) },
  [CMD.Notification_Partition_Ready_Status]: { type: 'NotificationPartitionReadyStatus', dec: (r) => ({ _type: 'NotificationPartitionReadyStatus', partition_number: r.compact(), status: r.u8() }) },
  [CMD.Notification_Partition_Trouble_Status]: { type: 'NotificationPartitionTroubleStatus', ...partByte('NotificationPartitionTroubleStatus') },
  [CMD.Notification_Partition_Bypass_Status]: { type: 'NotificationPartitionBypassStatus', ...partByte('NotificationPartitionBypassStatus') },
  [CMD.Notification_Partition_Alarm_Memory]: { type: 'NotificationPartitionAlarmMemory', ...partByte('NotificationPartitionAlarmMemory') },
  [CMD.Notification_Time_Date_Broadcast]: { type: 'NotificationDateTimeBroadcast', dec: (r) => ({ _type: 'NotificationDateTimeBroadcast', date_time: r.packedDate() }) },
  [CMD.Notification_Chime_Broadcast]: { type: 'NotificationChimeBroadcast', dec: (r) => ({ _type: 'NotificationChimeBroadcast', data: r.rest() }) },
  [CMD.Notification_Text]: { type: 'NotificationText', dec: (r) => ({ _type: 'NotificationText', message: utf16beDecode(r.lenBytes()) }) },
  [CMD.Connection_Encapsulated_Command_for_Multiple_Packets]: {
    type: 'MultipleMessagePacket',
    dec: (r) => {
      const messages = []
      while (r.o < r.b.length) {
        const len = r.varLen()
        const sub = r.bytes(len)
        if (sub.length < 2) { messages.push({ _type: 'DefaultMessage', command: 0, data: sub }); continue }
        messages.push(decodeMessage((sub[0] << 8) | sub[1], sub.subarray(2)))
      }
      return { _type: 'MultipleMessagePacket', messages }
    },
  },
}
const BY_TYPE = Object.fromEntries(Object.entries(M).map(([cmd, m]) => [m.type, Number(cmd)]))

function encodeMessage(msg) {
  const cmd = BY_TYPE[msg._type]
  if (cmd === undefined || !M[cmd].enc) throw new Error(`no encoder for ${msg._type}`)
  return [cmd, M[cmd].enc(msg)]
}
function decodeMessage(command, body) {
  const m = M[command]
  if (!m?.dec) return { _type: 'DefaultMessage', command, data: Buffer.from(body) }
  try { return m.dec(new Reader(Buffer.from(body))) } catch (err) {
    return { _type: 'DefaultMessage', command, data: Buffer.from(body), deserialization_error: err.message }
  }
}

// ── Encryption ──────────────────────────────────────────────────────────────
const pad16 = (b) => (b.length % 16 ? Buffer.concat([b, Buffer.alloc(16 - (b.length % 16))]) : b)
function aesEcb(key, data, decrypt = false) {
  const c = decrypt ? crypto.createDecipheriv('aes-128-ecb', key, null) : crypto.createCipheriv('aes-128-ecb', key, null)
  c.setAutoPadding(false)
  return Buffer.concat([c.update(decrypt ? data : pad16(data)), c.final()])
}
const evens = (b) => Buffer.from([...b].filter((_, i) => i % 2 === 0))
const odds = (b) => Buffer.from([...b].filter((_, i) => i % 2 === 1))
const type1Key = (v) => {
  if (!v || String(v).length < 8) throw new Error('Type 1 value must be at least 8 characters')
  return Buffer.from(String(v).slice(0, 8).repeat(4), 'hex')
}

class Type2 {
  constructor(keyHex, random) {
    if (!/^[0-9a-f]{32}$/i.test(keyHex || '')) throw new Error('Type 2 access code must be 32 hex characters')
    this.key = Buffer.from(keyHex, 'hex'); this.random = random
  }
  configureInbound() { const init = this.random(16); this.inKey = aesEcb(this.key, init); return init }
  configureOutbound(remote) {
    if (remote.length !== 16) throw new Error(`Type 2 initializer must be 16 bytes, got ${remote.length}`)
    this.outKey = aesEcb(this.key, remote)
  }
}
class Type1 {
  constructor(integrationId, accessCode, random) {
    this.iidKey = type1Key(integrationId); this.acKey = type1Key(accessCode); this.random = random
  }
  configureInbound() {
    const r = this.random(32)
    this.inKey = odds(r)
    return Buffer.concat([evens(r), aesEcb(this.acKey, r)])
  }
  configureOutbound(remote) {
    if (remote.length !== 48) throw new Error(`Type 1 initializer must be 48 bytes, got ${remote.length}`)
    const plain = aesEcb(this.iidKey, remote.subarray(16), true)
    if (!evens(plain).equals(remote.subarray(0, 16))) throw new Error('Type 1 check-byte mismatch — wrong Integration ID or access code')
    this.outKey = odds(plain)
  }
}

// ── Session codec (handshake state machine) ─────────────────────────────────
// Events: { type: 'send', data } | { type: 'connected', session_id, encryption_type, fw: [maj, min] }
//         | { type: 'notification', command, command_name, decoded } | { type: 'closed', reason } | { type: 'failed', reason }
const S = {
  AWAIT_OPEN: 'AWAITING_OPEN_SESSION', AWAIT_OPEN_ACK: 'AWAITING_OPEN_SESSION_ACK_FROM_PANEL',
  AWAIT_ECHO_RESP: 'AWAITING_OPEN_SESSION_ECHO_RESPONSE', AWAIT_ECHO_ACK: 'AWAITING_OPEN_SESSION_ECHO_ACK',
  AWAIT_RA_ACK: 'AWAITING_REQUEST_ACCESS_ACK_FROM_PANEL', AWAIT_OUR_RA_RESP: 'AWAITING_OUR_REQUEST_ACCESS_RESPONSE',
  READY: 'READY', CLOSED: 'CLOSED', FAILED: 'FAILED',
}
const bcd2 = (b) => ((b >> 4) & 0x0f) * 10 + (b & 0x0f)

class SessionCodec {
  // settings: { integration_id, type1_access_code, type2_access_code_hex }
  constructor(settings, { random = (n) => crypto.randomBytes(n) } = {}) {
    this.settings = settings || {}
    this.random = random
    this.buffer = Buffer.alloc(0)
    this.header = null
    this.session_id = ''
    this.state = S.AWAIT_OPEN
    this.enc = null
    this.open = null
    this.localSeq = 1
    this.remoteSeq = 0
    this.cmdSeq = 0
  }

  get isReady() { return this.state === S.READY }

  feed(data) {
    const events = []
    if (data?.length) this.buffer = Buffer.concat([this.buffer, data])
    for (;;) {
      let r
      try { r = tlinkExtract(this.buffer) } catch (err) { return this._fail(err, events) }
      if (!r.packet) return events
      this.buffer = r.rest
      if (!this.header) { this.header = r.packet.header; this.session_id = this.header.toString('latin1') }
      try { this._process(r.packet.payload, events) } catch (err) { return this._fail(err, events) }
      if (this.state === S.FAILED || this.state === S.CLOSED) return events
    }
  }

  _fail(err, events) { this.state = S.FAILED; events.push({ type: 'failed', reason: err.message }); return events }

  sendMessage(msg) {
    if (this.state !== S.READY) throw new Error(`cannot send in state ${this.state}`)
    const [cmd, body] = encodeMessage(msg)
    return this._wire(this._nextLocal(), this.remoteSeq, cmd, body)
  }

  close() {
    if (this.state === S.CLOSED || this.state === S.FAILED || !this.header) return Buffer.alloc(0)
    const [cmd, body] = encodeMessage({ _type: 'ConnectionEndSession' })
    const out = this._wire(this._nextLocal(), this.remoteSeq, cmd, body)
    this.state = S.CLOSED
    return out
  }

  _process(raw, events) {
    let data = raw
    if (this.enc?.inKey) data = aesEcb(this.enc.inKey, raw, true)
    const pkt = parsePacket(removeFraming(data))
    this.remoteSeq = pkt.snd
    const msg = decodeMessage(pkt.command, pkt.body)
    const t = msg._type
    const send = (cmd, body, snd = this.localSeq, rcv = pkt.snd) => events.push({ type: 'send', data: this._wire(snd, rcv, cmd, body) })
    const respond = (cmdSeq) => send(CMD.Command_Response, M[CMD.Command_Response].enc({ command_sequence: cmdSeq, response_code: 0 }))
    const ack = () => send(CMD.Simple_Ack, Buffer.alloc(0))

    if (t === 'OpenSession' && this.state === S.AWAIT_OPEN) {
      this.open = msg; this.cmdSeq = msg.command_sequence
      respond(msg.command_sequence); this.state = S.AWAIT_OPEN_ACK; return
    }
    if (t === 'SimpleAck' && this.state === S.AWAIT_OPEN_ACK) {
      this.cmdSeq = this._nextCmd()
      const [cmd, body] = encodeMessage({ ...this.open, command_sequence: this.cmdSeq })
      send(cmd, body, this._nextLocal(), this.remoteSeq); this.state = S.AWAIT_ECHO_RESP; return
    }
    if (t === 'CommandResponse' && this.state === S.AWAIT_ECHO_RESP) {
      if (msg.response_code !== 0) throw new Error(`panel rejected OpenSession echo: code ${msg.response_code}`)
      ack(); this._setupEncryption(); this.state = S.AWAIT_ECHO_ACK; return
    }
    if (t === 'RequestAccess' && this.state === S.AWAIT_ECHO_ACK) {
      this.enc.configureOutbound(msg.initializer)
      respond(msg.command_sequence); this.state = S.AWAIT_RA_ACK; return
    }
    if (t === 'SimpleAck' && this.state === S.AWAIT_RA_ACK) {
      const init = this.enc.configureInbound()
      this.cmdSeq = this._nextCmd()
      const [cmd, body] = encodeMessage({ _type: 'RequestAccess', command_sequence: this.cmdSeq, initializer: init })
      send(cmd, body, this._nextLocal(), this.remoteSeq); this.state = S.AWAIT_OUR_RA_RESP; return
    }
    if (t === 'CommandResponse' && this.state === S.AWAIT_OUR_RA_RESP) {
      if (msg.response_code !== 0) throw new Error(`panel rejected our RequestAccess: code ${msg.response_code}`)
      ack(); this.state = S.READY
      events.push({ type: 'connected', session_id: this.session_id, encryption_type: this.open.encryption_type,
        fw: [bcd2(this.open.firmware_version[0]), bcd2(this.open.firmware_version[1])] })
      return
    }
    if (this.state === S.READY) {
      if (t === 'ConnectionEndSession') { events.push({ type: 'closed', reason: 'panel sent Connection_End_Session' }); this.state = S.CLOSED; return }
      if (t === 'SimpleAck') return
      ack()
      events.push({ type: 'notification', command: pkt.command, command_name: nameOf(pkt.command), decoded: msg })
      return
    }
    throw new Error(`unexpected ${nameOf(pkt.command)} in state ${this.state}`)
  }

  _setupEncryption() {
    const et = this.open.encryption_type
    if (et === 1) {
      if (!this.settings.type1_access_code) throw new Error('panel uses Type 1 encryption but no Type 1 access code is configured')
      if (!this.settings.integration_id) throw new Error('panel uses Type 1 encryption but no Integration ID is configured')
      this.enc = new Type1(this.settings.integration_id, this.settings.type1_access_code, this.random)
    } else if (et === 2) {
      if (!this.settings.type2_access_code_hex) throw new Error('panel uses Type 2 encryption but no Type 2 access key is configured')
      this.enc = new Type2(this.settings.type2_access_code_hex, this.random)
    } else throw new Error(`unsupported encryption type ${et}`)
  }

  _wire(snd, rcv, cmd, body) {
    let framed = addFraming(buildPacket(snd, rcv, cmd, body))
    if (this.enc?.outKey) framed = aesEcb(this.enc.outKey, framed)
    return tlinkPack(this.header || Buffer.alloc(0), framed)
  }

  _nextLocal() { this.localSeq = (this.localSeq + 1) & 0xff || 1; return this.localSeq }
  _nextCmd() { this.cmdSeq = (this.cmdSeq + 1) & 0xff || 1; return this.cmdSeq }
}

// ── Status decoding helpers (shared with the client) ────────────────────────
const ZONE_FLAGS = { open: 0x01, tamper: 0x02, fault: 0x04, lowBattery: 0x08, delinquency: 0x10, alarm: 0x20, alarmMemory: 0x40, bypass: 0x80 }
function decodeZoneByte(b) {
  return Object.fromEntries(Object.entries(ZONE_FLAGS).map(([k, bit]) => [k, !!(b & bit)]))
}
function decodePartitionStatus(bytes) {
  const s1 = bytes[0] || 0, s2 = bytes[1] || 0, s3 = bytes[2] || 0
  const mode = s1 & 0x1f
  const armedMode = { 0x01: 'away', 0x03: 'stay', 0x05: 'away', 0x09: 'night', 0x11: 'no-entry-delay' }[mode] || null
  return {
    armed: !!armedMode, armMode: armedMode || 'disarmed', ready: mode === 0x02 || mode === 0x04, walkTest: mode === 0x10,
    exitDelay: !!(s1 & 0x20), entryDelay: !!(s1 & 0x40), quickExit: !!(s1 & 0x80),
    alarm: !!(s2 & 0x01), trouble: !!(s2 & 0x02), bypassed: !!(s2 & 0x04), programming: !!(s2 & 0x08),
    alarmMemory: !!(s2 & 0x10), chime: !!(s2 & 0x20), bell: !!(s2 & 0x40), firePreAlert: !!(s3 & 0x01),
  }
}

module.exports = {
  CMD, ARM_MODE, RESPONSE_CODE, nameOf, crc16, stuff, unstuff, tlinkPack, tlinkExtract, addFraming, removeFraming,
  buildPacket, parsePacket, encodeMessage, decodeMessage, Type1, Type2, SessionCodec, decodeZoneByte, decodePartitionStatus, hex,
}
