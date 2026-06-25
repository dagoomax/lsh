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
    this._inputs      = [];
    this._stopping    = false;
  }

  async start() {
    const cfg = this._config.denon;
    if (!cfg?.host) return;

    this._inputs    = cfg.inputs || [];
    this._deviceKey = `denon/${cfg.host.replace(/\./g, '_')}`;

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
        path: 'mute', label: 'Mute', format: 'on-off',
        controllable: true, type: 'toggle',
        writeOn: 'on', writeOff: 'off',
        capabilityId: 'mute',
      },
      { path: 'input', label: 'Input', type: 'label' },
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

    this._registry.registerDevice({
      key:    this._deviceKey,
      label:  cfg.name || `Denon ${cfg.host}`,
      type:   'denon',
      homekit: [],
      sensors,
      _writeCapability: (capId, command, args) =>
        this._executeCommand(capId, command, args),
    });

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
  }

  // ── Response Parser ─────────────────────────────────────────────────────────

  _parseLine(line) {
    const dk = this._deviceKey;

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
