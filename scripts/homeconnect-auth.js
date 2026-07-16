#!/usr/bin/env node
'use strict';

// One-off OAuth2 device-flow login for Bosch/Siemens Home Connect.
// Prereq: register an app at https://developer.home-connect.com (OAuth flow:
// "Device Flow"), put clientId/clientSecret in config.json → homeConnect.
// Usage: node scripts/homeconnect-auth.js
// Tokens are saved to persist/homeconnect-tokens.json; the server refreshes
// them automatically from then on.

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const TOKENS_FILE = path.join(__dirname, '..', 'persist', 'homeconnect-tokens.json');
const SCOPE = 'IdentifyAppliance Monitor Settings Control';

const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).homeConnect || {};
const host = cfg.simulator ? 'simulator.home-connect.com' : (cfg.host || 'api.home-connect.com');
if (!cfg.clientId) {
  console.error('config.json → homeConnect.clientId is required (register at developer.home-connect.com)');
  process.exit(1);
}

function post(reqPath, form) {
  const body = Object.entries(form)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host, path: reqPath, method: 'POST', timeout: 15000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
        catch { reject(new Error(`Non-JSON response (HTTP ${res.statusCode}): ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

(async () => {
  const { status, json: da } = await post('/security/oauth/device_authorization', {
    client_id: cfg.clientId, scope: SCOPE,
  });
  if (status >= 400) throw new Error(`device_authorization failed: ${JSON.stringify(da)}`);

  console.log('\nOpen this page and enter the code to authorize LSH:');
  console.log(`  ${da.verification_uri_complete || da.verification_uri}`);
  console.log(`  Code: ${da.user_code}\n`);

  const interval = (da.interval || 5) * 1000;
  const deadline = Date.now() + (da.expires_in || 600) * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const { status, json } = await post('/security/oauth/token', {
      grant_type: 'device_code',
      device_code: da.device_code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });
    if (status < 400 && json.access_token) {
      const tokens = {
        access_token:  json.access_token,
        refresh_token: json.refresh_token,
        expires_at:    Date.now() + (json.expires_in || 86400) * 1000,
      };
      fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
      fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
      console.log(`Success — tokens saved to ${TOKENS_FILE}`);
      console.log('Restart the server (or `npm run pm2:restart`) to connect.');
      return;
    }
    if (json.error === 'authorization_pending') { process.stdout.write('.'); continue; }
    if (json.error === 'slow_down') { await new Promise((r) => setTimeout(r, interval)); continue; }
    throw new Error(`Token poll failed: ${JSON.stringify(json)}`);
  }
  throw new Error('Timed out waiting for authorization');
})().catch((err) => { console.error(`\n${err.message}`); process.exit(1); });
