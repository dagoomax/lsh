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
    this.notifications = [];

    this._ruleState = new Map(); // ruleId → { matched: bool, lastFired: ts }
  }

  setIo(io) { this._io = io; }

  start() {
    this._load();
    this._store.on('change', ({ key, value }) => this._onChange(key, value));
    console.log(`[Automation] Started — ${this.rules.length} rule(s), ${this.scenes.length} scene(s)`);
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  _load() {
    try {
      if (fs.existsSync(AUTOMATIONS_PATH)) {
        const data = JSON.parse(fs.readFileSync(AUTOMATIONS_PATH, 'utf8'));
        this.rules  = data.rules  || [];
        this.scenes = data.scenes || [];
      }
    } catch (err) {
      console.error(`[Automation] Failed to load automations.json: ${err.message}`);
    }
  }

  _save() {
    fs.writeFileSync(AUTOMATIONS_PATH,
      JSON.stringify({ rules: this.rules, scenes: this.scenes }, null, 2), 'utf8');
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
