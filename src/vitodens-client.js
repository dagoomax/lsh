/**
 * Viessmann ViCare API client (Vitodens boilers, and other ViCare-connected
 * Viessmann heating systems — the API is model-agnostic).
 *
 * Auth: OAuth2 Authorization Code + PKCE, public client (no secret) — see
 * scripts/vitodens-auth.js for the one-time bootstrap. Access tokens are
 * short-lived (~1h); refreshed automatically here and the rotated refresh
 * token is persisted back to persist/vitodens-tokens.json.
 *
 * Sensors are NOT hardcoded from a guessed feature list. Each poll fetches
 * every feature the installation actually reports and registers/updates
 * whatever comes back — mirrors this codebase's Victron auto-discovery
 * (device-definitions.js) rather than SmartThings' fixed capability table,
 * because Viessmann's feature set varies a lot by model/firmware and a
 * stale hardcoded list would silently show nothing on a boiler it wasn't
 * written against. KNOWN_LABELS below only prettifies display names for
 * common features — it's cosmetic, discovery works without it.
 *
 * Writes are similarly self-describing: a feature's own `commands` object
 * (from the live API response) carries the command name, URI, and param
 * schema, so a command is only ever issued using values the boiler itself
 * just advertised as valid — never a guessed command path. This matters
 * because these commands control real heating hardware.
 */

const fs   = require('fs');
const path = require('path');

const platformStatus = require('./platform-status');

const TOKEN_URL   = 'https://iam.viessmann-climatesolutions.com/idp/v3/token';
const API_BASE    = 'https://api.viessmann-climatesolutions.com/iot';
const TOKEN_FILE  = path.join(__dirname, '..', 'persist', 'vitodens-tokens.json');
const POLL_INTERVAL_MS = 60_000; // Viessmann's cloud only gets fresh readings from the gateway every few minutes
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

// Cosmetic only — see file header. Unknown features still show up, just
// with a humanized version of their raw feature name.
const KNOWN_LABELS = {
  'heating.boiler.temperature':                 'Boiler Temperature',
  'heating.boiler.sensors.temperature.main':    'Boiler Temperature',
  'heating.dhw.temperature.main':               'Hot Water Temperature',
  'heating.dhw.sensors.temperature.dhwCylinder':'Hot Water Cylinder Temperature',
  'heating.dhw.temperature.hysteresis':         'Hot Water Hysteresis',
  'heating.dhw.pumps.circulation':              'Hot Water Circulation Pump',
  'heating.circuits.0.temperature':             'Supply Temperature',
  'heating.circuits.0.sensors.temperature.room':'Room Temperature',
  'heating.circuits.0.operating.modes.active':  'Operating Mode',
  'heating.circuits.0.circulation.pump':        'Circulation Pump',
  'heating.circuits.0.heating.curve':           'Heating Curve',
  'heating.burners.0.active':                   'Burner Active',
  'heating.burners.0.modulation':               'Burner Modulation',
  'heating.burners.0.statistics':               'Burner Runtime Stats',
  'heating.sensors.temperature.outside':        'Outside Temperature',
  'heating.power.consumption.summary.currentDay': 'Power Consumption (Today)',
  'device.messages.errors.raw':                 'Active Faults',
};

function humanizeFeatureName(feature) {
  return KNOWN_LABELS[feature] || feature
    .split('.')
    .filter((seg) => !/^\d+$/.test(seg)) // drop numeric circuit/burner/dhw indices
    .join(' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Pick the property that best represents this feature's headline value, and
// derive a store-friendly {value, format, unit} from its self-described type.
function extractPrimaryValue(properties) {
  if (!properties) return null;
  const candidateKeys = ['value', 'active', 'status', 'temperature', 'shift', 'slope'];
  let key = candidateKeys.find((k) => properties[k] != null);
  if (!key) key = Object.keys(properties)[0];
  if (!key) return null;

  const prop = properties[key];
  if (prop == null || prop.value === undefined) return null;

  let value = prop.value;
  let format = 'string';
  let unit;

  if (prop.type === 'boolean') {
    format = 'on-off';
    value = value ? 1 : 0;
  } else if (prop.type === 'number') {
    unit = prop.unit;
    format = unit === 'celsius' ? 'temperature'
      : unit === 'percent'     ? 'percent'
      : unit === 'kilowattHour' ? 'energy'
      : 'number';
  } else if (Array.isArray(value)) {
    // e.g. active fault list — store as JSON so raw display + history stay meaningful
    format = 'string';
    value = JSON.stringify(value);
  }

  return { value, format, unit };
}

class VitodensClient {
  constructor(config, store, sensorRegistry) {
    this.config         = config;
    this.store           = store;
    this.sensorRegistry  = sensorRegistry;
    this.pollTimer       = null;
    this.connected       = false;
    this._oauth          = null;
    this._refreshing     = null;
    this.installationId  = null;
    this.gatewaySerial   = null;
    this.deviceId        = null;
    this.deviceKey       = null;
    this._commandsByFeature = new Map(); // feature name → live commands object (for writes)
    this._registeredSensors  = new Set();
  }

  async start() {
    const cfg = this.config.vitodens || {};
    if (!cfg.clientId) throw new Error('vitodens.clientId missing in config.json');

    try {
      this._oauth = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    } catch {
      throw new Error(`${TOKEN_FILE} missing — run: node scripts/vitodens-auth.js`);
    }
    if (!this._oauth.refresh_token) throw new Error(`${TOKEN_FILE} has no refresh_token — re-run: node scripts/vitodens-auth.js`);

    await this._resolveInstallation(cfg);

    this.deviceKey = `vitodens/${this.deviceId}`;
    this.device = {
      key:    this.deviceKey,
      type:   'vitodens',
      label:  cfg.label || 'Vitodens',
      icon:   '🔥',
      color:  'orange',
      sensors: [],
      _writeCapability: (featureName, commandName, args = []) => this._writeCommand(featureName, commandName, args),
    };
    // Registered before the first poll (with an empty sensor list) — sensors
    // are then appended to this same object by reference as _poll()
    // discovers them, since SensorRegistry has no separate
    // "add a sensor to an already-registered device" method and reads
    // device.sensors fresh off the stored object on every request.
    this.sensorRegistry.registerDevice(this.device);

    await this._poll();
    this.connected = true;
    platformStatus.set('vitodens', true);

    this.pollTimer = setInterval(() => this._poll().catch((err) =>
      console.error(`[Vitodens] Poll failed: ${err.message}`)), POLL_INTERVAL_MS);
    console.log(`[Vitodens] Started — installation ${this.installationId}, gateway ${this.gatewaySerial}, device ${this.deviceId}, polling every ${POLL_INTERVAL_MS / 1000}s`);
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.connected = false;
    console.log('[Vitodens] Stopped');
  }

  // ── Installation / gateway / device resolution ─────────────

  async _resolveInstallation(cfg) {
    if (cfg.installationId && cfg.gatewaySerial && cfg.deviceId) {
      this.installationId = String(cfg.installationId);
      this.gatewaySerial  = String(cfg.gatewaySerial);
      this.deviceId       = String(cfg.deviceId);
      return;
    }

    const res = await this._fetch(`${API_BASE}/v1/equipment/installations?includeGateways=true`);
    const installation = res.data?.[0];
    if (!installation) throw new Error('No Viessmann installations found on this account');
    const gateway = installation.gateways?.[0];
    if (!gateway) throw new Error(`Installation ${installation.id} has no gateways`);
    const device = gateway.devices?.[0];
    if (!device) throw new Error(`Gateway ${gateway.serial} has no devices`);

    this.installationId = String(installation.id);
    this.gatewaySerial  = gateway.serial;
    this.deviceId       = device.id;
  }

  // ── Polling ──────────────────────────────────────────────

  async _poll() {
    const url = `${API_BASE}/v2/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features/`;
    const res = await this._fetch(url);
    const features = res.data ?? [];

    for (const f of features) {
      if (!f.isEnabled) continue;

      if (f.commands && Object.keys(f.commands).length) {
        this._commandsByFeature.set(f.feature, f.commands);
      }

      const extracted = extractPrimaryValue(f.properties);
      if (!extracted) continue;

      if (!this._registeredSensors.has(f.feature)) {
        this._registeredSensors.add(f.feature);
        this._registerSensor(f.feature, extracted);
      }

      this.store.update(`${this.deviceKey}/${f.feature}`, extracted.value);
    }
  }

  _registerSensor(feature, extracted) {
    const sensor = {
      path:   feature,
      name:   humanizeFeatureName(feature),
      label:  humanizeFeatureName(feature),
      sensorType: extracted.format === 'temperature' ? 'temperature'
        : extracted.format === 'on-off' ? 'switch'
        : extracted.format === 'energy' ? 'energy'
        : 'sensor',
      format: extracted.format,
      raw:    extracted.format === 'string',
    };
    if (extracted.unit === 'celsius') sensor.unit = '°C';

    const commands = this._commandsByFeature.get(feature);
    const setCommand = commands && Object.values(commands).find((c) => c.isExecutable && /^set/i.test(c.name));
    if (setCommand) {
      sensor.controllable = true;
      sensor.capabilityId = feature;
      sensor.writeCmd = setCommand.name;
      const numericParam = Object.entries(setCommand.params || {}).find(([, p]) => p.type === 'number');
      if (numericParam) {
        sensor.type = 'range';
        const [, p] = numericParam;
        if (p.constraints?.min != null) sensor.min = p.constraints.min;
        if (p.constraints?.max != null) sensor.max = p.constraints.max;
      }
    }

    this.device.sensors.push(sensor);
  }

  // ── Writes ───────────────────────────────────────────────

  // args: positional values matched against the command's own declared
  // param order (from the live feature response) — never a guessed shape.
  async _writeCommand(featureName, commandName, args = []) {
    const commands = this._commandsByFeature.get(featureName);
    const command = commands?.[commandName];
    if (!command) throw new Error(`Unknown command "${commandName}" for feature "${featureName}" — not present in last poll`);

    const paramNames = Object.keys(command.params || {});
    const body = {};
    paramNames.forEach((name, i) => { if (args[i] !== undefined) body[name] = args[i]; });

    try {
      await this._fetch(command.uri, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (err) {
      console.error(`[Vitodens] Command ${commandName} on ${featureName} failed: ${err.message}`);
    }
  }

  // ── Auth ─────────────────────────────────────────────────

  async _getToken() {
    if (Date.now() > (this._oauth.expires_at || 0) - TOKEN_REFRESH_MARGIN_MS) await this._refreshToken();
    return this._oauth.access_token;
  }

  _refreshToken() {
    if (!this._refreshing) {
      this._refreshing = this._doRefreshToken().finally(() => { this._refreshing = null; });
    }
    return this._refreshing;
  }

  async _doRefreshToken() {
    const clientId = this.config.vitodens.clientId;
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     clientId,
        refresh_token: this._oauth.refresh_token,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Token refresh failed: HTTP ${res.status} ${detail} — if the refresh token expired, re-run scripts/vitodens-auth.js`);
    }
    const t = await res.json();
    this._oauth = {
      access_token:  t.access_token,
      refresh_token: t.refresh_token || this._oauth.refresh_token,
      expires_at:    Date.now() + (t.expires_in || 3600) * 1000,
    };
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(this._oauth, null, 2));
  }

  // ── HTTP ─────────────────────────────────────────────────

  async _fetch(url, options = {}) {
    const doFetch = async () => fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${await this._getToken()}` },
    });
    let res = await doFetch();
    if (res.status === 401) {
      await this._refreshToken();
      res = await doFetch();
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${options.method || 'GET'} ${url}`);
    if (res.status === 204) return null;
    return res.json();
  }
}

module.exports = VitodensClient;
