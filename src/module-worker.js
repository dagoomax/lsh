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

// What a client gets as its 4th constructor argument when the host asks for
// it (init.automation — object detection, the LAN monitor; other clients'
// 4th parameter means something else): the parts of the automation engine — notifications, and reading / adding
// flows (object detection's auto-created flows). Calls go to the host's
// engine; `flows` is the host's list at start plus what this process saved.
class WorkerAutomation {
  constructor(flows) { this.flows = Array.isArray(flows) ? flows : []; }
  notify(level, message, source) {
    send({ t: 'notify', level, message: String(message), source: source || null });
    return { level, message, source };
  }
  saveFlow(flow) {
    const p = plain(flow);
    send({ t: 'saveFlow', flow: p });
    const i = this.flows.findIndex((f) => f.id === p.id);
    if (i >= 0) this.flows[i] = p; else this.flows.push(p);
    return p;
  }
}

// Only when forked by the host — required, this file just exports its path
// (and the stand-ins, for tests).
function run() {
  let clients = []; // [{ file, label, client }] — one, or a group sharing this process
  let store = null;
  let registry = null;
  let stopping = false;

  function shutdown(code = 0) {
    if (stopping) return;
    stopping = true;
    for (const { client } of clients) {
      try { const r = client.stop?.(); if (r?.then) r.catch(() => {}); } catch { /* best effort */ }
    }
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
        process.title = `lsh:${msg.file}`; // a group's file is its name

        // mirror this process's platform-status singleton into the server's
        const platformStatus = require('./platform-status');
        platformStatus.on('change', (all) => send({ t: 'ps', all }));
        // camera event log + live detection boxes → the dashboard, via the host
        require('./camera-log').on('entry', (entry) => send({ t: 'camlog', entry }));
        require('./detection-boxes').on('update', (entry) => send({ t: 'boxes', entry: plain(entry) }));

        // init.members: several clients sharing this process (small
        // integrations grouped to save a Node runtime each). One that can't
        // load is skipped; a single client that can't load is fatal (exit 2:
        // the host won't retry).
        const members = msg.members || [{ file: msg.file, label: msg.label, automation: msg.automation }];
        for (const m of members) {
          try {
            const Client = require(path.resolve(__dirname, m.file));
            const client = m.automation
              ? new Client(msg.config, store, registry, new WorkerAutomation(msg.flows))
              : new Client(msg.config, store, registry);
            clients.push({ file: m.file, label: m.label, client });
          } catch (err) {
            console.error(`[${m.label}] Load failed: ${String(err?.message || err).split('\n')[0]}`);
            if (!msg.members) {
              send({ t: 'fatal', error: String(err?.message || err) });
              return shutdown(2);
            }
            send({ t: 'memberFailed', file: m.file, error: String(err?.message || err) });
          }
        }
        send({ t: 'ready' });
        setInterval(() => registry.resync(), 15_000).unref();
        await Promise.all(clients.map(async ({ label, client }) => {
          try { await client.start(); }
          catch (err) { console.error(`[${label}] Start failed: ${err?.message || err}`); }
        }));
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
      // a public method of the client itself (getToken, handleWebhookEvent, …)
      // for hosts whose REST routes used to call the client object directly;
      // msg.member picks one in a group
      case 'call': {
        try {
          const client = (msg.member ? clients.find((c) => c.file === msg.member) : clients[0])?.client;
          if (typeof msg.method !== 'string' || msg.method.startsWith('_') || msg.method === 'constructor'
            || msg.method in Object.prototype || typeof client?.[msg.method] !== 'function') {
            throw new Error(`No method ${msg.method}`);
          }
          const value = await client[msg.method](...(msg.args || []));
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
}

module.exports = { FILE: __filename, WorkerStore, WorkerRegistry, WorkerAutomation };
if (require.main === module) run();
