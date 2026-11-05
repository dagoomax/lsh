#!/usr/bin/env node
'use strict';

// Long-running, fully isolated localhost demo of the Rotenso (Tuya) klima:
//   fake Tuya cloud (tuya-simulator) + REAL TuyaClient + REAL SensorRegistry +
//   the REAL LSH devices REST route (src/routes/devices.js) + a tiny control
//   page — all in one process, no persist/, no config.json, no auth, no other
//   integrations. Does NOT touch the Go core on :3001 or persist/store-data.
//   Run:  node scripts/klima-demo-server.js [port]     (default 3005)

const express = require('express');
const { startSimulator } = require('./tuya-simulator');
const TuyaClient = require('../src/tuya-client');
const SensorRegistry = require('../src/sensor-registry');
const registerDevicesRoute = require('../src/routes/devices');

const PORT = Number(process.argv[2]) || 3005;
const KEY = 'tuya/bf0sim0klima';

function makeStore() {
  const m = new Map(), ts = new Map();
  return { get: (k) => m.get(k), getTimestamp: (k) => ts.get(k) || null,
    set(k, v) { m.set(k, v); ts.set(k, Date.now()); },
    update(k, v) { m.set(k, v); ts.set(k, Date.now()); }, on() {}, emit() {} };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><html lang="pl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Klima — demo</title>
<style>
 :root{color-scheme:light dark}
 body{font:16px/1.5 system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px}
 h1{font-size:20px}.card{border:1px solid #8884;border-radius:14px;padding:20px}
 .row{display:flex;justify-content:space-between;align-items:center;margin:14px 0}
 button,select,input{font:inherit;padding:8px 12px;border-radius:10px;border:1px solid #8886;background:#8881}
 button{cursor:pointer}.big{font-size:30px;font-weight:600}
 .on{color:#1a9e4b}.off{color:#888}.muted{color:#888;font-size:13px}
</style></head><body>
<h1 id="label">Klima</h1>
<div class="card">
 <div class="row"><span>Zasilanie</span><span>
   <button onclick="cmd('switch',true)">ON</button>
   <button onclick="cmd('switch',false)">OFF</button></span></div>
 <div class="row"><span>Stan</span><span class="big" id="power">—</span></div>
 <div class="row"><span>Temp. zadana</span><span>
   <button onclick="nudge(-1)">−</button>
   <b id="set">—</b> °C
   <button onclick="nudge(1)">+</button></span></div>
 <div class="row"><span>Temp. bieżąca</span><span class="big" id="cur">—</span></div>
 <div class="row"><span>Tryb</span>
   <select id="mode" onchange="cmd('thermostatMode',this.value)">
     <option value="cold">cold</option><option value="hot">hot</option>
     <option value="wet">wet</option><option value="wind">wind</option>
     <option value="auto">auto</option></select></div>
</div>
<p class="muted">Demo: Grenton vCLU wysyła dokładnie te same wywołania REST. Źródło: symulator Tuya + prawdziwy klient LSH.</p>
<script>
const KEY=${JSON.stringify(KEY)};let setpoint=22;
async function refresh(){
 const r=await fetch('/api/devices/'+KEY);const d=(await r.json()).data;if(!d)return;
 document.getElementById('label').textContent=d.label;
 const g=p=>d.readings[p]&&d.readings[p].value;
 const on=String(g('switch'))==='1';
 const pw=document.getElementById('power');pw.textContent=on?'WŁ':'WYŁ';pw.className='big '+(on?'on':'off');
 if(g('heatingSetpoint')!=null){setpoint=Number(g('heatingSetpoint'));document.getElementById('set').textContent=setpoint;}
 document.getElementById('cur').textContent=(g('temperature')!=null?g('temperature')+' °C':'—');
 if(g('thermostatMode'))document.getElementById('mode').value=g('thermostatMode');
}
async function cmd(sensor,value){
 await fetch('/api/device/'+KEY+'/command',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({sensor,value})});setTimeout(refresh,250);
}
function nudge(d){cmd('heatingSetpoint',Math.max(16,Math.min(31,setpoint+d)));}
refresh();setInterval(refresh,2000);
</script></body></html>`;

async function main() {
  const sim = await startSimulator({ port: 0 });
  const store = makeStore();
  const registry = new SensorRegistry(store, 'pl');
  const tuya = new TuyaClient({ tuya: {
    accessId: 'sim-id', accessSecret: 'sim-secret', uid: 'eu1700000000sim',
    mode: 'cloud', baseUrl: sim.url, pollInterval: 5,
  } }, store, registry);
  await tuya.start();
  await sleep(300);
  if (!registry.getDeviceReadings(KEY)) { console.error('Klima did not register'); process.exit(1); }

  const app = express();
  app.use(express.json());
  app.get('/', (req, res) => res.type('html').send(PAGE));
  const router = express.Router();
  registerDevicesRoute(router, { requireAdmin: (req, res, next) => next(), sensorRegistry: registry });
  app.use('/api', router);
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`Klima demo:  http://localhost:${PORT}/   (device ${KEY})`);
    console.log('Isolated — no persist/, no config.json, Go core on :3001 untouched. Ctrl-C to stop.');
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
