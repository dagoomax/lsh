#!/usr/bin/env node
'use strict';

// Aqara gateway LAN-protocol simulator — emulates a hub (UDP 9898 developer
// mode) with a handful of Zigbee children for developing/testing
// src/aqara-client.js without real Aqara hardware.
// Run: node scripts/aqara-simulator.js [port]   (default 19898)
// Point config.aqara at:
//   { "gateways": [ { "host": "127.0.0.1", "port": 19898, "password": "abcdefghijklmnop" } ] }

const dgram  = require('dgram');
const crypto = require('crypto');

const PORT     = Number(process.argv[2]) || 19898;
const PASSWORD = 'abcdefghijklmnop';
const AES_IV   = Buffer.from('17996d093d28ddb3ba695a2e6f58562e', 'hex');

const GW_SID = '7811dcb28b25';
let   token  = crypto.randomBytes(8).toString('hex');   // 16 chars

// sid → { model, data }
const devices = {
  '158d0001a2b3c4': { model: 'sensor_ht',         data: { temperature: '2140', humidity: '4870', voltage: 2985 } },
  '158d0001d4e5f6': { model: 'sensor_magnet.aq2', data: { status: 'close', voltage: 3005 } },
  '158d000112a334': { model: 'sensor_motion.aq2', data: { lux: '120', voltage: 2955 } },
  '158d0001778899': { model: 'plug',              data: { status: 'off', load_power: '0.0' } },
  [GW_SID]:         { model: 'gateway',           data: { rgb: 0, illumination: 512 } },
};

const sock = dgram.createSocket('udp4');
let client = null;   // last requester { address, port } — reports go there

function send(obj, to = client) {
  if (!to) return;
  const buf = Buffer.from(JSON.stringify(obj));
  sock.send(buf, 0, buf.length, to.port, to.address);
}

function expectedKey() {
  const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(PASSWORD), AES_IV);
  c.setAutoPadding(false);
  return c.update(Buffer.from(token)).toString('hex');
}

function report(sid, data) {
  send({ cmd: 'report', model: devices[sid].model, sid, short_id: 0, data: JSON.stringify(data) });
}

sock.on('message', (msg, rinfo) => {
  let m;
  try { m = JSON.parse(msg.toString()); } catch { return; }
  client = { address: rinfo.address, port: rinfo.port };

  if (m.cmd === 'get_id_list') {
    const sids = Object.keys(devices).filter((s) => s !== GW_SID);
    send({ cmd: 'get_id_list_ack', sid: GW_SID, token, data: JSON.stringify(sids) });
  } else if (m.cmd === 'read' && devices[m.sid]) {
    send({ cmd: 'read_ack', model: devices[m.sid].model, sid: m.sid, data: JSON.stringify(devices[m.sid].data) });
  } else if (m.cmd === 'write' && devices[m.sid]) {
    let data = m.data;
    try { if (typeof data === 'string') data = JSON.parse(data); } catch { return; }
    if (data.key !== expectedKey()) {
      console.log(`[sim] write to ${m.sid} REJECTED — bad key`);
      return send({ cmd: 'write_ack', sid: m.sid, data: '{"error":"Invalid key"}' });
    }
    delete data.key;
    console.log(`[sim] write ${devices[m.sid].model} ${m.sid}:`, JSON.stringify(data));
    Object.assign(devices[m.sid].data, data);
    if (devices[m.sid].model === 'plug') {
      devices[m.sid].data.load_power = data.status === 'on' ? '12.5' : '0.0';
    }
    send({ cmd: 'write_ack', sid: m.sid, data: JSON.stringify(devices[m.sid].data) });
    report(m.sid, devices[m.sid].data);
  }
});

sock.bind(PORT, () => console.log(`[sim] Aqara gateway simulator on :${PORT} (password ${PASSWORD})`));

// temperature drift + heartbeat with rotating token
setInterval(() => {
  const ht = devices['158d0001a2b3c4'];
  ht.data.temperature = String(Math.round(2100 + Math.random() * 200));
  report('158d0001a2b3c4', { temperature: ht.data.temperature });
}, 15000);

setInterval(() => {
  token = crypto.randomBytes(8).toString('hex');
  send({ cmd: 'heartbeat', model: 'gateway', sid: GW_SID, token, data: '{}' });
}, 10000);

// motion blips every 40 s, clears after 5 s; door toggles every 90 s
setInterval(() => {
  report('158d000112a334', { status: 'motion' });
  setTimeout(() => report('158d000112a334', { no_motion: '5' }), 5000);
}, 40000);

setInterval(() => {
  const mg = devices['158d0001d4e5f6'];
  mg.data.status = mg.data.status === 'open' ? 'close' : 'open';
  report('158d0001d4e5f6', { status: mg.data.status });
}, 90000);
