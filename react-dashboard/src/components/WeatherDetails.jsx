import { gt } from '../i18n'
import { useHistoryPoints } from '../historyChart'
import Sparkline from './Sparkline'

// Sits between the clock and the agenda in the Wall Dashboard's right column
// — a compact 6h trend graph per outdoor metric (not just the current
// value WeatherClock's header has room for). Same openweather device data,
// each metric's own history via the shared /api/history endpoint.
const WIND_DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
const compass = (deg) => (deg == null ? null : WIND_DIRS[Math.round(deg / 22.5) % 16])

const METRICS = [
  { path: 'feelsLike', label: 'weather_feels_like', fallback: 'Feels like', color: '#ff9f0a' },
  { path: 'dewPoint',  label: 'weather_dew_point',  fallback: 'Dew point',  color: '#30d158' },
  { path: 'humidity',  label: 'weather_humidity',   fallback: 'Humidity',   color: '#0a84ff' },
  { path: 'windSpeed', label: 'weather_wind',       fallback: 'Wind',       color: '#bf5af2' },
  { path: 'pressure',  label: 'weather_pressure',   fallback: 'Pressure',   color: '#ff375f' },
]

function fmtValue(path, value, windDir) {
  switch (path) {
    case 'humidity': return `${Math.round(value)}%`
    case 'windSpeed': return `${value.toFixed(1)} m/s${compass(windDir) ? ' ' + compass(windDir) : ''}`
    case 'pressure': return `${Math.round(value)} hPa`
    default: return `${value.toFixed(1)}°`
  }
}

function WxGraph({ deviceKey, metric, value, windDir }) {
  const points = useHistoryPoints(`${deviceKey}/${metric.path}`, 60000, 6)
  return (
    <div className="wall-wxgraph">
      <div className="wall-wxgraph-head">
        <span>{gt(metric.label, metric.fallback)}</span>
        <span className="wall-wxgraph-value">{fmtValue(metric.path, value, windDir)}</span>
      </div>
      {points != null && points.length < 2
        ? <div className="wall-wxgraph-empty">{gt('collecting', 'Collecting data — check back in a few minutes')}</div>
        : <Sparkline points={points} height={36} color={metric.color} gradientId={`wx-${metric.path}`} />}
    </div>
  )
}

export default function WeatherDetails({ devices }) {
  const weatherDev = devices?.find((d) => d.type === 'openweather')
  const r = weatherDev?.readings || {}
  if (!weatherDev) return null

  const graphs = METRICS.filter((m) => typeof r[m.path]?.value === 'number')
  if (!graphs.length) return null

  return (
    <div className="wall-wxdetails">
      {graphs.map((m) => (
        <WxGraph key={m.path} deviceKey={weatherDev.key} metric={m} value={r[m.path].value} windDir={r.windDir?.value} />
      ))}
    </div>
  )
}
