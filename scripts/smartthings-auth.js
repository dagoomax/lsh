#!/usr/bin/env node
/**
 * One-time SmartThings OAuth bootstrap.
 *
 * SmartThings Personal Access Tokens created after Dec 2024 expire every
 * 24 hours, so LSH uses OAuth instead: this script performs the one-time
 * authorization-code flow and saves the token pair to
 * persist/smartthings-oauth.json. From then on smartthings-client.js
 * refreshes the access token automatically (and persists the rotated
 * refresh token), so no more manual token renewals.
 *
 * Prerequisite — an OAuth-integrated SmartThings app (one-time, needs the
 * SmartThings CLI and any valid PAT, even a 24 h one):
 *
 *   smartthings apps:create
 *     → OAuth-In App
 *     → redirect URI: http://localhost:8123/callback
 *     → scopes: r:devices:* x:devices:* r:locations:*
 *
 *   Note the client id + secret it prints, put them in config.json:
 *     "smartthings": { "clientId": "…", "clientSecret": "…" }
 *
 * Then run:  node scripts/smartthings-auth.js
 *
 * The script opens a local callback server on port 8123, prints the
 * authorization URL to visit, and exchanges the returned code. If the
 * redirect can't reach this machine, paste the full redirect URL (or just
 * the code) at the prompt instead.
 */

const fs       = require('fs');
const http     = require('http');
const path     = require('path');
const readline = require('readline');

const OAUTH_AUTHORIZE = 'https://api.smartthings.com/oauth/authorize';
const OAUTH_TOKEN     = 'https://api.smartthings.com/oauth/token';
const OAUTH_FILE      = path.join(__dirname, '..', 'persist', 'smartthings-oauth.json');
const CALLBACK_PORT   = 8123;
const REDIRECT_URI    = `http://localhost:${CALLBACK_PORT}/callback`;
const SCOPES          = 'r:devices:* x:devices:* r:locations:*';

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')); }
  catch { return {}; }
}

async function exchangeCode(clientId, clientSecret, code) {
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      client_id:    clientId,
      redirect_uri: REDIRECT_URI,
      code,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

function waitForCallback() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const code = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(code
        ? '<h2>LSH: SmartThings authorized — you can close this tab.</h2>'
        : `<h2>LSH: authorization failed: ${url.searchParams.get('error') || 'no code'}</h2>`);
      server.close();
      code ? resolve(code) : reject(new Error(url.searchParams.get('error') || 'No code in callback'));
    });
    server.on('error', reject);
    server.listen(CALLBACK_PORT);
  });
}

function askForCode() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('…or paste the redirect URL / code here: ', (answer) => {
      rl.close();
      answer = answer.trim();
      try { resolve(new URL(answer).searchParams.get('code') || answer); }
      catch { resolve(answer); }
    });
  });
}

(async () => {
  const cfg = loadConfig().smartthings || {};
  const clientId     = process.env.SMARTTHINGS_CLIENT_ID     || cfg.clientId;
  const clientSecret = process.env.SMARTTHINGS_CLIENT_SECRET || cfg.clientSecret;
  if (!clientId || !clientSecret) {
    console.error('Missing clientId/clientSecret — add them to config.json under "smartthings" (see header of this script).');
    process.exit(1);
  }

  const authUrl = `${OAUTH_AUTHORIZE}?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}`;

  console.log('\nOpen this URL in a browser and authorize your location:\n');
  console.log('  ' + authUrl + '\n');
  console.log(`Waiting for the redirect on ${REDIRECT_URI} …`);

  const code = await Promise.race([waitForCallback(), askForCode()]);
  const t = await exchangeCode(clientId, clientSecret, code);

  fs.mkdirSync(path.dirname(OAUTH_FILE), { recursive: true });
  fs.writeFileSync(OAUTH_FILE, JSON.stringify({
    access_token:  t.access_token,
    refresh_token: t.refresh_token,
    expires_at:    Date.now() + (t.expires_in || 86400) * 1000,
  }, null, 2));

  console.log(`\nSaved ${OAUTH_FILE}`);
  console.log('Restart LSH — the SmartThings client will now refresh tokens automatically.');
  process.exit(0);
})().catch((err) => { console.error('\n' + err.message); process.exit(1); });
