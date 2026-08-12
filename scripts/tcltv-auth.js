#!/usr/bin/env node
/**
 * One-time TCL (or any Android TV / Google TV) pairing.
 *
 * Usage: node scripts/tcltv-auth.js <tv-ip>
 *
 * 1. Run this script — it opens the TV's pairing service and asks the TV to
 *    show a 6-digit code (same flow as pairing the Google TV / Android TV
 *    Remote phone app).
 * 2. Read the code off the TV screen and type it in when prompted here.
 * 3. Copy the printed cert block into config.json under tcltv.cert.
 */

'use strict';

const readline = require('readline');

const host = process.argv[2];
if (!host) { console.error('Usage: node scripts/tcltv-auth.js <tv-ip>'); process.exit(1); }

function ask(q) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); res(a.trim()); });
  });
}

(async () => {
  const { createAndroidRemote } = await import('@kud/androidtv-remote');

  console.log(`\nConnecting to ${host}:6467 — the TV should show a pairing request…`);
  const remote = createAndroidRemote(host, { service_name: 'lsh' });

  remote.on('secret', async () => {
    const code = await ask('\nEnter the code shown on the TV: ');
    remote.sendCode(code);
  });

  remote.on('error', (err) => {
    console.error(`\nPairing error: ${err.message}`);
    process.exit(1);
  });

  remote.on('ready', () => {
    const cert = remote.getCertificate();
    console.log('\n✓ Paired! Add to config.json:\n');
    console.log(JSON.stringify({ tcltv: { host, name: 'Living Room TV', cert } }, null, 2));
    remote.stop();
    process.exit(0);
  });

  const started = await remote.start().catch((err) => {
    console.error(`\nCouldn't reach the TV: ${err.message}`);
    process.exit(1);
  });
  if (!started) {
    console.error('\nPairing did not complete — wrong code, or the TV rejected the request. Try again.');
    process.exit(1);
  }
})();
