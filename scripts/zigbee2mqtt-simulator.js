#!/usr/bin/env node
'use strict';

// Stand-in Zigbee2MQTT for src/zigbee2mqtt-client.js: publishes a retained
// bridge/state, bridge/info and bridge/devices (a colour bulb, a two-gang
// switch, a door sensor) on any MQTT broker, answers <name>/set and
// <name>/get like Zigbee2MQTT does (state echoed back on <name>), and handles
// bridge/request/permit_join and device/remove.
//
//   node scripts/zigbee2mqtt-simulator.js [mqtt://127.0.0.1:1883] [baseTopic] [--v1]
//
// --v1 reports version 1.42.0 (permit_join wants { value, time }).

const mqtt = require('mqtt');

const LIGHT = { type: 'light', features: [
  { name: 'state', access: 7, type: 'binary', property: 'state', value_on: 'ON', value_off: 'OFF' },
  { name: 'brightness', access: 7, type: 'numeric', property: 'brightness', value_min: 0, value_max: 254 },
  { name: 'color_temp', access: 7, type: 'numeric', property: 'color_temp', unit: 'mired', value_min: 153, value_max: 454 },
] };
const gang = (ep) => ({ type: 'switch', endpoint: ep, features: [{ name: 'state', access: 7, type: 'binary', endpoint: ep, property: `state_${ep}`, value_on: 'ON', value_off: 'OFF' }] });
const LQI = { name: 'linkquality', access: 1, type: 'numeric', property: 'linkquality', unit: 'lqi' };

function devices() {
  return [
    { ieee_address: '0x00124b0000000001', type: 'Coordinator', friendly_name: 'Coordinator', interview_completed: true, supported: true, definition: null },
    { ieee_address: '0x0017880100000001', type: 'Router', friendly_name: 'living/lamp', interview_completed: true, supported: true, disabled: false,
      definition: { vendor: 'Philips', model: '9290012573A', description: 'Hue white ambiance E27', exposes: [LIGHT, LQI] } },
    { ieee_address: '0xa4c1380000000002', type: 'Router', friendly_name: 'Hall switch', interview_completed: true, supported: true, disabled: false,
      definition: { vendor: 'Tuya', model: 'TS0012', description: 'Two-gang wall switch', exposes: [gang('l1'), gang('l2'), LQI] } },
    { ieee_address: '0x00158d0000000003', type: 'EndDevice', friendly_name: 'Front door', interview_completed: true, supported: true, disabled: false,
      definition: { vendor: 'Aqara', model: 'MCCGQ11LM', description: 'Door and window sensor', exposes: [
        { name: 'contact', access: 1, type: 'binary', property: 'contact', value_on: false, value_off: true },
        { name: 'battery', access: 1, type: 'numeric', property: 'battery', unit: '%', category: 'diagnostic' }, LQI] } },
  ];
}

function startSimulator({ url = 'mqtt://127.0.0.1:1883', base = 'zigbee2mqtt', v1 = false, mqttOpts = {} } = {}) {
  const list = devices();
  const state = {
    'living/lamp': { state: 'OFF', brightness: 200, color_temp: 370, linkquality: 120 },
    'Hall switch': { state_l1: 'OFF', state_l2: 'ON', linkquality: 90 },
    'Front door': { contact: true, battery: 97, linkquality: 60 },
  };
  const info = { version: v1 ? '1.42.0' : '2.6.0', permit_join: false, permit_join_end: null, permit_join_timeout: 0,
    network: { channel: 15, pan_id: 6754, extended_pan_id: '0xdddddddddddddddd' },
    coordinator: { type: 'EmberZNet', meta: { revision: '7.4.4.0' } } };
  const received = []; // [topic, payload] — for tests
  const client = mqtt.connect(url, { clientId: `z2m-sim-${process.pid}`, reconnectPeriod: 1000, ...mqttOpts });
  const pub = (t, p, retain = false) => client.publish(`${base}/${t}`, typeof p === 'string' ? p : JSON.stringify(p), { retain, qos: 1 });
  const names = () => list.filter((d) => d.type !== 'Coordinator').map((d) => d.friendly_name);
  const publishInfo = () => pub('bridge/info', info, true);
  const publishDevices = () => pub('bridge/devices', list, true);

  client.on('connect', () => {
    client.subscribe([`${base}/+/set`, `${base}/+/+/set`, `${base}/+/get`, `${base}/+/+/get`, `${base}/bridge/request/#`]);
    pub('bridge/state', v1 ? 'online' : { state: 'online' }, true);
    publishInfo();
    publishDevices();
    for (const n of names()) pub(`${n}/availability`, v1 ? 'online' : { state: 'online' }, true);
  });

  client.on('message', (topic, buf) => {
    const rest = topic.slice(base.length + 1);
    let body;
    try { body = JSON.parse(buf.toString()); } catch { body = buf.toString(); }
    received.push([rest, body]);
    if (rest === 'bridge/request/permit_join') {
      if (v1 && typeof body.value !== 'boolean') return pub('bridge/response/permit_join', { status: 'error', error: 'value missing' });
      const time = Number(body.time) || 0;
      info.permit_join = v1 ? body.value : time > 0;
      info.permit_join_end = info.permit_join ? Date.now() + time * 1000 : null;
      info.permit_join_timeout = info.permit_join ? time : 0;
      publishInfo();
      return pub('bridge/response/permit_join', { status: 'ok', data: body });
    }
    if (rest === 'bridge/request/device/remove') {
      const i = list.findIndex((d) => d.friendly_name === body.id || d.ieee_address === body.id);
      if (i < 0) return pub('bridge/response/device/remove', { status: 'error', error: `Device '${body.id}' does not exist` });
      list.splice(i, 1);
      publishDevices();
      return pub('bridge/response/device/remove', { status: 'ok', data: { id: body.id } });
    }
    const m = /^(.*)\/(set|get)$/.exec(rest);
    if (!m || !state[m[1]]) return;
    if (m[2] === 'set') Object.assign(state[m[1]], body);
    pub(m[1], state[m[1]]);
  });

  return {
    client, state, received, list,
    rename(from, to) {
      const d = list.find((x) => x.friendly_name === from);
      d.friendly_name = to; state[to] = state[from]; delete state[from];
      publishDevices();
    },
    report(name, payload) { Object.assign(state[name], payload); pub(name, state[name]); },
    stop: () => new Promise((r) => client.end(true, {}, r)),
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const url = args.find((a) => a.startsWith('mqtt://')) || 'mqtt://127.0.0.1:1883';
  const base = args.find((a) => !a.startsWith('mqtt://') && !a.startsWith('--')) || 'zigbee2mqtt';
  const sim = startSimulator({ url, base, v1: args.includes('--v1') });
  sim.client.on('connect', () => console.log(`Zigbee2MQTT simulator on ${url} (${base}) — ${sim.list.length - 1} devices`));
  setInterval(() => sim.report('Front door', { contact: Math.random() > 0.5 }), 15_000);
}

module.exports = { startSimulator };
