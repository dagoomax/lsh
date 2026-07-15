/**
 * Samsung SmartThings API client.
 *
 * Discovers devices and polls their status every 30 seconds.
 * Device data is written to the store under smartthings/{deviceId}/{attribute}
 * and devices are registered with SensorRegistry so they appear in the dashboard.
 *
 * Auth, either of:
 *  - OAuth (preferred): `clientId`/`clientSecret` in config + a one-time
 *    `node scripts/smartthings-auth.js` run. Access tokens expire after 24 h;
 *    the client refreshes them automatically and persists the rotated refresh
 *    token in persist/smartthings-oauth.json.
 *  - Personal Access Token (`token`): PATs created after Dec 2024 expire
 *    after 24 h, so this only makes sense for legacy long-lived PATs.
 */

const fs   = require('fs');
const path = require('path');

const platformStatus = require('./platform-status');
const cameraLog      = require('./camera-log');

const BASE_URL  = 'https://api.smartthings.com/v1';
const OAUTH_URL = 'https://api.smartthings.com/oauth/token';
const OAUTH_FILE = path.join(__dirname, '..', 'persist', 'smartthings-oauth.json');
const POLL_INTERVAL_MS = 5000;
// Refresh the access token this long before it actually expires
const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;

// Capability → sensor metadata.
// type: 'toggle' | 'range' | 'color' | 'color-temp' (controls UI rendering)
const CAPABILITIES = {
  switch:                      { storeAttr: 'switch',           name: 'Switch',       sensorType: 'switch',      format: 'on-off',      homekit: 'switch-rw',   controllable: true, type: 'toggle',     writeOn: 'on',                 writeOff: 'off',     capabilityId: 'switch' },
  switchLevel:                 { storeAttr: 'level',            name: 'Brightness',   sensorType: 'dimmer',      format: 'percent',                             controllable: true, type: 'range',      writeCmd: 'setLevel',          capabilityId: 'switchLevel',   min: 0,   max: 100 },
  colorControl:                { storeAttr: 'color',            name: 'Color',        sensorType: 'dimmer',      format: 'color',                               controllable: true, type: 'color', writeCmd: 'setColor', capabilityId: 'colorControl' },
  colorTemperature:            { storeAttr: 'colorTemperature', name: 'Color Temp',   sensorType: 'dimmer',      format: 'color-temp',                          controllable: true, type: 'color-temp', writeCmd: 'setColorTemperature', capabilityId: 'colorTemperature', min: 2700, max: 6500 },
  powerMeter:                  { storeAttr: 'power',            name: 'Power',        sensorType: 'power',       format: 'power' },
  energyMeter:                 { storeAttr: 'energy',           name: 'Energy',       sensorType: 'energy',      format: 'energy' },
  temperatureMeasurement:      { storeAttr: 'temperature',      name: 'Temperature',  sensorType: 'temperature', format: 'temperature', homekit: 'temperature' },
  relativeHumidityMeasurement: { storeAttr: 'humidity',         name: 'Humidity',     sensorType: 'humidity',    format: 'percent',     homekit: 'humidity' },
  battery:                     { storeAttr: 'battery',          name: 'Battery',      sensorType: 'sensor',      format: 'percent',     homekit: 'battery-level' },
  contactSensor:               { storeAttr: 'contact',          name: 'Contact',      sensorType: 'door',        format: 'on-off',      homekit: 'contact' },
  motionSensor:                { storeAttr: 'motion',           name: 'Motion',       sensorType: 'motion',      format: 'on-off',      homekit: 'motion' },
  illuminanceMeasurement:      { storeAttr: 'illuminance',      name: 'Illuminance',  sensorType: 'light',       format: 'number',      homekit: 'lux' },
  thermostatMode:              { storeAttr: 'thermostatMode',          name: 'Mode',             sensorType: 'temperature', format: 'string', raw: true },
  thermostatHeatingSetpoint:   { storeAttr: 'heatingSetpoint',         name: 'Heating Setpoint', sensorType: 'temperature', format: 'temperature', unit: '°C', controllable: true, type: 'range', writeCmd: 'setHeatingSetpoint', capabilityId: 'thermostatHeatingSetpoint', min: 4, max: 38 },
  thermostatCoolingSetpoint:   { storeAttr: 'coolingSetpoint',         name: 'Cooling Setpoint', sensorType: 'temperature', format: 'temperature', unit: '°C', controllable: true, type: 'range', writeCmd: 'setCoolingSetpoint', capabilityId: 'thermostatCoolingSetpoint', min: 10, max: 35 },
  thermostatOperatingState:    { storeAttr: 'thermostatOperatingState',name: 'Operating State',  sensorType: 'temperature', format: 'string', raw: true },
  temperatureSetpoint:         { storeAttr: 'heatingSetpoint',         name: 'Setpoint',         sensorType: 'temperature', format: 'temperature', unit: '°C', controllable: true, type: 'range', writeCmd: 'setHeatingSetpoint', capabilityId: 'temperatureSetpoint', min: 4, max: 38 },
  fanControl:                  { storeAttr: 'switch',           name: 'Fan',          sensorType: 'switch',      format: 'on-off',  homekit: 'fan-rw',   controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'switch' },
  fanSpeed:                    { storeAttr: 'level',            name: 'Fan Speed',    sensorType: 'dimmer',      format: 'percent', controllable: true, type: 'range', writeCmd: 'setFanSpeed', capabilityId: 'fanSpeed', min: 0, max: 100 },
  carbonMonoxideDetector:      { storeAttr: 'carbonMonoxide',   name: 'CO Detector',  sensorType: 'security',    format: 'alarm',       homekit: 'co' },
  smokeDetector:               { storeAttr: 'smoke',            name: 'Smoke',        sensorType: 'security',    format: 'alarm',       homekit: 'smoke' },
  waterSensor:                 { storeAttr: 'water',            name: 'Water Sensor', sensorType: 'security',    format: 'on-off',      homekit: 'leak' },
  presenceSensor:              { storeAttr: 'presence',         name: 'Presence',     sensorType: 'motion',      format: 'on-off',      homekit: 'occupancy' },
  lock:                        { storeAttr: 'lock',             name: 'Lock',         sensorType: 'door',        format: 'on-off',      controllable: true, type: 'toggle',     writeOn: 'lock',               writeOff: 'unlock',  capabilityId: 'lock' },
  doorControl:                 { storeAttr: 'door',             name: 'Door',         sensorType: 'door',        format: 'on-off',      controllable: true, type: 'toggle',     writeOn: 'open',               writeOff: 'close',   capabilityId: 'doorControl' },
  windowShade:                 { storeAttr: 'windowShade',      name: 'Shade',        sensorType: 'shutter',     format: 'on-off',      controllable: true, type: 'toggle',     writeOn: 'open',               writeOff: 'close',   capabilityId: 'windowShade' },
  airQualitySensor:            { storeAttr: 'airQuality',       name: 'Air Quality',  sensorType: 'sensor',      format: 'aqi',         homekit: 'air-quality' },
  carbonDioxideMeasurement:    { storeAttr: 'carbonDioxide',    name: 'CO₂',          sensorType: 'sensor',      format: 'co2',         homekit: 'co2-sensor' },
  tvocMeasurement:             { storeAttr: 'tvocLevel',        name: 'TVOC',         sensorType: 'sensor',      format: 'voc',         homekit: 'air-quality' },
  dustSensor: { sensorType: 'sensor', multi: [
    { storeAttr: 'fineDustLevel', name: 'PM2.5', format: 'pm25' },
    { storeAttr: 'dustLevel',     name: 'PM10',  format: 'pm10' },
  ]},
  soundSensor:  { storeAttr: 'sound',  name: 'Sound Detection', sensorType: 'motion',  format: 'on-off' },
  imageCapture: { storeAttr: 'image',  name: 'Snapshot URL',    sensorType: 'sensor',  format: 'string', raw: true, isCamera: true },
};

function _deriveHomekitTypes(caps) {
  const types = [];

  // ── Controllable device type (mutually exclusive) ──────────
  if (caps.has('thermostatMode') || caps.has('thermostatHeatingSetpoint') || caps.has('temperatureSetpoint')) {
    types.push('thermostat');
  } else if (caps.has('lock')) {
    types.push('lock-rw');
  } else if (caps.has('doorControl')) {
    types.push('door-rw');
  } else if (caps.has('windowShade')) {
    types.push('cover-rw');
  } else if (caps.has('fanControl') || (caps.has('switch') && caps.has('fanSpeed'))) {
    types.push('fan-rw');
  } else if (caps.has('switch')) {
    // Dimmer or colour bulb → Lightbulb; plain switch → Switch
    types.push(caps.has('switchLevel') ? 'light-rw' : 'switch-rw');
  }

  // ── Sensor types (additive) ────────────────────────────────
  if (caps.has('battery'))                     types.push('battery-level');
  if (caps.has('temperatureMeasurement'))      types.push('temperature');
  if (caps.has('relativeHumidityMeasurement')) types.push('humidity');
  if (caps.has('contactSensor'))               types.push('contact');
  if (caps.has('motionSensor'))                types.push('motion');
  if (caps.has('smokeDetector'))               types.push('smoke');
  if (caps.has('carbonMonoxideDetector'))      types.push('co');
  if (caps.has('waterSensor'))                 types.push('leak');
  if (caps.has('presenceSensor'))              types.push('occupancy');
  if (caps.has('illuminanceMeasurement'))      types.push('lux');
  if (caps.has('airQualitySensor') || caps.has('tvocMeasurement') || caps.has('dustSensor')) types.push('air-quality');
  if (caps.has('carbonDioxideMeasurement'))    types.push('co2-sensor');

  return types;
}

function deviceColor(caps) {
  if (caps.has('powerMeter') || caps.has('energyMeter')) return 'solar';
  if (caps.has('temperatureMeasurement'))                return 'orange';
  if (caps.has('battery'))                               return 'battery';
  if (caps.has('switch'))                                return 'blue';
  return 'blue';
}

function deviceIcon(caps) {
  if (caps.has('imageCapture'))                                                                      return '📷';
  if (caps.has('powerMeter') || caps.has('energyMeter'))                                            return '⚡';
  if (caps.has('airQualitySensor') || caps.has('dustSensor') || caps.has('tvocMeasurement') || caps.has('carbonDioxideMeasurement')) return '💨';
  if (caps.has('temperatureMeasurement'))                                                            return '🌡';
  if (caps.has('contactSensor'))                                                                     return '🚪';
  if (caps.has('motionSensor'))                                                                      return '👁';
  if (caps.has('smokeDetector'))                                                                     return '🔥';
  if (caps.has('lock'))                                                                              return '🔒';
  if (caps.has('switch'))                                                                            return '💡';
  if (caps.has('presenceSensor'))                                                                    return '📍';
  return '📟';
}

class SmartThingsClient {
  constructor(config, store, sensorRegistry) {
    this.config           = config;
    this.store            = store;
    this.sensorRegistry   = sensorRegistry;
    this.pollTimer        = null;
    this.connected        = false;
    this.devices          = []; // discovered device descriptors
    this._prevCamState    = new Map(); // tracks prev value for change-detection on camera devices
    this._oauth           = null; // { access_token, refresh_token, expires_at }
    this._refreshing      = null; // in-flight refresh promise (dedupes concurrent refreshes)
  }

  async start() {
    const { token, clientId, clientSecret } = this.config.smartthings;

    if (clientId && clientSecret) {
      try {
        this._oauth = JSON.parse(fs.readFileSync(OAUTH_FILE, 'utf8'));
      } catch {
        throw new Error(`OAuth configured but ${OAUTH_FILE} is missing — run: node scripts/smartthings-auth.js`);
      }
      if (!this._oauth.refresh_token) throw new Error(`${OAUTH_FILE} has no refresh_token — re-run: node scripts/smartthings-auth.js`);
      console.log('[SmartThings] Using OAuth with automatic token refresh');
    } else if (!token) {
      throw new Error('SmartThings needs either clientId+clientSecret (OAuth) or a token (PAT)');
    }

    await this._discoverDevices();
    this.connected = true;
    platformStatus.set('smartthings', true);

    // Try to register webhook for real-time updates
    await this._registerWebhook();

    // Keep polling as fallback (longer interval for redundancy)
    this.pollTimer = setInterval(() => this._pollAll(), POLL_INTERVAL_MS);
    console.log(`[SmartThings] Started — ${this.devices.length} device(s), polling every ${POLL_INTERVAL_MS / 1000}s`);
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.connected = false;
    console.log('[SmartThings] Stopped');
  }

  // Handle webhook events from SmartThings (called by API route)
  handleWebhookEvent(payload) {
    if (!payload?.events) return;

    for (const event of payload.events) {
      const { deviceId, componentId = 'main', capability, value } = event;
      const device = this.devices.find(d => d.instance === deviceId);
      if (!device) continue;

      const def = CAPABILITIES[capability];
      if (!def) continue;

      if (def.type === 'color') {
        // Handle color capability
        if (capability === 'colorControl') {
          if (value?.hue?.value != null) this.store.update(`${device.key}/hue`, value.hue.value);
          if (value?.saturation?.value != null) this.store.update(`${device.key}/saturation`, value.saturation.value);
        }
        continue;
      }

      if (def.multi) {
        // Multi-attribute capability
        for (const m of def.multi) {
          if (value?.[m.storeAttr] != null) {
            this.store.update(`${device.key}/${m.storeAttr}`, value[m.storeAttr]);
          }
        }
        continue;
      }

      if (!def.storeAttr) continue;

      let val = value?.value;
      if (val == null) continue;

      // Normalise string state values to 1/0
      if (!def.raw && typeof val === 'string') {
        if (['on', 'open', 'active', 'present', 'unlocked', 'detected'].includes(val)) val = 1;
        else if (['off', 'closed', 'inactive', 'not present', 'locked', 'clear', 'not detected'].includes(val)) val = 0;
      }

      this.store.update(`${device.key}/${def.storeAttr}`, val);
    }
  }

  // ── Webhooks ─────────────────────────────────────────────

  async _registerWebhook() {
    try {
      const webhookUrl = this.config.smartthings?.webhookUrl;
      if (!webhookUrl) {
        console.log('[SmartThings] Webhook URL not configured — real-time updates disabled');
        return;
      }

      // List existing webhooks to avoid duplicates
      const existing = await this._get('/installedapps/subscriptions');
      const hasWebhook = existing?.items?.some(w => w.targetUrl === webhookUrl);

      if (hasWebhook) {
        console.log('[SmartThings] Webhook already registered');
        return;
      }

      // Register webhook for all device events
      await this._post('/installedapps/subscriptions', {
        sourceId: 'smartthings',
        capability: '*',
        value: '*',
        subscriptionName: 'lsh-realtime-sync',
        targetUrl: webhookUrl,
      });

      console.log('[SmartThings] Webhook registered for real-time state sync');
    } catch (err) {
      console.warn(`[SmartThings] Webhook registration failed: ${err.message} — falling back to polling`);
    }
  }

  // ── Discovery ────────────────────────────────────────────

  async _discoverDevices() {
    const raw = await this._get('/devices');
    const items = raw?.items ?? [];

    const filter = new Set(this.config.smartthings.deviceIds ?? []);

    for (const item of items) {
      if (filter.size && !filter.has(item.deviceId)) continue;

      const caps = new Set(
        (item.components ?? []).flatMap((c) => c.capabilities?.map((x) => x.id) ?? [])
      );

      const sensors = [];
      for (const [capId, def] of Object.entries(CAPABILITIES)) {
        if (!caps.has(capId)) continue;

        if (def.type === 'color') {
          sensors.push({ path: 'hue',        name: 'Hue',        sensorType: 'dimmer', format: 'number', hidden: true });
          sensors.push({ path: 'saturation', name: 'Saturation', sensorType: 'dimmer', format: 'number', hidden: true });
          sensors.push({ path: 'color',      name: def.name,     sensorType: 'dimmer', format: 'color',  controllable: true, type: 'color', capabilityId: def.capabilityId });
          continue;
        }

        if (def.multi) {
          for (const m of def.multi) sensors.push({ path: m.storeAttr, name: m.name, sensorType: def.sensorType || 'sensor', format: m.format });
          continue;
        }

        const sensor = { path: def.storeAttr, name: def.name, label: def.name, sensorType: def.sensorType || 'sensor', format: def.format };
        if (def.homekit)       sensor.homekit      = def.homekit;
        if (def.controllable)  sensor.controllable = true;
        if (def.type)          sensor.type         = def.type;
        if (def.writeOn)       sensor.writeOn      = def.writeOn;
        if (def.writeOff)      sensor.writeOff     = def.writeOff;
        if (def.writeCmd)      sensor.writeCmd     = def.writeCmd;
        if (def.capabilityId)  sensor.capabilityId = def.capabilityId;
        if (def.min != null)   sensor.min          = def.min;
        if (def.max != null)   sensor.max          = def.max;
        sensors.push(sensor);
      }

      if (sensors.length === 0) continue;

      // Determine HomeKit types — order matters: specific types take precedence over generic switch
      const homekitTypes = _deriveHomekitTypes(caps);

      const deviceId = item.deviceId;
      const device = {
        key:       `smartthings/${deviceId}`,
        type:      'smartthings',
        instance:  deviceId,
        label:     item.label || item.name || deviceId,
        icon:      deviceIcon(caps),
        color:     deviceColor(caps),
        sensors,
        homekit:   homekitTypes,
        _caps:     caps,
        _isCamera: caps.has('imageCapture'),
        _writeCapability: (capId, command, args = []) => this._writeDevice(deviceId, capId, command, args),
      };

      this.devices.push(device);
      this.sensorRegistry.registerDevice(device);
    }

    // Fetch initial values
    await this._pollAll();
  }

  // ── Polling ──────────────────────────────────────────────

  async _pollAll() {
    await Promise.allSettled(this.devices.map((d) => this._pollDevice(d)));
  }

  async _pollDevice(device) {
    const id = device.instance;
    let status;
    try {
      status = await this._get(`/devices/${id}/status`);
    } catch (err) {
      console.error(`[SmartThings] Poll failed for ${device.label}: ${err.message}`);
      return;
    }

    const main = status?.components?.main ?? {};

    for (const [capId, def] of Object.entries(CAPABILITIES)) {
      if (!device._caps.has(capId)) continue;

      if (def.type === 'color') {
        const hue = main[capId]?.hue?.value;
        const sat = main[capId]?.saturation?.value;
        if (hue != null) this.store.update(`${device.key}/hue`, hue);
        if (sat != null) this.store.update(`${device.key}/saturation`, sat);
        continue;
      }

      if (def.multi) {
        for (const m of def.multi) {
          const v = main[capId]?.[m.storeAttr]?.value;
          if (v != null) this.store.update(`${device.key}/${m.storeAttr}`, v);
        }
        continue;
      }

      if (!def.storeAttr) continue;
      const attrData = main[capId]?.[def.storeAttr];
      if (attrData == null) continue;

      let value = attrData.value;
      if (value == null) continue;

      // Normalise string state values to 1/0 (skip raw: true attributes like thermostat mode)
      if (!def.raw && typeof value === 'string') {
        if (['on', 'open', 'active', 'present', 'unlocked', 'detected'].includes(value)) value = 1;
        else if (['off', 'closed', 'inactive', 'not present', 'locked', 'clear', 'not detected'].includes(value)) value = 0;
      }

      this.store.update(`${device.key}/${def.storeAttr}`, value);

      // Push camera events on state transitions (0→1 for motion/sound, URL change for snapshot)
      if (device._isCamera) {
        const stateKey = `${device.key}/${def.storeAttr}`;
        const prev     = this._prevCamState.get(stateKey);
        if (value !== prev) {
          this._prevCamState.set(stateKey, value);
          if (value === 1 && def.storeAttr === 'motion') cameraLog.push(device.label, 'motion');
          if (value === 1 && def.storeAttr === 'sound')  cameraLog.push(device.label, 'sound');
          if (def.storeAttr === 'image' && typeof value === 'string' && value.startsWith('http')) {
            cameraLog.push(device.label, 'snapshot', value);
          }
        }
      }
    }
  }

  // ── Auth ─────────────────────────────────────────────────

  // Current valid bearer token (refreshes OAuth access token when near expiry).
  // Also used by the camera routes in api-routes.js.
  async getToken() {
    if (!this._oauth) return this.config.smartthings.token;
    if (Date.now() > (this._oauth.expires_at || 0) - TOKEN_REFRESH_MARGIN_MS) await this._refreshToken();
    return this._oauth.access_token;
  }

  _refreshToken() {
    // Dedupe: pollers fire every 5 s, but only one refresh may run at a time
    // (SmartThings rotates the refresh token on every use)
    if (!this._refreshing) {
      this._refreshing = this._doRefreshToken().finally(() => { this._refreshing = null; });
    }
    return this._refreshing;
  }

  async _doRefreshToken() {
    const { clientId, clientSecret } = this.config.smartthings;
    const res = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     clientId,
        refresh_token: this._oauth.refresh_token,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OAuth refresh failed: HTTP ${res.status} ${detail} — if the refresh token expired (30 days unused), re-run scripts/smartthings-auth.js`);
    }
    const t = await res.json();
    this._oauth = {
      access_token:  t.access_token,
      refresh_token: t.refresh_token || this._oauth.refresh_token,
      expires_at:    Date.now() + (t.expires_in || 86400) * 1000,
    };
    fs.writeFileSync(OAUTH_FILE, JSON.stringify(this._oauth, null, 2));
    console.log(`[SmartThings] Access token refreshed — valid until ${new Date(this._oauth.expires_at).toISOString()}`);
  }

  // ── HTTP ─────────────────────────────────────────────────

  async _fetch(path, options = {}) {
    const doFetch = async () => fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${await this.getToken()}` },
    });
    let res = await doFetch();
    // Stale access token (e.g. revoked or clock skew) → force one refresh and retry
    if (res.status === 401 && this._oauth) {
      await this._refreshToken();
      res = await doFetch();
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${options.method || 'GET'} ${path}`);
    return res.json();
  }

  async _get(path) {
    return this._fetch(path);
  }

  async _post(path, body) {
    return this._fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async _writeDevice(deviceId, capability, command, args = []) {
    try {
      await this._post(`/devices/${deviceId}/commands`, {
        commands: [{ component: 'main', capability, command, arguments: args }],
      });
    } catch (err) {
      console.error(`[SmartThings] Write failed for ${deviceId}: ${err.message}`);
    }
  }
}

module.exports = SmartThingsClient;
