'use strict';

const platformStatus = require('./platform-status');

// TCL (and any other) Android TV / Google TV — the Android TV Remote v2
// protocol (protobuf over mutually-authenticated TLS, ports 6467/6466), the
// same protocol the Google TV / Android TV Remote phone app uses. There's no
// TCL-specific API — Google TV is Google TV regardless of the TV brand.
//
// Requires a one-time pairing (TV shows a 6-digit code): run
//   node scripts/tcltv-auth.js <tv-ip>
// and paste the printed cert block into config.json under tcltv.cert.
//
// The protocol only exposes power and mute as *toggles* (no "set to on" vs
// "set to off" — the TV just flips state), so both are driven off the last
// known state reported by the TV rather than blindly toggling, to avoid
// flipping the wrong way when the dashboard's idea of the state is stale.
class TclTvClient {
  constructor(config, store, sensorRegistry) {
    this._config    = config;
    this._store     = store;
    this._registry  = sensorRegistry;
    this._remote    = null;
    this._deviceKey = null;
    this._apps      = {};
  }

  async start() {
    const cfg = this._config.tcltv;
    if (!cfg?.host) return;
    if (!cfg.cert?.key || !cfg.cert?.cert) {
      console.warn(`[TclTv] tcltv.host is set but not paired yet — run: node scripts/tcltv-auth.js ${cfg.host}`);
      return;
    }

    const { createAndroidRemote, RemoteKeyCode, RemoteDirection } = await import('@kud/androidtv-remote');
    this._KeyCode   = RemoteKeyCode;
    this._Direction = RemoteDirection;

    this._deviceKey = `tcltv/${cfg.host.replace(/\./g, '_')}`;
    this._apps      = cfg.apps || {};
    const appNames  = Object.keys(this._apps);

    const sensors = [
      { path: 'power', label: 'Power', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'power' },
      { path: 'mute',  label: 'Mute',  format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'mute' },
      { path: 'volume_up',   label: 'Volume Up',   type: 'trigger', controllable: true, capabilityId: 'volume_up',   writeOn: 'press' },
      { path: 'volume_down', label: 'Volume Down', type: 'trigger', controllable: true, capabilityId: 'volume_down', writeOn: 'press' },
      { path: 'home', label: 'Home', type: 'trigger', controllable: true, capabilityId: 'home', writeOn: 'press' },
      { path: 'back', label: 'Back', type: 'trigger', controllable: true, capabilityId: 'back', writeOn: 'press' },
      { path: 'nowPlaying', label: 'Now Playing', type: 'label' },
    ];
    if (appNames.length) {
      sensors.push({
        path: 'app_idx', label: 'App', unit: '',
        controllable: true, type: 'range',
        min: 0, max: appNames.length - 1,
        writeCmd: 'launchApp', capabilityId: 'app_idx',
        inputNames: appNames,
      });
    }

    this._registry.registerDevice({
      key:    this._deviceKey,
      label:  cfg.name || `TCL TV ${cfg.host}`,
      type:   'tcltv',
      icon:   '📺',
      homekit: [],
      sensors,
      _writeCapability: (capId, command, args) => this._executeCommand(capId, command, args),
    });

    this._remote = createAndroidRemote(cfg.host, {
      cert: cfg.cert,
      service_name: cfg.name || 'lsh',
    });

    const dk = this._deviceKey;
    this._remote.on('ready', () => {
      platformStatus.set('tcltv', true);
      console.log(`[TclTv] Connected — ${cfg.host}`);
    });
    this._remote.on('powered', (powered) => this._store.update(`${dk}/power`, powered ? 1 : 0));
    this._remote.on('volume', ({ muted }) => this._store.update(`${dk}/mute`, muted ? 1 : 0));
    this._remote.on('current_app', (pkg) => {
      const friendly = Object.keys(this._apps).find((name) => this._apps[name] === pkg);
      this._store.update(`${dk}/nowPlaying`, friendly || pkg);
    });
    this._remote.on('unpaired', () => {
      platformStatus.set('tcltv', false);
      console.error(`[TclTv] TV rejected the certificate (unpaired) — re-run: node scripts/tcltv-auth.js ${cfg.host}`);
    });
    this._remote.on('error', (err) => {
      platformStatus.set('tcltv', false);
      console.error(`[TclTv] Error: ${err.message}`);
    });

    await this._remote.start().catch((err) => {
      platformStatus.set('tcltv', false);
      console.error(`[TclTv] Connect failed: ${err.message}`);
    });
  }

  stop() {
    this._remote?.stop();
  }

  async _executeCommand(capId, command, args) {
    if (!this._remote) return;
    const K = this._KeyCode, D = this._Direction;
    try {
      switch (capId) {
        case 'power': {
          const on = this._store.get(`${this._deviceKey}/power`);
          if ((command === 'on') !== !!on) this._remote.sendPower();
          break;
        }
        case 'mute': {
          const muted = this._store.get(`${this._deviceKey}/mute`);
          if ((command === 'on') !== !!muted) this._remote.sendKey(K.KEYCODE_VOLUME_MUTE, D.SHORT);
          break;
        }
        case 'volume_up':   this._remote.sendKey(K.KEYCODE_VOLUME_UP, D.SHORT);   break;
        case 'volume_down': this._remote.sendKey(K.KEYCODE_VOLUME_DOWN, D.SHORT); break;
        case 'home':        this._remote.sendKey(K.KEYCODE_HOME, D.SHORT);        break;
        case 'back':        this._remote.sendKey(K.KEYCODE_BACK, D.SHORT);        break;
        case 'app_idx': {
          const idx  = Math.round(args?.[0] ?? 0);
          const name = Object.keys(this._apps)[idx];
          const link = name && this._apps[name];
          if (link) this._remote.sendAppLink(link);
          break;
        }
      }
    } catch (err) {
      console.error(`[TclTv] Command failed (${capId}): ${err.message}`);
    }
  }
}

module.exports = TclTvClient;
