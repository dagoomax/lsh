import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { gt, getLang } from '../i18n'
import { weatherIconFor } from '../weatherIcons'

// 5-day forecast strip (OpenWeatherMap's free tier caps at 5 days — see the
// honesty note in openweather-client.js for why this isn't 7). Self-fetching
// and self-hiding: renders nothing until /api/openweather/forecast actually
// has data, so DeviceList can mount it unconditionally.
const POLL_MS = 10 * 60 * 1000
const WIND_DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
const compass = (deg) => deg == null ? null : WIND_DIRS[Math.round(deg / 22.5) % 16]

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
  return d.toLocaleDateString(getLang(), { weekday: 'short' })
}

function fullDayLabel(dateStr, index) {
  const d = new Date(`${dateStr}T12:00:00`)
  const weekday = d.toLocaleDateString(getLang(), { weekday: 'long', month: 'long', day: 'numeric' })
  if (index === 0) return `${gt('weather_today', 'Today')} · ${weekday}`
  if (index === 1) return `${gt('weather_tomorrow', 'Tomorrow')} · ${weekday}`
  return weekday
}

function DayCard({ day, index, onOpen }) {
  const { Icon: DayIcon, anim: dayAnim } = weatherIconFor(day.icon)
  return (
    <button
      onClick={() => onOpen(day, index)}
      style={{
        flex: '1 1 0', minWidth: 84, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        padding: '14px 8px', borderRadius: 14, background: 'var(--white-03)',
        border: '1px solid var(--white-07)', transition: 'background 0.15s, border-color 0.15s, transform 0.15s',
        cursor: 'pointer', font: 'inherit', color: 'inherit', appearance: 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--white-06)'; e.currentTarget.style.borderColor = 'var(--white-14)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--white-03)'; e.currentTarget.style.borderColor = 'var(--white-07)'; e.currentTarget.style.transform = 'none' }}
      onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.96)' }}
      onMouseUp={e => { e.currentTarget.style.transform = 'none' }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)' }}>
        {dayLabel(day.date, index)}
      </div>
      <div className={dayAnim} style={{ lineHeight: 1 }}><DayIcon size={30}/></div>
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
    </button>
  )
}

function StatRow({ label, value }) {
  if (value == null) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '10px 14px',
      background: 'var(--white-03)', border: '1px solid var(--white-07)', borderRadius: 14,
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2, #aeb6c4)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

function DayDetailModal({ day, index, onClose }) {
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  if (!day) return null
  const dir = compass(day.windDeg)
  const { Icon: DetailIcon, anim: detailAnim } = weatherIconFor(day.icon)
  return (
    <AnimatePresence>
      <motion.div key="wx-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(5,7,15,0.72)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
        }}>
        <motion.div key="wx-card"
          initial={{ opacity: 0, scale: 0.88, y: 26 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 16 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          onClick={e => e.stopPropagation()}
          className="device-modal-glow"
          style={{
            position: 'relative', width: 'min(380px, 100%)',
            background: 'var(--modal-grad)', borderRadius: 22, overflow: 'hidden',
          }}>

          {/* gradient border via CSS mask — same Aurora gradient as every
              other popup, not a one-off blend */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 22, padding: 1, pointerEvents: 'none',
            background: 'var(--aurora-gradient)', opacity: 0.8,
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor', maskComposite: 'exclude',
          }} />

          {/* ambient glow blobs */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', borderRadius: 22 }}>
            <div style={{ position: 'absolute', top: -90, left: -60, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,196,64,0.14), transparent 65%)' }} />
            <div style={{ position: 'absolute', bottom: -100, right: -60, width: 260, height: 260, borderRadius: '50%', background: 'radial-gradient(circle, color-mix(in srgb, var(--accent) 12%, transparent), transparent 65%)' }} />
          </div>

          {/* header */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px 12px' }}>
            <div className={detailAnim} style={{ lineHeight: 1 }}><DetailIcon size={34}/></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="modal-device-title" style={{ fontSize: 16, letterSpacing: '-0.01em' }}>{fullDayLabel(day.date, index)}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'capitalize' }}>{day.condition || '—'}</div>
            </div>
            <button onClick={onClose} title={gt('close', 'Close')} style={{
              width: 32, height: 32, borderRadius: 10, border: '1px solid var(--white-10)', cursor: 'pointer',
              background: 'var(--white-05)', color: 'var(--muted,#8b949e)', fontSize: 14,
            }}>✕</button>
          </div>

          {/* body */}
          <div style={{ position: 'relative', padding: '4px 20px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '4px 2px 10px' }}>
              <span style={{ fontSize: 34, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {day.tempMax != null ? Math.round(day.tempMax) : '—'}°
              </span>
              <span style={{ fontSize: 18, color: 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}>
                {day.tempMin != null ? Math.round(day.tempMin) : '—'}°
              </span>
              {day.feelsLike != null && (
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)' }}>
                  {gt('weather_feels_like', 'Feels like')} {Math.round(day.feelsLike)}°
                </span>
              )}
            </div>
            <StatRow label={gt('weather_precip', 'Precipitation')} value={`${day.pop ?? 0}%`} />
            <StatRow label={gt('weather_humidity', 'Humidity')} value={day.humidity != null ? `${day.humidity}%` : null} />
            <StatRow label={gt('weather_wind', 'Wind')} value={day.windSpeed != null ? `${day.windSpeed} m/s${dir ? ' ' + dir : ''}` : null} />
            <StatRow label={gt('weather_pressure', 'Pressure')} value={day.pressure != null ? `${day.pressure} hPa` : null} />
            <StatRow label={gt('weather_clouds', 'Cloudiness')} value={day.clouds != null ? `${day.clouds}%` : null} />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default function WeatherForecast() {
  const days = useForecast()
  const [selected, setSelected] = useState(null) // { day, index } | null
  if (!days.length) return null
  const { Icon: HeaderIcon } = weatherIconFor(days[0]?.icon)

  return (
    <div className="card" style={{
      margin: '8px 0 12px', borderRadius: 'var(--radius-lg)', overflow: 'hidden', padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <HeaderIcon size={15}/>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{gt('weather_forecast', 'Forecast')}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
        {days.map((day, i) => <DayCard key={day.date} day={day} index={i} onOpen={(d, idx) => setSelected({ day: d, index: idx })} />)}
      </div>
      {selected && <DayDetailModal day={selected.day} index={selected.index} onClose={() => setSelected(null)} />}
    </div>
  )
}
