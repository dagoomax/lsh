'use strict';

const platformStatus = require('./platform-status');

// Sony Bravia (Android TV / Google TV) local REST API — JSON-RPC over
// POST http://<host>/sony/<service>, authenticated with a Pre-Shared Key
// header (X-Auth-PSK). No pairing flow needed: enable it on the TV under
// Settings > Network & Accessories > Home network > IP control >
// Authentication > Pre-Shared Key, and put the same key in config.sony.psk.
//
// Powering on over the network requires the TV's "Remote start" (a.k.a.
// "Quick start"/Bravia Sync network standby) setting to be enabled, or the
// setPowerStatus(true) call below will simply fail while the TV is fully off.
//
// getPlayingContentInfo errors out (HTTP 200 with a JSON-RPC "error" array,
// commonly code 7) whenever the TV is sitting on the Android/Google TV home
// launcher rather than an actual input/app — that's expected, not a fault,
// and is treated as "Home" here rather than surfaced as a poll failure.

class SonyClient {
  constructor(config, store, sensorRegistry) {
    this._config     = config;
    this._store      = store;
    this._registry   = sensorRegistry;
    this._deviceKey  = null;
    this._inputs     = {};   // friendly name → Sony content URI (config-supplied)
    this._inputNames = [];
    this._reqId      = 0;
    this._timer      = null;
    this._stopping   = false;
  }

  async start() {
    const cfg = this._config.sony;
    if (!cfg?.host) return;

    this._inputs     = cfg.inputs || {};
    this._inputNames = Object.keys(this._inputs);
    this._deviceKey  = `sony/${cfg.host.replace(/\./g, '_')}`;

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
        min: 0, max: cfg.maxVolume || 100,
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
      { path: 'input', label: 'Input', type: 'label' },
      { path: 'nowPlaying', label: 'Now Playing', type: 'label' },
    ];

    if (this._inputNames.length) {
      sensors.push({
        path: 'input_idx', label: 'Source', unit: '',
        controllable: true, type: 'range',
        min: 0, max: this._inputNames.length - 1,
        writeCmd: 'selectInput', capabilityId: 'input_idx',
        inputNames: this._inputNames,
      });
    }

    this._registry.registerDevice({
      key:    this._deviceKey,
      label:  cfg.name || `Sony TV ${cfg.host}`,
      type:   'sony',
      homekit: [],
      sensors,
      _writeCapability: (capId, command, args) =>
        this._executeCommand(capId, command, args),
    });

    await this._poll().catch((err) => console.error(`[Sony] Initial poll failed: ${err.message}`));

    const ms = Math.max(cfg.pollInterval || 10, 3) * 1000;
    this._timer = setInterval(() => this._poll(), ms);
  }

  stop() {
    this._stopping = true;
    if (this._timer) clearInterval(this._timer);
  }

  // ── JSON-RPC ────────────────────────────────────────────────────────────

  async _call(service, method, params = []) {
    const cfg = this._config.sony;
    const res = await fetch(`http://${cfg.host}/sony/${service}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-PSK':   cfg.psk || '',
      },
      body: JSON.stringify({ method, id: ++this._reqId, params, version: '1.0' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(`${method}: ${json.error[1] || json.error[0]}`);
    return json.result;
  }

  // ── Poll ────────────────────────────────────────────────────────────────

  async _poll() {
    if (this._stopping) return;
    const dk = this._deviceKey;
    try {
      const [power] = await this._call('system', 'getPowerStatus');
      const on = power?.status === 'active';
      this._store.update(`${dk}/power`, on ? 1 : 0);

      if (on) {
        const [[vol]] = await this._call('audio', 'getVolumeInformation').catch(() => [[null]]);
        if (vol?.volume != null) this._store.update(`${dk}/volume`, vol.volume);
        if (vol?.mute != null)   this._store.update(`${dk}/mute`, vol.mute ? 1 : 0);

        const content = await this._call('avContent', 'getPlayingContentInfo')
          .then((r) => r?.[0]).catch(() => null);
        const label = content?.title || content?.source || 'Home';
        this._store.update(`${dk}/input`, label);
        // programTitle is the current live-TV program name; apps (Netflix,
        // YouTube, ...) don't expose per-video metadata through this API, so
        // this falls back to the app/source title for non-linear content.
        this._store.update(`${dk}/nowPlaying`, content?.programTitle || label);
        if (content?.uri) {
          const idx = this._inputNames.findIndex((n) => this._inputs[n] === content.uri);
          if (idx !== -1) this._store.update(`${dk}/input_idx`, idx);
        }
      }

      platformStatus.set('sony', true);
    } catch (err) {
      platformStatus.set('sony', false);
      console.error(`[Sony] Poll failed: ${err.message}`);
    }
  }

  // ── Command Dispatch ────────────────────────────────────────────────────

  async _executeCommand(capId, command, args) {
    try {
      switch (capId) {
        case 'power':
          await this._call('system', 'setPowerStatus', [{ status: command === 'on' }]);
          break;
        case 'volume': {
          const cfg = this._config.sony;
          const max = cfg.maxVolume || 100;
          const vol = Math.round(Math.max(0, Math.min(max, args?.[0] ?? 20)));
          await this._call('audio', 'setAudioVolume', [{ target: 'speaker', volume: String(vol) }]);
          break;
        }
        case 'volume_up':
          await this._call('audio', 'setAudioVolume', [{ target: 'speaker', volume: '+1' }]);
          break;
        case 'volume_down':
          await this._call('audio', 'setAudioVolume', [{ target: 'speaker', volume: '-1' }]);
          break;
        case 'mute':
          await this._call('audio', 'setAudioMute', [{ status: command === 'on' }]);
          break;
        case 'input_idx': {
          const idx = Math.round(args?.[0] ?? 0);
          const uri = this._inputs[this._inputNames[idx]];
          if (uri) await this._call('avContent', 'setPlayContent', [{ uri }]);
          break;
        }
      }
      // Confirm the change against the device rather than assume it applied.
      setTimeout(() => this._poll(), 1000);
    } catch (err) {
      console.error(`[Sony] Command failed (${capId}): ${err.message}`);
    }
  }
}

module.exports = SonyClient;
