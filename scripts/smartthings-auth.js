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
 *     → redirect URI: https://lsh-callback.invalid/callback
 *       (SmartThings 403s localhost redirects — any dead HTTPS URL works)
 *     → scopes: r:devices:* x:devices:* r:locations:*
 *
 *   Note the client id + secret it prints, put them in config.json:
 *     "smartthings": { "clientId": "…", "clientSecret": "…" }
 *
 * Then run:  node scripts/smartthings-auth.js
 *
 * The script prints the authorization URL to visit; after authorizing, the
 * browser lands on a DNS-error page for the dead redirect host — copy its
 * full URL (which carries ?code=…) and paste it at the prompt.
 */

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const OAUTH_AUTHORIZE = 'https://api.smartthings.com/oauth/authorize';
const OAUTH_TOKEN     = 'https://api.smartthings.com/oauth/token';
const OAUTH_FILE      = path.join(__dirname, '..', 'persist', 'smartthings-oauth.json');
// SmartThings rejects localhost redirect URIs with 403 Forbidden, so the app
// registers a deliberately dead HTTPS address: after authorizing, the browser
// lands on a DNS-error page whose address bar still carries ?code=… — paste
// that URL (or just the code) into this script's prompt.
const REDIRECT_URI    = 'https://lsh-callback.invalid/callback';
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

function askForCode() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('Paste the full redirect URL (or just the code) here: ', (answer) => {
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
  console.log('After authorizing, the browser lands on a "site can\'t be reached" page — that is expected.');

  const code = await askForCode();
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
