'use strict';

// Home Assistant, both ways.
//
//  Import (HA → LSH): connects to HA's WebSocket API with a long-lived access
//  token, mirrors the chosen entities as LSH devices (`ha/<entity_id>`), keeps
//  them live from state_changed events and controls them via call_service.
//
//  Export (LSH → HA): publishes LSH devices to an MQTT broker using Home
//  Assistant MQTT Discovery (`<prefix>/<component>/<node>/<object>/config`),
//  so they appear in HA by themselves; states go to `<base>/<object>/state`,
//  commands come back on `<base>/<object>/set`.
//
//  No loops: HA entities that are LSH's own exports (unique_id `<node>_…`) are
//  never imported, and imported HA devices are never exported.
//
// config.homeassistant = {
//   url: 'http://homeassistant.local:8123', token,
//   import: { enabled = true, domains = [light, switch, cover, climate, lock, fan,
//             sensor, binary_sensor, input_boolean], entities: [] (empty = all in domains) },
//   export: { enabled = false, mqttUrl: 'mqtt://host:1883', username, password,
//             prefix = 'homeassistant', base = 'lsh', node = 'lsh', types: [] (empty = all) },
// }
// Tested against scripts/homeassistant-simulator.js (test/homeassistant.test.js).

const platformStatus = require('./platform-status');

const DEFAULT_DOMAINS = ['light', 'switch', 'cover', 'climate', 'lock', 'fan', 'sensor', 'binary_sensor', 'input_boolean'];
const ICON = { light: '💡', switch: '🔌', cover: '🪟', climate: '🌡️', lock: '🔒', fan: '🌀', sensor: '📈', binary_sensor: '🔘', input_boolean: '🔘' };
const BINARY_HOMEKIT = { motion: 'motion', occupancy: 'motion', presence: 'motion', door: 'contact', window: 'contact', opening: 'contact', garage_door: 'contact' };

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 120);

class HomeAssistantClient {
  // opts.mqttConnect: (url, options) → mqtt client (tests inject a fake)
  constructor(config, store, sensorRegistry, opts = {}) {
    this.opts = opts;
    this.config = config;
    this.cfg = config.homeassistant || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.ws = null;
    this.msgId = 1;
    this.pending = new Map();
    this.entities = new Map(); // entity_id → last HA state object (imported ones)
    this.available = [];       // every HA entity seen (for the settings picker)
    this.status = { import: { connected: false, entities: 0, error: null, version: null }, export: { connected: false, published: 0, error: null } };
    this.stopped = false;
    this.backoff = 2000;
    this.mqtt = null;
    this.exported = new Map(); // objectId → { deviceKey, path, sensor, component }
    this.onStore = null;
  }

  async start() {
    platformStatus.set('homeassistant', false);
    if (this.cfg.url && this.cfg.token && this.cfg.import?.enabled !== false) this._connect();
    if (this.cfg.export?.enabled && this.cfg.export?.mqttUrl) this._startExport();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.republish);
    try { this.ws?.close() } catch {}
    if (this.onStore) this.store.removeListener('change', this.onStore);
    if (this.mqtt) {
      try { this.mqtt.publish(this._availTopic(), 'offline', { retain: true }) } catch {}
      this.mqtt.end(true);
    }
    platformStatus.set('homeassistant', false);
  }

  getStatus() {
    return { ...this.status, importedEntities: [...this.entities.keys()] };
  }

  // ── Import: WebSocket API ──────────────────────────────────────────────────

  _wsUrl() {
    return `${String(this.cfg.url).replace(/\/+$/, '').replace(/^http/, 'ws')}/api/websocket`;
  }

  _connect() {
    if (this.stopped) return;
    let WebSocket;
    try { WebSocket = require('ws') } catch {
      this.status.import.error = 'The ws package is not installed (Home Assistant module)';
      return;
    }
    const ws = new WebSocket(this._wsUrl(), { handshakeTimeout: 10000 });
    this.ws = ws;
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw) } catch { return }
      for (const msg of Array.isArray(m) ? m : [m]) this._onMessage(msg);
    });
    ws.on('error', (err) => { this.status.import.error = err.message });
    ws.on('close', () => {
      this.status.import.connected = false;
      this._updatePlatform();
      for (const p of this.pending.values()) p.reject(new Error('Home Assistant connection closed'));
      this.pending.clear();
      if (this.stopped) return;
      this.retry = setTimeout(() => this._connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 60000);
    });
  }

  _send(msg) {
    const id = this.msgId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Home Assistant: no answer to ${msg.type}`)) }, 15000);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v) }, reject: (e) => { clearTimeout(timer); reject(e) } });
      this.ws.send(JSON.stringify({ id, ...msg }));
    });
  }

  async _onMessage(m) {
    if (m.type === 'auth_required') {
      this.status.import.version = m.ha_version || null;
      this.ws.send(JSON.stringify({ type: 'auth', access_token: this.cfg.token }));
    } else if (m.type === 'auth_invalid') {
      this.status.import.error = 'Home Assistant rejected the access token';
      console.error('[HomeAssistant] Access token rejected');
      this.stopped = true; // don't hammer HA with a bad token
      this.ws.close();
    } else if (m.type === 'auth_ok') {
      this.backoff = 2000;
      this.status.import.error = null;
      try { await this._sync() } catch (err) { this.status.import.error = err.message; console.error(`[HomeAssistant] Sync failed: ${err.message}`) }
    } else if (m.type === 'result') {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.success) p.resolve(m.result); else p.reject(new Error(m.error?.message || 'Home Assistant error'));
    } else if (m.type === 'event' && m.event?.event_type === 'state_changed') {
      const ns = m.event.data?.new_state;
      if (ns && this.entities.has(ns.entity_id)) this._applyState(ns);
    }
  }

  async _sync() {
    const [states, registry] = await Promise.all([
      this._send({ type: 'get_states' }),
      this._send({ type: 'config/entity_registry/list' }).catch(() => []),
    ]);
    const node = this.cfg.export?.node || 'lsh';
    const ownExports = new Set(registry.filter((r) => String(r.unique_id || '').startsWith(`${node}_`)).map((r) => r.entity_id));
    const domains = this.cfg.import?.domains?.length ? this.cfg.import.domains : DEFAULT_DOMAINS;
    const wanted = this.cfg.import?.entities?.length ? new Set(this.cfg.import.entities) : null;
    this.available = states
      .filter((s) => !ownExports.has(s.entity_id))
      .map((s) => ({ entity_id: s.entity_id, name: s.attributes?.friendly_name || s.entity_id, domain: s.entity_id.split('.')[0], state: s.state, unit: s.attributes?.unit_of_measurement || '' }));
    for (const s of states) {
      const domain = s.entity_id.split('.')[0];
      if (ownExports.has(s.entity_id) || !domains.includes(domain)) continue;
      if (wanted && !wanted.has(s.entity_id)) continue;
      if (!this.entities.has(s.entity_id)) this._registerEntity(s);
      this._applyState(s);
    }
    await this._send({ type: 'subscribe_events', event_type: 'state_changed' });
    this.status.import.connected = true;
    this.status.import.entities = this.entities.size;
    this._updatePlatform();
    console.log(`[HomeAssistant] Connected (HA ${this.status.import.version || '?'}) — ${this.entities.size} entities imported${ownExports.size ? `, ${ownExports.size} LSH exports skipped` : ''}`);
  }

  _registerEntity(s) {
    const id = s.entity_id, domain = id.split('.')[0], a = s.attributes || {};
    const name = a.friendly_name || id;
    const sensors = [];
    if (['light', 'switch', 'fan', 'input_boolean'].includes(domain)) {
      sensors.push({ path: 'state', label: 'On', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'state', homekit: domain === 'light' ? 'light' : 'switch' });
      if (domain === 'light' && (a.supported_color_modes || []).some((m) => m !== 'onoff')) {
        sensors.push({ path: 'brightness', label: 'Brightness', unit: '%', controllable: true, type: 'range', min: 0, max: 100, writeCmd: 'set', capabilityId: 'brightness', homekit: null });
      }
    } else if (domain === 'cover') {
      sensors.push({ path: 'position', label: 'Position', unit: '%', controllable: true, type: 'range', min: 0, max: 100, writeCmd: 'set', capabilityId: 'position', homekit: 'windowCovering' });
      sensors.push({ path: 'state', label: 'State', type: 'label', homekit: null });
    } else if (domain === 'climate') {
      sensors.push({ path: 'current_temperature', label: 'Temperature', unit: a.temperature_unit || '°C', sensorType: 'temperature', homekit: 'temperature' });
      sensors.push({ path: 'target_temperature', label: 'Target', unit: '°C', controllable: true, type: 'range', min: a.min_temp ?? 5, max: a.max_temp ?? 35, writeCmd: 'set', capabilityId: 'target_temperature', homekit: null });
      sensors.push({ path: 'hvac_mode', label: 'Mode', type: 'label', homekit: null });
    } else if (domain === 'lock') {
      sensors.push({ path: 'locked', label: 'Locked', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'lock', writeOff: 'unlock', capabilityId: 'locked', homekit: 'lock' });
    } else if (domain === 'binary_sensor') {
      sensors.push({ path: 'state', label: name, format: 'on-off', sensorType: a.device_class || 'binary', homekit: BINARY_HOMEKIT[a.device_class] || null });
    } else {
      const numeric = num(s.state) !== null;
      sensors.push({ path: 'state', label: name, unit: a.unit_of_measurement || '', type: numeric ? undefined : 'label', sensorType: a.device_class || (numeric ? 'value' : 'text'),
        homekit: a.device_class === 'temperature' ? 'temperature' : a.device_class === 'humidity' ? 'humidity' : null });
    }
    this.entities.set(id, s);
    this.registry.registerDevice({
      key: `ha/${id}`, type: 'homeassistant', label: name, icon: ICON[domain] || '🏠', homekit: [], sensors,
      _writeCapability: (capId, command, args) => this._command(id, domain, capId, command, args),
    });
  }

  _applyState(s) {
    const id = s.entity_id, domain = id.split('.')[0], a = s.attributes || {}, k = `ha/${id}`;
    this.entities.set(id, s);
    if (['light', 'switch', 'fan', 'input_boolean'].includes(domain)) {
      this.store.update(`${k}/state`, s.state === 'on' ? 1 : 0);
      if (domain === 'light') this.store.update(`${k}/brightness`, s.state === 'on' && a.brightness != null ? Math.round((a.brightness / 255) * 100) : 0);
    } else if (domain === 'cover') {
      this.store.update(`${k}/position`, num(a.current_position) ?? (s.state === 'open' ? 100 : s.state === 'closed' ? 0 : null));
      this.store.update(`${k}/state`, s.state);
    } else if (domain === 'climate') {
      this.store.update(`${k}/current_temperature`, num(a.current_temperature));
      this.store.update(`${k}/target_temperature`, num(a.temperature));
      this.store.update(`${k}/hvac_mode`, s.state);
    } else if (domain === 'lock') {
      this.store.update(`${k}/locked`, s.state === 'locked' ? 1 : 0);
    } else if (domain === 'binary_sensor') {
      this.store.update(`${k}/state`, s.state === 'on' ? 1 : 0);
    } else {
      this.store.update(`${k}/state`, num(s.state) ?? s.state);
    }
  }

  _command(entityId, domain, capId, command, args = []) {
    if (!this.status.import.connected) throw new Error('Home Assistant is not connected');
    const v = args[0];
    const call = (d, service, data = {}) => this._send({ type: 'call_service', domain: d, service, service_data: { entity_id: entityId, ...data } });
    if (capId === 'state') return call(domain === 'input_boolean' ? 'input_boolean' : domain, command === 'on' ? 'turn_on' : 'turn_off');
    if (capId === 'brightness') return Number(v) > 0 ? call('light', 'turn_on', { brightness_pct: Math.round(Number(v)) }) : call('light', 'turn_off');
    if (capId === 'position') return call('cover', 'set_cover_position', { position: Math.round(Number(v)) });
    if (capId === 'target_temperature') return call('climate', 'set_temperature', { temperature: Number(v) });
    if (capId === 'locked') return call('lock', command === 'lock' ? 'lock' : 'unlock');
    throw new Error(`Unsupported Home Assistant command ${capId}`);
  }

  _updatePlatform() {
    platformStatus.set('homeassistant', !!(this.status.import.connected || this.status.export.connected));
  }

  // ── Export: MQTT Discovery ────────────────────────────────────────────────

  _ex() {
    const e = this.cfg.export || {};
    return { prefix: e.prefix || 'homeassistant', base: e.base || 'lsh', node: slug(e.node || 'lsh'), types: e.types || [] };
  }
  _availTopic() { return `${this._ex().base}/${this._ex().node}/status` }

  // Which sensors are exported, and as what HA component
  exportPlan() {
    const ex = this._ex();
    const plan = [];
    for (const d of this.registry.getDevices()) {
      if (d.type === 'homeassistant') continue; // never mirror HA back into HA
      if (ex.types.length && !ex.types.includes(d.type)) continue;
      for (const s of d.sensors || []) {
        const component = s.controllable
          ? (s.type === 'toggle' ? 'switch' : s.type === 'range' ? 'number' : null)
          : s.format === 'on-off' ? 'binary_sensor' : 'sensor';
        if (!component) continue;
        const objectId = slug(`${ex.node}_${d.key}_${s.path}`);
        plan.push({ objectId, component, deviceKey: d.key, path: s.path, sensor: s, device: d });
      }
    }
    return plan;
  }

  _discoveryConfig(p) {
    const ex = this._ex(), s = p.sensor, d = p.device;
    const cfg = {
      name: s.label || s.path,
      unique_id: p.objectId,
      object_id: p.objectId,
      state_topic: `${ex.base}/${p.objectId}/state`,
      availability_topic: this._availTopic(),
      device: { identifiers: [slug(`${ex.node}_${d.key}`)], name: d.label || d.key, manufacturer: 'LSH', model: d.type || 'device', via_device: ex.node },
    };
    if (s.unit) cfg.unit_of_measurement = s.unit;
    if (p.component === 'switch') Object.assign(cfg, { command_topic: `${ex.base}/${p.objectId}/set`, payload_on: '1', payload_off: '0', state_on: '1', state_off: '0' });
    if (p.component === 'binary_sensor') Object.assign(cfg, { payload_on: '1', payload_off: '0' });
    if (p.component === 'number') Object.assign(cfg, { command_topic: `${ex.base}/${p.objectId}/set`, min: s.min ?? 0, max: s.max ?? 100, step: s.step ?? 1 });
    if (p.component === 'sensor' && /temp/i.test(s.sensorType || s.path) && /C$/.test(s.unit || '')) cfg.device_class = 'temperature';
    return cfg;
  }

  _startExport() {
    const e = this.cfg.export;
    const connect = this.opts.mqttConnect || ((url, o) => require('mqtt').connect(url, o));
    const ex = this._ex();
    const client = connect(e.mqttUrl, {
      username: e.username || undefined, password: e.password || undefined, reconnectPeriod: 5000, connectTimeout: 10000,
      clientId: `lsh-ha-export-${Math.random().toString(16).slice(2, 8)}`,
      will: { topic: this._availTopic(), payload: 'offline', retain: true, qos: 1 },
    });
    this.mqtt = client;
    client.on('connect', () => {
      this.status.export.connected = true; this.status.export.error = null;
      this._updatePlatform();
      client.publish(this._availTopic(), 'online', { retain: true, qos: 1 });
      client.subscribe([`${ex.base}/+/set`, `${ex.prefix}/status`]);
      this._publishAll();
    });
    client.on('error', (err) => { this.status.export.error = err.message });
    client.on('close', () => { this.status.export.connected = false; this._updatePlatform() });
    client.on('message', (topic, payload) => this._onMqtt(topic, payload.toString()));
    // Device list can grow as integrations start — republish now and then
    this.republish = setInterval(() => this.status.export.connected && this._publishAll(), 5 * 60 * 1000);
    this.republish.unref?.();
    this.onStore = ({ key, value }) => {
      const p = this.byKey?.get(key);
      if (p && this.status.export.connected) this.mqtt.publish(`${ex.base}/${p.objectId}/state`, this._payload(value, p), { retain: true });
    };
    this.store.on('change', this.onStore);
  }

  _payload(value, p) {
    if (value === null || value === undefined) return '';
    if (p.component === 'switch' || p.component === 'binary_sensor') return value ? '1' : '0';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  _publishAll() {
    const ex = this._ex();
    const plan = this.exportPlan();
    this.byKey = new Map();
    for (const p of plan) {
      this.exported.set(p.objectId, p);
      this.byKey.set(`${p.deviceKey}/${p.path}`, p);
      this.mqtt.publish(`${ex.prefix}/${p.component}/${ex.node}/${p.objectId}/config`, JSON.stringify(this._discoveryConfig(p)), { retain: true, qos: 1 });
      const v = this.store.get(`${p.deviceKey}/${p.path}`);
      if (v !== null && v !== undefined) this.mqtt.publish(`${ex.base}/${p.objectId}/state`, this._payload(v, p), { retain: true });
    }
    this.status.export.published = plan.length;
  }

  async _onMqtt(topic, payload) {
    const ex = this._ex();
    if (topic === `${ex.prefix}/status`) { if (payload === 'online') this._publishAll(); return }
    const m = topic.match(new RegExp(`^${ex.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^/]+)/set$`));
    const p = m && this.exported.get(m[1]);
    if (!p) return;
    const value = p.component === 'switch' ? payload === '1' || /^(on|true)$/i.test(payload) : Number(payload);
    try { await this.registry.sendCommand(p.deviceKey, p.path, value) }
    catch (err) { console.warn(`[HomeAssistant] Command from HA for ${p.deviceKey}/${p.path} failed: ${err.message}`) }
  }

  // Remove LSH's discovery entries from HA (empty retained configs)
  unpublishAll() {
    if (!this.mqtt) return 0;
    const ex = this._ex();
    for (const p of this.exported.values()) this.mqtt.publish(`${ex.prefix}/${p.component}/${ex.node}/${p.objectId}/config`, '', { retain: true, qos: 1 });
    const n = this.exported.size;
    this.exported.clear();
    return n;
  }

  // Entities HA has (for the settings picker)
  listAvailable() { return this.available }
}

module.exports = HomeAssistantClient;
module.exports.DEFAULT_DOMAINS = DEFAULT_DOMAINS;
