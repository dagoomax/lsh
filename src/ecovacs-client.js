'use strict';

// Ecovacs Deebot robot vacuums (and yeedi) — cloud only, same account as the
// Ecovacs Home app. Uses the ecovacs-deebot library (mrbungle64/ecovacs-deebot.js,
// the one behind ioBroker's Deebot adapter): HTTP login to Ecovacs' portal,
// then one MQTT (or XMPP for legacy models) session per robot that pushes
// state events. We also ask for battery/clean/charge state every pollSeconds
// in case a push is missed.
//
// config.ecovacs = { email, password, country: 'PL', did?: '<robot did>',
//                    pollSeconds: 60 }
//   country  — the country the Ecovacs account was registered in (ISO code)
//   did      — optional, limit to one robot (shown by Test Login)

const fs             = require('fs');
const path           = require('path');
const crypto         = require('crypto');
const platformStatus = require('./platform-status');

const PERSIST_FILE = path.join(__dirname, '..', 'persist', 'ecovacs.json');
const RETRY_MS     = 60000;

// cleanReport values (library-normalized) that mean the robot is out working
const CLEANING = new Set(['auto', 'custom_area', 'spot', 'spot_area', 'singlePoint', 'area', 'edge', 'single_room', 'move']);

function lib() {
  return require('ecovacs-deebot');
}

// The portal wants a stable per-client device id; keep ours across restarts
function clientDeviceId() {
  try {
    const saved = JSON.parse(fs.readFileSync(PERSIST_FILE, 'utf8'));
    if (saved.deviceId) return saved.deviceId;
  } catch { /* first run */ }
  const deviceId = crypto.randomBytes(16).toString('hex');
  try {
    fs.mkdirSync(path.dirname(PERSIST_FILE), { recursive: true });
    fs.writeFileSync(PERSIST_FILE, JSON.stringify({ deviceId }, null, 2));
  } catch (err) {
    console.error(`[Ecovacs] Could not save ${PERSIST_FILE}: ${err.message}`);
  }
  return deviceId;
}

// Login + device list. Shared by the client and the Settings "Test Login".
async function login({ email, password, country = 'PL' }) {
  const { EcoVacsAPI } = lib();
  const api = new EcoVacsAPI(clientDeviceId(), String(country || 'PL').toUpperCase());
  await api.connect(String(email).trim(), EcoVacsAPI.md5(password));
  const devices = await api.devices();
  return { api, devices };
}

const describe = (d) => ({ did: d.did, name: d.nick || d.deviceName || d.did, model: d.deviceName || d.class || '' });

function statusOf(r) {
  if (r.error)                          return 'Error';
  if (r.charge === 'charging')          return 'Charging';
  if (r.charge === 'returning' || r.clean === 'returning') return 'Returning';
  if (CLEANING.has(r.clean))            return 'Cleaning';
  if (r.clean === 'pause')              return 'Paused';
  return 'Idle';
}

class EcovacsClient {
  constructor(config, store, sensorRegistry) {
    this.cfg       = config.ecovacs || {};
    this._store    = store;
    this._registry = sensorRegistry;
    this._api      = null;
    this._bots     = new Map(); // did → { vacbot, deviceKey, label, state }
    this._timer    = null;
    this._retry    = null;
    this._stopped  = false;
  }

  async start() {
    if (!this.cfg.email || !this.cfg.password) throw new Error('email and password are required');
    try {
      const { api, devices } = await login(this.cfg);
      this._api = api;
      const wanted = devices.filter((d) => !this.cfg.did || d.did === this.cfg.did);
      if (!wanted.length) throw new Error(this.cfg.did ? `Robot ${this.cfg.did} not on this account` : 'No robots on this account');
      for (const d of wanted) this._connect(d);
    } catch (err) {
      platformStatus.set('ecovacs', false);
      if (this._stopped) return;
      console.error(`[Ecovacs] Start failed: ${err.message} — retrying in 60s`);
      this._retry = setTimeout(() => this.start().catch(() => {}), RETRY_MS);
      return;
    }
    const every = Math.max(30, Number(this.cfg.pollSeconds) || 60) * 1000;
    this._timer = setInterval(() => this._pollAll(), every);
    this._timer.unref?.();
  }

  stop() {
    this._stopped = true;
    clearTimeout(this._retry);
    clearInterval(this._timer);
    for (const b of this._bots.values()) b.vacbot.disconnectAsync?.().catch(() => {});
    this._bots.clear();
  }

  _connect(d) {
    const { did, name, model } = describe(d);
    const vacbot    = this._api.getVacBotObj(d);
    const deviceKey = `ecovacs/${String(did).replace(/[^\w-]/g, '_')}`;
    const bot = { vacbot, deviceKey, label: name, state: { charge: null, clean: null, error: '' } };
    this._bots.set(did, bot);
    this._register(bot, model);

    const set = (k, v) => this._store.set(`${deviceKey}/${k}`, v);
    const refresh = () => {
      const s = bot.state;
      set('status', statusOf(s));
      set('cleaning', CLEANING.has(s.clean) || s.charge === 'returning' ? 1 : 0);
      set('charging', s.charge === 'charging' ? 1 : 0);
    };

    vacbot.on('ready', () => {
      console.log(`[Ecovacs] ${name} (${model}) connected`);
      set('online', true);
      platformStatus.set('ecovacs', true);
      this._poll(bot);
    });
    vacbot.on('BatteryInfo', (v) => { const n = Math.round(Number(v)); if (Number.isFinite(n)) set('battery', n) });
    vacbot.on('ChargeState', (v) => { bot.state.charge = v; refresh() });
    vacbot.on('CleanReport', (v) => { bot.state.clean = v; refresh() });
    vacbot.on('Error', (v) => {
      const msg = !v || /^no ?error/i.test(String(v)) ? '' : String(v);
      if (msg && msg !== bot.state.error) console.error(`[Ecovacs] ${name}: ${msg}`);
      bot.state.error = msg;
      set('error', msg);
      refresh();
    });
    // -1 = robot unreachable through the cloud, 0 = no error
    vacbot.on('ErrorCode', (code) => {
      set('online', String(code) !== '-1');
      if (String(code) === '0' && bot.state.error) { bot.state.error = ''; set('error', ''); refresh() }
    });

    vacbot.connect();
  }

  _poll({ vacbot }) {
    if (!vacbot.is_ready) return;
    vacbot.run('GetBatteryState');
    vacbot.run('GetCleanState');
    vacbot.run('GetChargeState');
  }

  _pollAll() {
    for (const b of this._bots.values()) this._poll(b);
  }

  _register(bot, model) {
    this._registry.registerDevice({
      key:   bot.deviceKey,
      type:  'ecovacs',
      label: bot.label,
      model: model ? `Ecovacs ${model}` : 'Ecovacs Deebot',
      icon:  '🤖',
      color: 'blue',
      sensors: [
        { path: 'battery',  name: 'Battery',  format: 'percent', unit: '%', homekit: 'battery-level' },
        { path: 'status',   name: 'Status',   format: 'string',  raw: true },
        {
          path: 'cleaning',     name: 'Cleaning', format: 'on-off',
          controllable: true,   type: 'toggle',   homekit: 'switch-rw',
          writeOn: 'start',     writeOff: 'dock',  capabilityId: 'cleaning',
        },
        { path: 'charging', name: 'Charging', format: 'on-off', hidden: true },
        { path: 'error',    name: 'Error',    format: 'string', raw: true },
        { path: 'online',   name: 'Online',   format: 'on-off', sensorType: 'connectivity', hidden: true },
      ],
      homekit: ['battery-level', 'switch-rw'],
      _writeCapability: (_capId, command) => this._command(bot, command),
    });
    console.log(`[Ecovacs] Registered ${bot.label}`);
  }

  // start | dock | stop | pause | resume | locate
  async _command({ vacbot, label }, command) {
    if (!vacbot.is_ready) throw new Error(`${label} is not connected`);
    const v2 = vacbot.is950type_V2?.();
    switch (command) {
      case 'start':  vacbot.run(v2 ? 'Clean_V2' : 'Clean'); break;
      case 'dock':   vacbot.run('Charge'); break;
      case 'stop':   vacbot.run('Stop'); break;
      case 'pause':  vacbot.run('Pause'); break;
      case 'resume': vacbot.run('Resume'); break;
      case 'locate': vacbot.run('PlaySound', 30); break; // "I'm here"
      default: throw new Error(`Unknown Ecovacs command: ${command}`);
    }
    console.log(`[Ecovacs] ${label}: ${command}`);
    return { success: true };
  }
}

EcovacsClient.login = login;
EcovacsClient.describe = describe;
module.exports = EcovacsClient;
