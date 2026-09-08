'use strict';

const platformStatus = require('./platform-status');

// TAURON's dynamic tariff (G14dynamic) settles hourly against PSE's public
// RCE (Rynkowa Cena Energii) index — the day-ahead-market clearing price,
// published free with no auth or API key at api.raporty.pse.pl in 15-minute
// steps, four of which are averaged into one hourly rate (PSE's own
// documented method for deriving an hourly price from the 15-min series).
// This client tracks that same public index and applies a configurable
// markup + VAT to approximate the retail price. Tauron's actual bill also
// bakes in distribution charges that vary per contract and aren't published
// in a fetchable form anywhere, so `currentPrice` is a good-faith estimate
// for the Energy tab's "electricity cost" reading — not a guaranteed match
// to an actual invoice line.
const PSE_RCE_URL = 'https://api.raporty.pse.pl/api/rce-pln';

class TauronTariffClient {
  constructor(config, store, sensorRegistry) {
    this._config = config;
    this._store = store;
    this._registry = sensorRegistry;
    this._timer = null;
    this._hourly = []; // [{ hour: 0-23, pricePlnMwh, pricePlnKwh }] for today, PLN/kWh already gross (markup+VAT applied)
  }

  async start() {
    const cfg = this._config.tauronTariff;
    if (!cfg?.enabled) return;

    this._key = 'tauron-tariff/pl';
    this._markup = Number(cfg.markupPlnKwh) || 0;
    this._vat = cfg.vatRate != null ? Number(cfg.vatRate) : 0.23;

    this._registry.registerDevice({
      key: this._key, label: cfg.name || 'Electricity Price', type: 'tauron-tariff', icon: '⚡',
      sensors: [
        { path: 'currentPrice',    name: 'Current Price',        type: 'number', unit: 'PLN/kWh', precision: 3 },
        { path: 'currentPriceRce', name: 'Market Price (RCE)',   type: 'number', unit: 'PLN/MWh',  precision: 2 },
      ],
    });

    // A day-ahead market index, not live telemetry — polling every few
    // minutes would just refetch the same 96 rows PSE published once for
    // the day. Default 30 min is plenty to pick up the new day's rows
    // shortly after PSE publishes them (~14:00 for the following day).
    const interval = Math.max(cfg.pollInterval || 1800, 300) * 1000;
    this._timer = setInterval(() => this._poll().catch((err) => {
      console.error(`[TauronTariff] Poll error: ${err.message}`);
      platformStatus.set('tauronTariff', false);
    }), interval);
    console.log(`[TauronTariff] Started — polling PSE RCE every ${interval / 1000}s`);

    await this._poll().catch((err) => {
      console.error(`[TauronTariff] Initial poll failed, will retry on schedule: ${err.message}`);
      platformStatus.set('tauronTariff', false);
    });
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  /** Today's hourly rate, PLN/kWh (markup+VAT applied) — for the Energy tab's solar-gain chart. */
  getHourly() {
    return this._hourly;
  }

  _grossPerKwh(pricePlnMwh) {
    return (pricePlnMwh / 1000 + this._markup) * (1 + this._vat);
  }

  async _poll() {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${PSE_RCE_URL}?$filter=business_date eq '${today}'`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 150)}`);
    }
    const data = await res.json();
    const rows = data.value || [];
    if (!rows.length) throw new Error('No RCE rows returned for today');

    const byHour = new Map();
    for (const row of rows) {
      const hour = new Date(row.dtime).getHours();
      const list = byHour.get(hour) || [];
      list.push(row.rce_pln);
      byHour.set(hour, list);
    }
    this._hourly = [...byHour.entries()]
      .map(([hour, vals]) => {
        const pricePlnMwh = vals.reduce((a, b) => a + b, 0) / vals.length;
        return { hour, pricePlnMwh, pricePlnKwh: +this._grossPerKwh(pricePlnMwh).toFixed(4) };
      })
      .sort((a, b) => a.hour - b.hour);

    const nowHour = new Date().getHours();
    const current = this._hourly.find((h) => h.hour === nowHour) || this._hourly[this._hourly.length - 1];
    if (current) {
      this._store.update(`${this._key}/currentPriceRce`, +current.pricePlnMwh.toFixed(2));
      this._store.update(`${this._key}/currentPrice`, current.pricePlnKwh);
    }

    platformStatus.set('tauronTariff', true);
  }
}

module.exports = TauronTariffClient;
