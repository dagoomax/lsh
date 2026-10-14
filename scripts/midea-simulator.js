#!/usr/bin/env node
'use strict';

// Minimal Midea AC stand-in (local LAN protocol) for testing
// src/midea-client.js: answers the 0x41 query and 0x40 set commands with a
// 0xC0 state, inside 5A5A packets — wrapped in the V3 8370 handshake /
// AES-256-CBC session when started with a token and key (default), plain V2
// with { v2: true }.
//
//   node scripts/midea-simulator.js [port=6444]
// then config.midea = { devices: [{ host: '127.0.0.1:6444', id, token, key }] } (printed)

const net = require('net');
const crypto = require('crypto');
const { frame, unframe, packet, unpacket, V3Session, T } = require('../src/midea-client');

function stateBody(s) {
  const whole = Math.floor(s.targetTemp), half = s.targetTemp - whole ? 0x10 : 0;
  const b = Buffer.alloc(24);
  b[0] = 0xc0;
  b[1] = s.power ? 1 : 0;
  b[2] = ((whole - 16) & 0x0f) | half | (s.mode << 5);
  b[3] = s.fan; b[4] = 0x7f; b[5] = 0x7f; b[7] = s.swing; b[9] = s.eco ? 0x10 : 0;
  b[11] = Math.round(s.indoor * 2 + 50); b[12] = Math.round(s.outdoor * 2 + 50);
  return b;
}

function startSimulator({ port = 6444, id = '151732605161920', v2 = false } = {}) {
  const token = crypto.randomBytes(64), key = crypto.randomBytes(32);
  const state = { power: true, mode: 2, targetTemp: 24, fan: 102, swing: 0, eco: false, indoor: 23.5, outdoor: 31 };
  const calls = [];
  let msgId = 0;
  const answer = (body) => {
    calls.push(Buffer.from(body));
    if (body[0] === 0x40) {
      state.power = !!(body[1] & 1);
      state.mode = (body[2] >> 5) & 7;
      state.targetTemp = (body[18] & 0x1f ? (body[18] & 0x1f) + 12 : (body[2] & 0x0f) + 16) + (body[2] & 0x10 ? 0.5 : 0);
      state.fan = body[3];
      state.swing = body[7] & 0x0f;
    } else if (body[0] !== 0x41) return null;
    return packet(id, frame(0x03, stateBody(state), ++msgId));
  };
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    const v3 = new V3Session();
    sock.on('error', () => {});
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      try {
        if (v2) {
          while (buf.length >= 6 && buf.length >= buf.readUInt16LE(4)) {
            const len = buf.readUInt16LE(4);
            const out = answer(unframe(unpacket(buf.subarray(0, len))));
            buf = buf.subarray(len);
            if (out) sock.write(out);
          }
          return;
        }
        if (!v3.tcpKey && buf.length >= 8 && buf.length >= buf.readUInt16BE(2) + 8) {
          const size = buf.readUInt16BE(2) + 8;
          const got = buf.subarray(8, size);
          buf = buf.subarray(size);
          if (!got.equals(token)) return sock.end('ERROR');
          const plain = crypto.randomBytes(32);
          const c = crypto.createCipheriv('aes-256-cbc', key, Buffer.alloc(16)); c.setAutoPadding(false);
          const resp = Buffer.concat([c.update(plain), c.final(), crypto.createHash('sha256').update(plain).digest()]);
          sock.write(v3.encode(resp, T.HANDSHAKE_RESPONSE));
          v3.tcpKey = Buffer.from(plain.map((b, i) => b ^ key[i]));
        }
        if (!v3.tcpKey) return;
        const { packets, rest } = v3.decode(buf);
        buf = rest;
        for (const p of packets) {
          const out = answer(unframe(unpacket(p.data)));
          if (out) sock.write(v3.encode(out, T.ENCRYPTED_RESPONSE));
        }
      } catch { sock.destroy() }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    port: server.address().port, id, token: v2 ? null : token.toString('hex'), key: v2 ? null : key.toString('hex'), state, calls,
    close: () => new Promise((r) => server.close(r)),
  })));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 6444;
  startSimulator({ port }).then((s) => console.log(`Midea AC simulator on 127.0.0.1:${s.port}\n  id ${s.id}\n  token ${s.token}\n  key ${s.key}`));
}

module.exports = { startSimulator };
