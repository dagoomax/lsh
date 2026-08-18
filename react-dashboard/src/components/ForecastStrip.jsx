import { useEffect, useState } from 'react'
import { gt, getLang } from '../i18n'
import { ICON_ANIM } from '../weatherIcons'

// Bottom-left of the Wall Dashboard: a compact vertical 5-day forecast list
// (day, icon, low–high gradient bar) matching the reference photo's strip.
// Reuses the same /api/openweather/forecast data WeatherForecast.jsx already
// fetches, as its own small component — that one stays a horizontal card
// strip for the normal dashboard, this is a different layout for the kiosk.
const POLL_MS = 10 * 60 * 1000

function useForecast() {
  const [days, setDays] = useState([])
  useEffect(() => {
    let stop = false
    const load = () => fetch('/api/openweather/forecast', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : { data: [] })
      .then(j => { if (!stop) setDays(j?.data || []) })
      .catch(() => {})
    load()
    const iv = setInterval(load, POLL_MS)
    return () => { stop = true; clearInterval(iv) }
  }, [])
  return days
}

const dayLabel = (dateStr, i) => {
  if (i === 0) return gt('weather_today', 'Today')
  const d = new Date(`${dateStr}T12:00:00`)
  return d.toLocaleDateString(getLang(), { weekday: 'short' })
}

export default function ForecastStrip() {
  const days = useForecast()
  if (!days.length) return null

  const lo = Math.min(...days.map(d => d.tempMin ?? d.tempMax ?? 0))
  const hi = Math.max(...days.map(d => d.tempMax ?? d.tempMin ?? 1))
  const span = Math.max(1, hi - lo)

  return (
    <div className="wall-forecast">
      {days.map((day, i) => {
        const min = day.tempMin ?? day.tempMax
        const max = day.tempMax ?? day.tempMin
        const left = ((min - lo) / span) * 100
        const width = Math.max(6, ((max - min) / span) * 100)
        return (
          <div key={day.date} className="wall-forecast-row">
            <span className="wall-forecast-day">{dayLabel(day.date, i)}</span>
            <span className={`wall-forecast-icon ${ICON_ANIM[day.icon] || ''}`}>{day.icon}</span>
            <div className="wall-forecast-bar-track">
              <div className="wall-forecast-bar" style={{ left: `${left}%`, width: `${width}%` }} />
            </div>
            <span className="wall-forecast-temps">
              {min != null ? Math.round(min) : '—'}°–{max != null ? Math.round(max) : '—'}°
            </span>
          </div>
        )
      })}
    </div>
  )
}
