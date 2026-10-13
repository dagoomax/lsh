#!/usr/bin/env node
'use strict';

// Fake Apple TV for testing AirPlay PIN pairing (src/airplay-pairing.js):
// answers /pair-pin-start (prints the PIN it "shows on screen"), HomeKit
// pair-setup M1–M6 with that PIN (SRP-6a 3072 / SHA-512, Ed25519 identities)
// and pair-verify M1–M4, remembering paired controllers like a real one.
// Anything after pair-verify (the encrypted RTSP session) just closes — it
// tests pairing, not audio.
//
//   node scripts/airplay-pin-simulator.js [port=7000] [pin=1234]

const net = require('net');
const crypto = require('crypto');
const path = require('path');
const { SRP, SrpServer } = require('fast-srp-hap');

const dist = path.dirname(require.resolve('@lox-audioserver/node-airplay-sender'));
const tlv = require(path.join(dist, 'homekit', 'tlv.js')).default;
const enc = require(path.join(dist, 'homekit', 'encryption.js')).default;
const T = tlv.Tag;

const b64u = (b) => Buffer.from(b).toString('base64url');
const rawPub = (key) => Buffer.from(key.export({ format: 'jwk' }).x, 'base64url');
const edPub = (raw) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64u(raw) }, format: 'jwk' });
const xPub = (raw) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: b64u(raw) }, format: 'jwk' });

function startSimulator({ port = 7000, pin = '1234' } = {}) {
  const ltk = crypto.generateKeyPairSync('ed25519');
  const accessoryId = Buffer.from('AA:BB:CC:DD:EE:FF');
  const controllers = new Map(); // pairingId → Ed25519 public key (raw)
  const stats = { pinStarts: 0, setups: 0, verifies: 0, verifiedOk: 0, verifyRejected: 0, wrongPin: 0 };

  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    const st = {};
    const reply = (cseq, body = Buffer.alloc(0), code = '200 OK') => {
      sock.write(Buffer.concat([Buffer.from(`RTSP/1.0 ${code}\r\nContent-Length: ${body.length}\r\nContent-Type: application/octet-stream\r\nServer: AirTunes/670.6.2\r\nCSeq: ${cseq}\r\n\r\n`), body]));
    };
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (st.encrypted) { stats.encryptedAfterVerify = true; buf = Buffer.alloc(0); return } // the encrypted session: ignored, kept open
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buf.slice(0, end).toString();
        const len = Number((head.match(/content-length:\s*(\d+)/i) || [])[1] || 0);
        if (buf.length < end + 4 + len) return;
        const body = buf.slice(end + 4, end + 4 + len);
        buf = buf.slice(end + 4 + len);
        const [, method, uri = ''] = head.match(/^(\S+) (\S+)/) || [];
        if (process.env.SIM_DEBUG) console.log('[AppleTV sim] <', JSON.stringify(head.slice(0, 200)));
        const cseq = (head.match(/cseq:\s*(\d+)/i) || [])[1] || '0';
        handle(method, uri, body, cseq);
      }
    });
    sock.on('error', () => {});

    function handle(method, uri, body, cseq) {
      if (uri.endsWith('/pair-pin-start')) { stats.pinStarts++; console.log(`[AppleTV sim] PIN on screen: ${pin}`); return reply(cseq) }
      if (uri.endsWith('/pair-setup')) {
        const m = tlv.decode(body), seq = m[T.Sequence]?.[0];
        if (seq === 1) {
          st.salt = crypto.randomBytes(16);
          st.srp = new SrpServer(SRP.params.hap, st.salt, Buffer.from('Pair-Setup'), Buffer.from(pin), crypto.randomBytes(32));
          return reply(cseq, tlv.encode(T.Sequence, 0x02, T.Salt, st.salt, T.PublicKey, st.srp.computeB()));
        }
        if (seq === 3) {
          st.srp.setA(m[T.PublicKey]);
          try { st.srp.checkM1(m[T.Proof]) } catch { stats.wrongPin++; return reply(cseq, tlv.encode(T.Sequence, 0x04, T.ErrorCode, 0x02)) }
          st.K = st.srp.computeK();
          return reply(cseq, tlv.encode(T.Sequence, 0x04, T.Proof, st.srp.computeM2()));
        }
        if (seq === 5) {
          const key = enc.HKDF('sha512', Buffer.from('Pair-Setup-Encrypt-Salt'), st.K, Buffer.from('Pair-Setup-Encrypt-Info'), 32);
          const data = m[T.EncryptedData];
          const inner = tlv.decode(enc.verifyAndDecrypt(data.slice(0, -16), data.slice(-16), null, Buffer.from('PS-Msg05'), key));
          const iosX = enc.HKDF('sha512', Buffer.from('Pair-Setup-Controller-Sign-Salt'), st.K, Buffer.from('Pair-Setup-Controller-Sign-Info'), 32);
          const ok = crypto.verify(null, Buffer.concat([iosX, inner[T.Username], inner[T.PublicKey]]), edPub(inner[T.PublicKey]), inner[T.Signature]);
          if (!ok) return reply(cseq, tlv.encode(T.Sequence, 0x06, T.ErrorCode, 0x02));
          controllers.set(inner[T.Username].toString(), Buffer.from(inner[T.PublicKey]));
          stats.setups++;
          const accX = enc.HKDF('sha512', Buffer.from('Pair-Setup-Accessory-Sign-Salt'), st.K, Buffer.from('Pair-Setup-Accessory-Sign-Info'), 32);
          const sig = crypto.sign(null, Buffer.concat([accX, accessoryId, rawPub(ltk.publicKey)]), ltk.privateKey);
          const sealed = Buffer.concat(enc.encryptAndSeal(tlv.encode(T.Username, accessoryId, T.PublicKey, rawPub(ltk.publicKey), T.Signature, sig), null, Buffer.from('PS-Msg06'), key));
          return reply(cseq, tlv.encode(T.Sequence, 0x06, T.EncryptedData, sealed));
        }
      }
      if (uri.endsWith('/pair-verify')) {
        const m = tlv.decode(body), seq = m[T.Sequence]?.[0];
        if (seq === 1) {
          stats.verifies++;
          st.clientPub = Buffer.from(m[T.PublicKey]);
          const kp = crypto.generateKeyPairSync('x25519');
          st.serverPub = rawPub(kp.publicKey);
          st.shared = crypto.diffieHellman({ privateKey: kp.privateKey, publicKey: xPub(st.clientPub) });
          st.vkey = enc.HKDF('sha512', Buffer.from('Pair-Verify-Encrypt-Salt'), st.shared, Buffer.from('Pair-Verify-Encrypt-Info'), 32);
          const sig = crypto.sign(null, Buffer.concat([st.serverPub, accessoryId, st.clientPub]), ltk.privateKey);
          const sealed = Buffer.concat(enc.encryptAndSeal(tlv.encode(T.Username, accessoryId, T.Signature, sig), null, Buffer.from('PV-Msg02'), st.vkey));
          return reply(cseq, tlv.encode(T.Sequence, 0x02, T.PublicKey, st.serverPub, T.EncryptedData, sealed));
        }
        if (seq === 3) {
          const data = m[T.EncryptedData];
          const inner = tlv.decode(enc.verifyAndDecrypt(data.slice(0, -16), data.slice(-16), null, Buffer.from('PV-Msg03'), st.vkey));
          const id = inner[T.Username].toString(), ltpk = controllers.get(id);
          const ok = !!ltpk && crypto.verify(null, Buffer.concat([st.clientPub, inner[T.Username], st.serverPub]), edPub(ltpk), inner[T.Signature]);
          if (!ok) { stats.verifyRejected++; reply(cseq, tlv.encode(T.Sequence, 0x04, T.ErrorCode, 0x02)); return sock.end() }
          stats.verifiedOk++;
          st.encrypted = true;
          return reply(cseq, tlv.encode(T.Sequence, 0x04));
        }
      }
      reply(cseq);
    }
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    port: server.address().port, pin, stats, controllers,
    forget: () => controllers.clear(),
    close: () => new Promise((r) => server.close(() => r())),
  })));
}

if (require.main === module) {
  startSimulator({ port: Number(process.argv[2]) || 7000, pin: process.argv[3] || '1234' })
    .then((s) => console.log(`Fake Apple TV on 127.0.0.1:${s.port} — PIN ${s.pin}`));
}

module.exports = { startSimulator };
