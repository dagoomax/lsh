'use strict';

/**
 * Yale doorbell cameras (Yale Access / "Yale Connect" hardware — the
 * August-made line). Yale actually spans three unrelated backends and this
 * targets only one of them on purpose:
 *   - Yale Sync / "Yale Smart Living" alarm hub — a different cloud
 *     (mob.yalehomesystem.co.uk) that exposes locks/contacts/alarm state
 *     but, per Home Assistant's current `yale_smart_alarm` integration, no
 *     camera entity.
 *   - "Yale View" — a generic white-label NVR/DVR app (package prefix
 *     `com.mm.android.*`, shared by many unrelated camera brands), with no
 *     known public API.
 *   - Yale Access / Yale Connect (this one) — doorbell cameras on the same
 *     infrastructure as classic August, reachable without OAuth.
 *
 * This talks directly to the same cloud API the `yalexs` Python library
 * (bundled with Home Assistant's official "Yale Home" integration) uses for
 * the `yale_access` brand, which — unlike the newer `yale_global` brand —
 * does NOT require OAuth: a plain email/phone + password login against
 * https://api-production.august.com is enough. Endpoint shapes, header
 * names and the fixed `x-august-api-key` below are taken from that library's
 * source (github.com/Yale-Libs/yalexs, api_common.py / const.py), not
 * guessed.
 *
 *   POST /session                      { installId, identifier, password }
 *     -> access token comes back in the `x-august-access-token` response
 *        header, not the body. First login on a new installId responds
 *        with vInstallId empty ("requires validation") — Yale/August emails
 *        or texts a one-time code that must be confirmed via
 *        POST /validation/email (or /phone) then POST /validate/email
 *        before the installId is trusted. That's a one-time, human-in-the-
 *        loop step this background poller can't do by itself — run
 *        `node scripts/yale-verify.js` when start() logs that it's needed.
 *   GET  /users/doorbells/mine          -> { <id>: { name, status,
 *        recentImage: { secure_url, created_at }, contentToken,
 *        dvrSubscriptionSetupDone, serialNumber, ... }, ... }
 *   GET  /users/houses/mine             (also (ab)used to mint a refreshed
 *        access token off its response header, same trick yalexs uses)
 *
 * The doorbell's actual JPEG lives at `recentImage.secure_url` and needs an
 * `Authorization: <contentToken>` header (the raw token, no "Bearer"
 * prefix) — api-routes.js's /yale-camera/:id/snapshot proxies that so the
 * browser/dashboard never sees the content token.
 *
 * Locks are NOT handled here — this module is cameras-only by design, even
 * though the same account/API also exposes `/users/locks/mine` etc.
 *
 * Untested against a real Yale account from this codebase — ported
 * faithfully from yalexs's documented wire protocol, but nobody has run
 * this specific file against live hardware yet. Say so plainly if asked
 * whether it's verified.
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const platformStatus = require('./platform-status');

// Three brands, two auth models, served from two hosts.
//
// PASSWORD model (august, yale_home) — the classic August protocol: email +
// password + one-time email/SMS code. The public app key must be sent under
// BOTH x-kease-api-key and x-august-api-key, with the iOS User-Agent below, or
// the gateway 403s "API key is not valid" before looking at credentials
// (recipe mirrors openHAB's seime/openhab-august RestApiClient verbatim).
//   - august     — legacy accounts + Yale accounts not yet migrated.
//   - yale_home  — accounts migrated to the "Yale Home" app, same protocol
//                  against api.aaecosystem.com. NOTE: as of 2026-09 this host's
//                  password surface WAF-throttles by IP aggressively; if it
//                  serves an HTML 403 block page, use yale_global instead.
//
// TOKEN model (yale_global) — the OAuth surface of the SAME aaecosystem host
// (yalexs's Brand.YALE_GLOBAL). Different key (d16a1029) under x-api-key, token
// under x-access-token, x-branding: yale. No password login here: it consumes
// an access/refresh token obtained out-of-band (e.g. captured from the Yale
// Home app, or via the oauth.aaecosystem.com authorization-code flow) and
// refreshes it against oauth.aaecosystem.com/access_token. Header/key shapes
// per yalexs const.py; the exact token header + refresh body should be
// confirmed against a real capture (see docs/comments where flagged UNVERIFIED).
const USER_AGENT = 'August/2019.12.16.4708 CFNetwork/1121.2.2 Darwin/19.3.0';
// The two password backends accept DIFFERENT app keys, verified against the
// live gateways (no-credential probe): api-production.august.com accepts only
// 7cab4bbd (d9984f29 -> 403 "API key is not valid" there), while
// api.aaecosystem.com accepts d9984f29 under the x-kease-api-key header. Using
// one key for both regresses the august brand — keep them separate.
const AUGUST_APP_KEY = '7cab4bbd-2693-4fc1-b99b-dec0fb20f9d4'; // august.com password-model key
const KEASE_APP_KEY  = 'd9984f29-07a6-816e-e1c9-44ec9d1be431'; // aaecosystem password-model key
const GLOBAL_APP_KEY = 'd16a1029-d823-4b55-a4ce-a769a9b56f0e'; // token-model (yale_global) app key

const BRANDS = {
  august: {
    url: 'https://api-production.august.com',
    apiKey: AUGUST_APP_KEY,
    keyHeaders: ['x-kease-api-key', 'x-august-api-key'],
    tokenHeader: 'x-august-access-token',
    mode: 'password',
  },
  yale_home: {
    url: 'https://api.aaecosystem.com',
    apiKey: KEASE_APP_KEY,
    keyHeaders: ['x-kease-api-key', 'x-august-api-key'],
    tokenHeader: 'x-august-access-token',
    mode: 'password',
  },
  yale_global: {
    url: 'https://api.aaecosystem.com',
    apiKey: GLOBAL_APP_KEY,
    keyHeaders: ['x-api-key'],
    brandingHeader: 'x-branding',
    branding: 'yale',
    tokenHeader: 'x-access-token',
    mode: 'token',
    oauthTokenUrl: 'https://oauth.aaecosystem.com/access_token',
  },
};
const DEFAULT_ECOSYSTEM = 'august';
function resolveBrand(ecoSystem) {
  return BRANDS[ecoSystem] || BRANDS[DEFAULT_ECOSYSTEM];
}
const AUTH_FILE = path.join(__dirname, '..', 'persist', 'yale-auth.json');

const DEFAULT_POLL_INTERVAL_S = 30;
const MIN_POLL_INTERVAL_S     = 10;
const REQUEST_TIMEOUT_MS      = 10_000;
const UPDATE_FAILURE_TOLERANCE = 3;
// Refresh the access token once less than this much of its lifetime remains
// (mirrors yalexs's DEFAULT_RENEWAL_THRESHOLD of 7 days).
const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

function authHeaders(accessToken, brand) {
  const b = brand || BRANDS[DEFAULT_ECOSYSTEM];
  const h = {
    'User-Agent':     USER_AGENT,
    'Accept':         'application/json',
    'Accept-Version': '0.0.1',
  };
  for (const kh of b.keyHeaders) h[kh] = b.apiKey;
  if (b.brandingHeader) h[b.brandingHeader] = b.branding;
  if (accessToken) h[b.tokenHeader] = accessToken;
  return h;
}

async function request(method, urlPath, { accessToken, json, brand } = {}) {
  const b = brand || BRANDS[DEFAULT_ECOSYSTEM];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${b.url}${urlPath}`, {
      method,
      headers: { ...authHeaders(accessToken, b), ...(json ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}) },
      body: json ? JSON.stringify(json) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      // Surface what the API actually said. A 403 "API key is not valid" is a
      // problem with API_KEY above, NOT with the user's credentials, and
      // reporting it as "bad credentials" sends debugging the wrong way.
      let detail = '';
      try { const t = await res.text(); const b = JSON.parse(t); detail = b?.message || b?.code || ''; } catch { /* non-JSON body */ }
      if (res.status === 401 || res.status === 403) {
        throw new Error(detail ? `HTTP ${res.status}: ${detail}` : 'unauthorized (bad or expired credentials)');
      }
      throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
    }
    const newToken = res.headers.get('x-august-access-token') || res.headers.get('x-access-token');
    let body = null;
    const text = await res.text();
    if (text) { try { body = JSON.parse(text); } catch { body = text; } }
    return { body, newToken };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function decodeJwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (payload.exp) return payload.exp * 1000;
  } catch { /* not a JWT / unreadable — caller falls back to re-login */ }
  return null;
}

function loadAuth() {
  try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); }
  catch { return null; }
}

function saveAuth(auth) {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
}

/**
 * Everything needed to log in, handle the one-time verification step, and
 * keep a token alive. Exported standalone (not just as a YaleClient method)
 * so scripts/yale-verify.js can drive it interactively without spinning up
 * the rest of LSH.
 */
class YaleAuthenticator {
  constructor({ username, password, loginMethod = 'email', ecoSystem = DEFAULT_ECOSYSTEM,
                accessToken = null, refreshToken = null, clientId = null, clientSecret = null }) {
    this.username = username;
    this.password = password;
    this.loginMethod = loginMethod === 'phone' ? 'phone' : 'email';
    this.brand = resolveBrand(ecoSystem);
    const cached = loadAuth();
    this.installId = cached?.installId || crypto.randomUUID();
    // A token supplied via config (yale_global) wins over the cache on first
    // run; afterwards the refreshed token in the cache is newer, so prefer it.
    this.accessToken = cached?.accessToken || accessToken || null;
    this.accessTokenExpires = cached?.accessTokenExpires || null;
    this.validated = cached?.validated || false;
    this.refreshToken = cached?.refreshToken || refreshToken || null;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    // Pin the installId to disk the first time we mint one, so repeated login
    // attempts reuse a single installId instead of spraying Yale with a fresh
    // one every run. A flood of new installIds from one IP is what trips
    // aaecosystem's abuse throttle, which then answers with a misleading
    // 403 "API key is not valid" even though the key is fine.
    if (!cached?.installId) this._persist();
  }

  get identifier() { return `${this.loginMethod}:${this.username}`; }

  _persist() {
    saveAuth({
      installId: this.installId,
      accessToken: this.accessToken,
      accessTokenExpires: this.accessTokenExpires,
      validated: this.validated,
      refreshToken: this.refreshToken,
    });
  }

  /** POST /session. Returns 'authenticated' | 'requires_validation' | 'bad_password'. */
  async login() {
    // Token-model brands have no password/session login — callers should go
    // through ensureAuthenticated() instead.
    if (this.brand.mode === 'token') {
      return this.accessToken ? 'authenticated' : 'requires_token';
    }
    const { body, newToken } = await request('POST', '/session', {
      brand: this.brand,
      json: { installId: this.installId, identifier: this.identifier, password: this.password },
    });
    const accessToken = newToken;
    // Response shape differs by eco-system: august returns vPassword:false
    // (alongside a throwaway token) to signal a wrong password, and marks a
    // trusted install with vInstallId. yale_home (aaecosystem) omits vPassword
    // and uses hasInstallId instead. So treat an EXPLICIT vPassword:false as a
    // rejection, but otherwise trust the presence of an access token, and
    // accept either field as the "install already trusted" signal.
    if (body?.vPassword === false || !accessToken) return 'bad_password';
    this.accessToken = accessToken;
    this.accessTokenExpires = decodeJwtExpiry(accessToken) || (Date.now() + 24 * 60 * 60 * 1000);
    const installTrusted = body?.vInstallId || body?.hasInstallId;
    if (!installTrusted) { this._persist(); return 'requires_validation'; }
    this.validated = true;
    this._persist();
    return 'authenticated';
  }

  async sendVerificationCode() {
    await request('POST', `/validation/${this.loginMethod}`, {
      brand: this.brand,
      accessToken: this.accessToken,
      json: this.loginMethod === 'phone' ? { smsHashString: 'anY0ZsRmXw+', value: this.username } : { value: this.username },
    });
  }

  async validateVerificationCode(code) {
    await request('POST', `/validate/${this.loginMethod}`, {
      brand: this.brand,
      accessToken: this.accessToken,
      json: { [this.loginMethod]: this.username, code: String(code) },
    });
    // Re-login now that the install is validated — vInstallId should be set this time.
    return this.login();
  }

  /**
   * OAuth2 refresh_token grant against the yale_global token endpoint. Body
   * shape is the standard OAuth2 form; the exact params (and whether a
   * client_secret is required) are UNVERIFIED until confirmed from a real
   * capture of the Yale Home app's token exchange — adjust here if a capture
   * shows different field names.
   */
  async _refreshOAuth() {
    if (!this.refreshToken || !this.brand.oauthTokenUrl) throw new Error('no refresh token / oauth endpoint');
    const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.refreshToken });
    if (this.clientId) form.set('client_id', this.clientId);
    if (this.clientSecret) form.set('client_secret', this.clientSecret);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(this.brand.oauthTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': USER_AGENT },
        body: form.toString(),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`token refresh HTTP ${res.status}`);
      const j = await res.json();
      if (!j.access_token) throw new Error('token refresh: no access_token in response');
      this.accessToken = j.access_token;
      if (j.refresh_token) this.refreshToken = j.refresh_token;
      this.accessTokenExpires = decodeJwtExpiry(j.access_token)
        || (j.expires_in ? Date.now() + Number(j.expires_in) * 1000 : Date.now() + 60 * 60 * 1000);
      this._persist();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Ensures this.accessToken is set and not near expiry; re-logs in if needed. */
  async ensureAuthenticated() {
    // Token model (yale_global): no password login exists. Use the supplied
    // access token; refresh it via OAuth when it is expired/near-expiry and a
    // refresh token is available. A minute of skew keeps us clear of the edge.
    if (this.brand.mode === 'token') {
      const fresh = this.accessTokenExpires && (this.accessTokenExpires - Date.now()) > 60_000;
      if (this.accessToken && fresh) return 'authenticated';
      if (this.refreshToken) {
        try { await this._refreshOAuth(); return 'authenticated'; }
        catch { /* fall through: try the (possibly still-valid) token as-is */ }
      }
      return this.accessToken ? 'authenticated' : 'requires_token';
    }
    if (this.accessToken && this.accessTokenExpires && (this.accessTokenExpires - Date.now()) > REFRESH_THRESHOLD_MS) {
      return 'authenticated';
    }
    // Try a cheap refresh first (rides on the response header of any authed call).
    if (this.accessToken && this.validated) {
      try {
        const { newToken } = await request('GET', '/users/houses/mine', { brand: this.brand, accessToken: this.accessToken });
        if (newToken) {
          this.accessToken = newToken;
          this.accessTokenExpires = decodeJwtExpiry(newToken) || (Date.now() + REFRESH_THRESHOLD_MS);
          this._persist();
          return 'authenticated';
        }
      } catch { /* fall through to full re-login */ }
    }
    return this.login();
  }

  async get(urlPath) {
    const { body, newToken } = await request('GET', urlPath, { brand: this.brand, accessToken: this.accessToken });
    if (newToken && newToken !== this.accessToken) {
      this.accessToken = newToken;
      this.accessTokenExpires = decodeJwtExpiry(newToken) || this.accessTokenExpires;
      this._persist();
    }
    return body;
  }
}

class YaleClient {
  constructor(config, store, sensorRegistry) {
    this._config = config;
    this._store = store;
    this._registry = sensorRegistry;
    this._timer = null;
    this._failCount = 0;
    this._auth = null;
    // Content tokens authenticate the doorbell image fetch (see
    // api-routes.js's /yale-camera/:id/snapshot) and must never go through
    // store.set() — the websocket layer broadcasts every store change to
    // every connected dashboard client, which would leak them.
    this._contentTokens = new Map();
  }

  async start() {
    const cfg = this._config.yale || {};
    const brand = resolveBrand(cfg.ecoSystem);
    // Password brands need username+password; the token brand (yale_global)
    // needs an accessToken instead. Skip startup if the required creds are
    // absent, matching how server.js gates every other integration.
    if (brand.mode === 'token') {
      if (!cfg.accessToken) return;
    } else if (!cfg.username || !cfg.password) {
      return;
    }

    this._auth = new YaleAuthenticator(cfg);
    platformStatus.set('yale', false);

    const seconds = Math.max(Number(cfg.pollInterval) || DEFAULT_POLL_INTERVAL_S, MIN_POLL_INTERVAL_S);
    await this._poll();
    this._timer = setInterval(() => this._poll().catch((err) => console.error(`[Yale] poll error: ${err.message}`)), seconds * 1000);
    console.log(`[Yale] Doorbell camera polling started (${seconds}s)`);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  async _poll() {
    try {
      const state = await this._auth.ensureAuthenticated();
      if (state === 'requires_validation') {
        console.error('[Yale] Account requires one-time verification — run `node scripts/yale-verify.js` and follow the prompts, then restart LSH.');
        platformStatus.set('yale', false);
        return;
      }
      if (state === 'bad_password') {
        console.error('[Yale] Login rejected — check yale.username/yale.password in config.json.');
        platformStatus.set('yale', false);
        return;
      }
      if (state === 'requires_token') {
        console.error('[Yale] yale_global needs an access token — set yale.accessToken (and yale.refreshToken) in config.json, or its token expired and could not be refreshed.');
        platformStatus.set('yale', false);
        return;
      }

      const doorbells = await this._auth.get('/users/doorbells/mine');
      for (const [id, data] of Object.entries(doorbells || {})) this._syncDoorbell(id, data);

      this._failCount = 0;
      platformStatus.set('yale', true);
    } catch (err) {
      this._failCount++;
      console.error(`[Yale] poll failed: ${err.message}`);
      if (this._failCount >= UPDATE_FAILURE_TOLERANCE) platformStatus.set('yale', false);
    }
  }

  _syncDoorbell(id, data) {
    const key = `yale/${id}`;

    if (!this._registry.devices.has(key)) {
      this._registry.registerDevice({
        key,
        type: 'yale',
        instance: id,
        label: data.name || `Yale Doorbell ${id}`,
        icon: '📷',
        color: 'gray',
        sensors: [
          { path: 'status',  name: 'Status',  format: 'string' },
          { path: 'online',  name: 'Online',  format: 'on-off' },
          { path: 'battery', name: 'Battery', format: 'percent', unit: '%', homekit: 'battery-level' },
          { path: 'image',   name: 'Snapshot URL', format: 'string', hidden: true, isCamera: true },
        ],
        homekit: ['battery-level'],
      });
    }

    const isOnline = data.status === 'doorbell_call_status_online';
    this._store.set(`${key}/status`, data.status || 'unknown');
    this._store.set(`${key}/online`, isOnline ? 1 : 0);

    const battery = this._batteryFromTelemetry(data.telemetry);
    if (battery != null) this._store.set(`${key}/battery`, battery);

    const imageUrl = data.recentImage?.secure_url;
    if (imageUrl) {
      this._store.set(`${key}/image`, imageUrl);
      this._contentTokens.set(id, data.contentToken || '');
    }
  }

  /** Used by the /yale-camera/:id/snapshot proxy route — kept off the
   * store/websocket path on purpose, see the constructor comment. */
  getContentToken(id) {
    return this._contentTokens.get(id) || '';
  }

  // Yale's telemetry shape varies by hardware revision — battery_soc (Li-ion
  // doorbells) is a direct percentage; older wired/hybrid units only expose
  // a boolean low-battery flag or a raw voltage, so approximate those the
  // same way yalexs's DoorbellDetail does.
  _batteryFromTelemetry(telemetry) {
    if (!telemetry) return null;
    if (telemetry.battery_soc != null) return telemetry.battery_soc;
    if (telemetry.doorbell_low_battery) return 10;
    if (telemetry.battery != null) {
      const v = telemetry.battery;
      if (v >= 4) return 100;
      if (v >= 3.75) return 75;
      if (v >= 3.5) return 50;
      return 25;
    }
    return null;
  }

  /** Used by the /api/cameras aggregator in api-routes.js — same shape as
   * the other camera clients' getCameras() (mobotix-client.js, etc.). No
   * RTSP `url` here — Yale doorbells are cloud-only, snapshot/live-view
   * only, no local stream to hand to go2rtc. */
  getCameras() {
    if (!this._registry) return [];
    const out = [];
    for (const [key, device] of this._registry.devices) {
      if (device.type !== 'yale') continue;
      const id = device.instance;
      out.push({
        name: device.label,
        url: '',
        snapshotUrl: `/api/yale-camera/${id}/snapshot`,
        mjpegUrl: '',
        webrtcUrl: '',
        _yale: true,
      });
    }
    return out;
  }
}

module.exports = YaleClient;
module.exports.YaleAuthenticator = YaleAuthenticator;
