'use strict';

const platformStatus = require('./platform-status');

/**
 * Airly — air quality (CAQI index, PM1/PM2.5/PM10, gases) plus temperature,
 * humidity and pressure for one location, via Airly's "point" measurement
 * endpoint. That endpoint interpolates from nearby sensors, so it works for
 * any lat/lon rather than requiring a physical Airly sensor at the address.
 * Free API key from https://developer.airly.org.
 *
 * cfg = { apiKey, lat, lon, name?, pollInterval }
 */
class AirlyClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._timer    = null;
  }

  async start() {
    const cfg = this._config.airly;
    if (!cfg?.apiKey) return;
    if (cfg.lat == null || cfg.lon == null) {
      console.warn('[Airly] apiKey set but lat/lon missing — set both in Settings → Airly');
      return;
    }

    this._key = 'airly/weather';
    this._registry.registerDevice({
      key: this._key, label: cfg.name || 'Air Quality', type: 'airly', icon: '💨',
      homekit: ['air-quality', 'temperature', 'humidity'],
      sensors: [
        { path: 'airQuality',    name: 'CAQI Index',  type: 'number', precision: 1, homekit: 'air-quality' },
        { path: 'caqiLevel',     name: 'Air Quality',  type: 'label' },
        { path: 'fineDustLevel', name: 'PM2.5',        type: 'number', unit: 'μg/m³', format: 'pm25', precision: 1 },
        { path: 'dustLevel',     name: 'PM10',         type: 'number', unit: 'μg/m³', format: 'pm10', precision: 1 },
        { path: 'pm1',           name: 'PM1',          type: 'number', unit: 'μg/m³', precision: 1 },
        { path: 'no2',           name: 'NO₂',          type: 'number', unit: 'μg/m³', precision: 1 },
        { path: 'o3',            name: 'O₃',           type: 'number', unit: 'μg/m³', precision: 1 },
        { path: 'so2',           name: 'SO₂',          type: 'number', unit: 'μg/m³', precision: 1 },
        { path: 'co',            name: 'CO',           type: 'number', unit: 'μg/m³', precision: 1 },
        { path: 'temperature',   name: 'Temperature',  type: 'number', unit: '°C', precision: 1, homekit: 'temperature' },
        { path: 'humidity',      name: 'Humidity',     type: 'number', unit: '%', homekit: 'humidity' },
        { path: 'pressure',      name: 'Pressure',     type: 'number', unit: 'hPa' },
      ],
    });

    // Airly's free tier is quota-limited per day (as low as 100 req/day on a
    // trial key) — default to a conservative 15 min and refuse to go below
    // 5 min regardless of what's configured.
    const interval = Math.max(cfg.pollInterval || 900, 300) * 1000;
    this._timer = setInterval(() => this._poll().catch((err) => {
      console.error(`[Airly] Poll error: ${err.message}`);
      platformStatus.set('airly', false);
    }), interval);
    console.log(`[Airly] Started — polling every ${interval / 1000}s`);

    await this._poll(true).catch((err) => {
      console.error(`[Airly] Initial poll failed, will retry on schedule: ${err.message}`);
      platformStatus.set('airly', false);
    });
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  async _poll(initial = false) {
    // Re-entrancy guard: the recurring interval is armed before the initial
    // poll resolves (see start()), so a slow first request could otherwise
    // overlap a scheduled tick. Skip rather than queue.
    if (this._polling) {
      console.warn('[Airly] Skipping poll — previous one still in flight');
      return;
    }
    this._polling = true;
    try {
      await this._pollImpl(initial);
    } finally {
      this._polling = false;
    }
  }

  async _pollImpl(initial) {
    const cfg  = this._config.airly;
    const data = await fetchAirlyPoint(cfg.apiKey, cfg.lat, cfg.lon);

    const k      = this._key;
    const values = {};
    for (const v of data.current?.values || []) values[v.name] = v.value;

    const caqi = (data.current?.indexes || []).find((i) => i.name === 'AIRLY_CAQI') || data.current?.indexes?.[0];
    if (caqi) {
      this._store.update(`${k}/airQuality`, caqi.value);
      this._store.update(`${k}/caqiLevel`, caqi.level || '');
    }

    if (values.PM1 != null)         this._store.update(`${k}/pm1`, values.PM1);
    if (values.PM25 != null)        this._store.update(`${k}/fineDustLevel`, values.PM25);
    if (values.PM10 != null)        this._store.update(`${k}/dustLevel`, values.PM10);
    if (values.NO2 != null)         this._store.update(`${k}/no2`, values.NO2);
    if (values.O3 != null)          this._store.update(`${k}/o3`, values.O3);
    if (values.SO2 != null)         this._store.update(`${k}/so2`, values.SO2);
    if (values.CO != null)          this._store.update(`${k}/co`, values.CO);
    if (values.TEMPERATURE != null) this._store.update(`${k}/temperature`, values.TEMPERATURE);
    if (values.HUMIDITY != null)    this._store.update(`${k}/humidity`, values.HUMIDITY);
    if (values.PRESSURE != null)    this._store.update(`${k}/pressure`, values.PRESSURE);

    platformStatus.set('airly', true);
    if (initial) console.log(`[Airly] Started for ${cfg.lat},${cfg.lon}`);
  }
}

async function fetchAirlyPoint(apiKey, lat, lon) {
  const qs  = `lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lon)}`;
  const res = await fetch(`https://airapi.airly.eu/v2/measurements/point?${qs}`, {
    headers: { apikey: apiKey },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 150)}`);
  }
  return res.json();
}

module.exports = AirlyClient;
