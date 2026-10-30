#!/usr/bin/env node
'use strict';

// Pair HomeKit (IP) accessories with LSH's HomeKit controller
// (src/homekit-controller-client.js). Pairings go to persist/homekit-controller.json;
// restart LSH afterwards. The accessory must not be paired with the Home app —
// remove it there first (or factory-reset it).
//
//   node scripts/homekit-pair.js                     list accessories on the network
//   node scripts/homekit-pair.js <id> <setup-code>   pair (code from the label, 123-45-678)
//   node scripts/homekit-pair.js <id> <code> <ip:port>   pair without waiting for mDNS
//   node scripts/homekit-pair.js --remove <id>       unpair and forget
//   node scripts/homekit-pair.js --paired            show what LSH is paired with

const fs   = require('fs');
const path = require('path');
const { HttpClient, IPDiscovery } = require('hap-controller');

const FILE = path.join(__dirname, '..', 'persist', 'homekit-controller.json');
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const save = (p) => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(p, null, 2)); };

function discover(seconds, wantId) {
  return new Promise((resolve) => {
    const d = new IPDiscovery();
    const found = new Map();
    const done = () => { d.stop(); resolve(found); };
    const t = setTimeout(done, seconds * 1000);
    d.on('serviceUp', (svc) => {
      found.set(svc.id, { svc, d });
      if (wantId && svc.id.toLowerCase() === wantId.toLowerCase()) { clearTimeout(t); done(); }
    });
    d.start();
  });
}

const fmtCode = (c) => {
  const digits = String(c).replace(/\D/g, '');
  if (digits.length !== 8) throw new Error('Setup code must have 8 digits (123-45-678)');
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
};

async function list() {
  console.log('Looking for HomeKit accessories (10 s)…\n');
  const found = await discover(10);
  if (!found.size) return console.log('None found. HomeKit over IP only (no BLE/Thread); LSH and the accessory must share a subnet.');
  const paired = load();
  for (const { svc } of found.values()) {
    const state = paired[svc.id] ? 'paired with LSH' : svc.availableToPair ? 'READY TO PAIR' : 'paired elsewhere (remove from Home app first)';
    console.log(`  ${svc.id}  ${svc.name.padEnd(30)} ${`${svc.address}:${svc.port}`.padEnd(22)} ${state}`);
  }
  console.log('\nPair one with: node scripts/homekit-pair.js <id> <setup-code>');
}

async function pair(id, code, hostPort) {
  const pin = fmtCode(code);
  let address, port, name = id, pairMethod;
  if (hostPort) {
    [address, port] = hostPort.split(':');
    port = Number(port);
    if (!address || !port) throw new Error('Use ip:port');
  } else {
    console.log(`Looking for ${id}…`);
    const hit = [...(await discover(15, id)).values()].find(({ svc }) => svc.id.toLowerCase() === id.toLowerCase());
    if (!hit) throw new Error(`${id} not found on the network`);
    ({ address, port, name, id } = hit.svc);
    if (!hit.svc.availableToPair) throw new Error(`${name} is already paired with a controller — remove it from the Home app first`);
    pairMethod = await hit.d.getPairMethod(hit.svc);
  }
  const client = new HttpClient(id, address, port);
  await client.pairSetup(pin, pairMethod);
  const pairings = load();
  pairings[id] = { name, address, port: Number(port), pairingData: client.getLongTermData() };
  save(pairings);
  await client.close();
  console.log(`Paired ${name} (${id}). Make sure config.json has "homekitController": { "enabled": true }, then restart LSH.`);
}

async function remove(id) {
  const pairings = load();
  const p = pairings[id];
  if (!p) throw new Error(`${id} is not paired with LSH`);
  try {
    const client = new HttpClient(id, p.address, p.port, p.pairingData);
    await client.removePairing(p.pairingData.iOSDevicePairingID);
    await client.close();
  } catch (err) {
    console.warn(`Could not unpair on the accessory (${err.message}) — forgetting it anyway; factory-reset it to pair again.`);
  }
  delete pairings[id];
  save(pairings);
  console.log(`Removed ${p.name}.`);
}

(async () => {
  const [a, b, c] = process.argv.slice(2);
  if (!a) return list();
  if (a === '--paired') {
    const p = load();
    for (const [id, x] of Object.entries(p)) console.log(`  ${id}  ${x.name}  ${x.address}:${x.port}`);
    if (!Object.keys(p).length) console.log('Nothing paired.');
    return;
  }
  if (a === '--remove') return remove(b);
  if (!b) throw new Error('Usage: node scripts/homekit-pair.js <id> <setup-code> [ip:port]');
  return pair(a, b, c);
})().then(() => process.exit(0), (err) => { console.error(`Error: ${err.message}`); process.exit(1); });
