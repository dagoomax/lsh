#!/usr/bin/env node
/**
 * One-time Viessmann (ViCare / Vitodens) OAuth bootstrap.
 *
 * The Viessmann IoT API uses OAuth2 Authorization Code + PKCE, a public
 * (no-client-secret) client — same shape verified against the actual
 * PyViCare reference implementation's OAuth manager, not guessed:
 *   authorize: https://iam.viessmann-climatesolutions.com/idp/v3/authorize
 *   token:     https://iam.viessmann-climatesolutions.com/idp/v3/token
 *
 * Prerequisite — register a client (one-time, free) at the Viessmann
 * Developer Portal (login with your ViCare app account):
 *
 *   https://app.developer.viessmann.com/  (or the newer
 *   https://developer.viessmann-climatesolutions.com/ — Viessmann has been
 *   migrating domains; try whichever loads)
 *     → My Dashboard → "Your clients" → + Add
 *     → redirect URI: https://lsh-callback.invalid/callback
 *       (same dead-HTTPS-domain trick LSH already uses for SmartThings —
 *       any registered HTTPS redirect works, it doesn't need to resolve;
 *       the authorization code lands in the browser's address bar on the
 *       resulting DNS-error page)
 *
 *   Note the Client ID it gives you, put it in config.json:
 *     "vitodens": { "clientId": "…" }
 *
 * Then run:  node scripts/vitodens-auth.js
 *
 * Saves the token pair to persist/vitodens-tokens.json. From then on
 * vitodens-client.js refreshes the access token automatically (Viessmann
 * access tokens are short-lived, ~1h) using the refresh token (requested via
 * the offline_access scope below), and persists the rotated refresh token.
 */

const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const readline = require('readline');

const AUTHORIZE_URL = 'https://iam.viessmann-climatesolutions.com/idp/v3/authorize';
const TOKEN_URL      = 'https://iam.viessmann-climatesolutions.com/idp/v3/token';
const TOKEN_FILE     = path.join(__dirname, '..', 'persist', 'vitodens-tokens.json');
// Any HTTPS redirect URI works as long as it's the exact one registered for
// the client in the dev portal — see the header comment for why this
// deliberately-dead domain is the simplest choice (same trick as
// smartthings-auth.js).
const REDIRECT_URI = 'https://lsh-callback.invalid/callback';
const SCOPE         = 'IoT offline_access';

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')); }
  catch { return {}; }
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function exchangeCode(clientId, code, codeVerifier) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     clientId,
      redirect_uri:  REDIRECT_URI,
      code_verifier: codeVerifier,
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
  const cfg = loadConfig();
  const clientId = cfg.vitodens?.clientId;
  if (!clientId) {
    console.error('Missing "vitodens": { "clientId": "…" } in config.json — see this script\'s header comment.');
    process.exit(1);
  }

  const codeVerifier = base64url(crypto.randomBytes(48));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  console.log('\nOpen this URL, log in with your ViCare app account, and authorize:\n');
  console.log(authUrl.toString());
  console.log('\nThe browser will land on a DNS-error page for lsh-callback.invalid — that\'s expected.\n');

  const code = await askForCode();
  if (!code) { console.error('No code provided.'); process.exit(1); }

  const t = await exchangeCode(clientId, code, codeVerifier);
  if (!t.refresh_token) {
    console.error(`No refresh_token in response — did the authorize URL include "offline_access" in scope? Response: ${JSON.stringify(t)}`);
    process.exit(1);
  }

  const tokens = {
    access_token:  t.access_token,
    refresh_token: t.refresh_token,
    expires_at:    Date.now() + (t.expires_in || 3600) * 1000,
  };
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  console.log(`\nSaved ${TOKEN_FILE} — vitodens-client.js will refresh it automatically from here on.`);
})().catch((err) => { console.error(err.message); process.exit(1); });
