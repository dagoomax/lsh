import { useEffect, useState } from 'react'
import { getLang } from '../i18n'
import { ICON_ANIM } from '../weatherIcons'

// Top-right corner of the Wall Dashboard: a big live clock plus the current
// condition/temperature — read straight off the openweather device that's
// already in the `devices` list (same data DeviceModal shows for that
// device), no separate fetch needed.
const CONDITION_ICON = [
  [/clear|sun/i, '☀️'],
  [/few clouds|partly/i, '🌤️'],
  [/thunderstorm|storm/i, '⛈️'],
  [/snow/i, '❄️'],
  [/rain|drizzle/i, '🌧️'],
  [/mist|fog|haze/i, '🌫️'],
  [/clouds|overcast/i, '☁️'],
]
const iconFor = (condition) => {
  if (!condition) return '⛅'
  const hit = CONDITION_ICON.find(([re]) => re.test(condition))
  return hit ? hit[1] : '⛅'
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(iv)
  }, [])
  return now
}

export default function WeatherClock({ devices }) {
  const now = useClock()
  const weatherDev = devices?.find(d => d.type === 'openweather')
  const r = weatherDev?.readings || {}
  const condition = r.condition?.value
  const temp = r.temperature?.value
  const icon = iconFor(condition)

  return (
    <div className="wall-weatherclock">
      <div className={`wall-weatherclock-icon ${ICON_ANIM[icon] || ''}`}>{icon}</div>
      <div className="wall-weatherclock-info">
        <div className="wall-weatherclock-cond">
          {condition ? condition.replace(/\b\w/g, c => c.toUpperCase()) : '—'}
          {typeof temp === 'number' && <>, {Math.round(temp)}°C</>}
        </div>
        <div className="wall-weatherclock-time">
          {now.toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}
