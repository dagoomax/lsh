'use strict';

const platformStatus = require('./platform-status');

// Bang & Olufsen local "BeoPlay App" REST API — present on legacy BeoPlay
// products (A9, A6, M3/M5, BeoSound 1/2 Gen1, Beolit, ...) and kept for
// backward compatibility on the newer Mozart platform (Beosound
// Balance/Level/Emerge/A5/A9, Beolab 8/28/50/90, Beoconnect Core), so this
// one client aims to reach "all models" rather than needing a second
// implementation for the newer official Mozart OpenAPI.
//
// Endpoint/JSON shapes here are reverse-engineered community knowledge (no
// official spec for this legacy surface) — verify against your actual
// device and adjust if a firmware revision differs.
//
// Source selection needs real source IDs, which vary per device/account and
// aren't a fixed small enum like Denon's SI codes. Inspect
// GET http://<host>:8080/BeoZone/Zone/ActiveSources on your speaker to find
// them, then list friendly-name → id pairs in config.beosound.sources.

class BeosoundClient {
  constructor(config, store, sensorRegistry) {
    this._config      = config;
    this._store       = store;
    this._registry    = sensorRegistry;
    this._deviceKey   = null;
    this._sources     = {};   // friendly name → source id (config-supplied)
    this._sourceNames = [];
    this._timer       = null;
    this._stopping    = false;
  }

  async start() {
    const cfg = this._config.beosound;
    if (!cfg?.host) return;

    this._sources      = cfg.sources || {};
    this._sourceNames  = Object.keys(this._sources);
    this._deviceKey    = `beosound/${cfg.host.replace(/\./g, '_')}`;

    const sensors = [
      {
        path: 'power', label: 'Power', format: 'on-off',
        controllable: true, type: 'toggle',
        writeOn: 'on', writeOff: 'standby',
        capabilityId: 'power',
      },
      {
        path: 'volume', label: 'Volume', unit: '%',
        controllable: true, type: 'range',
        min: 0, max: cfg.maxVolume || 90,
        rangeFormat: 'percent',
        writeCmd: 'setVolume', capabilityId: 'volume',
      },
      {
        path: 'volume_up', label: 'Volume Up', type: 'trigger',
        controllable: true, capabilityId: 'volume_up', writeOn: 'up',
      },
      {
        path: 'volume_down', label: 'Volume Down', type: 'trigger',
        controllable: true, capabilityId: 'volume_down', writeOn: 'down',
      },
      {
        path: 'mute', label: 'Mute', format: 'on-off',
        controllable: true, type: 'toggle',
        writeOn: 'on', writeOff: 'off',
        capabilityId: 'mute',
      },
      { path: 'source', label: 'Source', type: 'label' },
    ];

    if (this._sourceNames.length) {
      sensors.push({
        path: 'source_idx', label: 'Source', unit: '',
        controllable: true, type: 'range',
        min: 0, max: this._sourceNames.length - 1,
        writeCmd: 'selectSource', capabilityId: 'source_idx',
        inputNames: this._sourceNames,
      });
    }

    this._registry.registerDevice({
      key:    this._deviceKey,
      label:  cfg.name || `Beosound ${cfg.host}`,
      type:   'beosound',
      homekit: [],
      sensors,
      _writeCapability: (capId, command, args) =>
        this._executeCommand(capId, command, args),
    });

    await this._poll().catch((err) => console.error(`[Beosound] Initial poll failed: ${err.message}`));

    const ms = Math.max(cfg.pollInterval || 10, 3) * 1000;
    this._timer = setInterval(() => this._poll(), ms);
  }

  stop() {
    this._stopping = true;
    if (this._timer) clearInterval(this._timer);
  }

  // ── HTTP ────────────────────────────────────────────────────────────────

  _base() {
    const cfg = this._config.beosound;
    return `http://${cfg.host}:${cfg.port || 8080}`;
  }

  async _req(pathname, { method = 'GET', body } = {}) {
    const res = await fetch(`${this._base()}${pathname}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body:    body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  // ── Poll ────────────────────────────────────────────────────────────────

  async _poll() {
    if (this._stopping) return;
    const dk = this._deviceKey;
    try {
      const standby = await this._req('/BeoDevice/powerManagement/standby');
      const on = standby?.standby?.powerState === 'on';
      this._store.update(`${dk}/power`, on ? 1 : 0);

      const vol   = await this._req('/BeoZone/Zone/Sound/Volume');
      const level = vol?.volume?.speaker?.level;
      const muted = vol?.volume?.speaker?.muted;
      if (level != null) this._store.update(`${dk}/volume`, level);
      if (muted != null) this._store.update(`${dk}/mute`, muted ? 1 : 0);

      const src  = await this._req('/BeoZone/Zone/ActiveSources').catch(() => null);
      const info = src?.primaryExperience?.source;
      if (info?.friendlyName) {
        this._store.update(`${dk}/source`, info.friendlyName);
        const idx = this._sourceNames.findIndex((n) => this._sources[n] === info.id);
        if (idx !== -1) this._store.update(`${dk}/source_idx`, idx);
      }

      platformStatus.set('beosound', true);
    } catch (err) {
      platformStatus.set('beosound', false);
      console.error(`[Beosound] Poll failed: ${err.message}`);
    }
  }

  // ── Command Dispatch ────────────────────────────────────────────────────

  async _executeCommand(capId, command, args) {
    const cfg = this._config.beosound;
    const dk  = this._deviceKey;
    try {
      switch (capId) {
        case 'power':
          await this._req('/BeoDevice/powerManagement/standby', {
            method: 'PUT',
            body:   { standby: { powerState: command === 'on' ? 'on' : 'standby' } },
          });
          break;
        case 'volume': {
          const max   = cfg.maxVolume || 90;
          const level = Math.round(Math.max(0, Math.min(max, args?.[0] ?? 50)));
          await this._req('/BeoZone/Zone/Sound/Volume/Speaker/Level', { method: 'PUT', body: { level } });
          break;
        }
        case 'volume_up':
        case 'volume_down': {
          const max   = cfg.maxVolume || 90;
          const cur   = this._store.get(`${dk}/volume`) ?? 0;
          const step  = capId === 'volume_up' ? 2 : -2;
          const level = Math.round(Math.max(0, Math.min(max, cur + step)));
          await this._req('/BeoZone/Zone/Sound/Volume/Speaker/Level', { method: 'PUT', body: { level } });
          break;
        }
        case 'mute':
          await this._req('/BeoZone/Zone/Sound/Volume/Speaker/Muted', {
            method: 'PUT',
            body:   { muted: command === 'on' },
          });
          break;
        case 'source_idx': {
          const idx  = Math.round(args?.[0] ?? 0);
          const name = this._sourceNames[idx];
          const id   = name && this._sources[name];
          if (id) {
            await this._req('/BeoZone/Zone/ActiveSources', {
              method: 'POST',
              body:   { primaryExperience: { source: { id } } },
            });
          }
          break;
        }
      }
      // Confirm the change against the device rather than assume it applied.
      setTimeout(() => this._poll(), 1000);
    } catch (err) {
      console.error(`[Beosound] Command failed (${capId}): ${err.message}`);
    }
  }
}

module.exports = BeosoundClient;
