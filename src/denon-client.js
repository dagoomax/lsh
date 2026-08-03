'use strict';

const net            = require('net');
const platformStatus = require('./platform-status');

// Denon input code → friendly name
const INPUT_NAMES = {
  PHONO:    'Phono', CD:   'CD',   TUNER:    'Tuner', DVD:       'DVD',
  BD:       'Blu-ray', TV: 'TV',   'SAT/CBL': 'SAT/Cable',
  MPLAY:    'Media Player', GAME: 'Game',  HDRADIO: 'HD Radio',
  NET:      'Network',   BT:   'Bluetooth', AUX1: 'AUX 1',
  AUX2:     'AUX 2',    AUX3: 'AUX 3',
};

// Common Denon/Marantz surround/sound mode codes (MS command). Not every
// model or input offers every mode — override via config.denon.soundModes
// if yours differs.
const DEFAULT_SOUND_MODES = [
  'MOVIE', 'MUSIC', 'GAME', 'DIRECT', 'PURE DIRECT', 'STEREO',
  'AUTO', 'DOLBY DIGITAL', 'DTS SURROUND', 'MCH STEREO', 'VIRTUAL',
];

class DenonClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._socket   = null;
    this._buf      = '';
    this._pollTimer = null;
    this._reconnTimer = null;
    this._deviceKey   = null;
    this._zone2Key    = null;
    this._inputs      = [];
    this._soundModes  = DEFAULT_SOUND_MODES;
    this._nseLines    = ['', '', '', '', ''];
    this._stopping    = false;
  }

  async start() {
    const cfg = this._config.denon;
    if (!cfg?.host) return;

    this._inputs     = cfg.inputs || [];
    this._soundModes = (cfg.soundModes && cfg.soundModes.length) ? cfg.soundModes : DEFAULT_SOUND_MODES;
    this._deviceKey  = `denon/${cfg.host.replace(/\./g, '_')}`;

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
        min: 0, max: cfg.maxVolume || 80,
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
      {
        path: 'sound_mode', label: 'Sound Mode', type: 'label',
      },
      { path: 'nowPlaying', label: 'Now Playing', type: 'label' },
      {
        path: 'sleep', label: 'Sleep Timer', unit: 'min',
        controllable: true, type: 'range',
        min: 0, max: 120,
        writeCmd: 'setSleep', capabilityId: 'sleep',
      },
    ];

    if (this._inputs.length) {
      sensors.push({
        path: 'input_idx', label: 'Source', unit: '',
        controllable: true, type: 'range',
        min: 0, max: this._inputs.length - 1,
        writeCmd: 'selectInput', capabilityId: 'input_idx',
        // inputNames exposed here so the dashboard can read it from readings
        inputNames: this._inputs,
      });
    }

    if (this._soundModes.length) {
      sensors.push({
        path: 'sound_mode_idx', label: 'Sound Mode', unit: '',
        controllable: true, type: 'range',
        min: 0, max: this._soundModes.length - 1,
        writeCmd: 'selectSoundMode', capabilityId: 'sound_mode_idx',
        inputNames: this._soundModes,
      });
    }

    this._registry.registerDevice({
      key:    this._deviceKey,
      label:  cfg.name || `Denon ${cfg.host}`,
      type:   'denon',
      homekit: [],
      sensors,
      _writeCapability: (capId, command, args) =>
        this._executeCommand(capId, command, args),
    });

    if (cfg.zone2) {
      this._zone2Key = `${this._deviceKey}/zone2`;
      const zone2Sensors = [
        {
          path: 'power', label: 'Power', format: 'on-off',
          controllable: true, type: 'toggle',
          writeOn: 'on', writeOff: 'standby',
          capabilityId: 'power',
        },
        {
          path: 'volume', label: 'Volume', unit: '%',
          controllable: true, type: 'range',
          min: 0, max: cfg.zone2MaxVolume || cfg.maxVolume || 80,
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
      ];

      if (this._inputs.length) {
        zone2Sensors.push({
          path: 'input_idx', label: 'Source', unit: '',
          controllable: true, type: 'range',
          min: 0, max: this._inputs.length - 1,
          writeCmd: 'selectInput', capabilityId: 'input_idx',
          inputNames: this._inputs,
        });
      }

      this._registry.registerDevice({
        key:    this._zone2Key,
        label:  `${cfg.name || `Denon ${cfg.host}`} Zone 2`,
        type:   'denon',
        homekit: [],
        sensors: zone2Sensors,
        _writeCapability: (capId, command, args) =>
          this._executeZone2Command(capId, command, args),
      });
    }

    this._connect();
    platformStatus.set('denon', true);
  }

  stop() {
    this._stopping = true;
    if (this._pollTimer)  clearInterval(this._pollTimer);
    if (this._reconnTimer) clearTimeout(this._reconnTimer);
    if (this._socket) { this._socket.destroy(); this._socket = null; }
  }

  // ── TCP Connection ──────────────────────────────────────────────────────────

  _connect() {
    if (this._stopping) return;
    const cfg = this._config.denon;

    this._socket = net.createConnection({ host: cfg.host, port: cfg.port || 23 }, () => {
      console.log(`[Denon] Connected to ${cfg.host}:${cfg.port || 23}`);
      this._buf = '';
      this._query();
      this._pollTimer = setInterval(() => this._query(), 30_000);
    });

    this._socket.setEncoding('utf8');
    this._socket.setTimeout(35_000);

    this._socket.on('data', data => {
      this._buf += data;
      let cr;
      while ((cr = this._buf.indexOf('\r')) !== -1) {
        const line = this._buf.slice(0, cr).trim();
        this._buf  = this._buf.slice(cr + 1);
        if (line) this._parseLine(line);
      }
    });

    this._socket.on('timeout', () => {
      this._query(); // send a heartbeat; resets the socket timer
    });

    this._socket.on('error', err => {
      console.error(`[Denon] Socket error: ${err.message}`);
    });

    this._socket.on('close', () => {
      if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
      if (!this._stopping) {
        console.log('[Denon] Disconnected — reconnecting in 15 s');
        this._reconnTimer = setTimeout(() => this._connect(), 15_000);
      }
    });
  }

  _query() {
    this._send('PW?');
    this._send('MV?');
    this._send('MU?');
    this._send('SI?');
    this._send('MS?');
    this._send('SLP?');
    this._send('NSE?'); // Net/USB now-playing display lines — ignored by receivers/sources that don't support it
    if (this._zone2Key) {
      this._send('Z2?');
      this._send('Z2MU?');
    }
  }

  // ── Response Parser ─────────────────────────────────────────────────────────

  _parseLine(line) {
    const dk = this._deviceKey;

    if (this._zone2Key && line.startsWith('Z2')) {
      this._parseZone2Line(line);
      return;
    }

    if (line.startsWith('PW')) {
      this._store.update(`${dk}/power`, line === 'PWON' ? 1 : 0);
      return;
    }

    if (line.startsWith('MU')) {
      this._store.update(`${dk}/mute`, line === 'MUON' ? 1 : 0);
      return;
    }

    if (line.startsWith('MV')) {
      if (line.startsWith('MVMAX')) return; // ignore max-volume info line
      const raw = line.slice(2);
      const n   = parseInt(raw, 10);
      if (isNaN(n)) return;
      // Denon sends 3-char values for half-dB steps (e.g. 505 = 50.5)
      const vol = raw.length === 3 ? n / 10 : n;
      this._store.update(`${dk}/volume`, vol);
      return;
    }

    if (line.startsWith('SI')) {
      const raw = line.slice(2);
      const label = INPUT_NAMES[raw] || raw;
      this._store.update(`${dk}/input`, label);
      const idx = this._inputs.indexOf(raw);
      if (idx !== -1) this._store.update(`${dk}/input_idx`, idx);
      return;
    }

    if (line.startsWith('MS')) {
      const raw = line.slice(2);
      this._store.update(`${dk}/sound_mode`, raw);
      const idx = this._soundModes.indexOf(raw);
      if (idx !== -1) this._store.update(`${dk}/sound_mode_idx`, idx);
      return;
    }

    if (line.startsWith('SLP')) {
      const raw = line.slice(3);
      const val = raw === 'OFF' ? 0 : parseInt(raw, 10);
      if (!isNaN(val)) this._store.update(`${dk}/sleep`, val);
      return;
    }

    // NSE0..NSE4: Net/USB front-panel display lines (service/artist/album/
    // track — the exact line-to-field mapping isn't consistent across
    // sources/firmware, so rather than mislabel them, all non-empty lines
    // are just joined into one "Now Playing" string.
    const nse = line.match(/^NSE(\d)(.*)$/);
    if (nse) {
      const idx = parseInt(nse[1], 10);
      if (idx >= 0 && idx < this._nseLines.length) {
        this._nseLines[idx] = nse[2].trim();
        this._store.update(`${dk}/nowPlaying`, this._nseLines.filter(Boolean).join(' • '));
      }
      return;
    }
  }

  // Zone 2 replies are all prefixed "Z2" but pack power/mute/volume/input
  // into the same namespace, so they need to be disambiguated by shape.
  _parseZone2Line(line) {
    const zk  = this._zone2Key;
    const raw = line.slice(2);

    if (raw === 'ON' || raw === 'OFF') {
      this._store.update(`${zk}/power`, raw === 'ON' ? 1 : 0);
      return;
    }
    if (raw.startsWith('MU')) {
      this._store.update(`${zk}/mute`, raw === 'MUON' ? 1 : 0);
      return;
    }
    if (/^\d{2,3}$/.test(raw)) {
      const n = parseInt(raw, 10);
      this._store.update(`${zk}/volume`, raw.length === 3 ? n / 10 : n);
      return;
    }
    // Anything else is an input code.
    const label = INPUT_NAMES[raw] || raw;
    this._store.update(`${zk}/input`, label);
    const idx = this._inputs.indexOf(raw);
    if (idx !== -1) this._store.update(`${zk}/input_idx`, idx);
  }

  // ── Command Dispatch ────────────────────────────────────────────────────────

  async _executeCommand(capId, command, args) {
    switch (capId) {
      case 'power':
        this._send(command === 'on' ? 'PWON' : 'PWSTANDBY');
        break;
      case 'volume': {
        const cfg = this._config.denon;
        const max = cfg.maxVolume || 80;
        const vol = Math.round(Math.max(0, Math.min(max, args?.[0] ?? 50)));
        this._send(`MV${vol.toString().padStart(2, '0')}`);
        break;
      }
      case 'mute':
        this._send(command === 'on' ? 'MUON' : 'MUOFF');
        break;
      case 'input_idx': {
        const idx   = Math.round(args?.[0] ?? 0);
        const input = this._inputs[idx];
        if (input) this._send(`SI${input}`);
        break;
      }
      case 'volume_up':
        this._send('MVUP');
        break;
      case 'volume_down':
        this._send('MVDOWN');
        break;
      case 'sound_mode_idx': {
        const idx  = Math.round(args?.[0] ?? 0);
        const mode = this._soundModes[idx];
        if (mode) this._send(`MS${mode}`);
        break;
      }
      case 'sleep': {
        const min = Math.round(Math.max(0, Math.min(120, args?.[0] ?? 0)));
        this._send(min === 0 ? 'SLPOFF' : `SLP${min.toString().padStart(3, '0')}`);
        break;
      }
    }
  }

  async _executeZone2Command(capId, command, args) {
    switch (capId) {
      case 'power':
        this._send(command === 'on' ? 'Z2ON' : 'Z2OFF');
        break;
      case 'volume': {
        const cfg = this._config.denon;
        const max = cfg.zone2MaxVolume || cfg.maxVolume || 80;
        const vol = Math.round(Math.max(0, Math.min(max, args?.[0] ?? 50)));
        this._send(`Z2${vol.toString().padStart(2, '0')}`);
        break;
      }
      case 'volume_up':
        this._send('Z2UP');
        break;
      case 'volume_down':
        this._send('Z2DOWN');
        break;
      case 'mute':
        this._send(command === 'on' ? 'Z2MUON' : 'Z2MUOFF');
        break;
      case 'input_idx': {
        const idx   = Math.round(args?.[0] ?? 0);
        const input = this._inputs[idx];
        if (input) this._send(`Z2${input}`);
        break;
      }
    }
  }

  // ── TCP Helper ──────────────────────────────────────────────────────────────

  _send(cmd) {
    if (this._socket && !this._socket.destroyed) {
      this._socket.write(cmd + '\r');
    }
  }
}

module.exports = DenonClient;
