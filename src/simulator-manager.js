'use strict';

const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');

// Runs the bundled hardware simulators (scripts/*-simulator.js) as child
// processes, per config.simulators — so a dev install can enable them without
// PM2/extra terminals, and disable them again at runtime.
//
// config.simulators = {
//   grenton: true,                        // enabled on default port
//   hue:     { enabled: true, port: 8180 },
//   miele:   false,
// }
//
// Toggled live via GET /api/simulators + POST /api/simulators/:name
// { enabled } (persisted back to config.json by the route). A simulator that
// exits unexpectedly is restarted after 5 s while it stays enabled.

const CATALOG = {
  grenton: { script: 'grenton-simulator.js', port: 8199,  desc: 'Grenton GATE (HTTP)' },
  miele:   { script: 'miele-simulator.js',   port: 8299,  desc: 'Miele API (HTTP + SSE)' },
  ampio:   { script: 'ampio-simulator.js',   port: 1884,  desc: 'Ampio M-SERV (MQTT broker)' },
  aqara:   { script: 'aqara-simulator.js',   port: 19898, desc: 'Aqara gateway (UDP)' },
  hue:     { script: 'hue-simulator.js',     port: 8180,  desc: 'Hue bridge (HTTP)' },
};

function normalize(entry) {
  if (entry === true)  return { enabled: true };
  if (!entry)          return { enabled: false };
  return { enabled: !!entry.enabled, port: entry.port };
}

class SimulatorManager {
  constructor(config) {
    this._cfg   = config.simulators || {};
    this._procs = new Map();   // name → child process
  }

  start() {
    for (const name of Object.keys(CATALOG)) {
      if (normalize(this._cfg[name]).enabled) this._spawn(name);
    }
  }

  stop() {
    for (const name of [...this._procs.keys()]) this._kill(name);
  }

  list() {
    return Object.entries(CATALOG).map(([name, meta]) => {
      const cfg  = normalize(this._cfg[name]);
      const proc = this._procs.get(name);
      return {
        name,
        description: meta.desc,
        script:      `scripts/${meta.script}`,
        port:        cfg.port || meta.port,
        enabled:     cfg.enabled,
        running:     !!proc,
        pid:         proc?.pid,
      };
    });
  }

  // Toggle at runtime; the caller persists config.simulators to config.json.
  setEnabled(name, enabled, port) {
    if (!CATALOG[name]) throw new Error(`Unknown simulator: ${name}`);
    const prev = normalize(this._cfg[name]);
    this._cfg[name] = { enabled: !!enabled, ...(port || prev.port ? { port: port || prev.port } : {}) };
    if (enabled) { if (!this._procs.has(name)) this._spawn(name); }
    else this._kill(name);
    return this.list().find((s) => s.name === name);
  }

  _spawn(name) {
    const meta   = CATALOG[name];
    const script = path.join(__dirname, '..', 'scripts', meta.script);
    if (!fs.existsSync(script)) return console.error(`[Simulators] Missing ${script}`);
    const port = normalize(this._cfg[name]).port || meta.port;

    const proc = spawn(process.execPath, [script, String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    this._procs.set(name, proc);
    console.log(`[Simulators] Started ${name} on :${port} (pid ${proc.pid})`);

    const relay = (line) => line && console.log(`[sim:${name}] ${line}`);
    proc.stdout.on('data', (d) => String(d).trim().split('\n').forEach(relay));
    proc.stderr.on('data', (d) => String(d).trim().split('\n').forEach(relay));

    proc.on('exit', (code) => {
      if (this._procs.get(name) !== proc) return;   // replaced or killed on purpose
      this._procs.delete(name);
      if (normalize(this._cfg[name]).enabled) {
        console.error(`[Simulators] ${name} exited (${code}) — restarting in 5 s`);
        setTimeout(() => {
          if (normalize(this._cfg[name]).enabled && !this._procs.has(name)) this._spawn(name);
        }, 5000);
      }
    });
  }

  _kill(name) {
    const proc = this._procs.get(name);
    if (!proc) return;
    this._procs.delete(name);   // delete first so the exit handler won't restart
    proc.kill();
    console.log(`[Simulators] Stopped ${name}`);
  }
}

module.exports = SimulatorManager;
