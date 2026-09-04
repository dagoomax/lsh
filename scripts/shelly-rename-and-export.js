#!/usr/bin/env node
'use strict';

// Two-step maintenance helper for a bulk Shelly rename + Loxone re-export.
// Renaming a device's label happens once, at server startup, from
// config.shelly.devices[].name (see ShellySection.jsx / POST
// /api/settings/shelly) — flows/automations can't touch it, since they act
// on live device state, not config. So this is a plain script, run in two
// steps around a restart:
//
//   1. node scripts/shelly-rename-and-export.js rename
//        renames every configured Shelly device to "Shelly 1", "Shelly 2", …
//        in their current config.json order, then reminds you to restart LSH.
//
//   2. node scripts/shelly-rename-and-export.js export --host <lsh-ip:port> --token <api-token>
//        run AFTER restarting, once the new names are live — fetches the
//        Loxone inputs.xml + outputs.xml for type=shelly and saves them
//        next to this script (or --out <dir>).

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

function rename() {
  const cfg = readConfig();
  const devices = cfg.shelly?.devices || [];
  if (!devices.length) {
    console.log('[Shelly] No devices in config.shelly.devices — nothing to rename.');
    return;
  }

  console.log(`[Shelly] Renaming ${devices.length} device(s):`);
  devices.forEach((d, i) => {
    const newName = `Shelly ${i + 1}`;
    console.log(`  ${d.name || '(unnamed)'} (${d.host}) -> ${newName}`);
    d.name = newName;
  });

  writeConfig({ ...cfg, shelly: { devices } });
  console.log('\n[Shelly] Saved. Restart LSH for the new names to take effect, then run:');
  console.log('  node scripts/shelly-rename-and-export.js export --host <lsh-ip:port> --token <api-token>');
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode >= 400) {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${body}`)));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }));
    }).on('error', reject);
  });
}

async function exportXml(opts) {
  const { host, token } = opts;
  if (!host || !token) {
    console.error('Usage: node scripts/shelly-rename-and-export.js export --host <lsh-ip:port> --token <api-token> [--out <dir>]');
    process.exit(1);
  }
  const outDir = opts.out || __dirname;
  fs.mkdirSync(outDir, { recursive: true });

  for (const kind of ['outputs', 'inputs']) {
    const url = `http://${host}/api/loxone/${kind}.xml?type=shelly&token=${encodeURIComponent(token)}`;
    console.log(`[Loxone] Fetching ${kind}.xml for type=shelly ...`);
    try {
      const { buffer, contentType } = await fetchUrl(url);
      const isZip = contentType.includes('zip');
      const outPath = path.join(outDir, `shelly-${kind}.${isZip ? 'zip' : 'xml'}`);
      fs.writeFileSync(outPath, buffer);
      console.log(`  saved ${outPath} (${buffer.length} bytes${isZip ? ', zipped — Loxone Config caps a single block at 40 commands' : ''})`);
    } catch (err) {
      console.error(`  failed: ${err.message}`);
    }
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  if (cmd === 'rename') rename();
  else if (cmd === 'export') await exportXml(opts);
  else {
    console.log('Usage:');
    console.log('  node scripts/shelly-rename-and-export.js rename');
    console.log('  node scripts/shelly-rename-and-export.js export --host <lsh-ip:port> --token <api-token> [--out <dir>]');
    process.exit(1);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
