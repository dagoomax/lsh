#!/usr/bin/env node
'use strict';

/*
 * Roborock email-code sign-in for accounts where password login is rejected
 * (error 70016) or that use SSO. Sends a verification code to your email,
 * you type it in, and it saves a long-lived session to persist/ plus
 * roborock.cloud.email in config.json. No password is stored.
 *
 *   export ROBOROCK_EMAIL='you@example.com'   # or you'll be prompted
 *   node scripts/roborock-cloud-auth.js
 */

const fs   = require('fs');
const path = require('path');
const readline = require('readline');
const { sendEmailCode, codeLogin, fetchHomeDevices, saveUserData, mqttParams } = require('../src/roborock-cloud-client');

const ask = q => new Promise(res => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, a => { rl.close(); res(a.trim()); });
});

(async () => {
  const email = process.env.ROBOROCK_EMAIL || await ask('Roborock account email: ');
  if (!email) { console.error('✗ Email is required.'); process.exit(1); }

  console.log(`\nSending a verification code to ${email}…`);
  await sendEmailCode(email);
  console.log('✓ Code sent. Check your inbox (and spam).');

  const code = await ask('Enter the 6-digit code: ');
  if (!code) { console.error('✗ Code is required.'); process.exit(1); }

  console.log('\nLogging in…');
  const userData = await codeLogin(email, code);
  const { devices } = await fetchHomeDevices(email, userData);

  const p = mqttParams(userData.rriot);
  console.log(`\n✓ Login OK. MQTT broker: ${p.host}:${p.port} (tls=${p.tls})`);
  console.log(`\nFound ${devices.length} device(s):`);
  for (const d of devices) {
    console.log(`   • ${d.name}  [${d.model}]  duid=${d.duid}  online=${d.online}`);
  }

  // Persist the session so the server does not need to re-auth on restart.
  saveUserData(userData);

  const configPath = path.join(__dirname, '..', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  fs.copyFileSync(configPath, configPath + '.bak');
  cfg.roborock = { ...cfg.roborock, cloud: { ...(cfg.roborock?.cloud || {}), email } };
  delete cfg.roborock.cloud.password; // session cache is used instead
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

  console.log('\n✓ Saved session to persist/roborock-userdata.json and roborock.cloud.email to config.json.');
  console.log('  Reply "done" in Claude and it will restart the LSH server.');
  process.exit(0);
})().catch(e => { console.error(`\n✗ ${e.message}`); process.exit(1); });
