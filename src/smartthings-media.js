'use strict';

// Shared SmartThings AV Platform media fetch — used by the camera snapshot
// routes in api-routes.js and by smartthings-client.js's motion-triggered
// person detection. The media host (…ec2.st-av.net) requires a Personal
// Access Token specifically for "sensitive" attributes like camera images —
// an OAuth SmartApp access token gets rejected outright (confirmed: same
// request, same code, 500 "Error response from AV Platform" even with a
// valid OAuth token and a freshly-captured image). See api-routes.js's
// snapshot route for the full story. PATs created after Dec 2024 expire in
// 24h, so this needs a fresh one periodically from
// https://account.smartthings.com/tokens, configured as
// config.smartthings.cameraToken.

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function readSmartThingsConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).smartthings || {};
  } catch {
    return {};
  }
}

// smartThingsClient is optional — its getToken() (OAuth) is only a fallback
// for when no PAT is configured; the media host will 500 on those tokens
// regardless, but degrading to "wrong auth" is still better than none.
async function getCameraToken(smartThingsClient) {
  const cfg = readSmartThingsConfig();
  return cfg.cameraToken || cfg.token
    || (smartThingsClient ? await smartThingsClient.getToken().catch(() => null) : null);
}

async function fetchMedia(url, smartThingsClient) {
  const token = await getCameraToken(smartThingsClient);
  const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'image/jpeg',
  };
}

module.exports = { fetchMedia, getCameraToken };
