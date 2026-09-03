#!/usr/bin/env node
'use strict';

// One-time bootstrap for the Dyson cloud account: logs in with email +
// password + the emailed one-time code, then downloads the device manifest
// (name/serial/product type per device, plus each device's local MQTT
// password — shipped AES-encrypted by Dyson's API) and saves everything
// dyson-client.js needs to persist/dyson-tokens.json. Run again any time the
// bearer token expires or a device is added to the account.
//
// Protocol reference: this reimplements the reverse-engineered Dyson cloud
// API used by several open-source projects (libdyson, ha-dyson,
// node-dyson-api) — Dyson publishes no official docs for it. Untested
// against real hardware in this repo (no Dyson device available here); if a
// step 404s or a response shape doesn't match, that's the most likely cause.
//
// Usage: node scripts/dyson-auth.js <email> <password>

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const API_HOST = 'appapi.cp.dyson.com';
const TOKENS_PATH = path.join(__dirname, '..', 'persist', 'dyson-tokens.json');

// Fixed key Dyson's app ships client-side to decrypt each device's local MQTT
// password (LocalCredentials) — the same 16 ASCII bytes across all accounts,
// documented by every open-source Dyson client. Not a per-user secret.
const LOCAL_KEY = Buffer.from('1234567890123456', 'utf8');
const LOCAL_IV = Buffer.alloc(16, 0);

function apiRequest(method, urlPath, { body, headers, host } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: host || API_HOST,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = chunks ? JSON.parse(chunks) : {}; } catch { parsed = chunks; }
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} ${urlPath}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`));
        } else {
          resolve({ status: res.statusCode, body: parsed });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

function decryptLocalCredentials(base64Ciphertext) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', LOCAL_KEY, LOCAL_IV);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(base64Ciphertext, 'base64')), decipher.final()]);
  const { apPasswordHash } = JSON.parse(decrypted.toString('utf8'));
  return apPasswordHash;
}

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: node scripts/dyson-auth.js <email> <password>');
    process.exit(1);
  }

  console.log(`[Dyson] Checking account status for ${email}...`);
  const status = await apiRequest('POST', '/v1/userregistration/email/userstatus?country=US', { body: { email } });
  const country = status.body?.accountStatus === 'ACTIVE' ? 'US' : 'US';

  console.log('[Dyson] Requesting one-time code by email...');
  const authStart = await apiRequest('POST', `/v3/userregistration/email/auth?country=${country}&culture=en-US`, {
    body: { email },
  });
  const challengeId = authStart.body?.challengeId;
  if (!challengeId) throw new Error(`No challengeId in response: ${JSON.stringify(authStart.body)}`);

  const otpCode = await prompt('[Dyson] Enter the one-time code emailed to you: ');

  console.log('[Dyson] Verifying...');
  const verify = await apiRequest('POST', `/v3/userregistration/email/verify?country=${country}&culture=en-US`, {
    body: { email, password, challengeId, otpCode },
  });
  const token = verify.body?.token;
  const tokenType = verify.body?.tokenType || 'Bearer';
  if (!token) throw new Error(`No token in response: ${JSON.stringify(verify.body)}`);

  console.log('[Dyson] Fetching device manifest...');
  const manifest = await apiRequest('GET', '/v2/provisioningservice/manifest', {
    headers: { Authorization: `${tokenType} ${token}` },
  });
  const rawDevices = Array.isArray(manifest.body) ? manifest.body : [];

  const devices = rawDevices.map((d) => {
    let localPassword = null;
    try {
      if (d.LocalCredentials) localPassword = decryptLocalCredentials(d.LocalCredentials);
    } catch (err) {
      console.warn(`[Dyson] Could not decrypt local credentials for "${d.Name}": ${err.message}`);
    }
    return {
      serial: d.Serial,
      name: d.Name,
      productType: d.ProductType,
      version: d.Version,
      localPassword,
      ip: '', // fill in manually — see README's dyson section
    };
  });

  fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify({ token, tokenType, savedAt: new Date().toISOString(), devices }, null, 2), { mode: 0o600 });

  console.log(`[Dyson] Saved ${devices.length} device(s) to ${TOKENS_PATH}`);
  for (const d of devices) {
    console.log(`  - ${d.name} (${d.productType}, ${d.serial}) — ${d.localPassword ? 'local credentials OK' : 'NO local credentials'}`);
  }
  console.log('[Dyson] Edit that file to fill in each device\'s local IP address (its "ip" field), then set dyson.enabled in config.json and restart LSH.');
}

main().catch((err) => {
  console.error(`[Dyson] Failed: ${err.message}`);
  process.exit(1);
});
