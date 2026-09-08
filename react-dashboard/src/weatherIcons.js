import {
  SunIcon, CloudSunIcon, CloudIcon, CloudRainIcon, CloudLightningIcon, SnowflakeIcon, CloudFogIcon,
} from './components/Icons'

// The server (src/openweather-client.js) sends a plain emoji character as
// each forecast step's `icon` field — this maps that emoji to the matching
// outline icon component + the CSS motion class it should carry (see
// styles/global.css: .wx-icon-* — sun glows, clouds drift, rain falls,
// storms flicker, snow settles, fog breathes). Shared by every weather
// widget (WeatherForecast, WeatherClock, ForecastStrip) so they stay in
// sync, and keeps the server→client contract (a plain emoji) unchanged.
const WEATHER_ICON = {
  '☀️': { Icon: SunIcon,            anim: 'wx-icon-sun' },
  '🌤️': { Icon: CloudSunIcon,       anim: 'wx-icon-partly' },
  '☁️': { Icon: CloudIcon,          anim: 'wx-icon-cloud' },
  '🌧️': { Icon: CloudRainIcon,      anim: 'wx-icon-rain' },
  '🌦️': { Icon: CloudRainIcon,      anim: 'wx-icon-partly' },
  '⛈️': { Icon: CloudLightningIcon, anim: 'wx-icon-storm' },
  '❄️': { Icon: SnowflakeIcon,      anim: 'wx-icon-snow' },
  '🌫️': { Icon: CloudFogIcon,       anim: 'wx-icon-fog' },
  '⛅': { Icon: CloudSunIcon,       anim: 'wx-icon-partly' },
}
const FALLBACK = WEATHER_ICON['⛅']

export function weatherIconFor(emoji) {
  return WEATHER_ICON[emoji] || FALLBACK
}

// Which full-bleed background scene (WeatherForecast's popup) and accent glow
// color go with a given forecast emoji — same source-of-truth spirit as
// WEATHER_ICON above, just one level more dramatic than a still icon.
const WEATHER_SCENE = {
  '☀️': { scene: 'sun',   accent: 'rgba(255,196,64,0.16)' },
  '🌤️': { scene: 'partly', accent: 'rgba(255,196,64,0.12)' },
  '⛅': { scene: 'partly', accent: 'rgba(255,196,64,0.12)' },
  '☁️': { scene: 'cloud',  accent: 'var(--white-14)' },
  '🌧️': { scene: 'rain',   accent: 'rgba(74,158,255,0.16)' },
  '🌦️': { scene: 'rain',   accent: 'rgba(255,196,64,0.1)' },
  '⛈️': { scene: 'storm',  accent: 'rgba(188,140,255,0.18)' },
  '❄️': { scene: 'snow',   accent: 'rgba(160,210,255,0.16)' },
  '🌫️': { scene: 'fog',    accent: 'var(--white-10)' },
}
const SCENE_FALLBACK = WEATHER_SCENE['⛅']
const NIGHT_ACCENT = 'rgba(120,150,255,0.16)' // cool moonlight instead of warm sun/amber

export function weatherSceneFor(emoji, isDay = true) {
  const s = WEATHER_SCENE[emoji] || SCENE_FALLBACK
  if (isDay === false && (s.scene === 'sun' || s.scene === 'partly' || s.scene === 'cloud')) {
    return { ...s, accent: NIGHT_ACCENT }
  }
  return s
}

// Kept for any other spot still keying off the raw emoji directly.
export const ICON_ANIM = Object.fromEntries(
  Object.entries(WEATHER_ICON).map(([emoji, { anim }]) => [emoji, anim])
)

// Moon phase — pure astronomical calculation from the calendar date (no API
// dependency; the same math any moon-phase calendar uses), referenced off a
// known new moon (2000-01-06 18:14 UTC) and the synodic month length.
const SYNODIC_MONTH_DAYS = 29.530588853
const KNOWN_NEW_MOON_UTC = Date.UTC(2000, 0, 6, 18, 14, 0)
const MOON_PHASE_NAMES = [
  ['weather_moon_new', 'New Moon'],
  ['weather_moon_waxing_crescent', 'Waxing Crescent'],
  ['weather_moon_first_quarter', 'First Quarter'],
  ['weather_moon_waxing_gibbous', 'Waxing Gibbous'],
  ['weather_moon_full', 'Full Moon'],
  ['weather_moon_waning_gibbous', 'Waning Gibbous'],
  ['weather_moon_last_quarter', 'Last Quarter'],
  ['weather_moon_waning_crescent', 'Waning Crescent'],
]

export function moonPhaseFor(date) {
  const diffDays = (date.getTime() - KNOWN_NEW_MOON_UTC) / 86400000
  let phase = (diffDays % SYNODIC_MONTH_DAYS) / SYNODIC_MONTH_DAYS
  if (phase < 0) phase += 1
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2
  const [nameKey, nameFallback] = MOON_PHASE_NAMES[Math.round(phase * 8) % 8]
  return { phase, illumination, nameKey, nameFallback }
}
