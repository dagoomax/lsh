#!/usr/bin/env node
'use strict';

// Minimal Home Assistant stand-in for testing src/homeassistant-client.js:
// the /api/websocket API (auth, get_states, config/entity_registry/list,
// config/device_registry/list, config/area_registry/list, subscribe_events,
// call_service) with a handful of entities whose state changes when services
// are called, plus a Z-Wave-style device whose entities are named only
// through the registries (renameDevice() fires device_registry_updated).
//
//   node scripts/homeassistant-simulator.js [port=8123] [token=sim-token]
//
// Also usable from tests: const sim = await startSimulator({ port: 0 }).

const http = require('http');
const WebSocket = require('ws');

function initialStates() {
  const now = new Date().toISOString();
  const e = (entity_id, state, attributes) => ({ entity_id, state, attributes, last_changed: now, last_updated: now, context: { id: 'sim' } });
  return [
    e('light.kitchen', 'on', { friendly_name: 'Kitchen light', brightness: 128, supported_color_modes: ['brightness'], color_mode: 'brightness' }),
    e('switch.garden_pump', 'off', { friendly_name: 'Garden pump' }),
    e('cover.living_room', 'open', { friendly_name: 'Living room blind', current_position: 70 }),
    e('climate.office', 'heat', { friendly_name: 'Office', current_temperature: 20.5, temperature: 21, min_temp: 7, max_temp: 30, temperature_unit: '°C' }),
    e('lock.front_door', 'locked', { friendly_name: 'Front door' }),
    e('sensor.outdoor_temperature', '12.4', { friendly_name: 'Outdoor temperature', unit_of_measurement: '°C', device_class: 'temperature' }),
    e('binary_sensor.hall_motion', 'off', { friendly_name: 'Hall motion', device_class: 'motion' }),
    e('camera.front_door', 'idle', { friendly_name: 'Front door camera', supported_features: 2, entity_picture: '/api/camera_proxy/camera.front_door?token=x' }),
    // Z-Wave-style entities restored before the integration loaded: no friendly_name
    e('cover.roller_shutter_3', 'open', { current_position: 100 }),
    e('sensor.roller_shutter_3_electric_consumption_w', '0', { unit_of_measurement: 'W', device_class: 'power' }),
    // An entity LSH itself exported over MQTT Discovery — must not be imported back
    e('switch.lsh_shelly_1_relay0', 'on', { friendly_name: 'Shelly relay (from LSH)' }),
  ];
}

function startSimulator({ port = 8123, token = 'sim-token', haVersion = '2026.10.0' } = {}) {
  const states = new Map(initialStates().map((s) => [s.entity_id, s]));
  const registry = [
    ...[...states.keys()].map((id) => ({ entity_id: id, unique_id: `sim_${id}`, platform: 'demo' })),
  ];
  registry.find((r) => r.entity_id === 'switch.lsh_shelly_1_relay0').unique_id = 'lsh_shelly_1_relay0';
  registry.find((r) => r.entity_id === 'switch.lsh_shelly_1_relay0').platform = 'mqtt';
  const areas = [{ area_id: 'jadalnia', name: 'Jadalnia' }, { area_id: 'salon', name: 'Salon' }];
  const devices = [{ id: 'dev_roller', name: 'Roller Shutter 3', name_by_user: 'Roleta Jadalnia', model: 'FGR-223', area_id: 'jadalnia', identifiers: [['zwave_js', '3967862325-19']] }];
  Object.assign(registry.find((r) => r.entity_id === 'cover.roller_shutter_3'), { platform: 'zwave_js', device_id: 'dev_roller', has_entity_name: true, original_name: null, name: null, area_id: null });
  Object.assign(registry.find((r) => r.entity_id === 'sensor.roller_shutter_3_electric_consumption_w'), { platform: 'zwave_js', device_id: 'dev_roller', has_entity_name: true, original_name: 'Electric consumption [W]', name: null, area_id: null });
  const calls = [];
  const subscribers = new Set();

  // 1×1 JPEG
  const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
  const server = http.createServer((req, res) => {
    const cam = req.url.match(/^\/api\/camera_proxy(_stream)?\/([^?]+)/);
    if (cam) {
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); return res.end() }
      if (!states.has(decodeURIComponent(cam[2])) || !cam[2].startsWith('camera.')) { res.writeHead(404); return res.end() }
      if (!cam[1]) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(JPEG) }
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace;boundary=frame' });
      const frame = () => res.write(Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${JPEG.length}\r\n\r\n`), JPEG, Buffer.from('\r\n')]));
      frame();
      const t = setInterval(frame, 200);
      return req.on('close', () => clearInterval(t));
    }
    if (req.url === '/api/' && req.headers.authorization === `Bearer ${token}`) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"message":"API running."}') }
    res.writeHead(401); res.end();
  });
  const wss = new WebSocket.Server({ server, path: '/api/websocket' });

  function emit(event_type, data) {
    for (const sub of subscribers) {
      if (sub.event_type && sub.event_type !== event_type) continue;
      if (sub.ws.readyState === WebSocket.OPEN) sub.ws.send(JSON.stringify({ id: sub.id, type: 'event', event: { event_type, data } }));
    }
  }

  function renameDevice(id, changes) {
    Object.assign(devices.find((d) => d.id === id), changes);
    emit('device_registry_updated', { action: 'update', device_id: id, changes: Object.keys(changes) });
  }

  function setState(id, state, attrs = {}) {
    const old = states.get(id);
    const ns = { ...old, state, attributes: { ...old.attributes, ...attrs }, last_updated: new Date().toISOString() };
    states.set(id, ns);
    emit('state_changed', { entity_id: id, old_state: old, new_state: ns });
  }

  function callService(domain, service, data) {
    const id = data.entity_id;
    const s = states.get(id);
    if (!s) throw new Error(`Entity ${id} not found`);
    calls.push({ domain, service, data });
    if (service === 'turn_on') setState(id, 'on', domain === 'light' && data.brightness_pct != null ? { brightness: Math.round(data.brightness_pct * 2.55) } : {});
    else if (service === 'turn_off') setState(id, 'off');
    else if (service === 'set_cover_position') setState(id, data.position > 0 ? 'open' : 'closed', { current_position: data.position });
    else if (service === 'set_temperature') setState(id, s.state, { temperature: data.temperature });
    else if (service === 'lock') setState(id, 'locked');
    else if (service === 'unlock') setState(id, 'unlocked');
    else throw new Error(`Service ${domain}.${service} not found`);
  }

  wss.on('connection', (ws) => {
    let authed = false;
    ws.send(JSON.stringify({ type: 'auth_required', ha_version: haVersion }));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw) } catch { return }
      if (!authed) {
        if (m.type === 'auth' && m.access_token === token) { authed = true; ws.send(JSON.stringify({ type: 'auth_ok', ha_version: haVersion })) }
        else { ws.send(JSON.stringify({ type: 'auth_invalid', message: 'Invalid access token or password' })); ws.close() }
        return;
      }
      const ok = (result = null) => ws.send(JSON.stringify({ id: m.id, type: 'result', success: true, result }));
      const fail = (message) => ws.send(JSON.stringify({ id: m.id, type: 'result', success: false, error: { code: 'error', message } }));
      if (m.type === 'get_states') ok([...states.values()]);
      else if (m.type === 'config/entity_registry/list') ok(registry);
      else if (m.type === 'config/device_registry/list') ok(devices);
      else if (m.type === 'config/area_registry/list') ok(areas);
      else if (m.type === 'subscribe_events') { subscribers.add({ ws, id: m.id, event_type: m.event_type || null }); ok() }
      else if (m.type === 'call_service') { try { callService(m.domain, m.service, m.service_data || {}); ok({ context: { id: 'sim' } }) } catch (err) { fail(err.message) } }
      else if (m.type === 'ping') ws.send(JSON.stringify({ id: m.id, type: 'pong' }));
      else fail(`Unknown command ${m.type}`);
    });
    ws.on('close', () => { for (const s of subscribers) if (s.ws === ws) subscribers.delete(s) });
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    resolve({
      port: server.address().port, states, calls, setState, renameDevice, devices,
      close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(); server.close(() => r()) }),
    });
  }));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8123;
  const token = process.argv[3] || 'sim-token';
  startSimulator({ port, token }).then((s) => console.log(`Home Assistant simulator on http://127.0.0.1:${s.port} (token: ${token})`));
}

module.exports = { startSimulator };
