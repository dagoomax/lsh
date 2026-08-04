import { useEffect, useState } from 'react'
import { gt } from '../i18n'

// 5-day forecast strip (OpenWeatherMap's free tier caps at 5 days — see the
// honesty note in openweather-client.js for why this isn't 7). Self-fetching
// and self-hiding: renders nothing until /api/openweather/forecast actually
// has data, so DeviceList can mount it unconditionally.
const POLL_MS = 10 * 60 * 1000

function useForecast() {
  const [days, setDays] = useState([])
  useEffect(() => {
    let stop = false
    const load = () => {
      fetch('/api/openweather/forecast', { credentials: 'same-origin' })
        .then(r => r.ok ? r.json() : { data: [] })
        .then(j => { if (!stop) setDays(j?.data || []) })
        .catch(() => {})
    }
    load()
    const iv = setInterval(load, POLL_MS)
    return () => { stop = true; clearInterval(iv) }
  }, [])
  return days
}

function dayLabel(dateStr, index) {
  if (index === 0) return gt('weather_today', 'Today')
  if (index === 1) return gt('weather_tomorrow', 'Tomorrow')
  const d = new Date(`${dateStr}T12:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'short' })
}

function DayCard({ day, index }) {
  return (
    <div
      style={{
        flex: '1 1 0', minWidth: 84, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        padding: '14px 8px', borderRadius: 14, background: 'var(--white-03)',
        border: '1px solid var(--white-07)', transition: 'background 0.15s, border-color 0.15s',
        cursor: 'default',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--white-06)'; e.currentTarget.style.borderColor = 'var(--white-14)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--white-03)'; e.currentTarget.style.borderColor = 'var(--white-07)' }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)' }}>
        {dayLabel(day.date, index)}
      </div>
      <div style={{ fontSize: 30, lineHeight: 1 }}>{day.icon}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          {day.tempMax != null ? Math.round(day.tempMax) : '—'}°
        </span>
        <span style={{ fontSize: 13, color: 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}>
          {day.tempMin != null ? Math.round(day.tempMin) : '—'}°
        </span>
      </div>
      {day.pop > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600,
          color: 'var(--accent-lt)', fontVariantNumeric: 'tabular-nums',
        }}>
          💧 {day.pop}%
        </div>
      )}
    </div>
  )
}

export default function WeatherForecast() {
  const days = useForecast()
  if (!days.length) return null

  return (
    <div className="card" style={{
      margin: '8px 0 12px', borderRadius: 'var(--radius-lg)', overflow: 'hidden', padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 15 }}>{days[0]?.icon || '⛅'}</span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{gt('weather_forecast', 'Forecast')}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
        {days.map((day, i) => <DayCard key={day.date} day={day} index={i} />)}
      </div>
    </div>
  )
}
