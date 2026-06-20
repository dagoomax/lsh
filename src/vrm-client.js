/**
 * VRM Cloud API client — polls Victron VRM for live data.
 * Supports both API-token auth (Token xxx) and email/password auth (Bearer xxx).
 *
 * VRM diagnostics records look like:
 *   { idDataAttribute: 852, rawValue: 87.5, formattedValue: "88%" }
 * We match on idDataAttribute to map to our store paths.
 */

// ── VRM attribute ID → store path mapping ─────────────────────────────────
// IDs verified against live VRM diagnostics endpoint
const ATTR_MAP = [
  // Battery (from battery monitor / BMS)
  { id: 144,  path: 'system/0/Dc/Battery/Soc' },          // Battery SOC %
  { id: 240,  path: 'system/0/Dc/Battery/Soc',    alt: true }, // VE.Bus SOC backup
  { id: 32,   path: 'system/0/Dc/Battery/Voltage' },      // DC Voltage V
  { id: 33,   path: 'system/0/Dc/Battery/Current' },      // DC Current A
  { id: 215,  path: 'system/0/Dc/Battery/BatteryState' }, // 1=charging 2=discharging
  { id: 51,   path: 'system/0/Dc/Battery/Soc',    alt: true }, // Alt SOC
  { id: 52,   path: 'system/0/Dc/Battery/TimeToGo' },     // Seconds remaining

  // Solar — MPPT (DC-coupled)
  { id: 442,  path: 'system/0/Dc/Pv/Power' },             // MPPT PV power W
  { id: 86,   path: 'solarcharger/0/Pv/V' },              // PV voltage V
  { id: 94,   path: 'system/0/PvChargerAggregated/Yield/User' }, // Yield today kWh
  { id: 96,   path: 'solarcharger/0/History/Daily/1/Yield' },    // Yield yesterday
  { id: 285,  path: 'solarcharger/0/Yield/Total' },       // Total yield kWh
  { id: 518,  path: 'solarcharger/0/State' },             // MPPT state

  // Solar — AC-coupled PV inverters (added to PV power total)
  { id: 111,  path: 'system/0/Ac/PvOnOutput/L1/Power' },
  { id: 127,  path: 'system/0/Ac/PvOnOutput/L2/Power' },
  { id: 128,  path: 'system/0/Ac/PvOnOutput/L3/Power' },
  { id: 112,  path: 'system/0/Ac/PvOnGenset/L1/Power' },
  { id: 113,  path: 'system/0/Dc/Pv/Power2' },           // DC-coupled total

  // Grid / AC input (VE.Bus)
  { id: 8,    path: 'system/0/Ac/Grid/L1/Voltage' },
  { id: 9,    path: 'system/0/Ac/Grid/L2/Voltage' },
  { id: 10,   path: 'system/0/Ac/Grid/L3/Voltage' },
  { id: 11,   path: 'system/0/Ac/Grid/L1/Current' },
  { id: 12,   path: 'system/0/Ac/Grid/L2/Current' },
  { id: 13,   path: 'system/0/Ac/Grid/L3/Current' },
  { id: 14,   path: 'system/0/Ac/Grid/L1/Frequency' },
  { id: 17,   path: 'system/0/Ac/Grid/L1/Power' },
  { id: 18,   path: 'system/0/Ac/Grid/L2/Power' },
  { id: 19,   path: 'system/0/Ac/Grid/L3/Power' },
  { id: 35,   path: 'system/0/Ac/Grid/Available' },       // Active input (0=grid)

  // AC Output / Loads
  { id: 20,   path: 'system/0/Ac/Out/L1/Voltage' },
  { id: 21,   path: 'system/0/Ac/Out/L2/Voltage' },
  { id: 22,   path: 'system/0/Ac/Out/L3/Voltage' },
  { id: 26,   path: 'system/0/Ac/Out/L1/Frequency' },
  { id: 29,   path: 'system/0/Ac/Out/L1/Power' },
  { id: 30,   path: 'system/0/Ac/Out/L2/Power' },
  { id: 31,   path: 'system/0/Ac/Out/L3/Power' },

  // AC Consumption totals
  { id: 131,  path: 'system/0/Ac/Consumption/L1/Power' },
  { id: 132,  path: 'system/0/Ac/Consumption/L2/Power' },
  { id: 133,  path: 'system/0/Ac/Consumption/L3/Power' },

  // Relays
  { id: 306,  path: 'system/0/Relay/0/State' },
  { id: 335,  path: 'system/0/Relay/1/State' },

  // VE.Bus device
  { id: 42,   path: 'vebus/257/Dc/0/Temperature' },
  { id: 244,  path: 'battery/0/History/DischargedEnergy' },
  { id: 245,  path: 'battery/0/History/ChargedEnergy' },
];

// Build lookup: id → { path, alt }  (primary entries take priority)
const ATTR_ID_SET = new Map();
for (const a of ATTR_MAP) {
  if (!a.alt || !ATTR_ID_SET.has(a.id)) ATTR_ID_SET.set(a.id, a);
}

class VrmClient {
  constructor(config, store) {
    this.config      = config;
    this.store       = store;
    this.authHeader  = null;
    this.pollTimer   = null;
    this.connected   = false;
  }

  async start() {
    const { vrm } = this.config;
    if (!vrm.installationId) throw new Error('VRM installationId not configured');

    this.authHeader = await this._resolveAuth();
    this.connected  = true;
    console.log('[VRM] Authenticated, starting poll');
    this._startPolling();
  }

  async _resolveAuth() {
    const { vrm } = this.config;

    if (vrm.apiToken?.trim()) {
      console.log('[VRM] Using API token auth');
      return `Token ${vrm.apiToken.trim()}`;
    }

    if (!vrm.email || !vrm.password) {
      throw new Error('VRM credentials not configured (need apiToken or email+password)');
    }

    const res  = await fetch('https://vrmapi.victronenergy.com/v2/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username: vrm.email, password: vrm.password }),
    });

    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch {
      throw new Error(`VRM returned non-JSON (HTTP ${res.status}): ${raw.slice(0, 120)}`);
    }

    if (!res.ok || !data.token) {
      const e = data?.errors ?? data?.error ?? data?.error_description ?? `HTTP ${res.status}`;
      const msg = typeof e === 'string' ? e
                : typeof e === 'object' ? JSON.stringify(e)
                : String(e);
      throw new Error(`VRM auth failed: ${msg}`);
    }

    console.log('[VRM] Email/password auth successful');
    return `Bearer ${data.token}`;
  }

  _startPolling() {
    this._poll();
    this.pollTimer = setInterval(() => this._poll(), 15000);
  }

  async _poll() {
    try {
      const id  = this.config.vrm.installationId;
      const res = await fetch(
        `https://vrmapi.victronenergy.com/v2/installations/${id}/diagnostics?count=1000`,
        { headers: { 'x-authorization': this.authHeader } }
      );

      if (res.status === 401) {
        console.log('[VRM] Token expired — re-authenticating…');
        this.authHeader = await this._resolveAuth();
        return this._poll();
      }

      if (!res.ok) {
        console.error(`[VRM] Poll failed: HTTP ${res.status}`);
        return;
      }

      const data    = await res.json();
      const records = data?.records;

      if (!Array.isArray(records)) {
        console.warn('[VRM] Unexpected diagnostics response:', JSON.stringify(data).slice(0, 200));
        return;
      }

      let mapped = 0;
      // Track which primary paths have been written so alt IDs don't overwrite
      const written = new Set();

      for (const rec of records) {
        const entry = ATTR_ID_SET.get(rec.idDataAttribute);
        if (!entry) continue;
        if (entry.alt && written.has(entry.path)) continue; // primary already written

        const value = rec.rawValue ?? rec.formattedValue;
        if (value !== null && value !== undefined) {
          const num = parseFloat(value);
          this.store.update(entry.path, isNaN(num) ? value : num);
          written.add(entry.path);
          mapped++;
        }
      }

      if (mapped === 0) {
        console.warn(`[VRM] Poll returned ${records.length} records but none matched known attribute IDs`);
        // Log a sample so we can debug unknown IDs
        records.slice(0, 5).forEach((r) =>
          console.log(`  id=${r.idDataAttribute} desc="${r.description}" raw=${r.rawValue}`)
        );
      } else {
        console.log(`[VRM] Poll OK — ${mapped} values updated`);
      }
    } catch (err) {
      console.error('[VRM] Poll error:', err.message);
    }
  }

  writeRelay(relayIndex, state) {
    const id = this.config.vrm.installationId;
    const body = JSON.stringify({ state: state ? 1 : 0 });
    fetch(`https://vrmapi.victronenergy.com/v2/installations/${id}/relay/${relayIndex}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-authorization': this.authHeader },
      body,
    }).then((r) => {
      if (!r.ok) console.error(`[VRM] Relay write failed: HTTP ${r.status}`);
      else console.log(`[VRM] Relay ${relayIndex} → ${state ? 'ON' : 'OFF'}`);
    }).catch((err) => console.error('[VRM] Relay write error:', err.message));
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.connected = false;
    console.log('[VRM] Stopped');
  }
}

module.exports = VrmClient;
