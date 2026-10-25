#!/usr/bin/env node
'use strict';

// Send SIA DC-09 messages to LSH's Ajax receiver, as an Ajax Hub would.
//
//   node scripts/sia-send.js <host:port> <account> <data> [key] [--cid] [--udp]
//   node scripts/sia-send.js 127.0.0.1:12128 A1B2 Nri1/CL001          # armed
//   node scripts/sia-send.js 127.0.0.1:12128 A1B2 Nri1/BA005 MyKey1234567890  # intrusion, encrypted
//   node scripts/sia-send.js 127.0.0.1:12128 A1B2 "1401 01 001" --cid  # Contact ID: disarmed
//   node scripts/sia-send.js 127.0.0.1:12128 A1B2 "" --null            # link test

const net = require('net');
const dgram = require('dgram');
const sia = require('../src/sia-dc09');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [target, account, data = '', key] = args.filter((a) => !a.startsWith('--'));
if (!target || !account) { console.error('usage: sia-send.js <host:port> <account> <data> [key] [--cid] [--udp] [--null]'); process.exit(1); }
const [host, port] = target.split(':');
const id = flags.has('--null') ? 'NULL' : flags.has('--cid') ? 'ADM-CID' : 'SIA-DCS';
const msg = sia.build({ id, account, data, key, seq: Math.floor(Math.random() * 9999) });
const show = (r) => console.log(`← ${JSON.stringify(r)}${/"(\*?)ACK"/.test(r) ? '  (accepted)' : /NAK/.test(r) ? '  (refused)' : ''}`);
console.log(`→ ${JSON.stringify(msg)}`);
if (flags.has('--udp')) {
  const s = dgram.createSocket('udp4');
  s.on('message', (m) => { show(m.toString('latin1')); s.close(); });
  s.send(msg, Number(port), host);
  setTimeout(() => { console.error('no reply'); process.exit(1); }, 3000).unref();
} else {
  const s = net.connect(Number(port), host, () => s.write(msg, 'latin1'));
  s.on('data', (d) => { show(d.toString('latin1')); s.end(); });
  s.on('error', (e) => { console.error(e.message); process.exit(1); });
}
