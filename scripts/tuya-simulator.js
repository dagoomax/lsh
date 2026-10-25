#!/usr/bin/env node
'use strict';

// Fake Tuya IoT OpenAPI — the endpoints src/tuya-client.js uses, with the
// request signature checked, and four devices: a colour bulb, a 2-gang plug
// with metering, a curtain motor and a temperature/humidity sensor — plus
// TESLA Smart ones (Tuya inside): a Wi-Fi power strip 3+4 USB and a Zigbee
// hub with a radiator head, a Zigbee plug, a gas sensor and a button on it.
//   node scripts/tuya-simulator.js [port]     (default 8097, Access ID sim-id / Secret sim-secret)
// Point LSH at it: config.tuya = { accessId: 'sim-id', accessSecret: 'sim-secret',
//   mode: 'cloud', baseUrl: 'http://127.0.0.1:8097' }   (baseUrl is read by TuyaCloud)
// Tests: const sim = await startSimulator({ port: 0 }); … sim.state, sim.calls; sim.close()

const http = require('http');
const crypto = require('crypto');

const v = (min, max, scale = 0, unit = '', step = 1) => ({ type: 'value', min, max, scale, unit, step });
const DEVICES = () => [
  { id: 'bf0sim0bulb', name: 'Lampa salon', category: 'dj', product_name: 'Smart Bulb RGBCW', local_key: 'k3y0bulb00000000',
    props: [
      ['switch_led', 20, 'rw', { type: 'bool' }], ['work_mode', 21, 'rw', { type: 'enum', range: ['white', 'colour', 'scene', 'music'] }],
      ['bright_value_v2', 22, 'rw', v(10, 1000)], ['temp_value_v2', 23, 'rw', v(0, 1000)], ['colour_data_v2', 24, 'rw', { type: 'string' }],
    ],
    state: { switch_led: true, work_mode: 'white', bright_value_v2: 500, temp_value_v2: 300, colour_data_v2: '{"h":0,"s":1000,"v":1000}' } },
  { id: 'bf0sim0plug', name: 'Listwa biuro', category: 'cz', product_name: 'Power Strip 2', local_key: 'k3y0plug00000000',
    props: [
      ['switch_1', 1, 'rw', { type: 'bool' }], ['switch_2', 2, 'rw', { type: 'bool' }],
      ['add_ele', 17, 'ro', v(0, 50000, 3, 'kwh')], ['cur_current', 18, 'ro', v(0, 30000, 0, 'mA')],
      ['cur_power', 19, 'ro', v(0, 50000, 1, 'W')], ['cur_voltage', 20, 'ro', v(0, 5000, 1, 'V')],
    ],
    state: { switch_1: true, switch_2: false, add_ele: 1234, cur_current: 512, cur_power: 1176, cur_voltage: 2301 } },
  { id: 'bf0sim0curt', name: 'Zasłona sypialnia', category: 'cl', product_name: 'Curtain Motor', local_key: 'k3y0curt00000000',
    props: [
      ['control', 1, 'rw', { type: 'enum', range: ['open', 'stop', 'close', 'continue'] }],
      ['percent_control', 2, 'rw', v(0, 100, 0, '%')], ['percent_state', 3, 'ro', v(0, 100, 0, '%')],
    ],
    state: { control: 'stop', percent_control: 40, percent_state: 40 } },
  { id: 'bf0sim0th00', name: 'Czujnik łazienka', category: 'wsdcg', product_name: 'T&H Sensor', local_key: 'k3y0th0000000000',
    props: [
      ['va_temperature', 1, 'ro', v(-200, 600, 1, '℃')], ['va_humidity', 2, 'ro', v(0, 100, 0, '%')],
      ['battery_percentage', 4, 'ro', v(0, 100, 0, '%')],
    ],
    state: { va_temperature: 215, va_humidity: 58, battery_percentage: 87 } },
  // TESLA Smart (Tuya white label)
  { id: 'bf0tslstrip', name: 'Listwa TESLA', category: 'cz', product_name: 'TESLA Smart Power Strip 3+4 USB', local_key: 'k3y0strip0000000',
    props: [['switch_1', 1, 'rw', { type: 'bool' }], ['switch_2', 2, 'rw', { type: 'bool' }], ['switch_3', 3, 'rw', { type: 'bool' }], ['switch_usb1', 7, 'rw', { type: 'bool' }]],
    state: { switch_1: true, switch_2: false, switch_3: false, switch_usb1: true } },
  { id: 'bf0tslhub00', name: 'TESLA Zigbee Hub', category: 'wg2', product_name: 'TESLA Smart Zigbee Hub', local_key: 'k3y0hub000000000',
    props: [], state: {} },
  { id: 'bf0tsltrv00', name: 'Głowica sypialnia', category: 'wkf', product_name: 'TESLA Smart Thermostatic Valve', local_key: 'k3y0hub000000000', sub: true, gateway: 'bf0tslhub00', node_id: 'a4c13800trv00001',
    props: [['temp_set', 2, 'rw', v(50, 300, 1, '℃', 5)], ['temp_current', 3, 'ro', v(-100, 500, 1, '℃')],
      ['mode', 4, 'rw', { type: 'enum', range: ['auto', 'manual', 'holiday'] }], ['battery_percentage', 13, 'ro', v(0, 100, 0, '%')]],
    state: { temp_set: 210, temp_current: 195, mode: 'manual', battery_percentage: 76 } },
  { id: 'bf0tslplugz', name: 'Gniazdko TESLA Zigbee', category: 'cz', product_name: 'TESLA Smart Plug Zigbee', local_key: 'k3y0hub000000000', sub: true, gateway: 'bf0tslhub00', node_id: 'a4c13800plug0001',
    props: [['switch_1', 1, 'rw', { type: 'bool' }], ['cur_power', 19, 'ro', v(0, 50000, 1, 'W')]],
    state: { switch_1: false, cur_power: 0 } },
  { id: 'bf0tslgas00', name: 'Czujnik gazu', category: 'rqbj', product_name: 'TESLA Smart Sensor Gas', local_key: 'k3y0hub000000000', sub: true, gateway: 'bf0tslhub00', node_id: 'a4c13800gas00001',
    props: [['gas_sensor_status', 1, 'ro', { type: 'enum', range: ['alarm', 'normal'] }]], state: { gas_sensor_status: 'normal' } },
  { id: 'bf0tslbtn00', name: 'Przycisk', category: 'wxkg', product_name: 'TESLA Smart Button', local_key: 'k3y0hub000000000', sub: true, gateway: 'bf0tslhub00', node_id: 'a4c13800btn00001',
    props: [['switch1_value', 1, 'ro', { type: 'enum', range: ['single_click', 'double_click', 'long_press'] }], ['battery_percentage', 10, 'ro', v(0, 100, 0, '%')]],
    state: { switch1_value: 'single_click', battery_percentage: 100 } },
];

const sign = (secret, str) => crypto.createHmac('sha256', secret).update(str).digest('hex').toUpperCase();

function startSimulator({ port = 8097, accessId = 'sim-id', accessSecret = 'sim-secret', uid = 'eu1700000000sim' } = {}) {
  const devices = DEVICES();
  const sim = {
    devices, calls: [], token: 'sim-token-' + crypto.randomBytes(4).toString('hex'),
    get state() { return Object.fromEntries(devices.map((d) => [d.id, d.state])); },
  };
  const statusOf = (d) => Object.entries(d.state).map(([code, value]) => ({ code, value }));
  const listItem = (d) => ({ id: d.id, name: d.name, category: d.category, product_name: d.product_name, local_key: d.local_key,
    online: true, ip: '203.0.113.7', status: statusOf(d), uid, ...(d.sub ? { sub: true } : {}) });

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (result, ok = true, code, msg) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(ok ? { success: true, result, t: Date.now() } : { success: false, code, msg, t: Date.now() }));
      };
      const u = new URL(req.url, 'http://x');
      const pathQ = u.pathname + (u.search ? '?' + [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => `${k}=${val}`).join('&') : '');
      const h = req.headers;
      const token = u.pathname === '/v1.0/token' ? '' : h.access_token || '';
      const contentHash = crypto.createHash('sha256').update(body).digest('hex');
      const expect = sign(accessSecret, accessId + token + h.t + h.nonce + [req.method, contentHash, '', pathQ].join('\n'));
      sim.calls.push({ method: req.method, path: pathQ, body: body ? JSON.parse(body) : null });
      if (h.client_id !== accessId) return send(null, false, 1005, 'clientId is invalid');
      if (h.sign !== expect) return send(null, false, 1004, 'sign invalid');
      if (u.pathname === '/v1.0/token') return send({ access_token: sim.token, expire_time: 7200, refresh_token: 'r', uid });
      if (token !== sim.token) return send(null, false, 1010, 'token invalid');

      let m;
      if (u.pathname === '/v1.0/iot-01/associated-users/devices') return send({ devices: devices.map(listItem), has_more: false, last_row_key: '' });
      if ((m = /^\/v1\.0\/users\/([^/]+)\/devices$/.exec(u.pathname))) return send(m[1] === uid ? devices.map(listItem) : []);
      if ((m = /^\/v2\.0\/cloud\/thing\/([^/]+)\/model$/.exec(u.pathname))) {
        const d = devices.find((x) => x.id === m[1]);
        if (!d) return send(null, false, 2001, 'device not found');
        const model = { modelId: 'sim', services: [{ code: '', properties: d.props.map(([code, dp, mode, ts]) => ({ abilityId: dp, code, accessMode: mode, typeSpec: ts })) }] };
        return send({ model: JSON.stringify(model) });
      }
      if ((m = /^\/v1\.0\/devices\/([^/]+)\/sub-devices$/.exec(u.pathname))) {
        return send(devices.filter((d) => d.gateway === m[1]).map((d) => ({ id: d.id, name: d.name, node_id: d.node_id, category: d.category, online: true })));
      }
      if (u.pathname === '/v1.0/iot-03/devices/status') {
        const ids = (u.searchParams.get('device_ids') || '').split(',');
        return send(devices.filter((d) => ids.includes(d.id)).map((d) => ({ id: d.id, status: statusOf(d) })));
      }
      if ((m = /^\/v1\.0\/iot-03\/devices\/([^/]+)\/commands$/.exec(u.pathname)) && req.method === 'POST') {
        const d = devices.find((x) => x.id === m[1]);
        if (!d) return send(null, false, 2001, 'device not found');
        for (const { code, value } of JSON.parse(body).commands || []) {
          if (!d.props.some(([c, , mode]) => c === code && mode !== 'ro')) return send(null, false, 2008, `command ${code} not supported`);
          d.state[code] = value;
          if (code === 'percent_control') d.state.percent_state = value;
          if (code === 'control' && value === 'open') d.state.percent_state = d.state.percent_control = 100;
          if (code === 'control' && value === 'close') d.state.percent_state = d.state.percent_control = 0;
        }
        return send(true);
      }
      send(null, false, 1108, 'uri path invalid');
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    sim.port = server.address().port;
    sim.url = `http://127.0.0.1:${sim.port}`;
    sim.close = () => new Promise((r) => server.close(r));
    resolve(sim);
  }));
}

module.exports = { startSimulator };

if (require.main === module) {
  startSimulator({ port: Number(process.argv[2]) || 8097 }).then((sim) => {
    console.log(`Tuya cloud simulator on ${sim.url} — Access ID sim-id, Secret sim-secret`);
    console.log(sim.devices.map((d) => `  ${d.id}  ${d.name} (${d.category})`).join('\n'));
  });
}
