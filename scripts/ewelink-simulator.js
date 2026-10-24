#!/usr/bin/env node
'use strict';

// Fake eWeLink — the CoolKit v2 cloud endpoints src/ewelink-client.js uses
// (sign-in signature checked) and one Sonoff on the "LAN": an HTTP /zeroconf
// API that decrypts commands with the device key, plus an mDNS responder
// announcing it as _ewelink._tcp with its encrypted state in TXT records.
//   node scripts/ewelink-simulator.js [port]   (cloud on 8098, LAN device on 8099;
//     App ID sim-app / Secret sim-secret, account sim@example.com / sim-pass)
// Point LSH at it: config.sonoff = { appId: 'sim-app', appSecret: 'sim-secret',
//   email: 'sim@example.com', password: 'sim-pass', baseUrl: 'http://127.0.0.1:8098' }
// Tests: const sim = await startSimulator({ port: 0, lanPort: 0, mdns: false }); sim.txt('1000sim0r3'); sim.close()

const http = require('http');
const crypto = require('crypto');

const sw = (states) => states.map((s, outlet) => ({ switch: s, outlet }));
const DEVICES = () => [
  { deviceid: '1000sim0mn', name: 'Oświetlenie taras', devicekey: 'a1b2c3d4-0000-4000-8000-00000000mini', uiid: 1, model: 'MINIR2',
    params: { switch: 'off', startup: 'off', rssi: -58 }, lan: false },
  { deviceid: '1000sim0r3', name: 'Rolety / pompa', devicekey: 'a1b2c3d4-0000-4000-8000-0000dualr3xx', uiid: 126, model: 'DUALR3',
    params: { workMode: 1, switches: sw(['on', 'off', 'off', 'off']), current_00: 0, rssi: -61 }, lan: true },
  { deviceid: '1000sim0pw', name: 'Pralka', devicekey: 'a1b2c3d4-0000-4000-8000-0000powr3xxx', uiid: 190, model: 'POWR316',
    params: { switch: 'on', power: 1950, voltage: 23120, current: 84 }, lan: false },
  { deviceid: '1000sim0th', name: 'Termometr garaż', devicekey: 'a1b2c3d4-0000-4000-8000-0000th16xxxx', uiid: 15, model: 'TH16',
    params: { switch: 'off', currentTemperature: '18.4', currentHumidity: '61' }, lan: false },
];

const lanKey = (k) => crypto.createHash('md5').update(k).digest();
function enc(key, obj) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-128-cbc', lanKey(key), iv);
  return { iv: iv.toString('base64'), data: Buffer.concat([c.update(JSON.stringify(obj)), c.final()]).toString('base64') };
}
function dec(key, iv, data) {
  const d = crypto.createDecipheriv('aes-128-cbc', lanKey(key), Buffer.from(iv, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString());
}

function startSimulator({ port = 8098, lanPort = 8099, mdns = true, appId = 'sim-app', appSecret = 'sim-secret',
  email = 'sim@example.com', password = 'sim-pass' } = {}) {
  const devices = DEVICES();
  const at = 'sim-at-' + crypto.randomBytes(4).toString('hex');
  const sim = { devices, calls: [], lanCalls: [], seq: 1 };
  const apply = (d, params) => {
    for (const [k, val] of Object.entries(params)) {
      if (k === 'switches') for (const s of val) { const x = d.params.switches.find((y) => y.outlet === s.outlet); if (x) x.switch = s.switch; }
      else d.params[k] = val;
    }
    sim.seq++;
    sim._announce?.(d);
  };
  const json = (res, obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
  const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

  const cloud = http.createServer(async (req, res) => {
    const body = await readBody(req);
    sim.calls.push({ method: req.method, path: req.url, body: body ? JSON.parse(body) : null });
    if (req.headers['x-ck-appid'] !== appId) return json(res, { error: 407, msg: 'appid invalid' });
    if (req.url === '/v2/user/login') {
      const want = 'Sign ' + crypto.createHmac('sha256', appSecret).update(body).digest('base64');
      if (req.headers.authorization !== want) return json(res, { error: 401, msg: 'sign invalid' });
      const b = JSON.parse(body);
      if (b.email !== email || b.password !== password) return json(res, { error: 10001, msg: 'wrong account or password' });
      return json(res, { error: 0, msg: '', data: { at, rt: 'sim-rt', region: 'eu', user: { email } } });
    }
    if (req.headers.authorization !== `Bearer ${at}`) return json(res, { error: 401, msg: 'token invalid' });
    if (req.url.startsWith('/v2/device/thing?')) {
      return json(res, { error: 0, data: { total: devices.length, thingList: devices.map((d) => ({ itemType: 1, itemData: {
        deviceid: d.deviceid, name: d.name, online: true, devicekey: d.devicekey, productModel: d.model,
        extra: { uiid: d.uiid, model: d.model }, params: JSON.parse(JSON.stringify(d.params)) } })) } });
    }
    if (req.url === '/v2/device/thing/status' && req.method === 'POST') {
      const b = JSON.parse(body);
      const d = devices.find((x) => x.deviceid === b.id);
      if (!d) return json(res, { error: 405, msg: 'device not found' });
      apply(d, b.params);
      return json(res, { error: 0, data: {} });
    }
    json(res, { error: 404, msg: 'not found' });
  });

  const lan = http.createServer(async (req, res) => {
    const b = JSON.parse((await readBody(req)) || '{}');
    const d = devices.find((x) => x.deviceid === b.deviceid && x.lan);
    if (!d) return json(res, { seq: sim.seq, error: 404 });
    let params;
    try { params = b.encrypt ? dec(d.devicekey, b.iv, b.data) : b.data; }
    catch { return json(res, { seq: sim.seq, error: 400 }); }
    sim.lanCalls.push({ path: req.url, params });
    apply(d, params);
    json(res, { seq: sim.seq, error: 0 });
  });

  // TXT record of a LAN device: encrypted state split over data1..data4
  sim.txt = (id) => {
    const d = devices.find((x) => x.deviceid === id);
    const { iv, data } = enc(d.devicekey, d.params);
    const parts = data.match(/.{1,249}/g);
    return { txtvers: '1', id: d.deviceid, type: 'strip', apivers: '1', seq: String(sim.seq), encrypt: 'true', iv,
      ...Object.fromEntries(parts.map((p, i) => [`data${i + 1}`, p])) };
  };
  sim.mdnsResponse = (id) => {
    const name = `eWeLink_${id}._ewelink._tcp.local`;
    const host = `eWeLink_${id}.local`;
    return { answers: [
      { name: '_ewelink._tcp.local', type: 'PTR', data: name },
      { name, type: 'SRV', data: { port: sim.lanPort, target: host } },
      { name, type: 'TXT', data: Object.entries(sim.txt(id)).map(([k, val]) => Buffer.from(`${k}=${val}`)) },
      { name: host, type: 'A', data: '127.0.0.1' },
    ], additionals: [] };
  };

  return new Promise((resolve) => cloud.listen(port, '127.0.0.1', () => lan.listen(lanPort, '127.0.0.1', () => {
    sim.port = cloud.address().port;
    sim.lanPort = lan.address().port;
    sim.url = `http://127.0.0.1:${sim.port}`;
    let responder = null;
    if (mdns) {
      try {
        responder = require('multicast-dns')();
        const lanDevs = () => devices.filter((d) => d.lan);
        responder.on('query', (q) => {
          if (q.questions.some((x) => x.name === '_ewelink._tcp.local')) for (const d of lanDevs()) responder.respond(sim.mdnsResponse(d.deviceid));
        });
        sim._announce = (d) => { if (d.lan) responder.respond(sim.mdnsResponse(d.deviceid)); };
      } catch (err) { console.error(`mDNS responder off: ${err.message}`); }
    }
    sim.close = () => Promise.all([new Promise((r) => cloud.close(r)), new Promise((r) => lan.close(r))]).then(() => responder?.destroy());
    resolve(sim);
  })));
}

module.exports = { startSimulator };

if (require.main === module) {
  startSimulator({ port: Number(process.argv[2]) || 8098, lanPort: Number(process.argv[3]) || 8099 }).then((sim) => {
    console.log(`eWeLink cloud simulator on ${sim.url}, LAN device on 127.0.0.1:${sim.lanPort} (mDNS _ewelink._tcp)`);
    console.log(sim.devices.map((d) => `  ${d.deviceid}  ${d.name} (uiid ${d.uiid}${d.lan ? ', LAN' : ''})`).join('\n'));
  });
}
