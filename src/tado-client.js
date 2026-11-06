'use strict';

// tado° smart thermostats, radiator valves, hot water and Smart AC Control
// (V3+ and earlier, through the tado cloud: my.tado.com/api/v2). tado X —
// the 2024 line on the hops.tado.com API — is not covered.
//
// Sign-in: tado only allows its OAuth device-code flow (since March 2025 the
// password grant is gone). Settings → tado → Sign in shows a tado link and
// code; once confirmed there, the refresh token goes to
// persist/tado-tokens.json (0600). tado rotates the refresh token on every
// use and it lapses after 30 days unused, so it's saved after each refresh.
//
//   POST login.tado.com/oauth2/device_authorize   client_id, scope=offline_access
//   POST login.tado.com/oauth2/token              device_code / refresh_token grants
//   GET  /me                                      homes
//   GET  /homes/<h>/zones                         zones + their devices (batteries)
//   GET  /homes/<h>/zones/<z>/capabilities        AC modes / ranges (once)
//   GET  /homes/<h>/zoneStates                    every zone in one call (each poll)
//   GET  /homes/<h>/state                         presence HOME / AWAY
//   PUT  /homes/<h>/zones/<z>/overlay             manual setting { setting, termination }
//   DELETE /homes/<h>/zones/<z>/overlay           back to the schedule
//   PUT|DELETE /homes/<h>/presenceLock            force home / away, or back to geofencing
//
// API limits: tado allows 100 calls a day without an Auto-Assist
// subscription (20,000 with). Unless pollInterval is set, the interval is
// sized to stay under the limit — the ratelimit-policy header's quota when
// tado sends it, else config.tado.dailyLimit (default 100) — keeping a fifth
// of it for commands. With 100 a day that is about one poll every 23 minutes.
// A failed poll retries from a minute, doubling up to the interval, so a brief
// failure doesn't leave tado down for a whole interval; a 429 waits it out.
//
// Devices:
//   tado/<home>-<zone>  heating: a thermostat (power, set temperature, room
//                       temperature, humidity, heating power %, mode, open
//                       window, low battery, resume schedule) — HomeKit Thermostat
//                       hot water: power, temperature where the boiler takes one
//                       AC: the shared AC model (src/ac-common.js) + resume schedule
//   tado/<home>         presence (home/away, HomeKit occupancy), away lock,
//                       back to automatic presence
//
// A manual change lasts until the next schedule block by default;
// config.tado.overlay = 'manual' (until changed) or a number of minutes.
//
// The first poll waits config.tado.startDelay seconds (default 30): LSH's
// startup can stall the event loop long enough to time requests out, and an
// aborted refresh could lose the token tado has just rotated.
//
// config.tado = { enabled, pollInterval?, dailyLimit = 100, overlay = 'next', startDelay = 30 }
//   (apiBase / authBase override the endpoints, for tests)
// Tested against scripts/tado-simulator.js (test/tado.test.js) — not yet
// against a real tado account.

const fs = require('fs');
const path = require('path');
const PollingClient = require('./polling-client');
const { registerAc, publishAc, MODES } = require('./ac-common');

const CLIENT_ID = '1bb50063-6b0c-4d11-bd99-387f4a91cc46';
const TOKEN_FILE = process.env.LSH_TADO_TOKENS || path.join(__dirname, '..', 'persist', 'tado-tokens.json');
const TIMEOUT_MS = 15000;
const RETRY_MS = 60000;
const AUTH_BASE = 'https://login.tado.com/oauth2';
const API_BASE = 'https://my.tado.com/api/v2';

// ── tokens ─────────────────────────────────────────────────────────────────

function loadTokens(file = TOKEN_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function saveTokens(t, file = TOKEN_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(t, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function clearTokens(file = TOKEN_FILE) {
  try { fs.unlinkSync(file) } catch {}
}

async function form(url, params) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(), signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, j };
}

const tokenRecord = (j) => ({ accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Date.now() + (Number(j.expires_in) || 600) * 1000, savedAt: new Date().toISOString() });

// Step 1 of the sign-in: a code for the user to confirm on tado's site.
async function startDeviceAuth({ authBase = AUTH_BASE } = {}) {
  const { ok, status, j } = await form(`${authBase}/device_authorize`, { client_id: CLIENT_ID, scope: 'offline_access' });
  if (!ok || !j.device_code) throw new Error(`tado sign-in: ${j.error_description || j.error || `HTTP ${status}`}`);
  return {
    deviceCode: j.device_code, userCode: j.user_code,
    url: j.verification_uri_complete || j.verification_uri, expiresIn: Number(j.expires_in) || 300, interval: Number(j.interval) || 5,
  };
}

// Step 2: ask whether it was confirmed. → 'pending' | 'slow_down' | tokens (saved); throws when refused/expired.
async function pollDeviceAuth(deviceCode, { authBase = AUTH_BASE, file = TOKEN_FILE } = {}) {
  const { ok, j } = await form(`${authBase}/token`, { client_id: CLIENT_ID, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
  if (ok && j.access_token) { const t = tokenRecord(j); saveTokens(t, file); return t }
  if (j.error === 'authorization_pending') return 'pending';
  if (j.error === 'slow_down') return 'slow_down';
  if (j.error === 'expired_token') throw new Error('The code expired — start the sign-in again');
  if (j.error === 'access_denied') throw new Error('Sign-in was refused on tado’s page');
  throw new Error(`tado sign-in: ${j.error_description || j.error || 'no token'}`);
}

// ── mappings ───────────────────────────────────────────────────────────────

const TADO_MODE = { auto: 'AUTO', cool: 'COOL', dry: 'DRY', fan: 'FAN', heat: 'HEAT' };
const LSH_MODE = Object.fromEntries(Object.entries(TADO_MODE).map(([k, v]) => [v, k]));
// tado fan values on LSH's 0 auto … 5 turbo scale (fanLevel on newer units, fanSpeed on older)
const FAN_FROM = { AUTO: 0, SILENT: 1, LEVEL1: 1, LEVEL2: 2, LOW: 2, LEVEL3: 3, MIDDLE: 3, LEVEL4: 4, HIGH: 4, LEVEL5: 5 };
// the unit's value nearest to LSH fan n (auto only for 0)
function nearestFan(have, n) {
  if (n === 0 && have.includes('AUTO')) return 'AUTO';
  const steps = have.filter((x) => x !== 'AUTO' && FAN_FROM[x] != null);
  if (!steps.length) return have[0];
  return steps.reduce((best, x) => (Math.abs(FAN_FROM[x] - n) < Math.abs(FAN_FROM[best] - n) ? x : best));
}

const slug = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '');
const on = (v) => v === 'ON';

// overlay termination from config.tado.overlay
function termination(overlay) {
  if (overlay === 'manual') return { typeSkillBasedApp: 'MANUAL' };
  const min = Number(overlay);
  if (Number.isFinite(min) && min > 0) return { typeSkillBasedApp: 'TIMER', durationInSeconds: Math.round(min * 60) };
  return { typeSkillBasedApp: 'NEXT_TIME_BLOCK' };
}

// What a zone is doing, in words: schedule / manual / off / away / open window
function modeName(zs) {
  if (zs.openWindow) return 'open window';
  if (zs.overlayType === 'MANUAL' || zs.overlay) return zs.setting?.power === 'OFF' ? 'off' : 'manual';
  if (zs.tadoMode === 'AWAY') return 'away';
  return zs.setting?.power === 'OFF' ? 'off (schedule)' : 'schedule';
}

// ── client ─────────────────────────────────────────────────────────────────

class TadoClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'tado', logTag: 'tado' });
    this.cfg = config.tado || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.api = (this.cfg.apiBase || API_BASE).replace(/\/+$/, '');
    this.authBase = (this.cfg.authBase || AUTH_BASE).replace(/\/+$/, '');
    this.tokenFile = this.cfg.tokenFile || TOKEN_FILE;
    this.homes = new Map(); // id → { id, key, name, zones: Map<zoneId, zone> }
    this.quota = null;      // { limit, remaining } from the ratelimit headers
    this._polls = 0;
  }

  async start() {
    this.tokens = loadTokens(this.tokenFile);
    if (!this.tokens?.refreshToken) throw new Error('tado: not signed in — Settings → tado → Sign in');
    const fixed = Number(this.cfg.pollInterval);
    this._fixedInterval = Number.isFinite(fixed) && fixed > 0 ? Math.max(60, fixed) * 1000 : null;
    const delay = Number(this.cfg.startDelay ?? 30) * 1000;
    if (delay > 0) await new Promise((resolve) => { this._startTimer = setTimeout(resolve, delay) });
    await this.startPolling(this._fixedInterval || 30 * 60 * 1000);
  }

  stop() {
    clearTimeout(this._startTimer);
    super.stop();
  }

  _nextDelay() {
    if (!this._failures || this._rateLimited) return super._nextDelay();
    return Math.min(this._intervalMs, RETRY_MS * 2 ** (this._failures - 1));
  }

  // Poll interval that keeps a day's polls within 80 % of the API quota
  _autoInterval() {
    if (this._fixedInterval) return this._fixedInterval;
    const limit = this.quota?.limit || Number(this.cfg.dailyLimit) || 100;
    const perPoll = Math.max(1, this.homes.size) * 1.25; // zoneStates each poll, presence every 4th
    return Math.max(60, Math.ceil((86400 * perPoll) / (limit * 0.8))) * 1000;
  }

  async _token() {
    if (this.tokens.accessToken && this.tokens.expiresAt - Date.now() > 30000) return this.tokens.accessToken;
    if (!this._refreshing) {
      this._refreshing = (async () => {
        const { ok, j } = await form(`${this.authBase}/token`, { client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: this.tokens.refreshToken });
        if (!ok || !j.access_token) {
          if (j.error === 'invalid_grant') throw new Error('tado: sign-in expired — Settings → tado → Sign in again');
          throw new Error(`tado: token refresh failed (${j.error || 'no token'})`);
        }
        this.tokens = tokenRecord({ refresh_token: this.tokens.refreshToken, ...j });
        saveTokens(this.tokens, this.tokenFile);
        return this.tokens.accessToken;
      })().finally(() => { this._refreshing = null });
    }
    return this._refreshing;
  }

  async _call(method, p, body) {
    const res = await fetch(`${this.api}${p}`, {
      method, headers: { Authorization: `Bearer ${await this._token()}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    this._readQuota(res.headers);
    this._rateLimited = res.status === 429;
    if (res.status === 401) { this.tokens.accessToken = null; throw new Error('tado: access refused (401)') }
    if (res.status === 429) throw new Error('tado: daily API limit reached — polling slows down until it resets');
    if (res.status === 204) return null;
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`tado ${p}: ${j?.errors?.[0]?.title || `HTTP ${res.status}`}`);
    return j;
  }

  // ratelimit-policy: "perday";q=100;w=86400   ratelimit: "perday";r=93;t=…
  _readQuota(h) {
    const q = /q=(\d+)/.exec(h.get('ratelimit-policy') || '');
    const r = /r=(\d+)/.exec(h.get('ratelimit') || '');
    if (!q && !r) return;
    this.quota = { limit: q ? Number(q[1]) : this.quota?.limit, remaining: r ? Number(r[1]) : this.quota?.remaining };
    for (const home of this.homes.values()) if (this.quota.remaining != null) this.store.update(`${home.key}/apiRemaining`, this.quota.remaining);
  }

  async _discover() {
    const me = await this._call('GET', '/me');
    const homes = me?.homes || [];
    if (!homes.length) throw new Error('tado: no homes on this account');
    for (const h of homes) {
      if (this.homes.has(h.id)) continue;
      const home = { id: h.id, name: h.name || `Home ${h.id}`, key: `tado/${slug(h.id)}`, zones: new Map() };
      this._registerHome(home);
      for (const z of (await this._call('GET', `/homes/${h.id}/zones`)) || []) {
        const zone = { id: z.id, home, name: z.name || `Zone ${z.id}`, type: z.type, key: `tado/${slug(h.id)}-${slug(z.id)}`, devices: z.devices || [] };
        if (z.type === 'HEATING') zone.caps = { temperatures: { celsius: { min: 5, max: 25, step: 0.1 } } };
        else zone.caps = (await this._call('GET', `/homes/${h.id}/zones/${z.id}/capabilities`)) || {};
        home.zones.set(String(z.id), zone);
        this._registerZone(zone);
        console.log(`[tado] ${home.name}: ${zone.name} (${z.type})`);
      }
      // only now: a home known here is never discovered again, so one that
      // failed halfway has to stay out of the map or its zones are lost
      this.homes.set(h.id, home);
    }
  }

  _registerHome(home) {
    this.registry.registerDevice({
      key: home.key, label: `tado ${home.name}`, type: 'tado', category: 'climate', icon: '🏠', model: 'tado home',
      homekit: ['occupancy'],
      sensors: [
        { path: 'home', label: 'Someone home', format: 'on-off', type: 'boolean', homekit: 'occupancy' },
        { path: 'away', label: 'Away mode', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'away', writeOff: 'home', capabilityId: 'presence' },
        { path: 'presenceAuto', label: 'Automatic presence', controllable: true, type: 'trigger', writeOn: 'auto', writeOff: 'auto', capabilityId: 'presenceAuto' },
        { path: 'presenceLocked', label: 'Presence set by hand', format: 'on-off', type: 'boolean' },
        { path: 'apiRemaining', label: 'API calls left today', format: 'number' },
      ],
      _writeCapability: async (cap, cmd) => {
        if (cap === 'presenceAuto') { await this._call('DELETE', `/homes/${home.id}/presenceLock`); this.store.update(`${home.key}/presenceLocked`, 0); return }
        const away = cmd === 'away';
        await this._call('PUT', `/homes/${home.id}/presenceLock`, { homePresence: away ? 'AWAY' : 'HOME' });
        this.store.update(`${home.key}/away`, away ? 1 : 0);
        this.store.update(`${home.key}/home`, away ? 0 : 1);
        this.store.update(`${home.key}/presenceLocked`, 1);
      },
    });
  }

  _resumeSensor() {
    return { path: 'resumeSchedule', label: 'Resume schedule', controllable: true, type: 'trigger', writeOn: 'resume', writeOff: 'resume', capabilityId: 'resumeSchedule' };
  }

  _registerZone(zone) {
    const t = zone.caps.temperatures?.celsius || {};
    if (zone.type === 'AIR_CONDITIONING') {
      const modes = Object.keys(zone.caps).filter((k) => LSH_MODE[k]);
      const ranges = modes.map((m) => zone.caps[m]?.temperatures?.celsius).filter(Boolean);
      registerAc(this.registry, {
        key: zone.key, label: zone.name, type: 'tado', model: 'tado Smart AC Control',
        features: {
          swing: modes.some((m) => zone.caps[m]?.verticalSwing || zone.caps[m]?.swings), humidity: true,
          minTemp: ranges.length ? Math.min(...ranges.map((r) => r.min)) : 16, maxTemp: ranges.length ? Math.max(...ranges.map((r) => r.max)) : 30, step: 1,
        },
        set: (patch) => this.setAc(zone, patch),
        extraSensors: [this._resumeSensor(), { path: 'modeText', label: 'Mode', type: 'label' }],
        extraWrite: () => this.resume(zone),
      });
      return;
    }
    const heating = zone.type === 'HEATING';
    const sensors = [
      { path: 'power', label: heating ? 'Heating' : 'Hot water', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'power' },
      // hot water: only where the boiler takes a temperature
      ...(heating || zone.caps.canSetTemperature ? [{ path: 'targetTemp', label: 'Set temperature', unit: '°C', controllable: true, type: 'range', min: t.min ?? 5, max: t.max ?? 25, step: heating ? 0.5 : 1, writeCmd: 'set', capabilityId: 'targetTemp' }] : []),
      ...(heating ? [
        { path: 'temperature', label: 'Room temperature', unit: '°C', format: 'number' },
        { path: 'humidity', label: 'Humidity', unit: '%', format: 'number' },
        { path: 'heatingPower', label: 'Heating power', unit: '%', format: 'number' },
        { path: 'openWindow', label: 'Open window', format: 'on-off', type: 'boolean', sensorType: 'window' },
        { path: 'batteryLow', label: 'Battery low', format: 'on-off', type: 'boolean' },
      ] : []),
      { path: 'modeText', label: 'Mode', type: 'label' },
      this._resumeSensor(),
      { path: 'online', label: 'Online', sensorType: 'connectivity', hidden: true },
      ...(heating ? [
        { path: 'thermostatMode', label: 'Thermostat mode', type: 'label', hidden: true },
        { path: 'thermostatOperatingState', label: 'Operating state', type: 'label', hidden: true },
        { path: 'heatingSetpoint', label: 'Heating setpoint', unit: '°C', hidden: true },
        { path: 'coolingSetpoint', label: 'Cooling setpoint', unit: '°C', hidden: true },
      ] : []),
    ];
    this.registry.registerDevice({
      key: zone.key, label: zone.name, type: 'tado', category: 'climate', icon: heating ? '🔥' : '🚿',
      model: heating ? 'tado heating' : 'tado hot water', homekit: heating ? ['thermostat'] : [], sensors,
      _writeCapability: async (cap, cmd, args = []) => {
        const v = args[0];
        switch (cap) {
          case 'resumeSchedule': return this.resume(zone);
          case 'power': return this.setZone(zone, { power: cmd === 'on' });
          case 'targetTemp': case 'thermostatHeatingSetpoint': case 'thermostatCoolingSetpoint': {
            const n = Number(v);
            if (!Number.isFinite(n) || n < (t.min ?? 5) || n > (t.max ?? 25)) throw new Error(`temperature must be ${t.min ?? 5}–${t.max ?? 25} °C`);
            return this.setZone(zone, { power: true, targetTemp: Math.round(n * 10) / 10 });
          }
          // HomeKit: off → off, heat → manual on, auto → the schedule
          case 'thermostatMode':
            if (v === 'off') return this.setZone(zone, { power: false });
            if (v === 'auto') return this.resume(zone);
            return this.setZone(zone, { power: true });
          default: throw new Error(`can't set ${cap}`);
        }
      },
    });
  }

  async _pollImpl() {
    if (!this.homes.size) await this._discover();
    for (const home of this.homes.values()) {
      const r = await this._call('GET', `/homes/${home.id}/zoneStates`);
      if (!r?.zoneStates) throw new Error('tado: no zone states in the answer');
      for (const [zid, zs] of Object.entries(r.zoneStates)) {
        const zone = home.zones.get(String(zid));
        if (zone) this._publishZone(zone, zs);
      }
      if (this._polls % 4 === 0) {
        const st = await this._call('GET', `/homes/${home.id}/state`);
        if (st?.presence) {
          this.store.update(`${home.key}/home`, st.presence === 'HOME' ? 1 : 0);
          this.store.update(`${home.key}/away`, st.presence === 'AWAY' ? 1 : 0);
          this.store.update(`${home.key}/presenceLocked`, st.presenceLocked ? 1 : 0);
        }
      }
    }
    this._polls++;
    this._intervalMs = this._autoInterval();
  }

  _publishZone(zone, zs) {
    const k = zone.key, put = (p, v) => { if (v !== undefined && v !== null) this.store.update(`${k}/${p}`, v) };
    zone.state = zs;
    const s = zs.setting || {};
    const online = zs.link ? zs.link.state === 'ONLINE' : undefined;
    put('modeText', modeName(zs));
    if (zone.type === 'AIR_CONDITIONING') {
      const sd = zs.sensorDataPoints || {};
      publishAc(this.store, k, {
        online, power: on(s.power), mode: LSH_MODE[s.mode], targetTemp: s.temperature?.celsius,
        fan: FAN_FROM[s.fanLevel || s.fanSpeed], swing: s.verticalSwing ? on(s.verticalSwing) : s.swing ? on(s.swing) : undefined,
        temperature: sd.insideTemperature?.celsius, humidity: sd.humidity?.percentage,
      });
      return;
    }
    put('online', online === undefined ? undefined : online ? 1 : 0);
    put('power', on(s.power) ? 1 : 0);
    put('targetTemp', s.temperature?.celsius);
    if (zone.type !== 'HEATING') return;
    const sd = zs.sensorDataPoints || {}, act = zs.activityDataPoints || {};
    put('temperature', sd.insideTemperature?.celsius);
    put('humidity', sd.humidity?.percentage);
    put('heatingPower', act.heatingPower?.percentage);
    put('openWindow', zs.openWindow || zs.openWindowDetected ? 1 : 0);
    put('batteryLow', zone.devices.some((d) => d.batteryState === 'LOW') ? 1 : 0);
    // HomeKit mirror: off / heat (manual) / auto (schedule)
    put('thermostatMode', !on(s.power) ? 'off' : zs.overlay || zs.overlayType ? 'heat' : 'auto');
    put('thermostatOperatingState', (act.heatingPower?.percentage || 0) > 0 ? 'heating' : 'idle');
    if (s.temperature?.celsius != null) { put('heatingSetpoint', s.temperature.celsius); put('coolingSetpoint', s.temperature.celsius) }
  }

  async _overlay(zone, setting) {
    const r = await this._call('PUT', `/homes/${zone.home.id}/zones/${zone.id}/overlay`, { setting, termination: termination(this.cfg.overlay) });
    const zs = { ...(zone.state || {}), setting: r?.setting || setting, overlayType: 'MANUAL', overlay: r || { setting } };
    this._publishZone(zone, zs);
  }

  // heating / hot water: { power, targetTemp }
  async setZone(zone, { power, targetTemp }) {
    const cur = zone.state?.setting || {};
    const wantOn = power ?? on(cur.power);
    const setting = { type: zone.type, power: wantOn ? 'ON' : 'OFF' };
    if (wantOn) {
      const temp = targetTemp ?? cur.temperature?.celsius ?? (zone.type === 'HOT_WATER' ? undefined : 21);
      if (temp != null && (zone.type === 'HEATING' || zone.caps.canSetTemperature)) setting.temperature = { celsius: temp };
    }
    await this._overlay(zone, setting);
  }

  // AC: the shared patch { power, mode, targetTemp, fan, swing } within the zone's capabilities
  async setAc(zone, patch) {
    const cur = zone.state?.setting || {};
    const wantOn = patch.power ?? on(cur.power);
    if (!wantOn) return this._overlay(zone, { type: 'AIR_CONDITIONING', power: 'OFF' });
    const mode = patch.mode ? TADO_MODE[patch.mode] : cur.mode || 'COOL';
    const caps = zone.caps[mode];
    if (!caps) throw new Error(`tado: this AC has no ${patch.mode || mode.toLowerCase()} mode`);
    const setting = { type: 'AIR_CONDITIONING', power: 'ON', mode };
    const r = caps.temperatures?.celsius;
    if (r) setting.temperature = { celsius: Math.max(r.min, Math.min(r.max, patch.targetTemp ?? cur.temperature?.celsius ?? 22)) };
    const fan = patch.fan ?? FAN_FROM[cur.fanLevel || cur.fanSpeed] ?? 0;
    if (caps.fanLevel?.length) setting.fanLevel = nearestFan(caps.fanLevel, fan);
    else if (caps.fanSpeeds?.length) setting.fanSpeed = nearestFan(caps.fanSpeeds, fan);
    const swingOn = patch.swing ?? (cur.verticalSwing ? on(cur.verticalSwing) : on(cur.swing));
    if (caps.verticalSwing?.length) setting.verticalSwing = swingOn && caps.verticalSwing.includes('ON') ? 'ON' : 'OFF';
    else if (caps.swings?.length) setting.swing = swingOn && caps.swings.includes('ON') ? 'ON' : 'OFF';
    await this._overlay(zone, setting);
  }

  // back to the schedule — the zone's scheduled setting arrives with the next poll
  async resume(zone) {
    await this._call('DELETE', `/homes/${zone.home.id}/zones/${zone.id}/overlay`);
    zone.state = { ...(zone.state || {}), overlay: null, overlayType: null };
    this.store.update(`${zone.key}/modeText`, 'schedule');
    if (zone.type === 'HEATING') this.store.update(`${zone.key}/thermostatMode`, 'auto');
  }
}

module.exports = TadoClient;
Object.assign(module.exports, { nearestFan, startDeviceAuth, pollDeviceAuth, loadTokens, saveTokens, clearTokens, termination, modeName, CLIENT_ID, TOKEN_FILE, MODES });
