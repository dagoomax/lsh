#!/usr/bin/env node
'use strict';

// Ampio M-SERV MQTT simulator — a self-contained MQTT 3.1.1 broker (QoS 0/1,
// retained messages) that plays the M-SERV's Ampio↔MQTT bridge role for
// developing/testing src/ampio-client.js without real Ampio hardware.
// Run: node scripts/ampio-simulator.js [port]   (default 1884)
// Point config.ampio at { "host": "127.0.0.1", "port": 1884 } with the
// example devices from README.md (modules 1C4A and 3910).

const net  = require('net');
const PORT = Number(process.argv[2]) || 1884;

// ── simulated CAN modules: ampio/from/<suffix> → value ─────────────────────
const state = {
  '1C4A/state/o/1':  0,     // light (relay output)
  '1C4A/state/au/2': 0,     // LED dimmer level 0..255
  '1C4A/state/f/5':  0,     // flag
  '3910/state/t/1':  21.4,  // temperature
  '3910/state/i/2':  0,     // contact (binary input)
  '3910/state/i/3':  0,     // motion (binary input)
  '3910/state/a/1':  128,   // analogue input (brightness)
};

// ── minimal MQTT broker ────────────────────────────────────────────────────

const clients  = new Set();  // { sock, subs: [filter] }
const retained = new Map();  // topic → Buffer

function encodeLength(n) {
  const bytes = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 0x80; bytes.push(b); } while (n > 0);
  return Buffer.from(bytes);
}

function decodeLength(buf, pos) {
  let len = 0, mult = 1, used = 0;
  while (true) {
    if (pos + used >= buf.length) return null;               // incomplete
    const b = buf[pos + used++];
    len += (b & 0x7f) * mult; mult *= 128;
    if (!(b & 0x80)) return { len, used };
    if (used > 4) throw new Error('bad remaining length');
  }
}

function publishPacket(topic, payload, retain) {
  const t = Buffer.from(topic);
  const vh = Buffer.concat([Buffer.from([t.length >> 8, t.length & 0xff]), t, payload]);
  return Buffer.concat([Buffer.from([0x30 | (retain ? 1 : 0)]), encodeLength(vh.length), vh]);
}

function topicMatch(filter, topic) {
  const f = filter.split('/'), t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

function route(topic, payload) {
  for (const c of clients) {
    if (c.subs.some((f) => topicMatch(f, topic))) c.sock.write(publishPacket(topic, payload, false));
  }
}

function handlePacket(client, type, flags, body) {
  const { sock } = client;
  if (type === 1) {                                          // CONNECT → CONNACK
    sock.write(Buffer.from([0x20, 2, 0, 0]));
  } else if (type === 3) {                                   // PUBLISH
    const tlen  = (body[0] << 8) | body[1];
    const topic = body.slice(2, 2 + tlen).toString();
    let pos = 2 + tlen;
    const qos = (flags >> 1) & 3;
    if (qos > 0) { sock.write(Buffer.from([0x40, 2, body[pos], body[pos + 1]])); pos += 2; }
    const payload = body.slice(pos);
    if (flags & 1) retained.set(topic, payload);
    route(topic, payload);
    onCommand(topic, payload.toString());
  } else if (type === 8) {                                   // SUBSCRIBE → SUBACK
    const pid = [body[0], body[1]];
    let pos = 2;
    const granted = [];
    while (pos < body.length) {
      const flen = (body[pos] << 8) | body[pos + 1];
      const filter = body.slice(pos + 2, pos + 2 + flen).toString();
      pos += 2 + flen + 1;                                   // +1 requested-QoS byte
      client.subs.push(filter);
      granted.push(0);
      for (const [topic, payload] of retained) {
        if (topicMatch(filter, topic)) sock.write(publishPacket(topic, payload, true));
      }
    }
    sock.write(Buffer.concat([Buffer.from([0x90]), encodeLength(2 + granted.length), Buffer.from(pid), Buffer.from(granted)]));
  } else if (type === 10) {                                  // UNSUBSCRIBE → UNSUBACK
    sock.write(Buffer.from([0xb0, 2, body[0], body[1]]));
  } else if (type === 12) {                                  // PINGREQ → PINGRESP
    sock.write(Buffer.from([0xd0, 0]));
  } else if (type === 14) {                                  // DISCONNECT
    sock.end();
  }
}

net.createServer((sock) => {
  const client = { sock, subs: [] };
  clients.add(client);
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 2) {
      let rl;
      try { rl = decodeLength(buf, 1); } catch { return sock.destroy(); }
      if (!rl || buf.length < 1 + rl.used + rl.len) break;
      handlePacket(client, buf[0] >> 4, buf[0] & 0x0f, buf.slice(1 + rl.used, 1 + rl.used + rl.len));
      buf = buf.slice(1 + rl.used + rl.len);
    }
  });
  const drop = () => clients.delete(client);
  sock.on('close', drop);
  sock.on('error', drop);
}).listen(PORT, () => console.log(`[sim] Ampio M-SERV MQTT simulator on :${PORT}`));

// ── the "M-SERV bridge" side: publish states, execute commands ─────────────

function publishState(suffix) {
  const topic   = `ampio/from/${suffix}`;
  const payload = Buffer.from(String(state[suffix]));
  retained.set(topic, payload);
  route(topic, payload);
}

for (const suffix of Object.keys(state)) publishState(suffix);

function onCommand(topic, raw) {
  const m = topic.match(/^ampio\/to\/([^/]+)\/(o|f)\/(\d+)\/cmd$/);
  if (!m) return;
  const [, mac, kind, idx] = m;
  console.log(`[sim] cmd ${mac} ${kind}/${idx} = ${raw}`);

  if (kind === 'f' && `${mac}/state/f/${idx}` in state) {
    state[`${mac}/state/f/${idx}`] = raw === 'on' ? 1 : raw === 'off' ? 0 : Number(raw) > 0 ? 1 : 0;
    publishState(`${mac}/state/f/${idx}`);
  } else if (`${mac}/state/au/${idx}` in state) {            // dimmer: level on au/<idx>
    const v = raw === 'on' ? 255 : raw === 'off' ? 0 : Math.max(0, Math.min(255, Math.round(Number(raw)) || 0));
    state[`${mac}/state/au/${idx}`] = v;
    publishState(`${mac}/state/au/${idx}`);
  } else if (`${mac}/state/o/${idx}` in state) {             // relay output
    state[`${mac}/state/o/${idx}`] = raw === 'on' || Number(raw) > 0 ? 1 : 0;
    publishState(`${mac}/state/o/${idx}`);
  } else {                                                   // roller module
    console.log(`[sim] blind ${mac}/${idx}: ${{ 0: 'STOP', 1: 'DOWN', 2: 'UP' }[raw] || raw}`);
  }
}

// temperature drifts a little so the dashboard shows a live series
setInterval(() => {
  state['3910/state/t/1'] = Math.round((21 + Math.random() * 2) * 10) / 10;
  publishState('3910/state/t/1');
}, 15000);

// motion blips every 40 s, clears after 5 s
setInterval(() => {
  state['3910/state/i/3'] = 1; publishState('3910/state/i/3');
  setTimeout(() => { state['3910/state/i/3'] = 0; publishState('3910/state/i/3'); }, 5000);
}, 40000);

// contact toggles every 90 s, analogue input random-walks every 20 s
setInterval(() => {
  state['3910/state/i/2'] = state['3910/state/i/2'] ? 0 : 1;
  publishState('3910/state/i/2');
}, 90000);
setInterval(() => {
  state['3910/state/a/1'] = Math.max(0, Math.min(255, state['3910/state/a/1'] + Math.round(Math.random() * 30 - 15)));
  publishState('3910/state/a/1');
}, 20000);
