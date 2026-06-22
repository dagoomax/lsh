const EventEmitter = require('events');

// KNX 2-byte float decode (DPT9)
function decodeDPT9(b0, b1) {
  const sign = (b0 & 0x80) >> 7;
  const exp  = (b0 & 0x78) >> 3;
  let mant   = ((b0 & 0x07) << 8) | b1;
  if (sign) mant -= 2048;
  return Math.round(0.01 * mant * Math.pow(2, exp) * 100) / 100;
}

// KNX 2-byte float encode (DPT9)
function encodeDPT9(value) {
  const sign = value < 0 ? 1 : 0;
  let mant   = Math.round(Math.abs(value) / 0.01);
  let exp    = 0;
  while (mant > 2047) { mant >>= 1; exp++; }
  if (sign) mant = 2048 - mant;
  return [(sign << 7) | (exp << 3) | ((mant >> 8) & 0x07), mant & 0xFF];
}

function parseValue(raw, dpt) {
  if (!raw || raw.length === 0) return null;
  const base = (dpt || '').split('.')[0].toUpperCase();
  switch (base) {
    case 'DPT1':  return raw[0] ? true : false;
    case 'DPT5':  return raw[0];                // 0-255; UI can show as % if unit set
    case 'DPT9':  return raw.length >= 2 ? decodeDPT9(raw[0], raw[1]) : null;
    case 'DPT14': return raw.length >= 4 ? Buffer.from(raw).readFloatBE(0) : null;
    default:      return raw[0] ?? null;
  }
}

function encodeValue(value, dpt) {
  const base = (dpt || '').split('.')[0].toUpperCase();
  switch (base) {
    case 'DPT1':  return value ? 1 : 0;
    case 'DPT5':  return Math.max(0, Math.min(255, Math.round(Number(value))));
    case 'DPT9':  return encodeDPT9(Number(value));
    default:      return Number(value);
  }
}

const DPT_META = {
  DPT1:  { type: 'boolean', homekitType: 'Switch' },
  DPT5:  { type: 'range',   min: 0, max: 255 },
  DPT9:  { type: 'float' },
  DPT14: { type: 'float' },
};

class KNXClient extends EventEmitter {
  constructor(config, store, sensorRegistry) {
    super();
    this._cfg  = config.knx;
    this._reg  = sensorRegistry;
    this._conn = null;
  }

  async start() {
    const cfg = this._cfg;
    const gas = cfg.groupAddresses || [];
    if (!cfg.host) return;

    let knxLib;
    try {
      knxLib = require('knx');
    } catch {
      console.error('[KNX] Package not installed — run: npm install knx');
      return;
    }

    const deviceKey = `knx/${cfg.host}`;

    this._conn = knxLib.Connection({
      ipAddr:     cfg.host,
      ipPort:     parseInt(cfg.port) || 3671,
      handlers: {
        connected: () => {
          console.log(`[KNX] Connected to ${cfg.host}:${cfg.port || 3671}`);
          this._registerDevice(deviceKey, gas);
          gas.forEach(ga => {
            if (ga.readable !== false) {
              try { this._conn.read(ga.address); } catch {}
            }
          });
        },

        event: (evt, src, dest, rawValue) => {
          if (evt !== 'GroupValue_Write' && evt !== 'GroupValue_Response') return;
          const ga = gas.find(g => g.address === dest);
          if (!ga) return;
          const value = parseValue(rawValue, ga.dpt);
          if (value === null) return;
          this._reg.update(deviceKey, { [ga.address]: value });
        },

        error: (err) => {
          console.error(`[KNX] ${err}`);
        },
      },
    });
  }

  _registerDevice(deviceKey, gas) {
    const sensors = gas.map(ga => {
      const base = (ga.dpt || 'DPT1').split('.')[0].toUpperCase();
      const meta = DPT_META[base] || { type: 'float' };
      return {
        path:         ga.address,
        name:         ga.name || ga.address,
        type:         meta.type,
        unit:         ga.unit  || undefined,
        min:          ga.min   ?? meta.min,
        max:          ga.max   ?? meta.max,
        controllable: !!ga.writable,
        homekitType:  ga.homekitType || meta.homekitType || null,
      };
    });

    this._reg.register({
      key:    deviceKey,
      label:  'KNX Bus',
      icon:   'knx',
      color:  '#e85d00',
      sensors,
      sendCommand: (address, value) => {
        const ga = gas.find(g => g.address === address);
        if (!ga?.writable || !this._conn) return;
        try {
          this._conn.write(address, encodeValue(value, ga.dpt), ga.dpt || 'DPT1');
        } catch (err) {
          console.error(`[KNX] Write ${address} failed: ${err.message}`);
        }
      },
    });
  }
}

module.exports = KNXClient;
