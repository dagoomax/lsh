'use strict';

const fs   = require('fs');
const path = require('path');

const AUTOMATIONS_PATH = path.join(__dirname, '..', 'automations.json');
const MAX_NOTIFICATIONS = 200;

const OPS = {
  '>':  (a, b) => Number(a) >  Number(b),
  '<':  (a, b) => Number(a) <  Number(b),
  '>=': (a, b) => Number(a) >= Number(b),
  '<=': (a, b) => Number(a) <= Number(b),
  '==': (a, b) => String(a) === String(b) || Number(a) === Number(b),
  '!=': (a, b) => String(a) !== String(b) && Number(a) !== Number(b),
};

let nextNotifId = 1;

/**
 * Rules, scenes and notifications.
 *
 * Rule:  { id, name, enabled, trigger: { key, op, value }, actions: [...], cooldownSeconds }
 *   op: > < >= <= == != changes — comparison ops are edge-triggered (fire on
 *   false→true transition); 'changes' fires on every value change.
 * Scene: { id, name, icon, actions: [...] }
 * Action: { type: 'device', deviceKey, sensor, value }
 *       | { type: 'relay',  index, on }
 *       | { type: 'notify', level: 'info'|'warning'|'critical', message }
 *       | { type: 'scene',  sceneId }
 * notify messages support {value} and {key} placeholders.
 */
class AutomationEngine {
  constructor(store, sensorRegistry, relayController) {
    this._store    = store;
    this._registry = sensorRegistry;
    this._relays   = relayController;
    this._io       = null;

    this.rules  = [];
    this.scenes = [];
    this.flows  = [];
    this.notifications = [];

    this._ruleState = new Map(); // ruleId → { matched: bool, lastFired: ts }
    this._flowState = new Map(); // `${flowId}:${nodeId}` → { matched: bool }
  }

  setIo(io) { this._io = io; }

  start() {
    this._load();
    this._store.on('change', ({ key, value }) => this._onChange(key, value));
    console.log(`[Automation] Started — ${this.rules.length} rule(s), ${this.scenes.length} scene(s), ${this.flows.length} flow(s)`);
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  _load() {
    try {
      if (fs.existsSync(AUTOMATIONS_PATH)) {
        const data = JSON.parse(fs.readFileSync(AUTOMATIONS_PATH, 'utf8'));
        this.rules  = data.rules  || [];
        this.scenes = data.scenes || [];
        this.flows  = data.flows  || [];
      }
    } catch (err) {
      console.error(`[Automation] Failed to load automations.json: ${err.message}`);
    }
  }

  _save() {
    fs.writeFileSync(AUTOMATIONS_PATH,
      JSON.stringify({ rules: this.rules, scenes: this.scenes, flows: this.flows }, null, 2), 'utf8');
  }

  // ── Rule evaluation ──────────────────────────────────────────────────────

  _onChange(key, value) {
    for (const rule of this.rules) {
      if (!rule.enabled || rule.trigger?.key !== key) continue;
      try {
        this._evaluate(rule, key, value);
      } catch (err) {
        console.error(`[Automation] Rule "${rule.name}" error: ${err.message}`);
      }
    }
    for (const flow of this.flows) {
      if (flow.enabled === false) continue;
      try {
        this._evalFlow(flow, key, value);
      } catch (err) {
        console.error(`[Automation] Flow "${flow.name}" error: ${err.message}`);
      }
    }
  }

  _evaluate(rule, key, value) {
    const state = this._ruleState.get(rule.id) || { matched: false, lastFired: 0 };
    const op = rule.trigger.op;

    let fire = false;
    if (op === 'changes') {
      fire = true;
    } else {
      const cmp = OPS[op];
      if (!cmp) return;
      const matched = cmp(value, rule.trigger.value);
      fire = matched && !state.matched; // edge-triggered
      state.matched = matched;
    }

    const cooldownMs = (rule.cooldownSeconds || 0) * 1000;
    if (fire && Date.now() - state.lastFired >= cooldownMs) {
      state.lastFired = Date.now();
      console.log(`[Automation] Rule fired: ${rule.name} (${key} = ${value})`);
      this.runActions(rule.actions || [], { key, value, source: `rule:${rule.name}` });
    }
    this._ruleState.set(rule.id, state);
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  async runActions(actions, ctx = {}) {
    for (const action of actions) {
      try {
        await this._runAction(action, ctx);
      } catch (err) {
        console.error(`[Automation] Action failed (${action.type}): ${err.message}`);
        this.notify('warning', `Action failed: ${err.message}`, ctx.source);
      }
    }
  }

  async _runAction(action, ctx) {
    switch (action.type) {
      case 'device':
        await this._registry.sendCommand(action.deviceKey, action.sensor, action.value);
        break;
      case 'relay':
        await this._relays.setState(Number(action.index), !!action.on);
        break;
      case 'notify': {
        const msg = String(action.message || '')
          .replace(/\{value\}/g, ctx.value ?? '')
          .replace(/\{key\}/g, ctx.key ?? '');
        this.notify(action.level || 'info', msg, ctx.source);
        break;
      }
      case 'scene': {
        const scene = this.scenes.find((s) => s.id === action.sceneId);
        if (scene) await this.runActions(scene.actions || [], ctx);
        break;
      }
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  // ── Flows (Node-RED-style node graphs) ───────────────────────────────────
  // Flow: { id, name, enabled, nodes: [Node] }
  // Node: { id, type, x, y, config: {...}, wires: [[targetId, …], …] }
  //   wires[outputPort] = array of downstream node ids. A message
  //   { payload, key, source } is created by a `trigger` node on a matching
  //   store change and propagated along the wires; each node transforms/routes
  //   it and forwards to its outputs. Depth-capped to prevent runaway loops.
  //
  // Node types:
  //   trigger   { key, op, value }   entry; edge-triggered like a rule
  //   condition { op, value }        routes: output 0 = pass, output 1 = else
  //   device    { deviceKey, sensor, value }   run command, pass msg on
  //   relay     { index, on }        set relay, pass msg on
  //   notify    { level, message }   toast + log, pass msg on
  //   scene     { sceneId }          run a scene, pass msg on
  //   delay     { seconds }          wait, then pass msg on
  //   debug     { name }             tap: emit the message to the editor + log (sink)

  _evalFlow(flow, key, value) {
    for (const node of flow.nodes || []) {
      if (node.type !== 'trigger' || node.config?.key !== key) continue;
      const op = node.config.op || 'changes';
      const skey = `${flow.id}:${node.id}`;
      const st = this._flowState.get(skey) || { matched: false };
      let fire = false;
      if (op === 'changes') {
        fire = true;
      } else {
        const cmp = OPS[op];
        if (!cmp) continue;
        const matched = cmp(value, node.config.value);
        fire = matched && !st.matched; // edge-triggered
        st.matched = matched;
        this._flowState.set(skey, st);
      }
      if (fire) {
        const msg = { payload: value, key, source: `flow:${flow.name}` };
        this._propagate(flow, node, msg, 0);
      }
    }
  }

  async _propagate(flow, node, msg, depth) {
    if (depth > 50) { console.warn(`[Automation] Flow "${flow.name}" depth cap hit`); return; }
    const outputs = await this._execNode(node, msg); // [msgOrNull per output port]
    const wires = node.wires || [];
    for (let port = 0; port < outputs.length; port++) {
      const outMsg = outputs[port];
      if (outMsg == null) continue;
      for (const targetId of wires[port] || []) {
        const target = (flow.nodes || []).find((n) => n.id === targetId);
        if (target) this._propagate(flow, target, { ...outMsg }, depth + 1);
      }
    }
  }

  /** Run a node; return an array of messages, one per output port (null = no emit). */
  async _execNode(node, msg) {
    const c = node.config || {};
    switch (node.type) {
      case 'trigger':
        return [msg]; // single output
      case 'condition': {
        const cmp = OPS[c.op];
        const pass = cmp ? cmp(msg.payload, c.value) : false;
        return [pass ? msg : null, pass ? null : msg]; // [then, else]
      }
      case 'device':
        await this._registry.sendCommand(c.deviceKey, c.sensor, c.value);
        return [msg];
      case 'relay':
        await this._relays.setState(Number(c.index), !!c.on);
        return [msg];
      case 'notify': {
        const text = String(c.message || '')
          .replace(/\{value\}/g, msg.payload ?? '')
          .replace(/\{key\}/g, msg.key ?? '');
        this.notify(c.level || 'info', text, msg.source);
        return [msg];
      }
      case 'scene': {
        const scene = this.scenes.find((s) => s.id === c.sceneId);
        if (scene) await this.runActions(scene.actions || [], msg);
        return [msg];
      }
      case 'delay':
        await new Promise((r) => setTimeout(r, (Number(c.seconds) || 0) * 1000));
        return [msg];
      case 'debug': {
        // Node-RED-style debug tap: surface the message to the editor + log. Sink.
        const label = c.name || 'debug';
        console.log(`[Flow debug] ${label}: ${msg.key ?? ''} = ${JSON.stringify(msg.payload)}`);
        if (this._io) this._io.emit('flow-debug', {
          time: Date.now(), label, key: msg.key ?? null, payload: msg.payload, source: msg.source || null,
        });
        return []; // no output — it's a terminal tap
      }
      default:
        return [msg];
    }
  }

  saveFlow(flow) {
    if (!flow.name) throw new Error('Flow needs a name');
    if (!flow.id) flow.id = `f${Date.now().toString(36)}`;
    if (flow.enabled === undefined) flow.enabled = true;
    if (!Array.isArray(flow.nodes)) flow.nodes = [];
    const idx = this.flows.findIndex((f) => f.id === flow.id);
    if (idx >= 0) this.flows[idx] = flow; else this.flows.push(flow);
    // reset edge-trigger memory for this flow's nodes
    for (const k of [...this._flowState.keys()]) if (k.startsWith(`${flow.id}:`)) this._flowState.delete(k);
    this._save();
    return flow;
  }

  deleteFlow(id) {
    this.flows = this.flows.filter((f) => f.id !== id);
    for (const k of [...this._flowState.keys()]) if (k.startsWith(`${id}:`)) this._flowState.delete(k);
    this._save();
  }

  /** Manually fire a flow from its trigger node(s) — used by the editor's "Test run". */
  async runFlow(id) {
    const flow = this.flows.find((f) => f.id === id);
    if (!flow) throw new Error('Flow not found');
    for (const node of flow.nodes || []) {
      if (node.type !== 'trigger') continue;
      const payload = node.config?.key ? this._store.get(node.config.key) : null;
      await this._propagate(flow, node, { payload, key: node.config?.key, source: `flow-test:${flow.name}` }, 0);
    }
    return flow;
  }

  // ── Notifications ────────────────────────────────────────────────────────

  notify(level, message, source) {
    const entry = { id: nextNotifId++, time: Date.now(), level, message, source: source || null };
    this.notifications.push(entry);
    if (this.notifications.length > MAX_NOTIFICATIONS) this.notifications.shift();
    if (this._io) this._io.emit('notification', entry);
    console.log(`[Automation] [${level}] ${message}`);
    return entry;
  }

  getNotifications() { return this.notifications; }
  clearNotifications() { this.notifications = []; }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  saveRule(rule) {
    if (!rule.name || !rule.trigger?.key || !rule.trigger?.op) throw new Error('Rule needs name, trigger.key and trigger.op');
    if (!rule.id) rule.id = `r${Date.now().toString(36)}`;
    if (rule.enabled === undefined) rule.enabled = true;
    const idx = this.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) this.rules[idx] = rule; else this.rules.push(rule);
    this._ruleState.delete(rule.id);
    this._save();
    return rule;
  }

  deleteRule(id) {
    this.rules = this.rules.filter((r) => r.id !== id);
    this._ruleState.delete(id);
    this._save();
  }

  saveScene(scene) {
    if (!scene.name) throw new Error('Scene needs a name');
    if (!scene.id) scene.id = `s${Date.now().toString(36)}`;
    const idx = this.scenes.findIndex((s) => s.id === scene.id);
    if (idx >= 0) this.scenes[idx] = scene; else this.scenes.push(scene);
    this._save();
    return scene;
  }

  deleteScene(id) {
    this.scenes = this.scenes.filter((s) => s.id !== id);
    this._save();
  }

  async runScene(id) {
    const scene = this.scenes.find((s) => s.id === id);
    if (!scene) throw new Error('Scene not found');
    console.log(`[Automation] Scene run: ${scene.name}`);
    await this.runActions(scene.actions || [], { source: `scene:${scene.name}` });
    return scene;
  }
}

module.exports = AutomationEngine;
