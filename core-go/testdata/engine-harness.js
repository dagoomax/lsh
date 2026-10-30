'use strict';

// Runs a scenario through the real Node AutomationEngine with stand-in store
// and registry, and prints the trace — core_test.go runs the same scenario
// through the Go engine and compares. Never touches automations.json.

const { EventEmitter } = require('events');
const path = require('path');
const AutomationEngine = require(path.join(__dirname, '..', '..', 'src', 'automation-engine'));
const { buildInputsXml } = require(path.join(__dirname, '..', '..', 'src', 'loxone-xml'));

const scenario = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const trace = [];

class Store extends EventEmitter {
  constructor() { super(); this.data = {}; }
  update(key, value) {
    this.data[key] = { value, timestamp: Date.now() };
    if (!key.startsWith('in/')) trace.push(['set', key, value]);
    this.emit('change', { key, value, changed: true });
  }
  set(k, v) { this.update(k, v); }
  get(k) { return this.data[k]?.value ?? null; }
}
const store = new Store();
const devices = new Map();
const registry = {
  registerDevice(d) { if (!devices.has(d.key)) { devices.set(d.key, d); trace.push(['device', JSON.stringify(d)]); } },
  getDevices: () => [...devices.values()],
  async sendCommand(key, sensor, value) {
    trace.push(['cmd', key, sensor, value === undefined ? '<undefined>' : value]);
    if (key === 'fail/1') throw new Error('Device not found or not writable');
  },
};
const engine = new AutomationEngine(store, registry, { setState: async () => { throw new Error('No data client connected'); } }, scenario.config || {});
engine._load = () => {};
engine._save = () => { trace.push(['save', JSON.stringify({ rules: engine.rules, scenes: engine.scenes, flows: engine.flows }, null, 2)]); };
engine.setIo({ emit: (ev, d) => { if (ev === 'flow-debug') trace.push(['debug', d.label, d.key, d.payload === undefined ? '<undefined>' : d.payload]); } });
const origNotify = engine.notify.bind(engine);
engine.notify = (level, message, source) => { trace.push(['notify', level, message, source || null]); return origNotify(level, message, source); };
console.log = () => {};
console.error = () => {};
console.warn = () => {};

engine.rules = scenario.rules || [];
engine.scenes = scenario.scenes || [];
engine.flows = scenario.flows || [];
engine.start();

(async () => {
  for (const step of scenario.steps || []) {
    if (step.set) store.update(step.set[0], step.set[1]);
    if (step.run) await engine.runFlow(step.run).catch((e) => trace.push(['error', e.message]));
    if (step.scene) await engine.runScene(step.scene).catch((e) => trace.push(['error', e.message]));
    if (step.saveFlow) { try { engine.saveFlow(step.saveFlow); } catch (e) { trace.push(['error', e.message]); } }
    if (step.xml) trace.push(['xml', buildInputsXml([step.xml.device], { host: step.xml.host, token: step.xml.token }).join('\n')]);
    await new Promise((r) => setTimeout(r, step.wait || 30));
  }
  engine.stop();
  process.stdout.write(JSON.stringify(trace), () => process.exit(0));
})();
