#!/usr/bin/env node
'use strict';

// A fake HomeKit (IP) bridge for testing the HomeKit controller
// (src/homekit-controller-client.js) without real accessories: a colour bulb,
// a temperature/humidity sensor and a lock. Setup code 031-45-154.
//
//   node scripts/homekit-accessory-simulator.js [port=51830] [storage-dir]
//   node scripts/homekit-pair.js            → shows "LSH Test Bridge"
//
// The bridge's own pairing state lives in storage-dir (default: a temp dir, so
// every run starts unpaired). Temperature drifts every 5 s to exercise events.

const os   = require('os');
const path = require('path');
const fs   = require('fs');
const hap  = require('hap-nodejs');

const { Accessory, Bridge, Service, Characteristic, Categories, HAPStorage, uuid } = hap;

const PORT    = Number(process.argv[2]) || 51830;
const STORAGE = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-hk-sim-'));
HAPStorage.setCustomStoragePath(STORAGE);

const bridge = new Bridge('LSH Test Bridge', uuid.generate('lsh-hk-sim-bridge'));
const log = (...a) => console.log('[sim]', ...a);

// colour bulb
const bulb = new Accessory('Sim Bulb', uuid.generate('lsh-hk-sim-bulb'));
const ls = bulb.addService(Service.Lightbulb, 'Sim Bulb');
const st = { on: false, bri: 50, hue: 0, sat: 0, ct: 300 };
for (const [C, k] of [[Characteristic.On, 'on'], [Characteristic.Brightness, 'bri'], [Characteristic.Hue, 'hue'],
  [Characteristic.Saturation, 'sat'], [Characteristic.ColorTemperature, 'ct']]) {
  ls.getCharacteristic(C).onGet(() => st[k]).onSet((v) => { st[k] = v; log(`bulb ${k} = ${v}`); });
}

// temperature + humidity
const env = new Accessory('Sim Climate', uuid.generate('lsh-hk-sim-climate'));
const ts = env.addService(Service.TemperatureSensor, 'Sim Temperature');
const hs = env.addService(Service.HumiditySensor, 'Sim Humidity');
let temp = 21.5;
ts.getCharacteristic(Characteristic.CurrentTemperature).onGet(() => temp);
hs.getCharacteristic(Characteristic.CurrentRelativeHumidity).onGet(() => 45);
setInterval(() => {
  temp = Math.round((temp + (Math.random() - 0.5)) * 10) / 10;
  ts.getCharacteristic(Characteristic.CurrentTemperature).updateValue(temp);
}, 5000);

// lock
const lock = new Accessory('Sim Lock', uuid.generate('lsh-hk-sim-lock'));
const lk = lock.addService(Service.LockMechanism, 'Sim Lock');
let secured = 1;
lk.getCharacteristic(Characteristic.LockCurrentState).onGet(() => secured);
lk.getCharacteristic(Characteristic.LockTargetState).onGet(() => secured).onSet((v) => {
  secured = v;
  log(`lock target = ${v}`);
  lk.getCharacteristic(Characteristic.LockCurrentState).updateValue(v);
});

bridge.addBridgedAccessories([bulb, env, lock]);
bridge.publish({
  username: '1A:2B:3C:4D:5E:6F',
  pincode:  '031-45-154',
  port:     PORT,
  category: Categories.BRIDGE,
}).then(() => log(`published on :${PORT} (storage ${STORAGE}) — setup code 031-45-154`));

process.on('SIGINT', async () => { await bridge.unpublish(); process.exit(0); });
process.on('SIGTERM', async () => { await bridge.unpublish(); process.exit(0); });
