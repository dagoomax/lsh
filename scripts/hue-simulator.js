#!/usr/bin/env node
'use strict';

// Philips Hue bridge simulator (CLIP v1) for developing/testing
// src/hue-client.js without a real bridge.
// Run: node scripts/hue-simulator.js [port]   (default 8180)
// Point config.hue at { "host": "127.0.0.1", "port": 8180, "username": "sim" }
// (any username works; POST /api pairing also always succeeds).

const http = require('http');
const PORT = Number(process.argv[2]) || 8180;

const lights = {
  1: { name: 'Salon lampa', type: 'Extended color light', modelid: 'LCT015',
       state: { on: false, bri: 254, hue: 8418, sat: 140, ct: 366, reachable: true } },
  2: { name: 'Korytarz', type: 'Dimmable light', modelid: 'LWB010',
       state: { on: true, bri: 120, reachable: true } },
  3: { name: 'Gniazdko TV', type: 'On/Off plug-in unit', modelid: 'LOM001',
       state: { on: false, reachable: true } },
};

const sensors = {
  4: { name: 'Czujnik przedpokój', type: 'ZLLPresence', uniqueid: '00:17:88:01:aa:bb:cc:dd-02-0406',
       state: { presence: false }, config: { battery: 87 } },
  5: { name: 'Hue temperature sensor 1', type: 'ZLLTemperature', uniqueid: '00:17:88:01:aa:bb:cc:dd-02-0402',
       state: { temperature: 2144 }, config: { battery: 87 } },
  6: { name: 'Hue ambient light sensor 1', type: 'ZLLLightLevel', uniqueid: '00:17:88:01:aa:bb:cc:dd-02-0400',
       state: { lightlevel: 14500 }, config: { battery: 87 } },
  7: { name: 'Włącznik sypialnia', type: 'ZLLSwitch', uniqueid: '00:17:88:01:11:22:33:44-02-fc00',
       state: { buttonevent: 1002 }, config: { battery: 74 } },
};

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => body += c);
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    const parts = req.url.split('/').filter(Boolean);   // api/<user>/...

    if (req.method === 'POST' && req.url === '/api') {
      return res.end(JSON.stringify([{ success: { username: 'simulated-hue-user' } }]));
    }
    if (parts[0] !== 'api') { res.statusCode = 404; return res.end('{}'); }

    const section = parts[2];
    if (req.method === 'GET' && section === 'lights')  return res.end(JSON.stringify(lights));
    if (req.method === 'GET' && section === 'sensors') return res.end(JSON.stringify(sensors));

    // PUT /api/<user>/lights/<id>/state
    if (req.method === 'PUT' && section === 'lights' && parts[4] === 'state') {
      const light = lights[parts[3]];
      if (!light) { res.statusCode = 404; return res.end('[]'); }
      let patch = {};
      try { patch = JSON.parse(body); } catch {}
      Object.assign(light.state, patch);
      console.log(`[sim] ${light.name}:`, JSON.stringify(patch));
      return res.end(JSON.stringify(Object.entries(patch).map(([k, v]) =>
        ({ success: { [`/lights/${parts[3]}/state/${k}`]: v } }))));
    }

    res.end(JSON.stringify([{ error: { type: 3, description: 'resource not available' } }]));
  });
}).listen(PORT, () => console.log(`[sim] Hue bridge simulator on :${PORT}`));

// temperature drift + occasional motion blip + light level wander
setInterval(() => {
  sensors[5].state.temperature = Math.round(2050 + Math.random() * 250);
  sensors[6].state.lightlevel  = Math.max(0, sensors[6].state.lightlevel + Math.round(Math.random() * 2000 - 1000));
}, 15000);
setInterval(() => {
  sensors[4].state.presence = true;
  setTimeout(() => { sensors[4].state.presence = false; }, 8000);
}, 45000);
