'use strict';

// LAN device monitor — keeps an eye on the devices marked "monitored" in
// Settings → System → LAN scan → Devices, and (optionally) re-scans the LAN
// on a schedule so newly appearing devices get the "new" tag.
//
// Each monitored device becomes an LSH device (lan/<id>: online, latency, ip)
// so Flows / automations / the dashboard can use it. Presence check: TCP
// connect to the device's known ports (refused counts as up), then — for
// devices with every port closed — an ARP poke. Follows the device by MAC
// when its IP changes. A device is declared offline only after 3 failed
// checks in a row (phones doze).
//
// Config (config.lshLan): { enabled, checkSeconds = 60, autoScanMinutes = 0,
// notifyNew = true, notifyOffline = true }. Singleton: started at boot when
// enabled, or from the API the moment monitoring is switched on.

const lan = require('./lsh-lan');
const inventory = require('./lsh-lan-inventory');

const FAILS_FOR_OFFLINE = 3;
const FALLBACK_PORTS = [80, 443, 22, 62078, 7000, 8080, 53];

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

let instance = null;

class LanMonitor {
  constructor({ config, store, sensorRegistry, automation }) {
    this.cfg = config.lshLan || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.automation = automation || null;
    this.status = new Map(); // key → { online, latency, ip, fails, lastChange, lastCheck }
    this.registered = new Set();
    this.timer = null;
    this.scanTimer = null;
    this.running = false;
  }

  configure(cfg) {
    this.cfg = cfg || {};
    if (this.running) { this.stop(); this.start(); }
  }

  start() {
    if (this.running) return;
    this.running = true;
    const every = Math.max(15, Number(this.cfg.checkSeconds) || 60) * 1000;
    this.timer = setInterval(() => this.checkAll().catch((e) => console.error(`[LAN] Check failed: ${e.message}`)), every);
    this.timer.unref?.();
    setTimeout(() => this.checkAll().catch(() => {}), 2000).unref?.();
    const scanMin = Number(this.cfg.autoScanMinutes) || 0;
    if (scanMin > 0) {
      this.scanTimer = setInterval(() => this.backgroundScan().catch((e) => console.error(`[LAN] Background scan failed: ${e.message}`)), Math.max(5, scanMin) * 60000);
      this.scanTimer.unref?.();
    }
    console.log(`[LAN] Monitor started — ${inventory.monitored().length} device(s), check every ${every / 1000}s${scanMin ? `, scan every ${scanMin} min` : ''}`);
  }

  stop() {
    clearInterval(this.timer); clearInterval(this.scanTimer);
    this.timer = this.scanTimer = null;
    this.running = false;
  }

  statusOf(key) { return this.status.get(key) || null; }

  notify(level, msg) {
    console.log(`[LAN] ${msg}`);
    try { this.automation?.notify(level, msg, 'lan-monitor'); } catch {}
  }

  async backgroundScan() {
    const result = await lan.scan();
    const { newDevices } = inventory.mergeScan(result);
    if (newDevices.length && this.cfg.notifyNew !== false) {
      for (const d of newDevices) this.notify('warning', `New device on the LAN: ${d.name || d.kindLabel || 'unknown'} — ${d.ip}${d.vendor ? ` (${d.vendor})` : ''}`);
    }
    return result;
  }

  _register(dev) {
    const id = slug(dev.key.replace(/^ip:/, 'ip_'));
    const key = `lan/${id}`;
    if (!this.registered.has(key) && !this.registry.devices?.has?.(key)) {
      this.registry.registerDevice({
        key, label: dev.label || dev.name || dev.ip, type: 'lan', icon: '📶', homekit: [],
        sensors: [
          { path: 'online', name: 'Online', label: 'Online', type: 'boolean' },
          { path: 'latency', name: 'Latency', label: 'Latency', type: 'number', unit: 'ms', precision: 0 },
          { path: 'ip', name: 'IP address', label: 'IP address', type: 'label' },
        ],
      });
    }
    this.registered.add(key);
    return key;
  }

  async checkAll() {
    const devs = inventory.monitored();
    if (!devs.length) return;
    const arp = await lan._arpTable();
    await Promise.all(devs.map((dev) => this.check(dev, arp)));
  }

  async check(dev, arp) {
    const prev = this.status.get(dev.key) || { online: null, fails: 0 };
    // Follow the MAC if the device moved to another IP.
    let ip = dev.ip;
    if (dev.mac) for (const [aip, mac] of arp) if (mac === dev.mac && aip !== ip) { ip = aip; inventory.setIp(dev.key, ip); }
    const ports = [...new Set([...(dev.ports || []).slice(0, 4), ...FALLBACK_PORTS])].slice(0, 7);
    let up = null;
    for (const port of ports) {
      const r = await lan._tcpProbe(ip, port, 900);
      if (r.state !== 'timeout') { up = r; break; }
    }
    if (!up && dev.mac) {
      // Every port closed/filtered: poke it and see whether it answers ARP.
      await lan._arpPoke(ip);
      const after = await lan._arpTable();
      if (after.get(ip) === dev.mac) up = { ms: null };
    }
    const st = { ...prev, ip, lastCheck: Date.now() };
    if (up) {
      st.fails = 0; st.latency = up.ms; st.lastSeen = Date.now();
      if (prev.online !== true) {
        if (prev.online === false && this.cfg.notifyOffline !== false) this.notify('info', `${dev.label || dev.name || ip} is back online (${ip})`);
        st.online = true; st.lastChange = Date.now();
      }
    } else {
      st.fails = (prev.fails || 0) + 1;
      if (st.fails >= FAILS_FOR_OFFLINE && prev.online !== false) {
        st.online = false; st.lastChange = Date.now(); st.latency = null;
        if (prev.online === true && this.cfg.notifyOffline !== false) this.notify('warning', `${dev.label || dev.name || ip} went offline (${ip})`);
      }
    }
    this.status.set(dev.key, st);
    const key = this._register(dev);
    if (st.online != null) this.store.update(`${key}/online`, st.online ? 1 : 0);
    if (st.latency != null) this.store.update(`${key}/latency`, st.latency);
    this.store.update(`${key}/ip`, ip);
  }
}

// Shared instance: server boot and the API both go through this.
function getMonitor(deps) {
  if (!instance) instance = new LanMonitor(deps);
  else if (deps?.automation && !instance.automation) instance.automation = deps.automation;
  return instance;
}

module.exports = { getMonitor, LanMonitor };
