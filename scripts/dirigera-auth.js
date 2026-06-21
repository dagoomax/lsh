#!/usr/bin/env node
/**
 * One-time Dirigera token generator.
 *
 * Usage: node scripts/dirigera-auth.js <hub-ip>
 *
 * 1. Run this script.
 * 2. Press the action button on your Dirigera hub within 30 seconds.
 * 3. Copy the printed token into config.json under dirigera.token.
 */

'use strict';

const https  = require('https');
const crypto = require('crypto');

const host = process.argv[2];
if (!host) { console.error('Usage: node scripts/dirigera-auth.js <hub-ip>'); process.exit(1); }

const AGENT = new https.Agent({ rejectUnauthorized: false });
const PORT  = 8443;

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function req(method, path, body, headers = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: host, port: PORT, path, method, agent: AGENT,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(d)); } catch { resolve(d); }
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

(async () => {
  const verifier  = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const audience  = 'homesmart.local';
  const name      = 'lsh-dashboard';

  const qs = new URLSearchParams({
    audience,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  console.log(`\nConnecting to Dirigera at ${host}:${PORT}…`);

  let authRes;
  try {
    authRes = await req('GET', `/v1/oauth/authorize?${qs}`);
  } catch (err) {
    console.error('Failed to reach hub:', err.message);
    process.exit(1);
  }

  const code = authRes.code;
  console.log('\n>>> Press the action button on your Dirigera hub now <<<\n');
  console.log('Waiting 30 seconds…');
  await new Promise(r => setTimeout(r, 30_000));

  let tokenRes;
  try {
    const body = new URLSearchParams({ code, name, grant_type: 'authorization_code', code_verifier: verifier }).toString();
    tokenRes = await req('POST', '/v1/oauth/token', body);
  } catch (err) {
    console.error('Token exchange failed:', err.message);
    process.exit(1);
  }

  const token = tokenRes.access_token;
  if (!token) { console.error('No token in response:', tokenRes); process.exit(1); }

  console.log('\n✓ Token obtained! Add to config.json:\n');
  console.log(JSON.stringify({ dirigera: { host, token } }, null, 2));
})();
