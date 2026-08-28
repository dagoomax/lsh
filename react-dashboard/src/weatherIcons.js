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

// Kept for any other spot still keying off the raw emoji directly.
export const ICON_ANIM = Object.fromEntries(
  Object.entries(WEATHER_ICON).map(([emoji, { anim }]) => [emoji, anim])
)
