'use strict';

// Viessmann ViCare heating integration (boilers / heat pumps).
//
// Uses the official Viessmann IoT cloud API — the same one the ViCare app and
// the community PyViCare library talk to. Auth is OAuth2 Authorization-Code +
// PKCE against the Viessmann IAM: the authorize endpoint accepts HTTP Basic
// (ViCare account e-mail + password) and 302-redirects with the auth code, so
// no interactive browser step is needed. Tokens are persisted and refreshed.
//
// You need a (free) API client registered at https://developer.viessmann.com
// with redirect URI http://localhost:4200/ — put its Client ID in config.
//
//   config.vicare = { user, password, clientId, redirectUri?, pollInterval? }
//
// The Viessmann API is strictly rate-limited (~1450 calls/day per client), so
// polling defaults to 120 s and every request is parsed defensively.

const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
const platformStatus = require('./platform-status');

const IAM     = 'https://iam.viessmann.com/idp/v3';
const API     = 'https://api.viessmann.com';
const SCOPE   = 'IoT User offline_access';
const TOKENS_FILE = path.join(__dirname, '..', 'persist', 'vicare-tokens.json');
const POLL_DEFAULT_S = 120;
const DHW_MIN = 10, DHW_MAX = 60;

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

class ViCareClient {
  constructor(config, store, sensorRegistry) {
    this._cfg      = config.vicare || {};
    this._store    = store;
    this._registry = sensorRegistry;
    this._tokens   = null;   // { access_token, refresh_token, expires_at }
    this._timer    = null;
    this._target   = null;   // { installationId, gatewaySerial, deviceId }
    this._registered = false;
  }

  async start() {
    const c = this._cfg;
    if (!c.clientId || !c.user || !c.password) {
      console.log('[ViCare] Needs clientId + user + password — skipping');
      return;
    }
    this._redirect = c.redirectUri || 'http://localhost:4200/';
    platformStatus.set('vicare', false);

    this._tokens = this._loadTokens();
    try {
      if (!this._tokens?.refresh_token) await this._authorize();
      await this._discover();
    } catch (err) {
      console.error(`[ViCare] Startup failed: ${err.message}`);
      platformStatus.set('vicare', false);
      return;
    }

    await this._poll();
    const ms = Math.max(60, c.pollInterval || POLL_DEFAULT_S) * 1000;
    this._timer = setInterval(() => this._poll().catch(() => {}), ms);
    console.log(`[ViCare] Started — polling every ${ms / 1000}s`);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    platformStatus.set('vicare', false);
  }

  // ── Token persistence ───────────────────────────────────────────────────────
  _loadTokens() {
    try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch { return null; }
  }
  _saveTokens() {
    try { fs.writeFileSync(TOKENS_FILE, JSON.stringify(this._tokens, null, 2)); } catch { /* ignore */ }
  }

  // ── OAuth2 (Authorization Code + PKCE, Basic-auth authorize) ────────────────
  async _authorize() {
    const verifier  = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const q = new URLSearchParams({
      client_id: this._cfg.clientId,
      redirect_uri: this._redirect,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: SCOPE,
    });
    const basic = Buffer.from(`${this._cfg.user}:${this._cfg.password}`).toString('base64');
    const res = await fetch(`${IAM}/authorize?${q}`, {
      method: 'GET', redirect: 'manual',
      headers: { Authorization: `Basic ${basic}` },
    });
    const loc = res.headers.get('location');
    if (!loc) throw new Error(`authorize: no redirect (HTTP ${res.status} — check clientId / credentials)`);
    const code = new URL(loc, this._redirect).searchParams.get('code');
    if (!code) throw new Error(`authorize: no code in redirect (${loc.slice(0, 80)})`);

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this._cfg.clientId,
      redirect_uri: this._redirect,
      code_verifier: verifier,
      code,
    });
    await this._exchange(body);
  }

  async _refresh() {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this._cfg.clientId,
      refresh_token: this._tokens.refresh_token,
    });
    await this._exchange(body, true);
  }

  async _exchange(body, isRefresh = false) {
    const res = await fetch(`${IAM}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) {
      if (isRefresh) { this._tokens = null; } // force full re-auth next start
      throw new Error(j.error_description || j.error || `token HTTP ${res.status}`);
    }
    this._tokens = {
      access_token:  j.access_token,
      refresh_token: j.refresh_token || this._tokens?.refresh_token,
      expires_at:    Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60000,
    };
    this._saveTokens();
  }

  async _token() {
    if (!this._tokens?.access_token || Date.now() >= (this._tokens.expires_at || 0)) {
      if (this._tokens?.refresh_token) await this._refresh();
      else await this._authorize();
    }
    return this._tokens.access_token;
  }

  // ── API helpers ─────────────────────────────────────────────────────────────
  async _api(pathname, { method = 'GET', body, _retried = false } = {}) {
    const token = await this._token();
    const res = await fetch(`${API}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 401) { // token rejected — refresh once and retry (no loops)
      if (_retried) throw new Error('unauthorized after token refresh');
      await this._refresh();
      return this._api(pathname, { method, body, _retried: true });
    }
    if (res.status === 429) throw new Error('rate limited (HTTP 429)');
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
    return j;
  }

  async _discover() {
    const inst = await this._api('/iot/v1/equipment/installations');
    const installationId = inst?.data?.[0]?.id;
    if (installationId == null) throw new Error('no installations on this account');
    const gws = await this._api('/iot/v1/equipment/gateways');
    const gw  = (gws?.data || []).find((g) => String(g.installationId) === String(installationId)) || gws?.data?.[0];
    const gatewaySerial = gw?.serial;
    if (!gatewaySerial) throw new Error('no gateway found');
    const devs = await this._api(`/iot/v1/equipment/gateways/${gatewaySerial}/devices`);
    // Prefer the heating device (type "heating"), else the first non-gateway one.
    const dev = (devs?.data || []).find((d) => d.deviceType === 'heating')
             || (devs?.data || []).find((d) => d.id !== 'gateway')
             || devs?.data?.[0];
    const deviceId = dev?.id ?? '0';
    this._target = { installationId, gatewaySerial, deviceId };
    console.log(`[ViCare] Installation ${installationId} / gateway ${gatewaySerial} / device ${deviceId}`);
  }

  // ── Poll ────────────────────────────────────────────────────────────────────
  async _poll() {
    if (!this._target) return;
    const { installationId, gatewaySerial, deviceId } = this._target;
    let feats;
    try {
      feats = await this._api(`/iot/v2/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features`);
      platformStatus.set('vicare', true);
    } catch (err) {
      platformStatus.set('vicare', false);
      console.error(`[ViCare] Poll failed: ${err.message}`);
      return;
    }

    const map = new Map();
    for (const f of feats?.data || []) if (f?.feature) map.set(f.feature, f);
    const prop = (name, p = 'value') => map.get(name)?.properties?.[p]?.value;

    const readings = {
      outsideTemperature: prop('heating.sensors.temperature.outside'),
      supplyTemperature:  prop('heating.circuits.0.sensors.temperature.supply') ?? prop('heating.boiler.sensors.temperature.commonSupply'),
      boilerTemperature:  prop('heating.boiler.temperature'),
      dhwTemperature:     prop('heating.dhw.sensors.temperature.hotWaterStorage') ?? prop('heating.dhw.sensors.temperature.dhwCylinder'),
      dhwTarget:          prop('heating.dhw.temperature.main'),
      burner:             prop('heating.burners.0', 'active') ?? prop('heating.burner', 'active'),
      heatingMode:        prop('heating.circuits.0.operating.modes.active'),
    };

    const dhwSettable = !!map.get('heating.dhw.temperature.main')?.commands?.setTargetTemperature;
    this._register(dhwSettable);

    const key = 'vicare/heating';
    const num = (v) => (typeof v === 'number' ? v : undefined);
    if (num(readings.outsideTemperature) != null) this._store.update(`${key}/outsideTemperature`, readings.outsideTemperature);
    if (num(readings.supplyTemperature)  != null) this._store.update(`${key}/supplyTemperature`,  readings.supplyTemperature);
    if (num(readings.boilerTemperature)  != null) this._store.update(`${key}/boilerTemperature`,  readings.boilerTemperature);
    if (num(readings.dhwTemperature)     != null) this._store.update(`${key}/dhwTemperature`,     readings.dhwTemperature);
    if (num(readings.dhwTarget)          != null) this._store.update(`${key}/dhwTarget`,          readings.dhwTarget);
    if (readings.burner != null) this._store.update(`${key}/burner`, readings.burner ? 1 : 0);
    if (readings.heatingMode != null) this._store.update(`${key}/heatingMode`, readings.heatingMode);
  }

  _register(dhwSettable) {
    if (this._registered) return;
    this._registered = true;
    const sensors = [
      { path: 'outsideTemperature', name: 'Outside Temp', format: 'temperature', unit: '°C', homekit: 'temperature' },
      { path: 'supplyTemperature',  name: 'Supply Temp',  format: 'temperature', unit: '°C' },
      { path: 'boilerTemperature',  name: 'Boiler Temp',  format: 'temperature', unit: '°C' },
      { path: 'dhwTemperature',     name: 'Hot Water',    format: 'temperature', unit: '°C' },
      dhwSettable
        ? { path: 'dhwTarget', name: 'Hot Water Target', format: 'number', unit: '°C', type: 'range',
            controllable: true, capabilityId: 'dhwTarget', writeCmd: 'setTargetTemperature',
            min: DHW_MIN, max: DHW_MAX, step: 1 }
        : { path: 'dhwTarget', name: 'Hot Water Target', format: 'number', unit: '°C' },
      { path: 'burner',      name: 'Burner',       format: 'on-off' },
      { path: 'heatingMode', name: 'Heating Mode', format: 'text' },
    ];
    this._registry.registerDevice({
      key: 'vicare/heating',
      label: this._cfg.name || 'Viessmann Heating',
      type: 'vicare',
      icon: '🔥',
      color: 'orange',
      sensors,
      homekit: ['temperature'],
      _writeCapability: (capId, command, args = []) => this._writeCapability(capId, args),
    });
    console.log('[ViCare] Registered heating device');
  }

  async _writeCapability(capId, args) {
    if (capId !== 'dhwTarget' || !this._target) return;
    const temp = Math.round(Math.max(DHW_MIN, Math.min(DHW_MAX, Number(args[0]) || 0)));
    const { installationId, gatewaySerial, deviceId } = this._target;
    const url = `/iot/v2/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features/heating.dhw.temperature.main/commands/setTargetTemperature`;
    try {
      await this._api(url, { method: 'POST', body: { temperature: temp } });
      this._store.update('vicare/heating/dhwTarget', temp);
    } catch (err) {
      console.error(`[ViCare] Set DHW target failed: ${err.message}`);
    }
  }
}

module.exports = ViCareClient;
