'use strict';

// License enforcement (Node side; mirrors core-go/license.go). A license key
// (config.license.key) is an Ed25519-signed token from the LSH license server,
// verified OFFLINE here with the embedded product public key. Its tier maps to
// the limits below. A free instance (no/invalid/expired key) runs fine, just
// capped.
//
//   free:    max 2 integrations, Loxone export 1 input + 1 output, no hotel
//   managed: unlimited integrations + Loxone export            (499 PLN)
//   hotel:   managed + hotel features (room service, guest portal, booking) (call)

const crypto = require('crypto');

// Matches license-server/data/keys.json (and core-go/license.go).
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAolScOPeT/BQprS+g74d9r1bjASr3xVuCBCpNAUBG4Dc=
-----END PUBLIC KEY-----`;

const TIERS = {
  free:    { maxIntegrations: 2, loxoneInputs: 1, loxoneOutputs: 1, hotel: false },
  managed: { maxIntegrations: 0, loxoneInputs: 0, loxoneOutputs: 0, hotel: false },
  hotel:   { maxIntegrations: 0, loxoneInputs: 0, loxoneOutputs: 0, hotel: true },
};

const PRICING = { managed: '499 PLN', hotel: 'call' };

function b64urlDecode(s) { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

function verifyKey(key) {
  const m = /^LSH1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(key || '').trim());
  if (!m) return null;
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from('LSH1.' + m[1]), crypto.createPublicKey(PUBLIC_KEY_PEM), b64urlDecode(m[2])); } catch { ok = false; }
  if (!ok) return null;
  try { return JSON.parse(b64urlDecode(m[1]).toString('utf8')); } catch { return null; }
}

// resolveLicense(config) → { tier, licensee, exp, limits, reason }. Never throws.
function resolveLicense(config) {
  const free = { tier: 'free', licensee: '', exp: 0, limits: TIERS.free, pricing: PRICING };
  const lc = config && config.license;
  if (!lc || !lc.key) return { ...free, reason: 'no license' };
  const p = verifyKey(lc.key);
  if (!p) return { ...free, reason: 'invalid license key' };
  const limits = TIERS[p.tier];
  if (!limits) return { ...free, reason: 'unknown tier' };
  if (p.exp && Date.now() > Number(p.exp)) return { ...free, reason: 'license expired' };
  return { tier: p.tier, licensee: p.licensee || '', exp: Number(p.exp) || 0, limits, pricing: PRICING, reason: '' };
}

module.exports = { resolveLicense, verifyKey, TIERS, PRICING, PUBLIC_KEY_PEM };
