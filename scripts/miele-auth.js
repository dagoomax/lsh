#!/usr/bin/env node
'use strict';

// One-off OAuth2 authorization-code login for the Miele 3rd Party API —
// only needed if the simpler password grant (miele.username/password in
// config.json) does not work for your account.
// Prereq: register an app at https://developer.miele.com and put
// clientId/clientSecret in config.json → miele. Register a redirect URI
// (any localhost URL is fine, e.g. http://localhost:3001/miele).
// Usage: node scripts/miele-auth.js
//   1. open the printed URL in a browser and log in
//   2. paste the URL you were redirected to (contains ?code=...)
// Tokens are saved to persist/miele-tokens.json; the server refreshes them
// automatically from then on.

const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const TOKENS_FILE = path.join(__dirname, '..', 'persist', 'miele-tokens.json');
const HOST = 'api.mcs3.miele.com';

const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).miele || {};
if (!cfg.clientId || !cfg.clientSecret) {
  console.error('config.json → miele.clientId/clientSecret are required (register at developer.miele.com)');
  process.exit(1);
}
const redirectUri = cfg.redirectUri || 'http://localhost:3001/miele';
const country     = cfg.country || 'en-GB';

function post(reqPath, form) {
  const body = Object.entries(form)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: HOST, path: reqPath, method: 'POST', timeout: 15000,
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

(async () => {
  const authUrl = `https://${HOST}/thirdparty/login`
    + `?client_id=${encodeURIComponent(cfg.clientId)}`
    + `&response_type=code`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&state=lsh`
    + `&vg=${encodeURIComponent(country)}`;

  console.log('\nOpen this page, log in with your Miele account, and approve access:');
  console.log(`  ${authUrl}\n`);
  console.log('Your browser will be redirected to a (probably non-loading) URL that');
  console.log('contains ?code=... — copy the full address from the address bar.\n');

  const pasted = await ask('Paste the redirected URL (or just the code): ');
  const code = pasted.match(/[?&]code=([^&]+)/)?.[1] || pasted;
  if (!code) throw new Error('No code found in the pasted input');

  const { status, json } = await post('/thirdparty/token', {
    grant_type: 'authorization_code',
    code: decodeURIComponent(code),
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    vg: country,
  });
  if (status >= 400 || !json.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(json)}`);

  const tokens = {
    access_token:  json.access_token,
    refresh_token: json.refresh_token,
    expires_at:    Date.now() + (json.expires_in || 3600) * 1000,
  };
  fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
  console.log(`\nSuccess — tokens saved to ${TOKENS_FILE}`);
  console.log('Restart the server (or `npm run pm2:restart`) to connect.');
})().catch((err) => { console.error(`\n${err.message}`); process.exit(1); });
