#!/usr/bin/env node
'use strict';

// Discover every Tuya air-conditioner LSH currently has and (re)generate
// config.grenton.devices so the simulated vCLU (scripts/grenton-vclu-sim.js)
// exposes each as Grenton objects AC_<id>_{PWR,SET,MODE,TMP}. Heuristic for an
// AC: a Tuya device with BOTH a controllable `heatingSetpoint` and a
// controllable `switch` (a TRV has the setpoint but no power switch).
// Run directly for a one-off; scripts/grenton-klima-autosync.js imports syncOnce.
//   node scripts/grenton-klima-sync.js [vcluPort]        (default 8098)

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const token = () => require(path.join(ROOT, 'persist', 'api-tokens.json'))[0].token;

const get = (p, tok) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: 3001, path: p, headers: { Authorization: 'Bearer ' + tok } }, (res) => {
    let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve(d));
  }).on('error', reject);
});

async function discoverACs(tok) {
  const all = JSON.parse(await get('/api/devices', tok)).data || [];
  return all.filter((d) => d.key && d.key.startsWith('tuya/')
    && d.readings?.heatingSetpoint?.controllable && d.readings?.switch?.controllable);
}

function buildDevices(acs) {
  const devices = [];
  for (const d of acs) {
    const id = d.key.slice('tuya/'.length);
    const label = d.label || id;
    devices.push(
      { name: `${label} zasilanie`,   object: `AC_${id}_PWR`,  type: 'switch' },
      { name: `${label} nastawa`,     object: `AC_${id}_SET`,  type: 'dimmer', scale: 100 },
      { name: `${label} tryb`,        object: `AC_${id}_MODE`, type: 'dimmer', scale: 100 },
      { name: `${label} temperatura`, object: `AC_${id}_TMP`,  type: 'temperature' },
    );
  }
  return devices;
}

// Returns { acs, devices, changed }. Writes config.grenton only when the device
// list differs from what's already there (so an auto-sync loop stays quiet).
async function syncOnce({ port = 8098, tok = token() } = {}) {
  const acs = await discoverACs(tok);
  const devices = buildDevices(acs);
  const cfgPath = path.join(ROOT, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const changed = JSON.stringify(cfg.grenton?.devices || []) !== JSON.stringify(devices);
  if (changed) {
    cfg.grenton = { host: '127.0.0.1', port, path: '/lsh', pollInterval: 3, devices };
    fs.writeFileSync(cfgPath + '.tmp', JSON.stringify(cfg, null, 2));
    fs.renameSync(cfgPath + '.tmp', cfgPath);
  }
  return { acs, devices, changed };
}

module.exports = { discoverACs, buildDevices, syncOnce };

if (require.main === module) {
  const port = Number(process.argv[2]) || 8098;
  syncOnce({ port }).then(({ acs, devices, changed }) => {
    console.log(`Found ${acs.length} Tuya AC(s): ${acs.map((d) => d.key).join(', ') || '(none)'}`);
    console.log(changed ? `Wrote config.grenton with ${devices.length} device(s). Restart the core to apply.`
                        : `config.grenton already up to date (${devices.length} device(s)).`);
  }).catch((e) => { console.error(e); process.exit(1); });
}
