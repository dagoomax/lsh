'use strict';

const platformStatus = require('./platform-status');

// OpenWeatherMap's icon code → a small emoji set matching this app's existing
// convention of emoji icons for simpler devices (🔔 the SIP doorbell, 🧩
// virtual devices, ⛅ this device's own tile).
const ICON_MAP = {
  '01': '☀️', '02': '🌤️', '03': '☁️', '04': '☁️',
  '09': '🌧️', '10': '🌦️', '11': '⛈️', '13': '❄️', '50': '🌫️',
};
function emojiFor(owmIcon) {
  return ICON_MAP[(owmIcon || '').slice(0, 2)] || '🌡️';
}

/**
 * OpenWeatherMap — Current Weather Data API (the free-tier, no-subscription
 * endpoint) plus the free 5 Day / 3 Hour Forecast API for the dashboard's
 * forecast strip. Both work with the same plain API key — no separate One
 * Call subscription needed. That forecast endpoint genuinely only covers 5
 * days (40 x 3-hour steps), not 7 — a real 7-8 day forecast needs OpenWeather's
 * One Call 3.0 product, which is a separate opt-in subscription (still free
 * within its own limits, but not automatically included with a basic key).
 * Capped honestly at 5 here rather than silently padding fake days.
 *
 * cfg = { apiKey, lat, lon, units: 'metric'|'imperial', name?, pollInterval }
 */
class OpenWeatherClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._timer    = null;
    this._forecast = [];
  }

  async start() {
    const cfg = this._config.openweather;
    if (!cfg?.apiKey || cfg.lat == null || cfg.lon == null) return;

    this._key = 'openweather/weather';
    this._registry.registerDevice({
      key: this._key, label: cfg.name || 'Weather', type: 'openweather', icon: '⛅', homekit: ['temperature'],
      sensors: [
        { path: 'condition',   name: 'Condition',    type: 'label' },
        { path: 'temperature', name: 'Temperature',  type: 'number', unit: cfg.units === 'imperial' ? '°F' : '°C', precision: 1, homekit: 'temperature' },
        { path: 'feelsLike',   name: 'Feels Like',   type: 'number', unit: cfg.units === 'imperial' ? '°F' : '°C', precision: 1 },
        { path: 'humidity',    name: 'Humidity',     type: 'number', unit: '%' },
        { path: 'pressure',    name: 'Pressure',     type: 'number', unit: 'hPa' },
        { path: 'windSpeed',   name: 'Wind Speed',   type: 'number', unit: cfg.units === 'imperial' ? 'mph' : 'm/s', precision: 1 },
        { path: 'windDir',     name: 'Wind Direction', type: 'number', unit: '°' },
        { path: 'cloudiness',  name: 'Cloudiness',   type: 'number', unit: '%' },
        { path: 'visibility',  name: 'Visibility',   type: 'number', unit: 'm' },
        { path: 'sunrise',     name: 'Sunrise',      type: 'number', unit: 's' },
        { path: 'sunset',      name: 'Sunset',       type: 'number', unit: 's' },
      ],
    });

    await this._poll(true);
    const interval = Math.max(cfg.pollInterval || 600, 60) * 1000; // min 60s — be polite to the free tier
    this._timer = setInterval(() => this._poll().catch((err) => {
      console.error(`[OpenWeather] Poll error: ${err.message}`);
      platformStatus.set('openweather', false);
    }), interval);
    console.log(`[OpenWeather] Started — polling every ${interval / 1000}s`);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  /** Cached daily forecast (see aggregation notes on the class) — for the dashboard's forecast strip. */
  getForecast() {
    return this._forecast;
  }

  async _poll(initial = false) {
    const cfg = this._config.openweather;
    const units = cfg.units === 'imperial' ? 'imperial' : 'metric';
    const qs = `lat=${encodeURIComponent(cfg.lat)}&lon=${encodeURIComponent(cfg.lon)}&units=${units}&appid=${encodeURIComponent(cfg.apiKey)}`;

    const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?${qs}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 150)}`);
    }
    const data = await res.json();

    const k = this._key;
    if (data.weather?.[0]?.description) this._store.update(`${k}/condition`, data.weather[0].description);
    if (data.main?.temp != null)         this._store.update(`${k}/temperature`, data.main.temp);
    if (data.main?.feels_like != null)   this._store.update(`${k}/feelsLike`, data.main.feels_like);
    if (data.main?.humidity != null)     this._store.update(`${k}/humidity`, data.main.humidity);
    if (data.main?.pressure != null)     this._store.update(`${k}/pressure`, data.main.pressure);
    if (data.wind?.speed != null)        this._store.update(`${k}/windSpeed`, data.wind.speed);
    if (data.wind?.deg != null)          this._store.update(`${k}/windDir`, data.wind.deg);
    if (data.clouds?.all != null)        this._store.update(`${k}/cloudiness`, data.clouds.all);
    if (data.visibility != null)         this._store.update(`${k}/visibility`, data.visibility);
    if (data.sys?.sunrise != null)       this._store.update(`${k}/sunrise`, data.sys.sunrise);
    if (data.sys?.sunset != null)        this._store.update(`${k}/sunset`, data.sys.sunset);

    await this._pollForecast(qs, units).catch((err) => console.error(`[OpenWeather] Forecast poll failed: ${err.message}`));

    platformStatus.set('openweather', true);
    if (initial) console.log(`[OpenWeather] Started for ${data.name || `${cfg.lat},${cfg.lon}`}`);
  }

  async _pollForecast(qs, units) {
    const res = await fetch(`https://api.openweathermap.org/data/2.5/forecast?${qs}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 150)}`);
    }
    const data = await res.json();
    const tzOffset = data.city?.timezone || 0; // seconds, location-local vs UTC

    // Bucket the 3-hour steps by local calendar date.
    const days = new Map(); // 'YYYY-MM-DD' → { dateKey, entries: [...] }
    for (const step of data.list || []) {
      const dateKey = new Date((step.dt + tzOffset) * 1000).toISOString().slice(0, 10);
      if (!days.has(dateKey)) days.set(dateKey, { dateKey, entries: [] });
      days.get(dateKey).entries.push(step);
    }

    this._forecast = [...days.values()].slice(0, 5).map((day) => {
      const temps = day.entries.map((e) => e.main?.temp).filter((n) => n != null);
      const pops  = day.entries.map((e) => e.pop).filter((n) => n != null);
      // Representative condition/icon: the step closest to local noon reads
      // better than "most frequent", which tends to over-weight overnight
      // clear-sky steps for a day that's actually rainy in the afternoon.
      const noonStep = day.entries.reduce((best, e) => {
        const hour = new Date((e.dt + tzOffset) * 1000).getUTCHours();
        const dist = Math.abs(hour - 12);
        return (!best || dist < best.dist) ? { dist, e } : best;
      }, null)?.e || day.entries[0];

      return {
        date:      day.dateKey,
        tempMin:   temps.length ? Math.min(...temps) : null,
        tempMax:   temps.length ? Math.max(...temps) : null,
        pop:       pops.length ? Math.round(Math.max(...pops) * 100) : 0,
        condition: noonStep?.weather?.[0]?.description || '',
        icon:      emojiFor(noonStep?.weather?.[0]?.icon),
      };
    });
  }
}

module.exports = OpenWeatherClient;
