#!/usr/bin/env node
'use strict';

/*
 * Xiaomi (Mi Home) cloud token extractor for the LSH roborock module.
 *
 * Logs into the Xiaomi cloud with YOUR Mi Home account, lists every device on
 * the account, and (optionally) writes each Roborock/vacuum device's local IP +
 * 32-hex miio token into config.json under `roborock.devices`.
 *
 * The token this returns is identical to the one the Mi Home app stores locally.
 *
 * Usage:
 *   node scripts/xiaomi-token-extract.js            # prompts for email + password
 *   XIAOMI_EMAIL=you@example.com node scripts/xiaomi-token-extract.js
 *
 * Your password is read from the terminal with hidden input and is used only to
 * sign in to account.xiaomi.com. It is never stored, logged, or transmitted
 * anywhere except Xiaomi's own login endpoint.
 */

const https   = require('https');
const crypto  = require('crypto');
const readline = require('readline');
const fs      = require('fs');
const path    = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const UA = 'Android-7.1.1-1.0.0-ONEPLUS A3010-136-CID-CUS APP/xiaomi.smarthome APPV/62830';
const DEVICE_ID = crypto.randomBytes(8).toString('hex').toUpperCase().slice(0, 16);
// Regional servers to scan. Europe accounts are usually on "de".
const REGIONS = ['de', 'sg', 'i2', 'us', 'ru', 'cn', 'tw'];

// ── tiny prom-based https helper (no redirect following; we read Set-Cookie) ──
function req(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { method, hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': UA, ...headers } };
    const r = https.request(opts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

const stripPrefix = s => s.replace(/^&&&START&&&/, '');
const md5Upper = s => crypto.createHash('md5').update(s).digest('hex').toUpperCase();

// ── miio-cloud request signing (non-encrypted variant) ───────────────────────
function generateNonce() {
  const buf = Buffer.allocUnsafe(12);
  crypto.randomBytes(8).copy(buf);
  buf.writeInt32BE(Math.floor(Date.now() / 60000), 8);
  return buf.toString('base64');
}
function signedNonce(ssecurity, nonce) {
  return crypto.createHash('sha256')
    .update(Buffer.from(ssecurity, 'base64'))
    .update(Buffer.from(nonce, 'base64'))
    .digest('base64');
}
function signature(pathPart, snonce, nonce, params) {
  const parts = [pathPart, snonce, nonce];
  for (const k of Object.keys(params)) parts.push(`${k}=${params[k]}`);
  return crypto.createHmac('sha256', Buffer.from(snonce, 'base64'))
    .update(parts.join('&')).digest('base64');
}

// ── login (account.xiaomi.com serviceLogin → serviceLoginAuth2 → sts) ─────────
async function login(email, password) {
  const cookie1 = `sdkVersion=accountsdk-18.8.15; deviceId=${DEVICE_ID};`;
  const s1 = await req('GET', 'https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true',
    { headers: { Cookie: cookie1, 'Content-Type': 'application/x-www-form-urlencoded' } });
  const j1 = JSON.parse(stripPrefix(s1.body));
  const sign = j1._sign;

  const form = new URLSearchParams({
    sid: 'xiaomiio', hash: md5Upper(password), callback: j1.callback || 'https://sts.api.io.mi.com/sts',
    qs: j1.qs || '%3Fsid%3Dxiaomiio%26_json%3Dtrue', user: email, _sign: sign, _json: 'true',
  }).toString();
  const s2 = await req('POST', 'https://account.xiaomi.com/pass/serviceLoginAuth2',
    { headers: { Cookie: cookie1, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) }, body: form });
  const j2 = JSON.parse(stripPrefix(s2.body));

  if (!j2.ssecurity || !j2.location) {
    if (j2.notificationUrl) {
      throw new Error(`Two-factor / device verification required. Open this URL in a browser, approve, then re-run:\n  ${j2.notificationUrl}`);
    }
    throw new Error(`Login failed (code ${j2.code}: ${j2.desc || 'check email/password'})`);
  }

  const s3 = await req('GET', j2.location, { headers: { Cookie: cookie1 } });
  const setCookie = s3.headers['set-cookie'] || [];
  const svc = setCookie.map(c => /(?:^|;)\s*serviceToken=([^;]+)/.exec(c)).find(Boolean);
  if (!svc) throw new Error('No serviceToken returned from sts step');
  return { ssecurity: j2.ssecurity, userId: String(j2.userId), serviceToken: svc[1] };
}

// ── device_list on a given region server ─────────────────────────────────────
async function deviceList({ ssecurity, userId, serviceToken }, region) {
  const base = `https://${region === 'cn' ? '' : region + '.'}api.io.mi.com/app`;
  const data = JSON.stringify({ getVirtualModel: false, getHuamiDevices: 0 });
  const nonce = generateNonce();
  const snonce = signedNonce(ssecurity, nonce);
  const sig = signature('/home/device_list', snonce, nonce, { data });
  const body = new URLSearchParams({ _nonce: nonce, data, signature: sig }).toString();
  const cookie = `userId=${userId}; serviceToken=${serviceToken}; yetAnotherServiceToken=${serviceToken}; locale=en_US`;
  const res = await req('POST', `${base}/home/device_list`, {
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'x-xiaomi-protocal-flag-cli': 'PROTOCAL-HTTP2',
      'Accept-Encoding': 'identity',
    }, body,
  });
  try {
    const j = JSON.parse(res.body);
    return j.result?.list || [];
  } catch { return []; }
}

// ── hidden password prompt ────────────────────────────────────────────────────
function ask(question, hidden = false) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      const onData = () => { readline.moveCursor(process.stdout, -100, 0); readline.clearLine(process.stdout, 1); process.stdout.write(question); };
      process.stdin.on('data', onData);
      rl.question(question, ans => { process.stdin.removeListener('data', onData); rl.close(); process.stdout.write('\n'); resolve(ans); });
    } else {
      rl.question(question, ans => { rl.close(); resolve(ans); });
    }
  });
}

(async () => {
  const email = process.env.XIAOMI_EMAIL || await ask('Xiaomi (Mi Home) email/account: ');
  const password = process.env.XIAOMI_PASSWORD || await ask('Xiaomi password (hidden): ', true);
  process.stdout.write('\nLogging in…\n');

  let session;
  try {
    session = await login(email.trim(), password);
  } catch (e) {
    console.error(`\n✗ ${e.message}`);
    process.exit(1);
  }

  const seen = new Map();
  for (const region of REGIONS) {
    let list = [];
    try { list = await deviceList(session, region); } catch { /* ignore region errors */ }
    for (const d of list) {
      if (!seen.has(d.did)) seen.set(d.did, { ...d, region });
    }
  }

  const devices = [...seen.values()];
  if (!devices.length) { console.error('\n✗ No devices found on the account.'); process.exit(1); }

  const vacuums = devices.filter(d => /roborock|vacuum|robot|dreame|viomi|rockrobo/i.test(d.model || ''));
  const show = vacuums.length ? vacuums : devices;

  console.log(`\nFound ${devices.length} device(s)${vacuums.length ? ` (${vacuums.length} vacuum-like)` : ''}:\n`);
  for (const d of show) {
    const mask = d.token ? d.token.slice(0, 4) + '…' + d.token.slice(-4) : '(no token)';
    console.log(`  • ${d.name}`);
    console.log(`      model: ${d.model}`);
    console.log(`      ip:    ${d.localip || '(cloud only — device offline / not on LAN)'}`);
    console.log(`      token: ${mask}   [region ${d.region}]`);
    console.log('');
  }

  // Write vacuum devices into config.json roborock.devices
  const writable = show.filter(d => d.localip && d.token && d.token.length === 32);
  if (!writable.length) {
    console.log('No device had both a LAN IP and a 32-hex token — nothing written to config.json.');
    console.log('(A device must be online and on the same network to expose its local IP.)');
    process.exit(0);
  }

  const answer = (await ask(`\nWrite ${writable.length} device(s) into config.json roborock.devices? [y/N] `)).trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') { console.log('Skipped writing config.'); process.exit(0); }

  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
  const existing = cfg.roborock?.devices || [];
  const byHost = new Map(existing.map(d => [d.host, d]));
  for (const d of writable) {
    byHost.set(d.localip, { name: d.name, host: d.localip, token: d.token });
  }
  cfg.roborock = { devices: [...byHost.values()] };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  console.log(`\n✓ Wrote ${writable.length} device(s) to config.json (backup: config.json.bak).`);
  console.log('  Now tell Claude "done" so it restarts the roborock module.');
})();
