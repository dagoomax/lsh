#!/usr/bin/env node
'use strict';

// One-off OAuth2 login for Bosch/Siemens/Gaggenau Home Connect.
// Prereq: register an app at https://developer.home-connect.com, put
// clientId/clientSecret in config.json → homeConnect.
// Usage: node scripts/homeconnect-auth.js [--code]
// Production apps registered with OAuth flow "Device Flow" use the device
// flow (URL + code). The simulator host does not support device flow, so
// simulator mode — and --code, for apps registered with "Authorization Code
// Grant Flow" — uses the browser + paste-redirect-URL flow instead.
// Tokens are saved to persist/homeconnect-tokens.json; the server refreshes
// them automatically from then on.

const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

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

const ask = (q) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); resolve(a.trim()); });
});

function saveTokens(json) {
  const tokens = {
    access_token:  json.access_token,
    refresh_token: json.refresh_token,
    expires_at:    Date.now() + (json.expires_in || 86400) * 1000,
  };
  fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
  console.log(`\nSuccess — tokens saved to ${TOKENS_FILE}`);
  console.log('Restart the server (or `npm run pm2:restart`) to connect.');
}

// Authorization-code flow: browser login, then paste the redirect URL.
// Required for the simulator; also works for apps registered with
// "Authorization Code Grant Flow" (default redirect is Bosch's o2c.html).
async function codeFlow() {
  const redirectUri = cfg.redirectUri || 'https://apiclient.home-connect.com/o2c.html';
  const authUrl = `https://${host}/security/oauth/authorize`
    + `?client_id=${encodeURIComponent(cfg.clientId)}`
    + `&response_type=code`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&scope=${encodeURIComponent(SCOPE)}`;

  console.log('\nOpen this page, log in and approve access:');
  console.log(`  ${authUrl}\n`);
  console.log('You will be redirected to a page whose URL contains ?code=...');
  const pasted = await ask('Paste the redirected URL (or just the code): ');
  const code = pasted.match(/[?&]code=([^&]+)/)?.[1] || pasted;
  if (!code) throw new Error('No code found in the pasted input');

  const { status, json } = await post('/security/oauth/token', {
    grant_type: 'authorization_code',
    code: decodeURIComponent(code),
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  if (status >= 400 || !json.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(json)}`);
  saveTokens(json);
}

(async () => {
  if (cfg.simulator || process.argv.includes('--code')) {
    if (cfg.simulator) console.log('Simulator mode — the simulator does not support device flow, using browser login.');
    return codeFlow();
  }

  const { status, json: da } = await post('/security/oauth/device_authorization', {
    client_id: cfg.clientId, scope: SCOPE,
  });
  if (status >= 400) {
    if (da?.error === 'unauthorized_client') {
      throw new Error('The developer portal rejected this client for device flow.\n'
        + 'Either set your app\'s OAuth Flow to "Device Flow" at developer.home-connect.com\n'
        + '(changes take ~15 min to apply), or rerun with --code for the browser flow.');
    }
    throw new Error(`device_authorization failed: ${JSON.stringify(da)}`);
  }

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
      saveTokens(json);
      return;
    }
    if (json.error === 'authorization_pending') { process.stdout.write('.'); continue; }
    if (json.error === 'slow_down') { await new Promise((r) => setTimeout(r, interval)); continue; }
    throw new Error(`Token poll failed: ${JSON.stringify(json)}`);
  }
  throw new Error('Timed out waiting for authorization');
})().catch((err) => { console.error(`\n${err.message}`); process.exit(1); });
