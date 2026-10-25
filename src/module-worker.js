'use strict';

// One integration client running in its own process, forked by
// src/module-host.js. The client is constructed exactly as it would be in
// server.js — (config, store, sensorRegistry) — but the store and registry
// it gets are stand-ins that forward over IPC to the real ones in the server:
//
//   store.set/update      → the server's DataStore (history, websocket, flows…)
//   registry.registerDevice → the server's SensorRegistry; device._writeCapability
//                           stays here and the server calls it over IPC
//   platform-status       → mirrored into the server's platform bar
//   store 'change' events → only forwarded once the client listens for them
//
// Logging goes to stdout/stderr; the host prints each line through the
// server's console, so it lands in logs/*.log as before.

const { EventEmitter } = require('events');
const path = require('path');

const send = (msg) => { try { if (process.connected) process.send(msg); } catch { /* host gone */ } };

class WorkerStore extends EventEmitter {
  constructor(snapshot) {
    super();
    this.setMaxListeners(200);
    this.data = snapshot || {};
    this._subscribed = false;
    this.on('newListener', (ev) => {
      if (ev === 'change' && !this._subscribed) { this._subscribed = true; send({ t: 'sub' }); }
    });
  }
  update(key, value) {
    const prev = this.data[key];
    this.data[key] = { value, timestamp: Date.now() };
    const changed = !prev || !Object.is(prev.value, value) || (typeof value === 'object' && value !== null);
    send({ t: 'set', k: key, v: value });
    this.emit('change', { key, value, changed });
  }
  set(key, value) { this.update(key, value); }
  // a value changed in the server (another integration, a flow, the dashboard)
  _remote(key, value, timestamp) {
    const prev = this.data[key];
    this.data[key] = { value, timestamp };
    const changed = !prev || !Object.is(prev.value, value) || (typeof value === 'object' && value !== null);
    this.emit('change', { key, value, changed });
  }
  get(key) { return this.data[key]?.value ?? null; }
  getTimestamp(key) { return this.data[key]?.timestamp ?? null; }
  getAll() {
    const out = {};
    for (const [k, v] of Object.entries(this.data)) out[k] = v.value;
    return out;
  }
  getHistory() { return []; }
}

// Device descriptors cross the process boundary as plain data: functions
// (_writeCapability, helpers) stay here, the server gets the rest.
function plain(v, seen = new WeakSet()) {
  if (typeof v === 'function') return undefined;
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date || Buffer.isBuffer(v)) return v;
  if (seen.has(v)) return undefined;
  seen.add(v);
  if (Array.isArray(v)) return v.map((x) => plain(x, seen) ?? null);
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    const p = plain(x, seen);
    if (p !== undefined) out[k] = p;
  }
  return out;
}

class WorkerRegistry extends EventEmitter {
  constructor(store, language) {
    super();
    this.setMaxListeners(100);
    this.store = store;
    this.language = language || 'en';
    this.devices = new Map();
    this._sent = new Map(); // key → JSON last sent, to notice descriptors changed later
  }
  registerDevice(device) {
    if (this.devices.has(device.key)) return;
    this.devices.set(device.key, device);
    this._push(device);
    this.emit('device-discovered', device);
  }
  _push(device) {
    const p = plain(device);
    const json = JSON.stringify(p);
    if (this._sent.get(device.key) === json) return;
    this._sent.set(device.key, json);
    send({ t: 'dev', device: p, writable: typeof device._writeCapability === 'function' });
  }
  // Several clients add sensors or rename a device after registering it —
  // in-process the server saw that through the shared object; here it's resent.
  resync() { for (const d of this.devices.values()) this._push(d); }
  getDevices() { return Array.from(this.devices.values()); }
  getDeviceReadings(key) {
    const device = this.devices.get(key);
    if (!device) return null;
    const readings = {};
    for (const s of device.sensors || []) {
      const value = this.store.get(`${key}/${s.path}`);
      if (value !== null) readings[s.path] = { ...s, value, timestamp: this.store.getTimestamp(`${key}/${s.path}`) };
    }
    return { ...device, readings };
  }
  getAllReadings() { return this.getDevices().map((d) => this.getDeviceReadings(d.key)); }
}

let client = null;
let store = null;
let registry = null;
let stopping = false;

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  try { const r = client?.stop?.(); if (r?.then) r.catch(() => {}); } catch { /* best effort */ }
  setTimeout(() => process.exit(code), 300).unref();
}

process.on('uncaughtException', (err) => {
  console.error(`[Module] Uncaught exception: ${err?.stack || err}`);
  // a crashed integration is restarted by the host's watchdog with a clean state
  shutdown(1);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[Module] Unhandled rejection: ${reason?.stack || reason}`);
});
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('disconnect', () => shutdown(0)); // the server went away

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'init': {
      store = new WorkerStore(msg.snapshot);
      registry = new WorkerRegistry(store, msg.config?.language);
      process.title = `lsh:${msg.file}`;

      // mirror this process's platform-status singleton into the server's
      const platformStatus = require('./platform-status');
      platformStatus.on('change', (all) => send({ t: 'ps', all }));

      try {
        const Client = require(path.resolve(__dirname, msg.file));
        client = new Client(msg.config, store, registry);
      } catch (err) {
        console.error(`[${msg.label}] Load failed: ${String(err?.message || err).split('\n')[0]}`);
        send({ t: 'fatal', error: String(err?.message || err) });
        return shutdown(2);
      }
      send({ t: 'ready' });
      setInterval(() => registry.resync(), 15_000).unref();
      try { await client.start(); }
      catch (err) { console.error(`[${msg.label}] Start failed: ${err?.message || err}`); }
      registry.resync();
      break;
    }
    case 'chg':
      store?._remote(msg.k, msg.v, msg.ts);
      break;
    case 'write': {
      const device = registry?.devices.get(msg.key);
      try {
        if (!device?._writeCapability) throw new Error('Device not found or not writable');
        const value = await device._writeCapability(...(msg.args || []));
        send({ t: 'res', id: msg.id, ok: true, value: plain(value) });
      } catch (err) {
        send({ t: 'res', id: msg.id, ok: false, error: err?.message || String(err) });
      }
      break;
    }
    case 'ping': {
      const m = process.memoryUsage();
      send({ t: 'pong', n: msg.n, rss: m.rss, heap: m.heapUsed });
      break;
    }
    case 'stop':
      shutdown(0);
      break;
  }
});
