'use strict';

// SIA DC-09 — the IP alarm-reporting protocol panels use to talk to a
// monitoring station (Ajax Hub "Monitoring Station → SIA DC-09", and most
// other panels). One message per line:
//
//   \n CRC(4 hex) LEN(4 hex) "ID" SEQ(4) [Rrcvr] Lpref #ACCT [CONTENT] [xdata] _HH:MM:SS,MM-DD-YYYY \r
//   \n73C70055"SIA-DCS"0004L0#AAA[#AAA|Nri1/CL501]_14:12:04,09-25-2019\r
//
// CRC is CRC-16/ARC and LEN the length, both over the part from the first
// quote to the end. ID is SIA-DCS (SIA codes) or ADM-CID (Contact ID), NULL
// for a link test; a leading * means the bracketed part onwards is AES-CBC
// (zero IV, key = the 16/24/32-character key set in the panel) in hex,
// which decrypts to "<padding>|<content>]…_<timestamp>". Every message is
// acknowledged with "ACK" (encrypted "*ACK" when it came encrypted), else
// the panel retries.

const crypto = require('crypto');

function crc16(str) {
  let crc = 0;
  for (const b of Buffer.from(str, 'latin1')) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const frame = (body) => `\n${crc16(body)}${body.length.toString(16).toUpperCase().padStart(4, '0')}${body}\r`;

const aesAlgo = (key) => ({ 16: 'aes-128-cbc', 24: 'aes-192-cbc', 32: 'aes-256-cbc' }[Buffer.byteLength(key)]);

function decrypt(hex, key) {
  const d = crypto.createDecipheriv(aesAlgo(key), Buffer.from(key), Buffer.alloc(16));
  d.setAutoPadding(false);
  return Buffer.concat([d.update(Buffer.from(hex, 'hex')), d.final()]).toString('latin1');
}

// leading "0" padding to a whole block, as panels and pysiaalarm do
function encrypt(text, key) {
  const padded = text.padStart(text.length + 16 - (text.length % 16), '0');
  const c = crypto.createCipheriv(aesAlgo(key), Buffer.from(key), Buffer.alloc(16));
  c.setAutoPadding(false);
  return Buffer.concat([c.update(Buffer.from(padded, 'latin1')), c.final()]).toString('hex').toUpperCase();
}

const TS_RE = /_(\d{2}):(\d{2}):(\d{2}),(\d{2})-(\d{2})-(\d{4})/;
function parseTs(s) {
  const m = TS_RE.exec(s || '');
  if (!m) return null;
  return new Date(Date.UTC(+m[6], +m[4] - 1, +m[5], +m[1], +m[2], +m[3]));
}
const tsNow = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `_${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())},${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-${d.getUTCFullYear()}`;
};

// the account is in the header (#AAA) and/or at the start of the content
const HEAD_RE = /^"(\*?)(SIA-DCS|ADM-CID|NULL)"(\d{4})(R[0-9A-F]{1,6})?(L[0-9A-F]{1,6})#?([0-9A-F]{3,16})?\[(.*)$/i;

// One received line (without the leading \n / trailing \r) → message, or
// { error } when it can't be used. keyFor(account) → AES key or undefined.
function parse(line, keyFor = () => undefined) {
  const raw = line.replace(/^\n/, '').replace(/\r$/, '');
  if (raw.length < 8) return { error: 'too short' };
  const crc = raw.slice(0, 4).toUpperCase();
  const body = raw.slice(8);
  const m = HEAD_RE.exec(body);
  if (!m) return { error: 'not a SIA DC-09 message' };
  const [, star, id, seq, rcvr = '', pref, account, rest] = m;
  const base = { id: id.toUpperCase(), seq, rcvr, pref, account: (account || /^#([0-9A-F]{3,16})\|/i.exec(rest)?.[1] || '').toUpperCase(), encrypted: !!star };
  if (crc16(body) !== crc) return { ...base, error: 'CRC mismatch' };
  let content = rest;
  if (star) {
    const key = keyFor(base.account);
    if (!key) return { ...base, error: 'encrypted, but no key set for this account' };
    try {
      const plain = decrypt(rest.replace(/[^0-9A-F]/gi, ''), key);
      content = plain.slice(plain.indexOf('|'));
    } catch (err) {
      return { ...base, error: `decryption failed (${err.message})` };
    }
  }
  // content: "#ACCT|Nri1/CL501]" or "|Nri1/CL501]" (encrypted) + "[xdata]…_timestamp"
  const close = content.indexOf(']');
  const inner = close >= 0 ? content.slice(0, close) : content;
  const data = inner.includes('|') ? inner.slice(inner.indexOf('|') + 1) : inner.replace(/^#[0-9A-F]+/i, '');
  const tail = close >= 0 ? content.slice(close + 1) : '';
  const xdata = [...tail.matchAll(/\[([^\]]*)\]/g)].map((x) => x[1]);
  return { ...base, data, xdata, timestamp: parseTs(tail) };
}

// The acknowledgement for a parsed message (formats as pysiaalarm builds them)
function ack(msg, key) {
  const head = `${msg.seq}${msg.rcvr || ''}${msg.pref}#${msg.account}[`;
  if (msg.encrypted && key) return frame(`"*ACK"${head}${encrypt(`]${tsNow()}`, key)}`);
  return frame(`"ACK"${head}]`);
}

// Refusal — e.g. a timestamp outside the allowed window (replayed message)
function nak(msg) {
  return frame(`"NAK"0000${msg.rcvr || 'R0'}${msg.pref || 'L0'}A0[]${tsNow()}`);
}

// Build a message (simulators / tests)
function build({ id = 'SIA-DCS', seq = 1, account, data, key, rcvr = 'R0', pref = 'L0', time = tsNow() }) {
  const s = String(seq).padStart(4, '0');
  const content = `|${data}]${time}`;
  if (key) return frame(`"*${id}"${s}${rcvr}${pref}#${account}[${encrypt(content, key)}`);
  return frame(`"${id}"${s}${rcvr}${pref}#${account}[#${account}${content}`);
}

// ── Events ───────────────────────────────────────────────────────────────

// SIA-DCS data "Nri1/CL501" or "Nri1CL501/ri2OP2" → [{ area, code, zone }]
function siaEvents(data) {
  const out = [];
  let area = null;
  for (const part of String(data).replace(/^N/, '').split('/')) {
    const ri = /^ri(\d+)(.*)$/.exec(part);
    let rest = part;
    if (ri) { area = Number(ri[1]); rest = ri[2]; }
    const m = /^([A-Z]{2})(\d*)/.exec(rest.replace(/^\^[^^]*\^/, ''));
    if (m) out.push({ area, code: m[1], zone: m[2] ? Number(m[2]) : null });
  }
  return out;
}

// Contact ID data "1401 01 001" (or "1401010001"): qualifier, event, area, zone/user
function cidEvents(data) {
  const d = String(data).replace(/[^0-9A-F]/gi, '');
  const m = /^([136])(\d{3})(\d{2})(\d{3})/.exec(d);
  if (!m) return [];
  const [, q, ev, area, zone] = m;
  const restore = q === '3';
  const map = {
    401: restore ? 'CL' : 'OP', 402: restore ? 'CL' : 'OP', 403: restore ? 'CL' : 'OP', 407: restore ? 'CL' : 'OP', 409: restore ? 'CL' : 'OP',
    441: restore ? 'NL' : 'OP', 456: restore ? 'CG' : 'OP',
    130: restore ? 'BR' : 'BA', 131: restore ? 'BR' : 'BA', 132: restore ? 'BR' : 'BA', 133: restore ? 'BR' : 'BA', 134: restore ? 'BR' : 'BA',
    110: restore ? 'FR' : 'FA', 111: restore ? 'FR' : 'FA', 154: restore ? 'WR' : 'WA', 151: restore ? 'GR' : 'GA',
    120: restore ? 'PR' : 'PA', 121: restore ? 'PR' : 'PA', 137: restore ? 'TR' : 'TA', 144: restore ? 'TR' : 'TA', 383: restore ? 'TR' : 'TA',
    301: restore ? 'AR' : 'AT', 302: restore ? 'YR' : 'YT', 384: restore ? 'XR' : 'XT', 602: 'RP', 603: 'RP',
  };
  const code = map[Number(ev)] || `CID${ev}`;
  return [{ area: Number(area), code, zone: Number(zone), cid: `${q}${ev}` }];
}

const events = (msg) => (msg.id === 'ADM-CID' ? cidEvents(msg.data) : msg.id === 'SIA-DCS' ? siaEvents(msg.data) : []);

module.exports = { crc16, parse, ack, nak, build, events, siaEvents, cidEvents, decrypt, encrypt };
