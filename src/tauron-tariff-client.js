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
// The PSE index is PLN-only; for any other display currency the price is
// converted with NBP's (Polish central bank) daily mid rate — table A, free,
// no key, published once per business day, so it's refetched only when the
// cached rate is from an earlier day.
const NBP_RATE_URL = 'https://api.nbp.pl/api/exchangerates/rates/a';

class TauronTariffClient {
  constructor(config, store, sensorRegistry) {
    this._config = config;
    this._store = store;
    this._registry = sensorRegistry;
    this._timer = null;
    this._hourly = []; // [{ hour: 0-23, pricePlnMwh, pricePlnKwh, price }] for today, PLN/kWh already gross (markup+VAT applied); `price` is per kWh in the display currency
    this._fx = { rate: 1, day: null }; // PLN per 1 unit of display currency
  }

  async start() {
    const cfg = this._config.tauronTariff;
    if (!cfg?.enabled) return;

    this._key = 'tauron-tariff/pl';
    this._markup = Number(cfg.markupPlnKwh) || 0;
    this._vat = cfg.vatRate != null ? Number(cfg.vatRate) : 0.23;
    this._currency = /^[A-Z]{3}$/.test(String(cfg.currency || '').toUpperCase()) ? cfg.currency.toUpperCase() : 'PLN';

    this._registry.registerDevice({
      key: this._key, label: cfg.name || 'Electricity Price', type: 'tauron-tariff', icon: '⚡',
      sensors: [
        { path: 'currentPrice',    name: 'Current Price',        type: 'number', unit: 'PLN/kWh', precision: 3 },
        { path: 'currentPriceRce', name: 'Market Price (RCE)',   type: 'number', unit: 'PLN/MWh',  precision: 2 },
        ...(this._currency !== 'PLN' ? [{ path: 'currentPriceLocal', name: `Current Price (${this._currency})`, type: 'number', unit: `${this._currency}/kWh`, precision: 3 }] : []),
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

  /** Today's hourly rate (markup+VAT applied) — for the Energy tab's solar-gain chart and earnings card. */
  getHourly() {
    return this._hourly;
  }

  getCurrency() {
    return { currency: this._currency, rate: this._fx.rate };
  }

  async _refreshFx() {
    if (this._currency === 'PLN') return;
    const today = new Date().toISOString().slice(0, 10);
    if (this._fx.day === today) return;
    const res = await fetch(`${NBP_RATE_URL}/${this._currency.toLowerCase()}/?format=json`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`NBP rate for ${this._currency}: HTTP ${res.status}`);
    const mid = (await res.json())?.rates?.[0]?.mid;
    if (!(mid > 0)) throw new Error(`NBP returned no rate for ${this._currency}`);
    this._fx = { rate: mid, day: today };
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

    // A failed FX fetch keeps the last known rate rather than failing the
    // whole poll; before the first success there's no rate to fall back on,
    // so _fx.day stays null and prices stay unconverted until it works.
    await this._refreshFx().catch((err) => console.error(`[TauronTariff] ${err.message}`));
    const fx = this._fx.day ? this._fx.rate : 1;
    const currency = this._fx.day || this._currency === 'PLN' ? this._currency : 'PLN';

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
        const pricePlnKwh = +this._grossPerKwh(pricePlnMwh).toFixed(4);
        return { hour, pricePlnMwh, pricePlnKwh, price: +(pricePlnKwh / fx).toFixed(4), currency };
      })
      .sort((a, b) => a.hour - b.hour);

    const nowHour = new Date().getHours();
    const current = this._hourly.find((h) => h.hour === nowHour) || this._hourly[this._hourly.length - 1];
    if (current) {
      this._store.update(`${this._key}/currentPriceRce`, +current.pricePlnMwh.toFixed(2));
      this._store.update(`${this._key}/currentPrice`, current.pricePlnKwh);
      this._store.update(`${this._key}/currency`, current.currency);
      if (this._currency !== 'PLN') this._store.update(`${this._key}/currentPriceLocal`, current.price);
    }

    platformStatus.set('tauronTariff', true);
  }
}

module.exports = TauronTariffClient;
