#!/usr/bin/env node
'use strict';

/*
 * One-time Yale doorbell login + email/phone verification code flow.
 *
 * The Yale/August cloud API ties every login to an `installId` (a random
 * UUID LSH generates and caches in persist/yale-auth.json). The FIRST time
 * a given installId logs in with a given account, Yale requires proving you
 * own that account by emailing (or texting) a one-time code — after that,
 * the installId is trusted and yale-client.js's background poller can log
 * in on its own forever. This script only exists for that one-time step.
 *
 *   1. Set yale.username / yale.password / yale.loginMethod in config.json
 *      (see config.example.json) — this script reads them from there.
 *   2. node scripts/yale-verify.js
 *   3. It logs in, and if Yale says "requires validation", sends you a code
 *      and asks you to type it in.
 *   4. Once validated, restart LSH — yale-client.js will authenticate
 *      without any further prompts from then on.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { YaleAuthenticator } = require('../src/yale-client');

const ask = (q) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); res(a.trim()); });
});

(async () => {
  const configPath = path.join(__dirname, '..', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const yaleCfg = cfg.yale || {};

  const username = yaleCfg.username || await ask('Yale account email/phone: ');
  const password = yaleCfg.password || await ask('Yale account password: ');
  const loginMethod = yaleCfg.loginMethod === 'phone' ? 'phone' : 'email';
  if (!username || !password) { console.error('✗ Username and password are required.'); process.exit(1); }

  const auth = new YaleAuthenticator({ username, password, loginMethod });

  console.log('\nLogging in…');
  let state = await auth.login();

  if (state === 'bad_password') {
    console.error('✗ Login rejected — check the password.');
    process.exit(1);
  }

  if (state === 'authenticated') {
    console.log('✓ Already validated — nothing to do. Restart LSH if it isn\'t picking up yale.* config yet.');
    process.exit(0);
  }

  // state === 'requires_validation'
  console.log(`\nThis installId hasn't been verified yet. Sending a code via ${loginMethod}…`);
  await auth.sendVerificationCode();
  console.log(`✓ Code sent to your ${loginMethod === 'phone' ? 'phone' : 'inbox (and spam folder)'}.`);

  const code = await ask('Enter the verification code: ');
  if (!code) { console.error('✗ Code is required.'); process.exit(1); }

  console.log('\nValidating…');
  state = await auth.validateVerificationCode(code);

  if (state !== 'authenticated') {
    console.error(`✗ Validation did not complete (state: ${state}). Re-run this script to try again.`);
    process.exit(1);
  }

  console.log('\n✓ Verified and authenticated. Session cached in persist/yale-auth.json.');

  if (!yaleCfg.username || !yaleCfg.password) {
    fs.copyFileSync(configPath, configPath + '.bak');
    cfg.yale = { ...yaleCfg, username, password, loginMethod };
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    console.log('✓ Saved yale.username/password/loginMethod to config.json.');
  }

  console.log('\nRestart LSH — yale-client.js will now authenticate on its own.');
  process.exit(0);
})().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1); });
