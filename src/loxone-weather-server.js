'use strict';

/**
 * Loxone Weather Service emulator (Open-Meteo backend).
 *
 * The Miniserver hits, once an hour and after every reboot/program upload:
 *   GET http://weather.loxone.com:6066/forecast/
 *       ?user=loxone_<MAC>&coord=<lon>,<lat>&asl=<m>&format=2&new_api=1
 * Point weather.loxone.com at this host by DNS override, listen on 6066,
 * answer in the <mb_metadata>/<station> format below. Plain HTTP, no TLS.
 *
 * Response is NOT real XML — it's XML-ish tags wrapping a semicolon CSV block.
 * Column order is fixed; the Miniserver parses by position, not by name.
 *
 * NOT verified against a real Miniserver — test before relying on it or
 * shipping it to a client.
 */

const http           = require('http');
const platformStatus = require('./platform-status');

const DEFAULTS = {
  port: 6066,
  lat: 50.2649,          // Katowice
  lon: 19.0238,
  asl: 266,
  name: 'Katowice',
  country: 'PL',
  timezone: 'Europe/Warsaw',
  validUntil: '2049-12-31', // Miniserver warns once this subscription date passes
  cacheMs: 30 * 60 * 1000,
  // Loxone's own docs call the columns "local date"/"local time", but working
  // emulators emit UTC and let the Miniserver localise. Flip if hours look shifted.
  emitUtc: true,
  // First line inside <station> = the station-info row matching header line 1.
  // The original cloud service sends it; some emulators omit it. Keep it on.
  stationInfoLine: true,
};

const HEADER_STATION =
  'id;name;longitude;latitude;height (m.asl.);country;timezone;utc-timedifference;sunrise;sunset;';
const HEADER_HOURLY =
  'local date;weekday;local time;temperature(C);feeledTemperature(C);windspeed(km/h);' +
  'winddirection(degr);wind gust(km/h);low clouds(%);medium clouds(%);high clouds(%);' +
  'precipitation(mm);probability of Precip(%);snowFraction;sea level pressure(hPa);' +
  'relative humidity(%);CAPE;picto-code;radiation (W/m2);';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * WMO weather code -> Loxone picto-code.
 * Loxone's documented weather types: 1 clear, 2 bright, 3 cloudy, 4 very cloudy,
 * 5 overcast, 6 fog, 7 low fog, 10-12 rain, 13 drizzle, 14-15 freezing rain,
 * 16-17 rain showers, 18-19 thunderstorm, 20-22 snow, 23-24 snow showers,
 * 25-29 sleet. Community mapping tables disagree on a few values — check how
 * a handful of these actually render in the app before trusting the edges.
 */
const WMO_TO_PICTO = {
  0: 1, 1: 2, 2: 3, 3: 5,
  45: 6, 48: 7,
  51: 13, 53: 13, 55: 13,
  56: 14, 57: 15,
  61: 10, 63: 11, 65: 12,
  66: 14, 67: 15,
  71: 20, 73: 21, 75: 22, 77: 20,
  80: 16, 81: 17, 82: 17,
  85: 23, 86: 24,
  95: 18, 96: 19, 99: 19,
};

const HOURLY_VARS = [
  'temperature_2m', 'apparent_temperature', 'wind_speed_10m', 'wind_direction_10m',
  'wind_gusts_10m', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
  'precipitation', 'precipitation_probability', 'snowfall', 'pressure_msl',
  'relative_humidity_2m', 'weather_code', 'shortwave_radiation', 'cape',
].join(',');

class LoxoneWeatherServer {
  constructor(config) {
    this.cfg = { ...DEFAULTS, ...config.loxoneWeather };
    this.server = null;
    this.cache = null;
    this.cacheAt = 0;
  }

  async start() {
    platformStatus.set('loxoneWeather', false);
    this.server = http.createServer((req, res) => this._handle(req, res));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.cfg.port, () => resolve());
    });
    console.log(`[LoxoneWeather] listening on :${this.cfg.port}/forecast/`);
    platformStatus.set('loxoneWeather', true);
  }

  stop() {
    if (this.server) this.server.close();
    this.server = null;
    platformStatus.set('loxoneWeather', false);
  }

  async _handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/forecast')) {
      res.writeHead(404).end();
      return;
    }
    // The Miniserver sends coord=<longitude>,<latitude> — note the order.
    const coord = (url.searchParams.get('coord') || '').split(',');
    const lon = parseFloat(coord[0]) || this.cfg.lon;
    const lat = parseFloat(coord[1]) || this.cfg.lat;
    const asl = parseInt(url.searchParams.get('asl'), 10) || this.cfg.asl;

    try {
      const body = await this._buildResponse(lat, lon, asl);
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      platformStatus.set('loxoneWeather', true);
    } catch (err) {
      console.error('[LoxoneWeather] failed:', err.message);
      res.writeHead(500).end();
      platformStatus.set('loxoneWeather', false);
    }
  }

  async _fetchForecast(lat, lon) {
    if (this.cache && Date.now() - this.cacheAt < this.cfg.cacheMs) return this.cache;
    const u = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${lat}&longitude=${lon}`
      + `&hourly=${HOURLY_VARS}`
      + '&daily=sunrise,sunset&forecast_days=7&timeformat=unixtime'
      + (this.cfg.emitUtc ? '&timezone=UTC' : `&timezone=${encodeURIComponent(this.cfg.timezone)}`);
    const r = await fetch(u);
    if (!r.ok) throw new Error(`open-meteo ${r.status}`);
    this.cache = await r.json();
    this.cacheAt = Date.now();
    return this.cache;
  }

  async _buildResponse(lat, lon, asl) {
    const d = await this._fetchForecast(lat, lon);
    const h = d.hourly;
    const offsetSec = d.utc_offset_seconds || 0;
    // unixtime + utc_offset gives the wall-clock we want to print, in both modes.
    const fmt = (ts) => new Date((ts + offsetSec) * 1000);

    const lines = [];
    if (this.cfg.stationInfoLine) {
      const sr = fmt(d.daily.sunrise[0]);
      const ss = fmt(d.daily.sunset[0]);
      lines.push([
        1, this.cfg.name, lon.toFixed(4), lat.toFixed(4), asl,
        this.cfg.country, this.cfg.timezone, offsetSec / 3600,
        hhmm(sr), hhmm(ss),
      ].join(';') + ';');
    }

    for (let i = 0; i < h.time.length; i++) {
      const t = fmt(h.time[i]);
      const snow = (h.snowfall[i] || 0) > 0 ? 1 : 0;
      lines.push([
        `${p2(t.getUTCDate())}.${p2(t.getUTCMonth() + 1)}.${t.getUTCFullYear()}`,
        WEEKDAYS[t.getUTCDay()],
        p2(t.getUTCHours()),
        n(h.temperature_2m[i], 1),
        n(h.apparent_temperature[i], 1),
        r0(h.wind_speed_10m[i]),
        r0(h.wind_direction_10m[i]),
        r0(h.wind_gusts_10m[i]),
        r0(h.cloud_cover_low[i]),
        r0(h.cloud_cover_mid[i]),
        r0(h.cloud_cover_high[i]),
        n(h.precipitation[i], 1),
        r0(h.precipitation_probability[i]),
        snow.toFixed(1),
        r0(h.pressure_msl[i]),
        r0(h.relative_humidity_2m[i]),
        r0(h.cape ? h.cape[i] : 0),
        WMO_TO_PICTO[h.weather_code[i]] ?? 3,
        r0(h.shortwave_radiation[i]),
      ].join(';') + ';');
    }

    return `<mb_metadata>\n${HEADER_STATION}\n${HEADER_HOURLY}\n`
      + `</mb_metadata><valid_until>${this.cfg.validUntil}</valid_until>\n`
      + `<station>\n${lines.join('\n')}\n</station>\n`;
  }
}

const p2 = (v) => String(v).padStart(2, '0');
const n = (v, dp) => (Number.isFinite(v) ? v : 0).toFixed(dp);
const r0 = (v) => Math.round(Number.isFinite(v) ? v : 0);
const hhmm = (dt) => `${p2(dt.getUTCHours())}:${p2(dt.getUTCMinutes())}`;

module.exports = LoxoneWeatherServer;
