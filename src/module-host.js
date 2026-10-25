'use strict';

// Runs integration clients (src/integrations.js) each in its own child
// process (src/module-worker.js) and keeps them alive:
//
//   - a module that crashes is restarted, with backoff (2 s doubling to 2 min;
//     reset once it has stayed up 5 min)
//   - the watchdog pings every module every 10 s; one that hasn't answered for
//     30 s (event loop stuck) is killed and restarted
//   - one whose memory grows past config.modules.memoryLimitMB (default 512)
//     is restarted the same way
//
// The server side of each module is just data: its devices are registered
// in the real SensorRegistry with a _writeCapability that forwards the
// command to the process, its store values are set in the real DataStore,
// its platform-status flags are mirrored. Restarting a module therefore
// doesn't touch anything else — the dashboard keeps the last values and
// devices, which refresh as soon as the new process reports again.

const { fork } = require('child_process');
const path = require('path');
const readline = require('readline');
const platformStatus = require('./platform-status');
const { translateDevice } = require('./server-i18n');

const WORKER = require('./module-worker').FILE;
const PING_EVERY = 10_000;
const HANG_AFTER = 30_000;
const BACKOFF_MIN = 2_000;
const BACKOFF_MAX = 120_000;
const STABLE_AFTER = 5 * 60_000;
const COMMAND_TIMEOUT = 30_000;

class ModuleProcess {
  constructor(host, it) {
    this.host = host;
    this.it = it;
    this.id = it.file;
    this.child = null;
    this.state = 'stopped';
    this.restarts = 0;
    this.startedAt = null;
    this.lastExit = null;
    this.lastPong = 0;
    this.rss = null;
    this.heap = null;
    this.devices = new Set();
    this.platforms = new Set();
    this.subscribed = false;
    this._pending = new Map();
    this._seq = 0;
    this._backoff = BACKOFF_MIN;
    this._restartTimer = null;
    this._wanted = false;
  }

  start() {
    this._wanted = true;
    if (this.child) return;
    clearTimeout(this._restartTimer);
    const { config, store } = this.host;
    const child = fork(WORKER, [this.id], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'advanced', // structured clone: Buffers, Dates, Maps survive
      execArgv: [],
      env: { ...process.env, LSH_MODULE: this.id },
    });
    this.child = child;
    this.state = 'starting';
    this.startedAt = Date.now();
    this.lastPong = Date.now();
    this.subscribed = false;
    this.fatal = null;

    // the module's own lines go through the server console → logs/*.log
    readline.createInterface({ input: child.stdout }).on('line', (l) => l && console.log(l));
    readline.createInterface({ input: child.stderr }).on('line', (l) => l && console.error(l));

    child.on('message', (msg) => this._onMessage(msg));
    child.on('error', (err) => console.error(`[Modules] ${this.it.label}: ${err.message}`));
    child.on('exit', (code, signal) => this._onExit(code, signal));
    child.send({ t: 'init', file: this.id, label: this.it.label, config, snapshot: store.data });
    console.log(`[Modules] ${this.it.label} started (pid ${child.pid})`);
  }

  stop() {
    this._wanted = false;
    clearTimeout(this._restartTimer);
    const child = this.child;
    if (!child) { this.state = 'stopped'; return Promise.resolve(); }
    return new Promise((resolve) => {
      const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.once('exit', () => { clearTimeout(kill); resolve(); });
      try { child.send({ t: 'stop' }); } catch { child.kill('SIGTERM'); }
    });
  }

  async restart(reason = 'manual') {
    console.log(`[Modules] ${this.it.label} restarting (${reason})`);
    await this.stop();
    this._backoff = BACKOFF_MIN;
    this.start();
  }

  // ask the process to run one of its devices' _writeCapability
  write(key, args) {
    if (!this.child || this.state !== 'running') {
      return Promise.reject(new Error(`${this.it.label} is not running (${this.state})`));
    }
    const id = ++this._seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`${this.it.label} did not answer the command in time`));
      }, COMMAND_TIMEOUT);
      this._pending.set(id, { resolve, reject, timer });
      this.child.send({ t: 'write', id, key, args });
    });
  }

  ping() {
    if (!this.child) return;
    if (Date.now() - this.lastPong > HANG_AFTER) {
      console.error(`[Modules] ${this.it.label} not responding for ${Math.round((Date.now() - this.lastPong) / 1000)} s — killing it`);
      this.lastExit = { at: Date.now(), reason: 'hung' };
      this.child.kill('SIGKILL');
      return;
    }
    const limit = this.host.memoryLimit;
    if (limit && this.rss > limit) {
      console.error(`[Modules] ${this.it.label} uses ${Math.round(this.rss / 1048576)} MB (limit ${Math.round(limit / 1048576)} MB) — restarting it`);
      this.lastExit = { at: Date.now(), reason: 'memory' };
      this.child.kill('SIGKILL');
      return;
    }
    try { this.child.send({ t: 'ping', n: Date.now() }); } catch { /* exit handler follows */ }
  }

  _onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    const { store } = this.host;
    switch (msg.t) {
      case 'set':
        this.host._from = this;
        try { store.update(msg.k, msg.v); } finally { this.host._from = null; }
        break;
      case 'dev':
        this._device(msg.device, msg.writable);
        break;
      case 'ps':
        for (const [name, ok] of Object.entries(msg.all || {})) {
          this.platforms.add(name);
          platformStatus.set(name, ok);
        }
        break;
      case 'sub':
        this.subscribed = true;
        break;
      case 'ready':
        this.state = 'running';
        break;
      case 'pong':
        this.lastPong = Date.now();
        this.rss = msg.rss;
        this.heap = msg.heap;
        break;
      case 'res': {
        const p = this._pending.get(msg.id);
        if (!p) break;
        this._pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.value); else p.reject(new Error(msg.error));
        break;
      }
      case 'fatal':
        this.fatal = msg.error;
        break;
    }
  }

  _device(d, writable) {
    const reg = this.host.sensorRegistry;
    this.devices.add(d.key);
    const existing = reg.devices.get(d.key);
    const write = writable ? (...args) => this.write(d.key, args) : undefined;
    if (!existing) {
      if (write) d._writeCapability = write;
      reg.registerDevice(d);
      return;
    }
    // re-sent after the module changed it, or after a restart: refresh in
    // place (other parts of the server hold this object) and put the
    // dashboard's customisations — room, label, plan position — back on top
    Object.assign(existing, d);
    translateDevice(existing, reg.language);
    reg._applyOverride(existing);
    if (write) existing._writeCapability = write;
    reg.emit('devices-changed');
  }

  _onExit(code, signal) {
    this.child = null;
    for (const p of this._pending.values()) { clearTimeout(p.timer); p.reject(new Error(`${this.it.label} stopped`)); }
    this._pending.clear();
    for (const name of this.platforms) platformStatus.set(name, false);
    const uptime = Date.now() - (this.startedAt || Date.now());
    if (!this.lastExit || this.lastExit.at < this.startedAt) {
      this.lastExit = { at: Date.now(), reason: signal ? `signal ${signal}` : `exit ${code}` };
    }
    this.lastExit.code = code;
    this.lastExit.signal = signal;
    if (!this._wanted || this.host.stopping) { this.state = 'stopped'; return; }
    // couldn't even load (missing file / npm package): retrying won't help
    if (code === 2 && this.fatal) {
      this.state = 'failed';
      console.error(`[Modules] ${this.it.label} can't load — not restarting: ${this.fatal.split('\n')[0]}`);
      return;
    }
    if (uptime > STABLE_AFTER) this._backoff = BACKOFF_MIN;
    const delay = this._backoff;
    this._backoff = Math.min(this._backoff * 2, BACKOFF_MAX);
    this.restarts++;
    this.state = 'restarting';
    console.error(`[Modules] ${this.it.label} exited (${this.lastExit.reason}) after ${Math.round(uptime / 1000)} s — restart in ${delay / 1000} s`);
    this._restartTimer = setTimeout(() => this.start(), delay);
  }

  info() {
    return {
      id: this.id,
      label: this.it.label,
      state: this.state,
      pid: this.child?.pid || null,
      uptime: this.child && this.startedAt ? Date.now() - this.startedAt : 0,
      restarts: this.restarts,
      lastExit: this.lastExit,
      rss: this.rss,
      heap: this.heap,
      devices: this.devices.size,
      error: this.state === 'failed' ? this.fatal : undefined,
    };
  }
}

class ModuleHost {
  constructor(config, store, sensorRegistry) {
    this.config = config;
    this.store = store;
    this.sensorRegistry = sensorRegistry;
    this.modules = new Map();
    this.stopping = false;
    this._from = null;
    const mb = Number(config.modules?.memoryLimitMB ?? 512);
    this.memoryLimit = mb > 0 ? mb * 1048576 : 0;

    // values set anywhere else (other modules, flows, the dashboard) reach
    // the modules that listen for store changes
    store.on('change', ({ key, value }) => {
      for (const m of this.modules.values()) {
        if (!m.subscribed || !m.child || m === this._from) continue;
        try { m.child.send({ t: 'chg', k: key, v: value, ts: store.getTimestamp(key) }); } catch { /* exiting */ }
      }
    });

    this._watchdog = setInterval(() => { for (const m of this.modules.values()) m.ping(); }, PING_EVERY);
    this._watchdog.unref();

    const onSignal = () => { this.stopping = true; for (const m of this.modules.values()) m.child?.kill('SIGTERM'); };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    process.on('exit', () => { for (const m of this.modules.values()) m.child?.kill('SIGKILL'); });
  }

  add(it) {
    const m = new ModuleProcess(this, it);
    this.modules.set(m.id, m);
    m.start();
    return m;
  }

  get(id) { return this.modules.get(id); }
  list() { return [...this.modules.values()].map((m) => m.info()); }
  async stopAll() { this.stopping = true; await Promise.all([...this.modules.values()].map((m) => m.stop())); }
}

module.exports = ModuleHost;
