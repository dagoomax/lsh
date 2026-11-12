#!/usr/bin/env node
'use strict';

// One-time Ring sign-in for src/ring-client.js.
//
//   node scripts/ring-auth.js
//
// Asks for the Ring account e-mail and password, then the verification code
// Ring sends (SMS / e-mail / authenticator app). The password is used once
// and not stored; Ring's refresh token goes to persist/ring-auth.json and a
// `ring` section is added to config.json if there is none. Restart LSH after.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { RingAuth } = require('../src/ring-client');

const CONFIG = path.join(__dirname, '..', 'config.json');

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // echo nothing while the password is typed
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(question); };
    }
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

(async () => {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { /* no config yet */ }
  const auth = new RingAuth({ authFile: cfg.ring?.authFile, endpoints: cfg.ring?.endpoints });
  const email = await ask('Ring e-mail: ');
  const password = await ask('Ring password: ', { hidden: true });
  let out = await auth.login(email, password);
  while (out.needs2fa) {
    const code = await ask(`${out.prompt}: `);
    try { out = await auth.login(email, password, code); } catch (err) {
      if (!/Wrong verification code/.test(err.message)) throw err;
      console.error('That code was not accepted — try again.');
      out = { needs2fa: true, prompt: 'Verification code' };
    }
  }
  if (!cfg.ring) {
    cfg.ring = { pollInterval: 60 };
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
    console.log('Added a "ring" section to config.json.');
  }
  console.log('Signed in to Ring. Restart LSH to load the cameras.');
})().catch((err) => { console.error(`Ring sign-in failed: ${err.message}`); process.exit(1); });
