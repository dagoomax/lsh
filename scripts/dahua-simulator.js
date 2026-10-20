#!/usr/bin/env node
'use strict';

// Fake Dahua NVR — the CGI endpoints src/dahua-client.js uses, behind HTTP
// Digest auth, plus a live eventManager stream.
//   node scripts/dahua-simulator.js [port]      (default 8096, login admin / admin123)
// Then type an event on stdin, e.g.   VideoMotion Start 0
//                                     CrossLineDetection Pulse 1 Human
// Tests: const sim = await startSimulator({ port: 0 }); sim.event('VideoMotion', 'Start', 0); sim.close()

const http   = require('http');
const crypto = require('crypto');

const REALM = 'Login to SIM0123456789';
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function startSimulator({ port = 8096, username = 'admin', password = 'admin123', channels } = {}) {
  const sim = {
    model: 'DHI-NVR4108HS-4KS2/L',
    serial: 'SIM0123456789',
    channels: channels || [
      { name: 'Brama', connected: true },
      { name: 'Ogród', connected: true },
      { name: 'Garaż', connected: true },
      { name: 'Kanał 4', connected: false },
    ],
    jpeg: null, // a real JPEG to serve as every snapshot (tests set one)
    calls: [],
    streams: new Set(),
    event(code, action, index, objectType) {
      const data = objectType ? `;data={\n   "Object" : { "ObjectType" : "${objectType}" }\n}` : '';
      const body = `Code=${code};action=${action};index=${index}${data}\r\n`;
      for (const res of sim.streams) res.write(`--myboundary\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}\r\n`);
    },
  };
  const nonce = crypto.randomBytes(8).toString('hex');

  const authorized = (req) => {
    const h = req.headers.authorization || '';
    const f = {};
    for (const m of h.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) f[m[1]] = m[2] ?? m[3];
    if (!h.startsWith('Digest ') || f.username !== username || f.nonce !== nonce) return false;
    const ha1 = md5(`${username}:${REALM}:${password}`), ha2 = md5(`${req.method}:${f.uri}`);
    return f.response === md5(`${ha1}:${nonce}:${f.nc}:${f.cnonce}:${f.qop}:${ha2}`);
  };

  const text = (res, body) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(body) };

  const server = http.createServer((req, res) => {
    sim.calls.push(req.url);
    if (!authorized(req)) {
      res.writeHead(401, { 'WWW-Authenticate': `Digest realm="${REALM}", qop="auth", nonce="${nonce}", opaque="5ccc069c403ebaf9f0171e9517f40e41"` });
      return res.end();
    }
    const u = new URL(req.url, 'http://x');
    const action = u.searchParams.get('action');
    if (u.pathname === '/cgi-bin/magicBox.cgi' && action === 'getDeviceType') return text(res, `type=${sim.model}\r\n`);
    if (u.pathname === '/cgi-bin/magicBox.cgi' && action === 'getSerialNo') return text(res, `sn=${sim.serial}\r\n`);
    if (u.pathname === '/cgi-bin/configManager.cgi' && u.searchParams.get('name') === 'ChannelTitle') {
      return text(res, sim.channels.map((c, i) => `table.ChannelTitle[${i}].Name=${c.name}`).join('\r\n') + '\r\n');
    }
    if (u.pathname === '/cgi-bin/LogicDeviceManager.cgi' && action === 'getCameraState') {
      return text(res, sim.channels.map((c, i) =>
        `states[${i}].channel=${i}\r\nstates[${i}].connectionState=${c.connected ? 'Connected' : 'Disconnected'}`).join('\r\n') + '\r\n');
    }
    if (u.pathname === '/cgi-bin/snapshot.cgi') {
      const ch = Number(u.searchParams.get('channel'));
      if (!sim.channels[ch - 1]?.connected) { res.writeHead(500); return res.end('Error') }
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return res.end(sim.jpeg || Buffer.from([0xff, 0xd8, 0xff, 0xe0, ch, 0xff, 0xd9]));
    }
    if (u.pathname === '/cgi-bin/eventManager.cgi' && action === 'attach') {
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=myboundary' });
      sim.streams.add(res);
      const hb = setInterval(() => res.write('--myboundary\r\nContent-Type: text/plain\r\nContent-Length: 9\r\n\r\nHeartbeat\r\n'), 5000);
      req.on('close', () => { clearInterval(hb); sim.streams.delete(res) });
      return;
    }
    res.writeHead(400); res.end('Error\r\nBad Request!\r\n');
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    sim.port = server.address().port;
    sim.close = () => { for (const s of sim.streams) s.destroy(); return new Promise((r) => server.close(r)) };
    resolve(sim);
  }));
}

if (require.main === module) {
  startSimulator({ port: Number(process.argv[2]) || 8096 }).then((sim) => {
    console.log(`Dahua NVR simulator on 127.0.0.1:${sim.port} (admin / admin123), ${sim.channels.length} channels`);
    console.log('Type an event: <Code> <Start|Stop|Pulse> <index> [Human|Vehicle]');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (line) => {
      const [code, action, index, obj] = line.trim().split(/\s+/);
      if (code && action && index) sim.event(code, action, Number(index), obj);
    });
  });
}

module.exports = { startSimulator };
