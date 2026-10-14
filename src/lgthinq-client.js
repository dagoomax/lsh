'use strict';

// LG ThinQ — LG's official ThinQ Connect API (https://smartsolution.developer.lge.com/en/apiManage/thinq_connect)
// with a Personal Access Token from https://connect-pat.lgthinq.com. Any LG
// appliance on the account: its sensors are built from the device's own profile
// (GET /devices/{id}/profile — what it reports, with ranges / options, and what
// can be written), so a fridge, an AC, a washer or a purifier all work without
// per-model code.
//
//   GET  /devices                    the account's appliances
//   GET  /devices/{id}/profile       their properties
//   GET  /devices/{id}/state         current values (polled)
//   POST /devices/{id}/control       { group: { [locationName,] attribute: value } }
//
// The server is regional (api-eic Europe, api-aic Americas, api-kic Asia /
// Pacific), picked by the account's country — which has to be the real one
// (x-country; LG answers "Not supported country" otherwise). An old config with
// a region code (EU, US…) instead of a country gets it detected once and saved.
//
// Sensors: <group>_<attribute>, or <group>_<location>_<attribute> for parts of
// a device (FRIDGE / FREEZER…). Numbers and ranges → number / range; booleans →
// boolean / toggle; options → text, or a 0…N number when writable (hint lists
// them); POWER_ON / POWER_OFF style options → toggle.
//
// Token: config.lgthinq.token, else persist/lgthinq-tokens.json (access_token),
// which older versions of the Settings page wrote.
//
// Verified against a real account (a refrigerator); other appliance types follow
// the same profile format but haven't been tried on real hardware.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PollingClient = require('./polling-client');

// public key of LG's ThinQ Connect SDK (thinqconnect) — identifies the client kind, not the user
const API_KEY = 'v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3';
const TOKENS_FILE = path.join(__dirname, '..', 'persist', 'lgthinq-tokens.json');
const POLL_MS = 60 * 1000;

const AMERICAS = ['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'EC', 'VE', 'UY', 'PY', 'BO', 'CR', 'PA', 'GT', 'HN', 'SV', 'NI', 'DO', 'PR', 'JM', 'TT'];
const ASIA = ['KR', 'JP', 'AU', 'NZ', 'CN', 'TW', 'HK', 'SG', 'MY', 'TH', 'VN', 'PH', 'ID', 'IN'];
const EUROPE = ['PL', 'DE', 'GB', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR', 'PT', 'IE', 'DK', 'SE', 'NO', 'FI', 'EE', 'LV', 'LT', 'SI', 'HR', 'RS', 'BA', 'UA', 'LU', 'TR', 'IL', 'AE', 'SA', 'ZA', 'EG', 'MA'];
const LEGACY = { EU: EUROPE, US: ['US', 'CA'], CA: ['CA', 'US'], KR: ['KR'], JP: ['JP'], AU: ['AU', 'NZ'] };

function regionOf(country) {
  if (AMERICAS.includes(country)) return 'aic';
  if (ASIA.includes(country)) return 'kic';
  return 'eic';
}

const human = (s) => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const slug = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '');
const POWER = /^(POWER_ON|POWER_OFF|ON|OFF|START|STOP)$/;

// profile → [{ path, group, attr, location, spec }] (one per readable attribute)
function propertiesOf(profile) {
  const prop = profile?.property || {};
  const groups = Array.isArray(prop) ? prop.map((p, i) => ['', p, i]) : Object.entries(prop).map(([g, v]) => [g, v]);
  const out = [];
  const add = (group, obj, location) => {
    for (const [attr, spec] of Object.entries(obj || {})) {
      if (attr === 'locationName' || attr === 'unit' || !spec || typeof spec !== 'object' || !spec.type) continue;
      out.push({ path: [group, location, attr].filter(Boolean).map(slug).join('_'), group, attr, location, spec });
    }
  };
  for (const [group, v] of groups) {
    if (group === 'temperatureInUnits' && prop.temperature) continue; // same values as `temperature`
    for (const part of [].concat(v)) {
      if (!part || typeof part !== 'object') continue;
      const location = typeof part.locationName === 'string' ? part.locationName : part.location?.locationName;
      // nested groups (washer combos: { location, runState: {…}, … })
      const nested = Object.entries(part).filter(([, x]) => x && typeof x === 'object' && !x.type && !Array.isArray(x) && Object.values(x).some((y) => y?.type));
      if (nested.length && !Object.values(part).some((x) => x?.type)) for (const [g, x] of nested) add(group ? `${group}_${g}` : g, x, location);
      else add(group, part, location);
    }
  }
  return out;
}

// one property → an LSH sensor
function sensorFor(p) {
  const { spec } = p;
  const mode = spec.mode || ['r'];
  const writable = mode.includes('w');
  const w = spec.value?.w ?? spec.value?.r;
  const label = [p.location && human(p.location), human(p.attr)].filter(Boolean).join(' · ');
  const s = { path: p.path, name: label, label };
  if (/emperature/.test(p.attr)) s.format = 'temperature';
  if (spec.type === 'range' || spec.type === 'number') {
    Object.assign(s, { type: writable ? 'range' : 'number' });
    if (writable) Object.assign(s, { controllable: true, min: w?.min ?? 0, max: w?.max ?? 100, step: w?.step ?? 1, writeCmd: 'set', capabilityId: p.path });
  } else if (spec.type === 'boolean') {
    Object.assign(s, writable ? { type: 'toggle', controllable: true, writeOn: 'true', writeOff: 'false', capabilityId: p.path } : { type: 'boolean', format: 'on-off' });
  } else if (spec.type === 'enum') {
    const opts = Array.isArray(w) ? w : Array.isArray(spec.value?.r) ? spec.value.r : [];
    if (writable && opts.length === 2 && opts.every((o) => POWER.test(o))) {
      const on = opts.find((o) => /ON|START/.test(o)), off = opts.find((o) => /OFF|STOP/.test(o));
      Object.assign(s, { type: 'toggle', controllable: true, writeOn: on, writeOff: off, capabilityId: p.path, format: 'on-off' });
    } else if (writable && opts.length) {
      Object.assign(s, { type: 'range', controllable: true, min: 0, max: opts.length - 1, step: 1, writeCmd: 'set', capabilityId: p.path, hint: opts.map((o, i) => `${i} = ${o}`).join(', '), options: opts });
    } else Object.assign(s, { type: 'label' });
  } else return null;
  return s;
}

// state + property → the value LSH stores
function valueOf(state, p, sensor) {
  let g = p.group ? state?.[p.group.split('_')[0]] : state;
  if (p.group.includes('_')) g = [].concat(g).map((x) => x?.[p.group.split('_')[1]] ?? x);
  const part = [].concat(g).find((x) => !p.location || x?.locationName === p.location || x?.location?.locationName === p.location) ?? (Array.isArray(g) ? null : g);
  let v = part?.[p.attr];
  if (v === undefined || v === null) return null;
  if (sensor.type === 'toggle' && typeof v === 'string') return v === sensor.writeOn ? 1 : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (sensor.options) { const i = sensor.options.indexOf(v); return i < 0 ? null : i }
  return v;
}

class LGThinQClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'lgthinq', logTag: 'LGThinQ' });
    this.cfg = config.lgthinq || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.clientId = `lsh-${crypto.createHash('sha256').update(String(this._token() || 'x')).digest('hex').slice(0, 16)}`;
    this.devices = new Map(); // deviceId → { key, props: [{ p, sensor }] }
    this.country = null;
  }

  _token() {
    if (this.cfg.token) return String(this.cfg.token).trim();
    try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')).access_token || null } catch { return null }
  }

  async start() {
    if (!this._token()) { console.log('[LGThinQ] No Personal Access Token — add one in Settings → LG ThinQ'); return }
    await this.startPolling(POLL_MS);
  }

  stop() { this.stopPolling() }

  // ── API ───────────────────────────────────────────────────────────────
  async call(method, p, body, country = this.country) {
    const res = await fetch(`https://api-${regionOf(country)}.lgthinq.com${p}`, {
      method,
      headers: {
        Authorization: `Bearer ${this._token()}`,
        'x-country': country,
        'x-message-id': Buffer.from(crypto.randomUUID().replace(/-/g, ''), 'hex').toString('base64url'),
        'x-client-id': this.clientId,
        'x-api-key': API_KEY,
        'x-service-phase': 'OP',
        'Content-Type': 'application/json',
        ...(method === 'POST' ? { 'x-conditional-control': 'true' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || j?.error) {
      const e = j?.error || {};
      const why = { 1218: 'the Personal Access Token is invalid or expired — create a new one at connect-pat.lgthinq.com', 1307: `"${country}" isn’t your LG account’s country`, 1310: `"${country}" isn’t your LG account’s country`, 1222: 'the appliance is offline', 2207: 'the appliance is offline' }[e.code];
      const err = new Error(`LG ThinQ: ${why || e.message || `HTTP ${res.status}`}${e.code ? ` (${e.code})` : ''}`);
      err.code = e.code;
      throw err;
    }
    return j?.response;
  }

  // the account's country: as configured, or found once from an old region code and saved
  async _country() {
    if (this.country) return this.country;
    const c = String(this.cfg.country || '').toUpperCase();
    const known = [...AMERICAS, ...ASIA, ...EUROPE];
    if (/^[A-Z]{2}$/.test(c) && known.includes(c) && !LEGACY[c]) return (this.country = c);
    const tries = [...new Set([...(LEGACY[c] || []), ...(/^[A-Z]{2}$/.test(c) ? [c] : []), ...EUROPE, ...AMERICAS, ...ASIA])];
    for (const t of tries) {
      try {
        await this.call('GET', '/devices', null, t);
        this.country = t;
        if (t !== c) {
          console.log(`[LGThinQ] Account country is ${t} — saved to config`);
          try {
            const { readConfigCached, writeConfigFile } = require('./config-file-cache');
            const cur = readConfigCached();
            writeConfigFile({ ...cur, lgthinq: { ...(cur.lgthinq || {}), country: t } });
          } catch { /* used for this run anyway */ }
        }
        return t;
      } catch (err) {
        if (err.code === '1307' || err.code === '1310') continue;
        throw err;
      }
    }
    throw new Error('LG ThinQ: couldn’t find the account’s country — set it in Settings → LG ThinQ');
  }

  async _pollImpl() {
    await this._country();
    if (!this.devices.size) await this._discover();
    let ok = 0;
    for (const [id, d] of this.devices) {
      try { this._apply(d, await this.call('GET', `/devices/${id}/state`)); ok++ }
      catch (err) { console.warn(`[LGThinQ] ${d.label}: ${err.message}`) }
    }
    if (this.devices.size && !ok) throw new Error('No appliance answered');
  }

  async _discover() {
    const list = (await this.call('GET', '/devices')) || [];
    for (const dev of list) {
      const id = dev.deviceId;
      const info = dev.deviceInfo || {};
      try {
        const profile = await this.call('GET', `/devices/${id}/profile`);
        const props = propertiesOf(profile).map((p) => ({ p, sensor: sensorFor(p) })).filter((x) => x.sensor);
        const key = `lgthinq/${id}`;
        const label = info.alias || info.modelName || id;
        const d = { key, label, type: info.deviceType, props };
        const writer = (capId, command, args = []) => this.write(id, capId, command, args);
        const existing = this.registry.devices?.get?.(key);
        // saved again from Settings: this client takes over the device the previous one registered
        if (existing) Object.assign(existing, { sensors: props.map((x) => x.sensor), _writeCapability: writer });
        else this.registry.registerDevice({
          key, label, type: 'lgthinq', model: info.modelName, kind: String(info.deviceType || '').replace(/^DEVICE_/, '').toLowerCase(),
          homekit: [], sensors: props.map((x) => x.sensor), _writeCapability: writer,
        });
        this.devices.set(id, d);
        console.log(`[LGThinQ] ${label} (${info.deviceType}): ${props.length} sensor(s)`);
      } catch (err) { console.warn(`[LGThinQ] ${info.alias || id}: ${err.message}`) }
    }
    if (!list.length) console.log('[LGThinQ] No appliances on this LG account');
  }

  _apply(d, state) {
    d.state = state;
    for (const { p, sensor } of d.props) {
      const v = valueOf(state, p, sensor);
      if (v !== null) this.store.update(`${d.key}/${sensor.path}`, v);
    }
  }

  async write(id, capId, command, args) {
    const d = this.devices.get(id);
    const x = d?.props.find((y) => y.p.path === capId);
    if (!x) throw new Error('Unknown LG ThinQ setting');
    const { p, sensor } = x;
    let value;
    if (sensor.type === 'toggle') value = p.spec.type === 'boolean' ? command === 'true' : command;
    else if (sensor.options) value = sensor.options[Math.round(Number(args[0]))];
    else value = Number(args[0]);
    if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Invalid value');
    const inner = { ...(p.location ? { locationName: p.location } : {}), [p.attr]: value };
    if (/emperature/.test(p.attr) && p.group === 'temperature') {
      const part = [].concat(d.state?.temperature || []).find((t) => !p.location || t?.locationName === p.location);
      if (part?.unit) inner.unit = part.unit; // as the device reports it
    }
    const [g, sub] = p.group.split('_');
    const body = !g ? inner : sub ? { [g]: { [sub]: inner } } : { [g]: inner };
    await this.call('POST', `/devices/${id}/control`, body);
    this.store.update(`${d.key}/${sensor.path}`, sensor.type === 'toggle' ? (value === true || value === sensor.writeOn ? 1 : 0) : sensor.options ? Number(args[0]) : value);
    setTimeout(() => this.call('GET', `/devices/${id}/state`).then((s) => this._apply(d, s)).catch(() => {}), 3000).unref?.();
  }
}

module.exports = LGThinQClient;
module.exports.propertiesOf = propertiesOf;
module.exports.sensorFor = sensorFor;
module.exports.valueOf = valueOf;
module.exports.regionOf = regionOf;
// for Settings (GET /api/settings/lgthinq): every country the client knows, with its English name and LG server
const REGION_NAME = { eic: 'Europe, Middle East & Africa', aic: 'Americas', kic: 'Asia & Pacific' };
module.exports.countries = () => {
  let dn = null;
  try { dn = new Intl.DisplayNames(['en'], { type: 'region' }) } catch { /* no ICU */ }
  return [...EUROPE, ...AMERICAS, ...ASIA]
    .map((code) => ({ code, name: dn?.of(code) || code, region: regionOf(code), regionName: REGION_NAME[regionOf(code)] }))
    .sort((a, b) => a.name.localeCompare(b.name));
};
