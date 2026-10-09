'use strict';

// Links from the wiring emulator to real devices: which module (and which
// diagram) was installed, paired through which gateway, under which real id.
// Stored in persist/wiring-links.json (override with LSH_WIRING_LINKS).
//
// realId:  'zwave:<homeId hex>:<nodeId>'  — Z-Wave node in that network
//          'mac:<AA:BB:…>'                — Wi-Fi / LAN device by MAC
//          'host:<ip>'                    — LAN device whose MAC couldn't be read
//          '<deviceKey>'                  — a device LSH already had (any gateway)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { execFile } = require('child_process');

const FILE = process.env.LSH_WIRING_LINKS || path.join(__dirname, '..', 'persist', 'wiring-links.json');

function list() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] }
}

function write(links) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(links, null, 2));
  fs.renameSync(tmp, FILE);
}

// Same real device saved again replaces the old link
function save(link) {
  const links = list().filter((l) => l.realId !== link.realId);
  const entry = { id: crypto.randomBytes(6).toString('hex'), pairedAt: new Date().toISOString(), ...link };
  links.push(entry);
  write(links);
  return entry;
}

function remove(id) {
  const links = list();
  const next = links.filter((l) => l.id !== id);
  if (next.length === links.length) return false;
  write(next);
  return true;
}

const zwaveRealId = (homeId, nodeId) => `zwave:${Number(homeId).toString(16).padStart(8, '0')}:${nodeId}`;

// ── Wi-Fi / LAN probe ────────────────────────────────────────────────────
function getJson(host, p, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, path: p, timeout }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
        try { resolve(JSON.parse(body)) } catch { reject(new Error('not JSON')) }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const fmtMac = (m) => String(m || '').replace(/[^0-9a-f]/gi, '').toUpperCase().match(/.{2}/g)?.join(':') || null;

// MAC from the host's ARP / neighbour table (works for anything on the same LAN)
function arpMac(ip) {
  return new Promise((resolve) => {
    try {
      const row = fs.readFileSync('/proc/net/arp', 'utf8').split('\n').find((l) => l.split(/\s+/)[0] === ip);
      const mac = row?.split(/\s+/)[3];
      if (mac && mac !== '00:00:00:00:00:00') return resolve(fmtMac(mac));
    } catch {}
    execFile('arp', ['-n', ip], { timeout: 3000 }, (err, out) => {
      const m = String(out || '').match(/([0-9a-f]{1,2}[:-]){5}[0-9a-f]{1,2}/i);
      resolve(m ? fmtMac(m[0].split(/[:-]/).map((x) => x.padStart(2, '0')).join('')) : null);
    });
  });
}

// What's at this address? Shelly (any generation) is recognised; anything
// else that answers is identified by its MAC.
async function probe(host) {
  if (!/^[a-z0-9.-]{1,253}$/i.test(host)) throw new Error('Enter an IP address or host name');
  let shelly = null;
  try { shelly = await getJson(host, '/shelly') } catch (err) { if (err.message === 'timeout' || err.code === 'EHOSTUNREACH' || err.code === 'ENOTFOUND') throw new Error(`${host} doesn't answer`) }
  if (shelly && (shelly.mac || shelly.id || shelly.type)) {
    const mac = fmtMac(shelly.mac) || await arpMac(host);
    return {
      host, kind: 'shelly', mac, realId: mac ? `mac:${mac}` : `host:${host}`,
      model: shelly.model || shelly.type || null, gen: shelly.gen || 1, name: shelly.name || null,
      firmware: shelly.fw_id || shelly.fw || shelly.ver || null, deviceId: shelly.id || null, auth: !!(shelly.auth || shelly.auth_en),
    };
  }
  // Any other device: make sure something answers, then read its MAC
  await new Promise((resolve, reject) => {
    const req = http.get({ host, path: '/', timeout: 4000 }, (res) => { res.resume(); resolve() });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => (err.code === 'ECONNREFUSED' ? resolve() : reject(new Error(`${host} doesn't answer (${err.message})`))));
  });
  const mac = await arpMac(host);
  return { host, kind: 'lan', mac, realId: mac ? `mac:${mac}` : `host:${host}` };
}

module.exports = { list, save, remove, probe, zwaveRealId, FILE };
