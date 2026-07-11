#!/usr/bin/env node
'use strict';

/*
 * Logs into the Roborock cloud using ROBOROCK_EMAIL / ROBOROCK_PASSWORD from the
 * environment, lists the account's devices, and writes roborock.cloud into
 * config.json. Credentials are read from env only — never hard-coded here.
 *
 *   export ROBOROCK_EMAIL='you@example.com'
 *   export ROBOROCK_PASSWORD='your-password'
 *   node scripts/roborock-cloud-save.js
 */

const fs   = require('fs');
const path = require('path');
const { roborockLogin } = require('../src/roborock-cloud-client');

const email    = process.env.ROBOROCK_EMAIL;
const password = process.env.ROBOROCK_PASSWORD;

if (!email || !password) {
  console.error('✗ Set ROBOROCK_EMAIL and ROBOROCK_PASSWORD in the environment first.');
  process.exit(1);
}

(async () => {
  console.log('Logging in to Roborock cloud…');
  const { devices } = await roborockLogin(email.trim(), password);

  console.log(`\n✓ Login OK — ${devices.length} device(s):`);
  for (const d of devices) {
    console.log(`   • ${d.name}  [${d.model}]  duid=${d.duid}  online=${d.online}`);
  }

  const configPath = path.join(__dirname, '..', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  fs.copyFileSync(configPath, configPath + '.bak');
  cfg.roborock = { ...cfg.roborock, cloud: { ...(cfg.roborock?.cloud || {}), email: email.trim(), password } };
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

  console.log('\n✓ Saved roborock.cloud to config.json (backup: config.json.bak).');
  console.log('  Reply "done" in Claude and it will restart the LSH server.');
})().catch(e => { console.error(`\n✗ ${e.message}`); process.exit(1); });
