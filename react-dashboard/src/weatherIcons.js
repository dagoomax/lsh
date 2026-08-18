// Emoji → motion class (see styles/global.css: .wx-icon-*) so weather icons
// animate instead of sitting dead-still — sun glows, clouds drift, rain
// falls, storms flicker, snow settles, fog breathes. Shared by every weather
// widget (WeatherForecast, WeatherClock, ForecastStrip) so they stay in sync.
export const ICON_ANIM = {
  '☀️': 'wx-icon-sun', '🌤️': 'wx-icon-partly', '☁️': 'wx-icon-cloud',
  '🌧️': 'wx-icon-rain', '🌦️': 'wx-icon-partly', '⛈️': 'wx-icon-storm',
  '❄️': 'wx-icon-snow', '🌫️': 'wx-icon-fog',
}
