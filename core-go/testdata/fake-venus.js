'use strict';

// Fake Venus OS MQTT broker for victron_test.go: answers like a Cerbo GX —
// N/<portal>/… values as {"value": …}, re-published on R/<portal>/keepalive
// — and prints every W/ (write) and R/ (read) message it gets as a JSON line.

const net = require('net');
const aedes = require('aedes')({ id: 'fake-venus' });
const port = Number(process.argv[2]);
const PORTAL = 'c0619ab1e2f3';
const values = {
  'system/0/Serial': PORTAL,
  'system/0/Dc/Battery/Soc': 76.5,
  'system/0/Dc/Battery/Voltage': 52.31,
  'battery/0/Dc/0/Voltage': 52.3,
  'system/0/Relay/0/State': 0,
  'solarcharger/279/Pv/V': 120.4,
};
const publishAll = () => {
  for (const [k, v] of Object.entries(values)) {
    aedes.publish({ topic: `N/${PORTAL}/${k}`, payload: JSON.stringify({ value: v }), qos: 0, retain: false }, () => {});
  }
};
aedes.on('publish', (packet, client) => {
  if (!client) return;
  const t = packet.topic;
  if (t.startsWith('W/') || t.startsWith('R/')) {
    process.stdout.write(JSON.stringify({ topic: t, payload: packet.payload.toString() }) + '\n');
  }
  if (t === `R/${PORTAL}/keepalive`) setTimeout(publishAll, 20);
  const m = t.match(/^W\/[^/]+\/system\/0\/Relay\/(\d+)\/State$/);
  if (m) {
    values[`system/0/Relay/${m[1]}/State`] = JSON.parse(packet.payload.toString()).value;
    setTimeout(publishAll, 20);
  }
});
aedes.on('subscribe', (subs) => { if (subs.some((s) => s.topic === 'N/+/system/0/Serial')) setTimeout(publishAll, 50); });
net.createServer(aedes.handle).listen(port, '127.0.0.1', () => process.stdout.write('{"ready":true}\n'));
process.on('SIGTERM', () => process.exit(0));
