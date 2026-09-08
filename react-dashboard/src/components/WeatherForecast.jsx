import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { gt, getLang } from '../i18n'
import { weatherIconFor, weatherSceneFor, moonPhaseFor } from '../weatherIcons'
import { DropletIcon } from './Icons'

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
      className="detail-card"
      style={{
        flex: '1 1 0', minWidth: 84, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        padding: '14px 8px', transition: 'border-color 0.15s, transform 0.15s',
        cursor: 'pointer', font: 'inherit', color: 'inherit', appearance: 'none',
      }}
      onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.96)' }}
      onMouseUp={e => { e.currentTarget.style.transform = 'none' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)' }}>
        {dayLabel(day.date, index)}
      </div>
      <div className={dayAnim} style={{ lineHeight: 1 }}><DayIcon size={34}/></div>
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
          <DropletIcon size={11} color="var(--accent-lt)"/> {day.pop}%
        </div>
      )}
    </button>
  )
}

function StatRow({ label, value, delay = 0, icon = null }) {
  if (value == null) return null
  return (
    <div className="detail-card wx-stat-in" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '10px 14px',
      animationDelay: `${delay}s`,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text2, #aeb6c4)' }}>
        {icon}{label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

// Realistic phase-shaded moon disc: a lit disc with a couple of soft maria
// (mare) patches, overlaid by a same-size dark disc shifted horizontally so
// the visible sliver matches the actual illumination fraction — the classic
// two-circle technique, driven by real astronomical math (moonPhaseFor).
function MoonDisc({ phase, size = 40 }) {
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2
  const dir = phase <= 0.5 ? -1 : 1
  const shiftPct = illum * 2 * dir * 50 // -100%..100% of the disc's own width
  return (
    <div style={{
      position: 'relative', width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
      background: 'radial-gradient(circle at 35% 30%, #f7f4ec 0%, #d7dbe2 55%, #a9afba 85%)',
      boxShadow: 'inset -3px -2px 6px rgba(0,0,0,0.35), 0 0 16px 3px rgba(200,212,235,0.35)',
    }}>
      <div style={{ position: 'absolute', width: '26%', height: '20%', top: '24%', left: '20%', borderRadius: '50%', background: 'rgba(110,118,135,0.35)', filter: 'blur(1px)' }} />
      <div style={{ position: 'absolute', width: '16%', height: '14%', top: '54%', left: '58%', borderRadius: '50%', background: 'rgba(110,118,135,0.3)', filter: 'blur(1px)' }} />
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: '#0b1020',
        transform: `translateX(${shiftPct}%)`, transition: 'transform 0.4s ease',
      }} />
    </div>
  )
}

function Stars({ count = 18, opacity = 1 }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="wx-scene-star" style={{
          top: `${(i * 37) % 90}%`, left: `${(i * 61) % 100}%`,
          width: 1 + (i % 3) * 0.6, height: 1 + (i % 3) * 0.6, opacity,
          animationDuration: `${2 + (i % 4)}s`, animationDelay: `${-(i % 5) * 0.6}s`,
        }} />
      ))}
    </>
  )
}

// The full-bleed atmosphere color behind every scene — dark and desaturated
// enough to stay legible under the popup's own text, but enough to make the
// card actually feel like "inside a sunny/rainy/snowy sky" rather than a
// dark app panel with some icons floating on it.
const MOOD = {
  sun:      'linear-gradient(180deg, rgba(18,42,78,0.5) 0%, rgba(55,100,155,0.28) 45%, rgba(255,170,90,0.18) 100%)',
  partly:   'linear-gradient(180deg, rgba(18,42,78,0.46) 0%, rgba(65,95,135,0.26) 50%, rgba(255,190,110,0.12) 100%)',
  cloud:    'linear-gradient(180deg, rgba(26,32,46,0.5) 0%, rgba(58,68,88,0.32) 55%, rgba(88,98,116,0.18) 100%)',
  rain:     'linear-gradient(180deg, rgba(8,12,24,0.6) 0%, rgba(18,26,44,0.42) 50%, rgba(30,42,64,0.26) 100%)',
  storm:    'linear-gradient(180deg, rgba(8,12,24,0.62) 0%, rgba(28,20,46,0.44) 50%, rgba(46,34,68,0.28) 100%)',
  snow:     'linear-gradient(180deg, rgba(16,26,44,0.5) 0%, rgba(58,78,102,0.3) 55%, rgba(180,200,220,0.18) 100%)',
  fog:      'linear-gradient(180deg, rgba(38,44,54,0.45) 0%, rgba(68,74,84,0.3) 55%, rgba(108,114,122,0.16) 100%)',
  night:    'linear-gradient(180deg, rgba(2,4,10,0.62) 0%, rgba(9,15,30,0.42) 55%, rgba(19,27,48,0.24) 100%)',
}
const Mood = ({ tone }) => <div className="wx-scene-mood" style={{ background: MOOD[tone] }} />

// Full-bleed animated backdrop for the day-detail popup, picked by condition
// (and, for clear/partly/cloudy scenes, by whether it's actually day or
// night). Deterministic (index-seeded, not Math.random) so it doesn't
// reshuffle if the popup re-renders while open.
function WeatherScene({ icon, isDay = true, moonPhase = 0 }) {
  const { scene } = weatherSceneFor(icon)
  const night = isDay === false

  if (scene === 'sun' || scene === 'partly' || scene === 'cloud') {
    if (night) {
      return (
        <div className="wx-scene">
          <Mood tone="night" />
          <div className="wx-scene-night-sky" />
          <Stars count={scene === 'cloud' ? 16 : 24} />
          <div style={{ position: 'absolute', top: '9%', right: '11%' }}>
            <MoonDisc phase={moonPhase} size={scene === 'sun' ? 72 : 60} />
          </div>
          {scene !== 'sun' && [0, 1, scene === 'cloud' ? 2 : null].filter(i => i != null).map(i => (
            <div key={i} className="wx-scene-cloud" style={{
              top: `${10 + i * 32}%`, left: `${-16 + i * 15}%`,
              width: 150 + i * 65, height: 56 + i * 22, opacity: 0.55 - i * 0.08,
              filter: `blur(${5 + i * 2}px)`,
              animationDuration: `${24 + i * 9}s`, animationDelay: `${-i * 8}s`,
            }} />
          ))}
        </div>
      )
    }
    if (scene === 'sun' || scene === 'partly') {
      return (
        <div className="wx-scene">
          <Mood tone={scene} />
          <div className="wx-scene-sky" style={{ opacity: scene === 'sun' ? 1 : 0.6 }} />
          <div className="wx-scene-sun-wrap" style={{ opacity: scene === 'sun' ? 1 : 0.65 }}>
            <div className="wx-scene-sun-rays" />
            <div className="wx-scene-sun-rays-2" />
            <div className="wx-scene-sun-disc" />
          </div>
          <div className="wx-scene-flare" style={{ width: 34, height: 34, top: '18%', right: '42%', animationDuration: '5.6s' }} />
          <div className="wx-scene-flare" style={{ width: 20, height: 20, top: '32%', right: '33%', animationDuration: '4.6s', animationDelay: '-1.6s' }} />
          <div className="wx-scene-flare" style={{ width: 11, height: 11, top: '44%', right: '26%', animationDuration: '3.8s', animationDelay: '-2.4s' }} />
          {scene === 'partly' && [0, 1].map(i => (
            <div key={i} className="wx-scene-cloud" style={{
              top: `${28 + i * 34}%`, left: `${-12 + i * 18}%`,
              width: 160 + i * 60, height: 60 + i * 20, opacity: 0.85 - i * 0.15,
              animationDuration: `${26 + i * 10}s`, animationDelay: `${-i * 9}s`,
            }} />
          ))}
        </div>
      )
    }
    // scene === 'cloud', daytime — four depth layers (far/blurrier & slow at
    // the back, near/crisper & faster up front) instead of one flat row.
    return (
      <div className="wx-scene">
        <Mood tone="cloud" />
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="wx-scene-cloud" style={{
            top: `${2 + i * 24}%`, left: `${-20 + i * 12}%`,
            width: 130 + i * 55, height: 48 + i * 22, opacity: 0.92 - i * 0.14,
            filter: `blur(${3 + (3 - i) * 2}px)`,
            animationDuration: `${18 + i * 8}s`, animationDelay: `${-i * 6}s`,
          }} />
        ))}
      </div>
    )
  }
  if (scene === 'rain' || scene === 'storm') {
    const drops = Array.from({ length: 38 }, (_, i) => i)
    const puddles = Array.from({ length: 7 }, (_, i) => i)
    return (
      <div className="wx-scene">
        <Mood tone={scene} />
        {night && <Stars count={8} opacity={0.5} />}
        <div className="wx-scene-overcast" />
        {[0, 1].map(i => (
          <div key={i} className="wx-scene-cloud" style={{
            top: `${-14 + i * 6}%`, left: `${-20 + i * 30}%`,
            width: `${150 - i * 20}%`, height: 90 - i * 15, opacity: 0.75 - i * 0.25,
            filter: `blur(${5 + i * 3}px)`,
            animationDuration: `${30 + i * 10}s`,
          }} />
        ))}
        <div className="wx-scene-rain-layer">
          {drops.map(i => (
            <div key={i} className="wx-scene-rain-drop" style={{
              left: `${(i * 113) % 130 - 15}%`, height: `${14 + (i % 5) * 5}%`,
              width: i % 4 === 0 ? 2.4 : 1.6,
              opacity: 0.5 + (i % 3) * 0.2,
              animationDuration: `${0.45 + (i % 5) * 0.12}s`, animationDelay: `${-(i % 9) * 0.22}s`,
            }} />
          ))}
        </div>
        <div className="wx-scene-ground-wet" />
        {puddles.map(i => (
          <div key={i} className="wx-scene-puddle" style={{
            left: `${4 + i * 14}%`, width: `${16 + (i % 3) * 6}px`,
            animationDuration: `${1.5 + (i % 3) * 0.4}s`, animationDelay: `${-(i % 5) * 0.35}s`,
          }} />
        ))}
        {scene === 'storm' && <div className="wx-scene-flash" />}
      </div>
    )
  }
  if (scene === 'snow') {
    const flakes = Array.from({ length: 28 }, (_, i) => i)
    return (
      <div className="wx-scene">
        <Mood tone="snow" />
        {night && <Stars count={14} opacity={0.6} />}
        {flakes.map(i => (
          <div key={i} className="wx-scene-snowflake" style={{
            left: `${(i * 41) % 100}%`, width: 2.5 + (i % 4) * 0.9, height: 2.5 + (i % 4) * 0.9,
            opacity: 0.45 + (i % 4) * 0.14,
            animationDuration: `${5 + (i % 6)}s`, animationDelay: `${-(i % 7) * 0.8}s`,
          }} />
        ))}
        <div className="wx-scene-ground-snow" />
      </div>
    )
  }
  if (scene === 'fog') {
    return (
      <div className="wx-scene">
        <Mood tone="fog" />
        {[0, 1, 2].map(i => (
          <div key={i} className="wx-scene-fog-band" style={{
            top: `${16 + i * 28}%`, animationDuration: `${16 + i * 6}s`, animationDelay: `${-i * 5}s`,
          }} />
        ))}
      </div>
    )
  }
  return null
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
  const isDay = day.isDay !== false
  const { accent } = weatherSceneFor(day.icon, isDay)
  const moon = moonPhaseFor(new Date(`${day.date}T12:00:00`))
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
          initial={{ opacity: 0, scale: 0.86, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 16 }}
          transition={{ type: 'spring', stiffness: 340, damping: 26 }}
          onClick={e => e.stopPropagation()}
          className="device-modal-glow"
          style={{
            // Scales up on larger screens (like every other popup in the app)
            // instead of stopping dead at a small flat cap — 50vw up to 680px
            // (matching DeviceModal's own top-tier cap), falling back to the
            // available width on narrow/mobile screens.
            position: 'relative', width: 'min(clamp(400px, 50vw, 680px), 100%)', maxHeight: '88vh',
            background: 'var(--modal-grad)', borderRadius: 22, overflow: 'hidden', overflowY: 'auto',
          }}>

          {/* gradient border via CSS mask — same Aurora gradient as every
              other popup, not a one-off blend */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 22, padding: 1, pointerEvents: 'none',
            background: 'var(--aurora-gradient)', opacity: 0.8,
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor', maskComposite: 'exclude',
          }} />

          {/* ambient glow blobs, tinted to this day's condition */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', borderRadius: 22 }}>
            <div style={{ position: 'absolute', top: -90, left: -60, width: 240, height: 240, borderRadius: '50%', background: `radial-gradient(circle, ${accent}, transparent 65%)` }} />
            <div style={{ position: 'absolute', bottom: -110, right: -70, width: 280, height: 280, borderRadius: '50%', background: 'radial-gradient(circle, color-mix(in srgb, var(--accent) 12%, transparent), transparent 65%)' }} />
          </div>

          {/* living, condition-specific backdrop — sun rays, drifting clouds,
              falling rain/snow, lightning, breathing fog, or (after dark) a
              real phase-accurate moon under a starfield */}
          <WeatherScene icon={day.icon} isDay={isDay} moonPhase={moon.phase} />

          {/* header */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14, padding: '22px 24px 12px' }}>
            <motion.div className={detailAnim} style={{ lineHeight: 1 }}
              initial={{ scale: 0.4, rotate: -18, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 15, delay: 0.08 }}>
              <DetailIcon size={46}/>
            </motion.div>
            <motion.div style={{ flex: 1, minWidth: 0 }}
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05, duration: 0.25 }}>
              <div className="modal-device-title" style={{ fontSize: 18, letterSpacing: '-0.01em' }}>{fullDayLabel(day.date, index)}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text3)', textTransform: 'capitalize' }}>
                {day.condition || '—'} · {isDay ? gt('weather_day', 'Day') : gt('weather_night', 'Night')}
              </div>
            </motion.div>
            <button onClick={onClose} title={gt('close', 'Close')} style={{
              width: 34, height: 34, borderRadius: 10, border: '1px solid var(--white-10)', cursor: 'pointer',
              background: 'var(--white-05)', color: 'var(--muted,#8b949e)', fontSize: 15,
            }}>✕</button>
          </div>

          {/* body */}
          <div style={{ position: 'relative', padding: '4px 24px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '4px 2px 12px' }}>
              <span style={{ fontSize: 46, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {day.tempMax != null ? Math.round(day.tempMax) : '—'}°
              </span>
              <span style={{ fontSize: 22, color: 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}>
                {day.tempMin != null ? Math.round(day.tempMin) : '—'}°
              </span>
              {day.feelsLike != null && (
                <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text3)' }}>
                  {gt('weather_feels_like', 'Feels like')} {Math.round(day.feelsLike)}°
                </span>
              )}
            </div>
            <StatRow delay={0.10} label={gt('weather_precip', 'Precipitation')} value={`${day.pop ?? 0}%`} />
            <StatRow delay={0.14} label={gt('weather_humidity', 'Humidity')} value={day.humidity != null ? `${day.humidity}%` : null} />
            <StatRow delay={0.18} label={gt('weather_wind', 'Wind')} value={day.windSpeed != null ? `${day.windSpeed} m/s${dir ? ' ' + dir : ''}` : null} />
            <StatRow delay={0.22} label={gt('weather_pressure', 'Pressure')} value={day.pressure != null ? `${day.pressure} hPa` : null} />
            <StatRow delay={0.26} label={gt('weather_clouds', 'Cloudiness')} value={day.clouds != null ? `${day.clouds}%` : null} />
            <StatRow delay={0.30}
              icon={<MoonDisc phase={moon.phase} size={16} />}
              label={gt('weather_moon_phase', 'Moon phase')}
              value={`${gt(moon.nameKey, moon.nameFallback)} · ${Math.round(moon.illumination * 100)}%`} />
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
