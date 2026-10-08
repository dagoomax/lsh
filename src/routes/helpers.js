'use strict';

// Shared by createApiRoutes() (src/api-routes.js) and its src/routes/*.js
// route files.
const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

function readConfigFile() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
  return {};
}

// atomic + keeps config.json.bak — see config-file-cache.js
const { writeConfigFile } = require('../config-file-cache');

const VIRTUAL_TYPES = new Set(['switch', 'dimmer', 'sensor', 'text', 'button']);

// Ids are the store key (virtual/<id>/value) — two devices sharing one
// silently collide onto the same value, and one device's type could then
// look like a stale mismatch under the other's id. The stock UI never sends
// a duplicate, but the route accepts a raw id from any caller, so re-roll a
// fresh one rather than let a collision through. Pure (no I/O) so it's
// testable without mocking Express or the filesystem.
function dedupeVirtualDevices(devices) {
  const crypto = require('crypto');
  const seenIds = new Set();
  return devices.map((d) => {
    let id = String(d.id || '').trim() || crypto.randomUUID().slice(0, 8);
    if (seenIds.has(id)) id = crypto.randomUUID().slice(0, 8);
    seenIds.add(id);
    const type = VIRTUAL_TYPES.has(d.type) ? d.type : 'switch';
    const out = {
      id,
      name: String(d.name || '').trim(),
      type,
      unit: String(d.unit || '').trim(),
    };
    // min/max only mean anything for 'sensor' — default range (-1000/1000)
    // is fine for most values, so only persist an override when the caller
    // actually supplied one (keeps existing configs' JSON unchanged).
    if (type === 'sensor') {
      if (d.min !== undefined && d.min !== '' && Number.isFinite(Number(d.min))) out.min = Number(d.min);
      if (d.max !== undefined && d.max !== '' && Number.isFinite(Number(d.max))) out.max = Number(d.max);
    }
    return out;
  }).filter((d) => d.name);
}

// Device customization is optionally locked with a PIN (config.editPin, set in
// Settings → Security).
function editPinOk(req) {
  const pin = String(readConfigFile().editPin || '');
  return !pin || String(req.body?.pin || '') === pin;
}

// Manual `cameras` entries with an `onvif` section — shared by the preset
// and IR routes below.
function onvifCfgFor(idx) {
  const cam = (readConfigFile().cameras || [])[Number(idx)];
  if (!cam?.onvif?.host) throw new Error('Camera has no ONVIF config');
  return cam.onvif;
}

// ── VRM helpers ──

/** Extract a readable string from VRM API error responses */
function vrmError(data, fallback = 'Authentication failed') {
  const e = data?.errors ?? data?.error ?? data?.error_description;
  if (!e) return fallback;
  if (typeof e === 'string') return e;
  if (Array.isArray(e)) return e.join(', ');
  if (typeof e === 'object') {
    return Object.entries(e)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join(' | ');
  }
  return String(e);
}

/**
 * Resolve VRM credentials → { authHeader }
 * Supports two modes:
 *   - API token:       x-authorization: Token {apiToken}   (no login needed)
 *   - Email/password:  x-authorization: Bearer {loginToken} (login required)
 */
async function vrmResolveAuth({ apiToken, email, password }) {
  if (apiToken && apiToken.trim()) {
    // API token — use directly, no login step
    return { authHeader: `Token ${apiToken.trim()}` };
  }
  if (!email || !password) {
    throw new Error('Provide either an API token or email + password');
  }
  const r = await fetch('https://vrmapi.victronenergy.com/v2/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: email, password }),
  });
  const raw = await r.text();
  let data;
  try { data = JSON.parse(raw); } catch {
    throw new Error(`VRM returned non-JSON (HTTP ${r.status}): ${raw.slice(0, 120)}`);
  }
  if (!r.ok || !data.token) throw new Error(vrmError(data));
  return { authHeader: `Bearer ${data.token}` };
}

/** Fetch installation name via auth header */
async function vrmGetInstallation(installationId, authHeader) {
  const r = await fetch(
    `https://vrmapi.victronenergy.com/v2/installations/${installationId}/overview`,
    { headers: { 'x-authorization': authHeader } }
  );
  if (!r.ok) throw new Error(`Installation "${installationId}" not found (HTTP ${r.status})`);
  const data = await r.json();
  return data?.records?.name || String(installationId);
}

module.exports = {
  CONFIG_PATH, readConfigFile, writeConfigFile, VIRTUAL_TYPES, dedupeVirtualDevices,
  editPinOk, onvifCfgFor, vrmError, vrmResolveAuth, vrmGetInstallation,
};
